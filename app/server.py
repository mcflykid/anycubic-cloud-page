# SPDX-License-Identifier: GPL-3.0-or-later
"""Adaptateur web autonome de l’API Anycubic avec suivi MQTT et commandes sérialisées."""
import asyncio,base64,collections,contextlib,hashlib,json,logging,os,pathlib,re,secrets,threading,time,tempfile
from datetime import datetime,timezone
import aiohttp,ssl
from aiohttp import web
from aiofiles import open as aio_open
from vendor_config import load_vendor_config
load_vendor_config()
from file_preview import find_project_preview_url
from temperature_history import TemperatureHistory
from printer_registry import PrinterRegistry,SharedCloudAPI,select_printer,printer_key
from account_auth import AccountAuth
from web_host import access_control
from session_api import SessionRecovery
from native_controls import task_details,axis_payload,ai_payload
from anycubic_cloud_api.api.mqtt import AnycubicMQTTAPI
from anycubic_cloud_api.helpers.helpers import get_part_from_mqtt_topic
from anycubic_cloud_api.models.auth import AnycubicAuthMode
from anycubic_cloud_api.data_models.printer_properties import AnycubicMaterialColor
from anycubic_cloud_api.data_models.printing_settings import AnycubicPrintingSettings
from anycubic_cloud_api.const.api_endpoints import API_ENDPOINT
from anycubic_cloud_api.const.enums import AnycubicOrderID
from anycubic_cloud_api.data_models.orders import AnycubicBaseOrderRequest
from anycubic_cloud_api.exceptions.exceptions import AnycubicAuthError,AnycubicAuthTokensExpired,AnycubicCameraSessionError

ROOT=pathlib.Path(__file__).parent
FIELDS=json.loads((ROOT/'fields.json').read_text())
ALLOWED_ORIGIN=os.environ.get('PUBLIC_ORIGIN','http://localhost:8080')
COMMAND_READ_WAIT_SECONDS=30
UPLOAD_LIMIT=100*1024*1024
UPLOAD_STAGING=asyncio.Lock()
def now():"""Renvoie un horodatage ISO en UTC pour comparer les mises à jour HTTP et MQTT.""";return datetime.now(timezone.utc).isoformat()
def safeget(obj,key,default=None):
 """Renvoie un attribut imbriqué, ou default si le modèle cloud ne le fournit pas."""
 try:
  for part in key.split('.'):obj=getattr(obj,part)
  return obj
 except Exception:return default

def serial(obj):
 """Renvoie une structure JSON compatible, avec conversion ISO des dates."""
 if obj is None or isinstance(obj,(str,bool,int,float)):return obj
 if isinstance(obj,dict):return {str(k):serial(v) for k,v in obj.items()}
 if isinstance(obj,(list,tuple)):return [serial(v) for v in obj]
 if hasattr(obj,'isoformat'):return obj.isoformat()
 return str(obj)

def integer(value,lo,hi):
 """Renvoie un entier entre lo et hi ; lève ValueError pour un booléen ou une valeur invalide."""
 if isinstance(value,bool):raise ValueError('Nombre invalide')
 n=int(value)
 if not lo<=n<=hi:raise ValueError(f'Valeur attendue entre {lo} et {hi}')
 return n

def filepath(value):
 """Renvoie un chemin absolu canonique ; lève ValueError en cas de traversée ou de caractère nul."""
 value=str(value or '/')
 if len(value)>500 or '\x00' in value or '..' in value.split('/'):raise ValueError('Chemin invalide')
 return '/'+value.strip('/')

def history_entry(row):
 """Renvoie une notification affichable avec référence opaque et libellé français."""
 code=row.get('print_status')
 labels={2:'Impression terminée',3:'Impression arrêtée'}
 title=labels.get(code) or {'Print complete':'Impression terminée','Print to terminate':'Impression arrêtée','Print failed':'Échec de l’impression'}.get(row.get('title'),'Notification d’impression')
 return {'key':hashlib.sha256(str(row.get('id','')).encode()).hexdigest()[:20],'name':str(row.get('project_name') or 'Impression sans nom')[:300],'printer':str(row.get('printer_name') or 'Kobra S1')[:100],'time':row.get('create_time'),'result':title,'kind':'success' if code==2 else 'interrupted' if code==3 else 'info','unread':row.get('read')==0}

class CloudPageAPI(SessionRecovery,AnycubicMQTTAPI):
 """Relie les réponses MQTT et le renouvellement de session au moteur web."""
 def cloud_printer_updated(self):
  """Le rappel sans argument de la bibliothèque hérite du propriétaire du message actuellement routé."""
  owner=getattr(self,'message_engine',None)
  if owner:owner.mqtt_changed()
 def _mqtt_message_router(self,message):
  """Associe rapports et fraîcheur à la bonne machine sur l’unique connexion MQTT du compte."""
  primary=getattr(self,'cloud_engine',None);owner=primary
  registry=getattr(primary,'fleet_registry',None)
  if registry:owner=registry.owner(get_part_from_mqtt_topic(str(message.topic),6))
  self.message_engine=owner
  try:
   with contextlib.suppress(Exception):
    payload=json.loads(message.payload)
    if owner and owner.printer and get_part_from_mqtt_topic(str(message.topic),6)==str(owner.printer.key):
     owner.receive_ai_reply(str(message.topic),payload)
     owner.receive_video_reply(str(message.topic),payload)
     if (payload.get('type')=='file' and payload.get('action') in ['listLocal','listUdisk','fileDetails','listVideo','videoThumbnailList']) or payload.get('type') in ['light','aiSettings']:
      owner.file_messages[str(payload.get('msgid'))]=payload
      if payload.get('type')=='light':owner.light_report=(time.monotonic(),payload)
      while len(owner.file_messages)>60:owner.file_messages.pop(next(iter(owner.file_messages)))
   return super()._mqtt_message_router(message)
  finally:self.message_engine=None
 def _mqtt_on_connect(self,client,userdata,flags,rc,properties=None):
  if rc:getattr(self,'cloud_engine',engine).event('MQTT','Connexion refusée, code '+str(rc))
  return super()._mqtt_on_connect(client,userdata,flags,rc,properties)
 def _mqtt_on_disconnect(self,client,userdata,rc,*args):
  getattr(self,'cloud_engine',engine).event('MQTT','Déconnecté, code '+str(rc))
  return super()._mqtt_on_disconnect(client,userdata,rc)

class Engine:
 """Coordonne l’état cloud, le suivi MQTT et les commandes de l’interface."""
 def __init__(self):
  """Initialise le modèle et ses données locales depuis les paramètres fournis."""
  self.selected_id=os.environ.get('PRINTER_ID') or None;self.known_printers=[];self.state_dir=pathlib.Path('/appdata/state');self.catalogue_source=False;self.transport_only=False
  self.camera_message_id=None;self.camera_diagnostic=None;self.camera_stage=-1;self.reconnect_required=False
  self.camera_viewers=set();self.camera_owner=None;self.camera_close_task=None
  self.command_lock=asyncio.Lock()
  self.mqtt_auth_lock=asyncio.Lock();self.mqtt_auth_pending=False;self.account=AccountAuth();self.account_token=None;self.api=None;self.printer=None;self.session=None;self.ok=False;self.updated=None;self.mqtt_update=None;self.error='Connexion en cours';self.lock=asyncio.Lock();self.events=collections.deque(maxlen=40);self.cloudfiles={};self.commands=collections.OrderedDict();self.file_tasks={};self.light_report=None;self.preview_cache={};self.file_messages={};self.dir_cache={};self.mqtt_enabled=True;self.raw_info={};self.last_session=0;self.camera=None;self.mqtt_thread=None;self.presets=[{'name':'PLA','temperature':45,'hours':4},{'name':'PETG','temperature':55,'hours':6},{'name':'ABS / ASA','temperature':60,'hours':4},{'name':'PA','temperature':65,'hours':8}]
 def event(self,action,state):"""Ajoute un événement horodaté au journal local borné.""";self.events.appendleft({'time':now(),'action':action,'state':state})
 def receive_video_reply(self,topic,payload):
  """Ne retient que l’étape connue de la session vidéo courante et de cette machine, sans payload privé."""
  if not self.printer or get_part_from_mqtt_topic(topic,6)!=str(self.printer.key) or payload.get('type')!='video' or payload.get('action')!='startCapture':return
  if self.camera_message_id is None or str(payload.get('msgid'))!=str(self.camera_message_id):return
  stages={'done':(0,'Demande vidéo acquittée'),'initSuccess':(1,'Initialisation vidéo confirmée'),'joinSuccess':(2,'Jonction au canal vidéo confirmée'),'pushStarted':(3,'Envoi de la vidéo démarré'),'pushStoped':(4,'Envoi de la vidéo arrêté'),'pushFailed':(5,'La capture vidéo a échoué côté imprimante')}
  stage=stages.get(payload.get('state'))
  if stage and stage[0]>=self.camera_stage:self.camera_stage=stage[0];self.camera_diagnostic={'stage':payload['state'],'message':stage[1]}
 def mqtt_changed(self):"""Marque la fraîcheur des données lors d’une notification MQTT.""";self.mqtt_update=now()
 def mqtt_connected(self):"""Consigne l’établissement du suivi MQTT dans le journal affichable.""";self.event('MQTT','Connecté')
 def mqtt_run(self):
  """Exécute le suivi bloquant ; consigne son échec sans exposer le contenu de l’exception."""
  try:self.api.connect_mqtt()
  except Exception as e:self.event('MQTT','Connexion indisponible ('+type(e).__name__+')')
 def mqtt_start(self):
  """Démarre un seul fil de suivi, uniquement si MQTT reste activé."""
  if getattr(self,'fleet_registry',None) and self is not self.fleet_registry.default:return
  if not self.mqtt_enabled or (self.mqtt_thread and self.mqtt_thread.is_alive()):return
  if getattr(self,'fleet_registry',None):self.fleet_registry.restore_subscriptions()
  self.mqtt_thread=threading.Thread(target=self.mqtt_run,daemon=True);self.mqtt_thread.start()
 async def refresh_access(self):
  """Renvoie le jeton renouvelé après refus explicite ; propage les erreurs d’authentification."""
  token=await self.account.renew_after_rejection(self.session);self.account_token=token
  return token
 def session_renewed(self,api):
  """Programme la reconnexion MQTT pour employer la nouvelle session HTTP."""
  self.event('Cloud','Session renouvelée automatiquement')
  if self.api is api and self.printer:
   self.mqtt_auth_pending=True
   asyncio.create_task(self.restart_mqtt_auth(api))
 async def restart_mqtt_auth(self,api):
  """Relance MQTT après l’arrêt de l’ancien fil afin d’éviter deux suivis simultanés."""
  async with self.mqtt_auth_lock:
   if self.api is not api or not self.mqtt_auth_pending:return
   api.disconnect_mqtt()
   thread=self.mqtt_thread
   if thread and thread.is_alive():await asyncio.to_thread(thread.join,3)
   if self.api is not api or (thread and thread.is_alive()):return
   self.mqtt_thread=None;self.mqtt_auth_pending=False;self.mqtt_start()
 async def connect(self):
  """Connecte la cible du moteur ; le défaut facultatif se replie sur la première machine, jamais une cible secondaire explicite."""
  if getattr(self,'fleet_registry',None) and self is not self.fleet_registry.default:
   await self.fleet_registry.connect_secondary(self);return
  if not self.session:self.session=aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=45))
  token=await self.account.token(self.session)
  self.account_token=token
  if self.api:self.api.disconnect_mqtt()
  if self.mqtt_thread and self.mqtt_thread.is_alive():
   await asyncio.to_thread(self.mqtt_thread.join,3)
   if self.mqtt_thread.is_alive():raise RuntimeError('Reconnexion du suivi en attente')
  self.mqtt_thread=None;self.mqtt_auth_pending=False
  self.api=CloudPageAPI(self.session,self.session.cookie_jar,refresh_access=self.refresh_access,session_renewed=self.session_renewed,auth_token=token,auth_mode=AnycubicAuthMode.SLICER,mqtt_callback_printer_update=self.mqtt_changed,mqtt_callback_subscribed=self.mqtt_connected)
  if not await self.api.check_api_tokens():raise RuntimeError('Authentification refusée')
  self.api.cloud_engine=self
  self.api._mqtt_callback_printer_update=getattr(self.api,'cloud_printer_updated',self.mqtt_changed)
  printers=await self.api.list_my_printers();self.known_printers=printers
  selected=getattr(self,'pinned_id',None) or self.selected_id;candidates=[p for p in printers if str(p.id)==selected] if selected else printers[:1]
  if not candidates and not getattr(self,'pinned_id',None):candidates=printers[:1]
  if self.selected_id and (not candidates or str(candidates[0].id)!=str(self.selected_id)) and not self.catalogue_source:raise RuntimeError('Imprimante sélectionnée absente du compte')
  self.printer=candidates[0] if candidates else None
  if self.printer:self.pinned_id=str(self.printer.id)
  if self.printer is None:
   if self.catalogue_source and getattr(self,'fleet_registry',None):self.transport_only=True;self.reconnect_required=False;self.mqtt_start();return
   raise RuntimeError('Imprimante absente')
  await self.printer.update_info_from_api()
  self.reconnect_required=False
  self.api.mqtt_add_subscribed_printer(self.printer)
  self.mqtt_start()
 async def refresh_catalogue(self):
  """Le retrait du défaut libère son modèle, pas le transport partagé ; son identité n’est jamais réaffectée."""
  if not self.catalogue_source or self.api is None:return
  self.known_printers=await self.api.list_my_printers();rows={str(p.id):p for p in self.known_printers}
  if self.printer and str(self.printer.id) not in rows:
   self.api.mqtt_unsubscribe_printer_status(self.printer);self.printer=None;self.transport_only=True
  if self.transport_only and getattr(self,'pinned_id',None) in rows:
   self.printer=rows[self.pinned_id];self.transport_only=False
  if getattr(self,'fleet_registry',None):self.fleet_registry.restore_subscriptions()
 async def poll(self):
  """Actualise chaque cible et le catalogue du compte, sans changer l’identité d’un moteur existant."""
  while True:
   try:
    async with self.lock:
     primary=not getattr(self,'fleet_registry',None) or self is self.fleet_registry.default
     if self.catalogue_source and self.api and not self.reconnect_required:await self.refresh_catalogue()
     reconnect=self.reconnect_required or not self.api or (not self.printer and not self.transport_only) or primary and await self.account.token(self.session)!=self.account_token
     if reconnect:await self.connect()
     elif self.printer:await self.printer.update_info_from_api()
     self.raw_info=(await self.api.printer_info_for_id(self.printer.id,raw_data=True)).get('data') or {} if self.printer else {}
     self.updated=now();self.ok=bool(self.printer);self.error=None if self.printer else 'Choisissez une imprimante disponible dans le compte.'
     if self.mqtt_auth_pending:await self.restart_mqtt_auth(self.api)
     self.mqtt_start()
     try:await self.print_history(1);self.notifications_error=None
     except Exception:self.notifications_error='Messages temporairement indisponibles'
   except Exception as e:
    self.ok=False;self.error=getattr(self.account,'notice',None) or 'Connexion Anycubic indisponible ('+type(e).__name__+').'
    if 'Auth' in type(e).__name__ and type(e).__name__!='CloudSessionAuthError':
     owner=getattr(getattr(self,'fleet_registry',None),'default',self);owner.reconnect_required=True
     # Conserver le client jusqu’à la fin du fil permet de réessayer sa fermeture au cycle suivant.
     if owner.api:
      with contextlib.suppress(Exception):owner.api.disconnect_mqtt()
     self.printer=None
   await asyncio.sleep(60)
 def command_project_key(self):
  """Renvoie une référence opaque du projet affiché, liée à la machine ; None si le contexte manque."""
  p=self.printer;project=getattr(p,'latest_project',None)
  identifier=getattr(project,'id',None)
  attempt=[getattr(project,name,None) for name in ('_taskid','created_timestamp','_start_time')]
  return printer_key(json.dumps([p.id,identifier,*attempt])) if p and identifier is not None else None
 async def verify_active_project(self,name,expected):
  """Relit le projet sous le verrou de commande ; ValueError refuse une identité ou un état devenus différents."""
  p=self.printer
  if not expected or expected!=self.command_project_key():raise ValueError('Le projet a changé ou sa référence manque. Actualisez ; aucune commande envoyée.')
  try:await asyncio.wait_for(p.update_info_from_api(),timeout=10)
  except Exception:raise ValueError('État récent de l’impression indisponible. Aucune commande envoyée.') from None
  if self.printer is not p or expected!=self.command_project_key():raise ValueError('Le projet a changé pendant la vérification. Aucune commande envoyée.')
  if not p.printer_online or not p.latest_project or not p.latest_project_print_in_progress:raise ValueError('Aucune impression active confirmée. Aucune commande envoyée.')
  paused=p.latest_project_print_is_paused
  if name in ('pause','resume') and (not isinstance(paused,bool) or paused!=(name=='resume')):raise ValueError('L’état de pause a changé. Actualisez ; aucune commande envoyée.')
  self.updated=now()
  return p.latest_project
 def snapshot(self):
  """Renvoie l’état sérialisé et filtré pour le navigateur, sans identifiants de compte."""
  p=self.printer
  shared=isinstance(self.api,SharedCloudAPI)
  api=self.api.transport if shared else self.api
  disconnected=shared and api is None
  mqtt=getattr(api,'_mqtt_client',None)
  base={'ok':self.ok and not disconnected,'message':'Connexion en cours' if disconnected else self.error,'updated_at':self.updated,'mqtt_updated_at':self.mqtt_update,'mqtt_connected':bool(mqtt and mqtt.is_connected()),'public_commands':False,'upstream':'hass-anycubic_cloud_v3','events':list(self.events),'presets':self.presets}
  base['account_message']=getattr(self.account,'notice',None)
  base['notifications']=getattr(self,'history_cache',{}).get(1,(None,None))[1]
  base['notifications_error']=getattr(self,'notifications_error',None)
  base['camera_diagnostic']=self.camera_diagnostic
  base['mqtt_diagnostics']=getattr(api,'mqtt_diagnostics',{})
  if not p:return {**base,'printer':None}
  fields={k:serial(safeget(p,v)) for k,v in FIELDS.items()}
  # Le schéma de champs affichables écarte les identifiants privés ; l’aperçu brut doit aussi rester côté serveur.
  fields.pop('job_image_url',None)
  fields['command_project']=self.command_project_key();fields['firmware']=safeget(p,'fw_version.firmware_version');fields['firmware_available']=safeget(p,'fw_version.available_version');fields['ace_available']=[safeget(p,'primary_multi_color_box_fw_available_version'),safeget(p,'secondary_multi_color_box_fw_available_version')]
  fields['firmware_update_available']=safeget(p,'fw_version.update_available')
  fields['ace_updates']=[{'current':safeget(fw,'firmware_version'),'target':safeget(fw,'available_version'),'available':safeget(fw,'update_available'),'progress':safeget(fw,'total_progress')} for fw in (safeget(p,'multi_color_box_fw_version') or [])]
  fields['supported_functions']=safeget(p,'supported_function_strings');fields['camera_light']=safeget(p,'camera_light_on')
  fields['speed_modes']=safeget(p,'latest_project_available_print_speed_modes_data_object')
  fields['local_files']=safeget(p,'local_file_list_object');fields['usb_files']=safeget(p,'udisk_file_list_object')
  fields['local_path']=safeget(p,'local_file_list_path');fields['usb_path']=safeget(p,'udisk_file_list_path')
  boxes=[]
  for idx,box in enumerate(p.multi_color_box or []):
   boxes.append({'box_id':safeget(box,'box_id',idx),'index':idx,'spools':safeget(p,('primary' if idx==0 else 'secondary')+'_multi_color_box_spool_info_object',[]),'auto_feed':safeget(box,'auto_feed'),'temperature':safeget(box,'current_temperature'),'humidity':safeget(box,'humidity'),'loaded_slot':safeget(box,'loaded_slot'),'drying':{name:safeget(p,('primary' if idx==0 else 'secondary')+'_drying_status_'+name) for name in ['is_drying','target_temperature','total_duration','remaining_time']}})

  rawboxes=self.raw_info.get('multi_color_box') or []
  if isinstance(rawboxes,dict):rawboxes=[rawboxes]
  for i,b in enumerate(boxes):
   if i<len(rawboxes):
    b['humidity']=rawboxes[i].get('humidity')
    for j,spool in enumerate(b['spools'] or []):
     rawslots=rawboxes[i].get('slots') or []
     if j<len(rawslots):
      rawslot=rawslots[j];spool['remaining_percent']=rawslot.get('consumables_percent') if rawslot.get('edit_status')==0 else rawslot.get('consumables_percent') or None
      edit=rawslot.get('edit_status');spool['rfid']=edit==0 if isinstance(edit,int) and not isinstance(edit,bool) else None
      spool['brand']='Anycubic' if spool['rfid'] is True else None
  fields['task_details']=task_details(safeget(p,'latest_project'))
  fields['axes_supported']=67 in (self.raw_info.get('type_function_ids') or [])
  features={r.get('name'):r.get('value') for r in self.raw_info.get('features') or [] if isinstance(r,dict)}
  fields['foreign_detection_supported']=bool(features.get('fod_support'))
  fields['boxes']=boxes
  fields['material_rack']=safeget(p,'material_rack_spool_info_object',[])
  fields['statistics']={'material':safeget(p,'material_used'),'hours':safeget(p,'total_print_time_hrs'),'print_count':safeget(p,'print_count')}
  return serial({**base,'printer':fields})
 async def direct_request(self,kind,action,data):
  """Renvoie la réponse MQTT corrélée ; lève ValueError sans connexion ou sans réponse sous dix secondes."""
  if not self.api or not self.api._mqtt_client or not self.api._mqtt_client.is_connected():raise ValueError('La connexion à l’imprimante n’est pas disponible')
  msgid=str(__import__('uuid').uuid4())
  self.api._mqtt_publish_to_printer(self.printer,kind,{'type':kind,'action':action,'timestamp':int(time.time()*1000),'msgid':msgid,'data':data})
  deadline=time.monotonic()+10
  while msgid not in self.file_messages:
   if time.monotonic()>deadline:raise ValueError('L’imprimante n’a pas confirmé cette demande')
   await asyncio.sleep(.1)
  return self.file_messages.pop(msgid)
 async def local_preview(self,source,name,path):
  """Renvoie une image locale en ligne ou None ; lève ValueError si le chemin ou la réponse est invalide."""
  filename='/'.join(x for x in [filepath(path).strip('/'),str(name)] if x)
  if '..' in filename.split('/') or '\x00' in filename:raise ValueError('Nom de fichier invalide')
  cachekey=(source,filename)
  if cachekey in self.preview_cache:return self.preview_cache[cachekey]
  # La consultation native Slicer 1239 reçoit son aperçu par MQTT, pas dans la réponse HTTP.
  from anycubic_cloud_api.data_models.orders import AnycubicProjectOrderRequest
  msgid=await self.api._send_anycubic_order(AnycubicProjectOrderRequest(order_id=1239,printer_id=self.printer.id,project_id=0,order_data={'root':'local' if source=='local' else 'udisk','filename':filename,'plate_index':0}))
  deadline=time.monotonic()+12
  while str(msgid) not in self.file_messages:
   if time.monotonic()>deadline:raise ValueError('L’imprimante n’a pas répondu à la demande d’aperçu')
   await asyncio.sleep(.1)
  response=self.file_messages.pop(str(msgid))
  data=response.get('data') or {}
  if isinstance(data,dict) and isinstance(data.get('file_details'),dict):data=data['file_details']
  if isinstance(data,dict):
   for key in ['png_image','thumbnail']:
    encoded=data.get(key)
    if isinstance(encoded,str) and len(encoded)<4*1024*1024:
     with contextlib.suppress(Exception):
      raw=base64.b64decode(encoded,validate=True)
      if raw.startswith(b'\x89PNG\r\n\x1a\n') or raw.startswith(b'\xff\xd8'):
       image='data:'+('image/png' if raw.startswith(b'\x89PNG') else 'image/jpeg')+';base64,'+encoded
       self.preview_cache[cachekey]=image
       while len(self.preview_cache)>20:self.preview_cache.pop(next(iter(self.preview_cache)))
       return image
  return None
 async def read_files(self,source,path):
  """Renvoie fichiers et chemin de local ou usb ; lève ValueError si la consultation n’est pas confirmée."""
  p=self.printer
  if not p or not self.api:raise ValueError('Connexion à l’imprimante en cours')
  if not (self.api._mqtt_client and self.api._mqtt_client.is_connected()):raise ValueError('La connexion à l’imprimante se rétablit. Réessayez dans quelques secondes.')
  canonical=filepath(path)
  async def fetch_records(folder):
   """Corrèle la réponse au dossier demandé, le firmware pouvant omettre son chemin."""
   wire=folder.strip('/') or '/'
   setattr(p,'_pending_'+('local' if source=='local' else 'udisk')+'_file_list_path',folder)
   method=self.api._send_order_list_local_files if source=='local' else self.api._send_order_list_udisk_files
   msgid=await method(p,file_path=wire)
   deadline=time.monotonic()+12
   while str(msgid) not in self.file_messages:
    if time.monotonic()>deadline:raise ValueError('L’imprimante n’a pas répondu à la demande de fichiers. Réessayez.')
    await asyncio.sleep(.1)
   response=self.file_messages.pop(str(msgid))
   if response.get('state')!='done':raise ValueError('Ce dossier n’est pas accessible sur l’imprimante')
   data=response.get('data') or {}
   return data.get('records') or []
  records=await fetch_records(canonical)
  if source=='local' and canonical=='/' and p.machine_name=='Anycubic Kobra S1':
   # Le firmware S1 omet les modèles usine de la liste racine ; vérifier leur dossier avant de l’ajouter.
   cached=self.dir_cache.get('test_model')
   if not cached or time.time()-cached[0]>300:
    try:
     factory=await fetch_records('/test_model')
     self.dir_cache['test_model']=(time.time(),bool(factory))
    except ValueError:self.dir_cache['test_model']=(time.time(),False)
   if self.dir_cache.get('test_model',(0,False))[1] and not any(r.get('filename')=='test_model' for r in records):records=[{'filename':'test_model','is_dir':True,'timestamp':0,'size':0},*records]
  setter=p._set_local_file_list if source=='local' else p._set_udisk_file_list
  setter(records,file_path=canonical)
  rows=p.local_file_list_object if source=='local' else p.udisk_file_list_object
  return {'files':rows,'path':canonical}
 async def cloud_files(self,page):
  """Renvoie une page de fichiers et le quota, avec références opaques pour les actions ultérieures."""
  files=await self.api.get_user_cloud_files(page=page,limit=20)
  rows=[]
  for f in files or []:
   handle=hashlib.sha256(str(f.id).encode()).hexdigest()[:20];self.cloudfiles[handle]=f
   rows.append({'handle':handle,'name':f.old_filename,'size_mb':f.size_mb,'printable':f.gcode_id is not None})
  store=await self.api.get_user_cloud_store()
  return {'files':rows,'page':page,'has_more':len(rows)==20,'store':{k:serial(safeget(store,k)) for k in ['total_bytes','used_bytes','available_bytes']}}
 async def print_history(self,page):
  """Renvoie les notifications paginées filtrées ; lève ValueError si le cloud refuse la lecture."""
  from anycubic_cloud_api.models.http import AnycubicAPIEndpoint,HTTP_METHODS
  cached=getattr(self,'history_cache',{}).get(page)
  if cached and time.monotonic()-cached[0]<30:return cached[1]
  response=await self.api._fetch_api_resp(AnycubicAPIEndpoint(HTTP_METHODS.POST,'/v2/message/getMessages'),params={'type':1,'page':page,'limit':20})
  counts=await self.api._fetch_api_resp(AnycubicAPIEndpoint(HTTP_METHODS.POST,'/v2/message/getMessageCount'),params={})
  if response.get('code')!=1 or not isinstance(response.get('data'),list):raise ValueError('Le journal Anycubic est temporairement indisponible')
  rows=[history_entry(r) for r in response['data'] if isinstance(r,dict)]
  if not hasattr(self,'history_keys'):self.history_keys={}
  if not hasattr(self,'notification_rows'):self.notification_rows={}
  for raw in response['data']:
   if isinstance(raw,dict) and isinstance(raw.get('id'),int):
    k=history_entry(raw)['key'];self.history_keys[k]=raw['id'];self.notification_rows[k]=raw
  while len(self.history_keys)>1000:self.history_keys.pop(next(iter(self.history_keys)))
  while len(self.notification_rows)>1000:self.notification_rows.pop(next(iter(self.notification_rows)))
  count=next((r for r in counts.get('data') or [] if r.get('type')==1),{})
  result={'items':rows,'page':page,'total':int(count.get('count',len(rows))),'unread':int(count.get('newcount',0)),'has_more':page*20<int(count.get('count',0)),'updated_at':now()}
  if not hasattr(self,'history_cache'):self.history_cache={}
  self.history_cache[page]=(time.monotonic(),result)
  while len(self.history_cache)>10:self.history_cache.pop(next(iter(self.history_cache)))
  return result
 async def mark_history_read(self,key=None,all_items=False):
  """Marque une clé connue ou toutes les notifications ; lève ValueError sans confirmation cloud."""
  from anycubic_cloud_api.models.http import AnycubicAPIEndpoint,HTTP_METHODS
  if all_items:
   endpoint='/v2/message/setRead';params={}
  else:
   mid=getattr(self,'history_keys',{}).get(str(key))
   if mid is None:raise ValueError('Actualisez l’historique avant de marquer cette notification comme lue')
   endpoint='/v2/message/setReadById';params={'id':mid}
  result=await self.api._fetch_api_resp(AnycubicAPIEndpoint(HTTP_METHODS.POST,endpoint),params=params,query=params or None)
  if result.get('code')!=1:raise ValueError('Anycubic n’a pas confirmé la mise à jour de lecture')
  self.history_cache={}
  return {'ok':True,'message':'Notifications marquées comme lues' if all_items else 'Notification marquée comme lue'}
 async def delete_history(self,key=None,all_items=False):
  """Efface une clé connue ou les identifiants collectés ; lève ValueError si la collecte est incomplète."""
  from anycubic_cloud_api.models.http import AnycubicAPIEndpoint,HTTP_METHODS
  if all_items:
   ids=[]
   for page in range(1,251):
    result=await self.api._fetch_api_resp(AnycubicAPIEndpoint(HTTP_METHODS.POST,'/v2/message/getMessages'),params={'type':1,'page':page,'limit':20})
    if result.get('code')!=1 or not isinstance(result.get('data'),list):raise ValueError('Lecture de l’historique impossible ; aucun effacement envoyé')
    rows=result['data'];ids.extend(r['id'] for r in rows if isinstance(r,dict) and isinstance(r.get('id'),int))
    if len(rows)<20:break
   else:raise ValueError('Trop de notifications pour un effacement unique')
  else:
   mid=getattr(self,'history_keys',{}).get(str(key))
   if mid is None:raise ValueError('Actualisez l’historique avant d’effacer cette notification')
   ids=[mid]
  if ids:
   result=await self.api._fetch_api_resp(AnycubicAPIEndpoint(HTTP_METHODS.POST,'/v2/message/delete'),params={'ids':ids})
   if result.get('code')!=1:raise ValueError('Anycubic n’a pas confirmé l’effacement')
  self.history_cache={};self.history_keys={};self.notification_rows={}
  return {'ok':True,'message':'Notifications effacées' if all_items else 'Notification effacée'}
 def receive_ai_reply(self,topic,payload):
  """Retient uniquement la réponse IA de la machine et de la consultation en cours."""
  started=getattr(self,'ai_query_started',None)
  if started is None or time.monotonic()-started>30:return
  parts=topic.split('/')
  if len(parts)<=6 or not self.printer or not getattr(self.printer,'key',None) or parts[6]!=str(self.printer.key):return
  if payload.get('type')!='aiSettings' or payload.get('action')!='query' or payload.get('state')!='done':return
  data=payload.get('data')
  if isinstance(data,dict) and isinstance(data.get('ai_settings'),dict):self.ai_query_reply=(started,payload)
 async def cloud_query(self,order,data=None):
  """Renvoie les données de consultation ; lève ValueError en cas de refus ou d’absence de réponse MQTT."""
  from anycubic_cloud_api.data_models.orders import AnycubicBaseOrderRequest,AnycubicProjectOrderRequest
  started=time.monotonic()
  if order==1242:self.ai_query_started=started;self.ai_query_reply=None
  request=AnycubicBaseOrderRequest(order_id=order,printer_id=self.printer.id) if order==1242 else AnycubicProjectOrderRequest(order_id=order,printer_id=self.printer.id,project_id=0,order_data=data or {})
  try:
   mid=await self.api._send_anycubic_order(request)
   if not mid:raise ValueError('La consultation n’a pas été acceptée par Anycubic')
   deadline=time.monotonic()+(30 if order==1242 else 15)
   while True:
    if order==1242:
     reply=getattr(self,'ai_query_reply',None)
     if reply and reply[0]==started:response=reply[1];break
    elif str(mid) in self.file_messages:response=self.file_messages.pop(str(mid));break
    if time.monotonic()>deadline:raise ValueError('L’imprimante n’a pas répondu à cette consultation')
    await asyncio.sleep(.1)
   if response.get('state')!='done':raise ValueError('Cette fonction n’est pas disponible sur l’imprimante')
   return response.get('data') or {}
  finally:
   if order==1242:self.ai_query_started=None
 async def ai_settings(self):
  """Renvoie les réglages IA filtrés ; lève ValueError si la machine est occupée ou la réponse absente."""
  if not self.printer.is_available or self.printer.latest_project_print_in_progress:raise ValueError('Les réglages IA sont disponibles lorsque l’imprimante est libre')
  cache=getattr(self,'ai_cache',None)
  if cache and time.monotonic()-cache[0]<5:return cache[1]
  result=await self.cloud_query(1242);settings=result.get('ai_settings')
  if not isinstance(settings,dict):raise ValueError('Les réglages IA ne sont pas fournis par l’imprimante')
  clean={k:settings.get(k) for k in ['status','sensitivity_level','notice_type']}
  self.ai_cache=(time.monotonic(),clean);return clean
 def slots(self,data):
  """Convertit les numéros de bobines en indices ; renvoie None sans sélection, ValueError si invalide."""
  values=data.get('slots')
  if not values:return None
  if not isinstance(values,list) or len(values)>8:raise ValueError('Liste de bobines invalide')
  return self.printer.print_slot_numbers_to_indices([integer(v,1,8) for v in values])
 async def action(self,name,d):
  """Renvoie le résultat textuel d’une commande validée ; lève ValueError si interdite ou non acceptée."""
  p=self.printer;a=self.api
  if not p or not a:raise ValueError('Imprimante non connectée')
  if name in ['cloud-rename','cloud-delete-many','task-delete-many','task-reprint','calibrate','hardware','assist','screen','factory-reset','task-rate','timelapse']:
   return await self.extras.action(name,d)
  box=integer(d.get('box',0),0,max(0,p.connected_ace_units-1));slot=integer(d.get('slot',1),1,4)-1
  if name in ['axis','axis-off','ai-settings']:
   if not p.is_available or p.latest_project_print_in_progress:raise ValueError('Commande indisponible pendant une impression ou une opération')
   from anycubic_cloud_api.data_models.orders import AnycubicProjectOrderRequest
   if name=='axis':
    if 67 not in (self.raw_info.get('type_function_ids') or []):raise ValueError('Contrôle des axes non annoncé par l’imprimante')
    payload=axis_payload(d.get('axis'),d.get('direction'),d.get('distance'));order=201
   elif name=='axis-off':payload={};order=1213
   else:
    previous=await self.ai_settings();payload=ai_payload(d,previous);order=1243;self.ai_cache=None
   await a._send_anycubic_order(AnycubicProjectOrderRequest(order_id=order,printer_id=p.id,project_id=0,order_data=payload))
   return 'Commande transmise à Anycubic ; vérifiez son application sur la machine'
  if name in ['pause','resume','cancel']:
   project=await self.verify_active_project(name,d.get('project_key'))
   result=await getattr(p,name+'_print')(project=project)
  elif name=='light':
   enabled=bool(d['enabled']);channel=2 if p.machine_name=='Anycubic Kobra S1' else p.camera_light_type
   started=time.monotonic()
   result=await a._send_order_set_light_status(p,enabled,light_type=channel)
   if result is None:raise ValueError('La commande d’éclairage n’a pas été acceptée')
   await p.query_camera_light_status()
   deadline=time.monotonic()+6
   while time.monotonic()<deadline:
    if self.light_report and self.light_report[0]>=started:
     response=self.light_report[1];data=response.get('data') or {};value=data.get('status',data.get('light')) if isinstance(data,dict) else None
     if response.get('state')=='done' and value is not None and bool(int(value))==enabled:return 'Éclairage '+('allumé' if enabled else 'éteint')+' : état confirmé par l’imprimante'
    await asyncio.sleep(.1)
   return 'Demande d’éclairage envoyée. Vérifiez son état dans la vidéo.'
  elif name=='dry-start':result=await p.multi_color_box_drying_start(duration=integer(d['hours'],1,24)*60,target_temp=integer(d['temperature'],35,70),box_id=box)
  elif name=='dry-stop':result=await p.multi_color_box_drying_stop(box_id=box)
  elif name=='auto-feed':result=await p.multi_color_box_set_auto_feed(bool(d['enabled']),box_id=box)
  elif name=='feed':result=await p.multi_color_box_feed_filament(slot_index=slot,box_id=box,finish=bool(d.get('finish',False)))
  elif name=='retract':result=await p.multi_color_box_retract_filament(box_id=box)
  elif name=='slot':
   color=str(d['color'])
   if not re.fullmatch(r'#[0-9a-fA-F]{6}',color):raise ValueError('Couleur invalide')
   material=str(d['material'])
   if material not in ['PLA','PETG','ABS','PACF','PC','ASA','HIPS','PA','PLA SE']:raise ValueError('Matériau non pris en charge par la commande du dépôt')
   c=AnycubicMaterialColor(*[int(color[i:i+2],16) for i in (1,3,5)])
   result=await p.multi_color_box_set_slot(slot,slot_color=c,slot_material_type=material,box_id=box)
  elif name=='settings':
   ranges={'print_speed_mode':(0,10),'target_nozzle_temp':(0,320),'target_hotbed_temp':(0,120),'fan_speed_pct':(0,100),'aux_fan_speed_pct':(0,100),'box_fan_level':(0,3),'bottom_layers':(0,1000),'bottom_time':(0,1000),'off_time':(0,1000),'on_time':(0,1000)}
   values={k:integer(v,*ranges[k]) for k,v in d.items() if k in ranges and v not in ['',None]}
   if not values:raise ValueError('Aucun réglage fourni')
   if not p.latest_project:raise ValueError('Ces réglages nécessitent une impression active, comme dans le dépôt')
   result=await a._send_order_change_print_settings(p,AnycubicPrintingSettings(**values))
  elif name in ['files-local','files-usb']:
   await self.read_files('local' if name=='files-local' else 'usb',d.get('path'));return 'Liste reçue de l’imprimante'
  elif name in ['delete-local','delete-usb','print-local','print-usb']:
   source='local' if name.endswith('local') else 'udisk';filename=str(d['name'])
   if not filename or '/' in filename or '\x00' in filename or len(filename)>255:raise ValueError('Nom de fichier invalide')
   kw={'file_name':filename,'file_path':filepath(d.get('path')).strip('/') or '/'}
   if name.startswith('print'):
    if not p.is_available:raise ValueError('Imprimante non disponible')
    kw['slot_index_list']=self.slots(d)
   result=await getattr(p,('delete_' if name.startswith('delete') else 'print_')+source+'_file')(**kw)
  elif name in ['delete-cloud','print-cloud']:
   f=self.cloudfiles.get(str(d.get('handle')))
   if f is None:raise ValueError('Actualisez la liste des fichiers cloud')
   if name=='delete-cloud':result=await a.delete_file_from_cloud(f.id)
   else:
    if not p.is_available:raise ValueError('Imprimante non disponible')
    if f.gcode_id is None:raise ValueError('Ce fichier ne dispose pas de G-code cloud')
    result=await p.print_with_cloud_gcode_id(f.gcode_id,self.slots(d))
  elif name=='rename':
   value=str(d.get('name','')).strip()
   if not 1<=len(value)<=64:raise ValueError('Nom entre 1 et 64 caractères')
   result=await a.set_printer_name(p,value)
  elif name=='firmware':
   if not p.is_available:raise ValueError('Imprimante non disponible')
   if safeget(p,'fw_version.update_available') is not True:raise ValueError('Aucune mise à jour de l’imprimante n’est proposée par Anycubic')
   result=await p.update_printer_firmware()
  elif name=='ace-firmware':
   if not p.is_available:raise ValueError('Imprimante non disponible')
   versions=safeget(p,'multi_color_box_fw_version') or []
   if box>=len(versions):raise ValueError('Version de l’ACE non reçue. Actualisez les informations.')
   fw=versions[box]
   if safeget(fw,'update_available') is not True:raise ValueError('Aucune mise à jour de cet ACE n’est proposée par Anycubic')
   result=await p.update_printer_multi_color_box_firmware(box_id=box)
  elif name=='query':
   await p.update_info_from_api()
   self.raw_info=(await a.printer_info_for_id(p.id,raw_data=True)).get('data') or {};self.updated=now();self.ok=True;self.error=None;result=True
  elif name=='mqtt-on':
   owner=self.fleet_registry.default if getattr(self,'fleet_registry',None) else self;owner.mqtt_enabled=True;owner.mqtt_start();return 'Connexion MQTT du compte demandée'
  elif name=='mqtt-off':
   owner=self.fleet_registry.default if getattr(self,'fleet_registry',None) else self;owner.mqtt_enabled=False;a.disconnect_mqtt();return 'Déconnexion MQTT du compte demandée'
  elif name=='presets':
   presets=d.get('presets',[])
   if len(presets)!=4:raise ValueError('Quatre préréglages attendus')
   self.presets=[{'name':str(x['name'])[:25],'temperature':integer(x['temperature'],35,70),'hours':integer(x['hours'],1,24)} for x in presets]
   self.state_dir.mkdir(mode=0o700,parents=True,exist_ok=True);path=self.state_dir/'presets.json';path.write_text(json.dumps(self.presets));return 'Préréglages enregistrés'
  else:raise ValueError('Commande inconnue')
  if result is None or result is False:raise ValueError('Aucune commande acceptée par le moteur Anycubic')
  return 'Commande acceptée par Anycubic ; confirmation machine en attente'

engine=Engine()
def request_engine(request):
 """Les appels directs de tests gardent leur doublure ; les requêtes HTTP ont une cible figée par middleware."""
 return request.get('selected_engine',engine) if isinstance(request,web.Request) else engine

def verify_printer_target(request,selected):
 """Refuse une cible modifiée pendant une attente ; la vérification précède tout envoi physique sous verrou."""
 if isinstance(request,web.Request):
  expected=request.get('printer_key')
  registry=getattr(selected,'fleet_registry',None)
  if expected and registry and expected not in registry.catalogue():raise ValueError('Cette imprimante a quitté le compte. Aucune commande envoyée.')
  if expected and (not selected.printer or printer_key(selected.printer.id)!=expected):raise ValueError('L’imprimante ciblée a changé ou n’est pas prête. Actualisez sans répéter la commande.')

@web.middleware
async def errors(request,handler):
 """Convertit les erreurs en réponses HTTP sans publier les détails internes des exceptions inattendues."""
 try:return await handler(request)
 except web.HTTPException:raise
 except AnycubicCameraSessionError as e:
  request_engine(request).event('Caméra',e.reason)
  return web.json_response({'ok':False,'message':str(e),'camera_error':e.reason},status=409)
 except (ValueError,KeyError,TypeError) as e:return web.json_response({'ok':False,'message':str(e)[:200]},status=400)
 except Exception as e:
  request_engine(request).event('Erreur',type(e).__name__)
  return web.json_response({'ok':False,'message':('La caméra ne répond pas pour le moment. Réessayez dans quelques secondes.' if request.path=='/imprimante-api/camera-session' else 'Anycubic n’a pas confirmé cette opération. Vérifiez l’état de la machine avant un nouvel essai.')},status=409)

async def status(req):
 """Renvoie l’état de la cible propre à la requête, sans sélection globale ni cache navigateur."""
 return web.json_response(request_engine(req).snapshot(),headers={'Cache-Control':'no-store'})

async def printers(req):
 """Renvoie les noms et références opaques du compte ; aucun identifiant cloud brut."""
 return web.json_response(req.app['printer_registry'].choices(),headers={'Cache-Control':'no-store'})
async def health(req):"""Renvoie la disponibilité du service HTTP, indépendamment de celle du cloud.""";return web.json_response({'service':'ok'})
async def files(req):
 """Renvoie les fichiers cloud sous verrou ; lève ValueError sans connexion ou si la page est invalide."""
 engine=request_engine(req)
 if not engine.api:raise ValueError('Connexion en cours')
 async with engine.lock:return web.json_response(await engine.cloud_files(integer(req.query.get('page',1),1,1000)),headers={'Cache-Control':'no-store'})

async def history(req):
 """Renvoie une page du journal ; lève ValueError sans connexion ou si la page est invalide."""
 engine=request_engine(req)
 if not engine.api:raise ValueError('Connexion en cours')
 async with engine.lock:return web.json_response(await engine.print_history(integer(req.query.get('page',1),1,1000)),headers={'Cache-Control':'no-store'})

async def history_read(req):
 """Renvoie la confirmation de lecture ; rejette une origine étrangère ou une clé invalide."""
 engine=request_engine(req)
 verify_origin(req)
 data=await req.json()
 if data.get('all') is not True and not re.fullmatch(r'[a-f0-9]{20}',str(data.get('key',''))):raise ValueError('Notification invalide')
 if not engine.api:raise ValueError('Connexion en cours')
 async with engine.lock:return web.json_response(await engine.mark_history_read(data.get('key'),data.get('all') is True),headers={'Cache-Control':'no-store'})

async def history_delete(req):
 """Renvoie la confirmation d’effacement ; rejette une origine étrangère ou une clé invalide."""
 engine=request_engine(req)
 verify_origin(req);data=await req.json()
 if data.get('all') is not True and not re.fullmatch(r'[a-f0-9]{20}',str(data.get('key',''))):raise ValueError('Notification invalide')
 async with engine.lock:
  if not engine.api:raise ValueError('Connexion en cours')
  return web.json_response(await engine.delete_history(data.get('key'),data.get('all') is True),headers={'Cache-Control':'no-store'})
async def ai_settings(req):
 """Renvoie les réglages IA en JSON ; lève ValueError sans machine ou connexion disponible."""
 engine=request_engine(req)
 if not engine.api or not engine.printer:raise ValueError('Connexion en cours')
 async with engine.lock:return web.json_response({'settings':await engine.ai_settings()},headers={'Cache-Control':'no-store'})

def verify_origin(req):
 """Lève HTTPForbidden si une origine explicite diffère des origines locales autorisées."""
 origin=req.headers.get('Origin')
 if origin and origin not in [ALLOWED_ORIGIN,'http://127.0.0.1:8080']:raise web.HTTPForbidden()

async def local_files(req):
 """Renvoie le dossier machine ; lève HTTPNotFound pour une source autre que local ou usb."""
 engine=request_engine(req)
 source=req.match_info['source']
 if source not in ['local','usb']:raise web.HTTPNotFound()
 async with engine.lock:return web.json_response(await engine.read_files(source,req.query.get('path','/')),headers={'Cache-Control':'no-store'})

@contextlib.asynccontextmanager
async def command_operation(req):
 # Attendre le verrou partagé des lectures, sans mettre une seconde opération utilisateur en file d’attente.
 """Cède le verrou API à une seule opération ; lève ValueError si attente trop longue ou client parti."""
 engine=request_engine(req)
 if engine.command_lock.locked():raise ValueError('Une opération est en cours. Réessayez après sa fin.')
 async with engine.command_lock:
  try:await asyncio.wait_for(engine.lock.acquire(),timeout=COMMAND_READ_WAIT_SECONDS)
  except asyncio.TimeoutError:raise ValueError('La consultation Anycubic prend trop de temps. Aucune commande envoyée ; réessayez dans quelques secondes.') from None
  try:
   if req.transport is None or req.transport.is_closing():raise ValueError('La demande a été interrompue. Aucune commande envoyée.')
   verify_printer_target(req,engine)
   yield
  finally:engine.lock.release()

async def command(req):
 """Renvoie le résultat mémorisé par request_id ; rejette une demande invalide sans répéter une commande connue."""
 engine=request_engine(req)
 verify_origin(req)
 d=await req.json();requestid=str(d.pop('request_id',''))
 if not re.fullmatch(r'[a-zA-Z0-9-]{16,80}',requestid):raise ValueError('Identifiant de commande manquant')
 if requestid in engine.commands:return web.json_response(engine.commands[requestid])
 async with command_operation(req):
  engine.commands[requestid]={'ok':False,'message':'Opération en cours ou résultat inconnu ; ne pas répéter la commande'}
  name=d.pop('action',None)
  try:message=await engine.action(name,d)
  except Exception:
   engine.event(str(name),'Échec ou résultat inconnu');raise
  engine.event(str(name),'Acceptée')
  result={'ok':True,'message':message};engine.commands[requestid]=result
  while len(engine.commands)>200:engine.commands.popitem(last=False)
  return web.json_response(result)

def camera_transport_failure(error):
 """Reconnaît une panne de connexion ou un délai, même enveloppé ; refuse les erreurs TLS, d’authentification et de format."""
 chain=[];seen=set()
 while error is not None and id(error) not in seen:
  seen.add(id(error));chain.append(error)
  error=error.__cause__ if error.__cause__ is not None else error.__context__
 # Le client embarqué enveloppe les erreurs : leur type reste exploitable sans lire de message sensible.
 if any(isinstance(item,(AnycubicAuthError,AnycubicAuthTokensExpired,AnycubicCameraSessionError,ValueError,ssl.SSLError,aiohttp.ClientSSLError,aiohttp.ServerFingerprintMismatch)) for item in chain):return False
 return any(isinstance(item,(aiohttp.ClientConnectionError,asyncio.TimeoutError)) for item in chain)

async def camera(req):
 """Renvoie une session en cache cinq secondes ; retente une seule panne de transport, propage les autres erreurs."""
 engine=request_engine(req)
 verify_origin(req)
 viewer=req.headers.get('X-Camera-Viewer')
 if viewer and not re.fullmatch(r'[a-f0-9-]{36}',viewer):raise ValueError('Session vidéo invalide')
 if not engine.printer:raise ValueError('Connexion en cours')
 async with engine.lock:
  verify_printer_target(req,engine)
  if viewer and len(engine.camera_viewers)>=32 and viewer not in engine.camera_viewers:raise ValueError('Trop de sessions vidéo ouvertes')
  if not engine.camera or time.time()-engine.last_session>5 or (viewer and engine.camera_owner!=viewer):
   engine.camera_message_id=None;engine.camera_diagnostic=None;engine.camera_stage=-1
   try:session=await engine.printer.get_camera_session()
   except Exception as error:
    # Aucun délai de déduplication cloud n’est établi ; une erreur durable ne justifie pas une seconde demande.
    if not camera_transport_failure(error):raise
    session=await engine.printer.get_camera_session()
   if session is None:raise ValueError('Caméra indisponible')
   engine.camera=session.data;engine.camera_message_id=getattr(session,'msg_id',None);engine.last_session=time.time()
  if viewer:
   engine.camera_owner=viewer
   engine.camera_viewers.add(viewer)
  elif hasattr(engine,'camera_viewers'):
   # Un client ancien sans référence de spectateur ne permet pas de confirmer son départ.
   engine.camera_viewers.add('legacy')
  return web.json_response(engine.camera,headers={'Cache-Control':'no-store'})

async def close_idle_camera(engine,target):
 """Envoie une fermeture unique après le départ du dernier spectateur de l’atelier."""
 await asyncio.sleep(3)
 async with engine.command_lock:
  async with engine.lock:
   if engine.camera_viewers or not engine.api or not engine.printer or str(engine.printer.id)!=target:
    return
   registry=getattr(engine,'fleet_registry',None)
   if registry and printer_key(target) not in registry.catalogue():
    return
   engine.camera=None
   engine.camera_owner=None
   try:
    request=AnycubicBaseOrderRequest(order_id=AnycubicOrderID.CAMERA_CLOSE,printer_id=target)
    await engine.api._send_anycubic_order(order_request=request)
   except Exception as error:
    engine.event('Caméra','Fermeture non confirmée ('+type(error).__name__+')')

async def camera_close(req):
 """Libère la session vidéo du navigateur et programme la fermeture si le flux est inutilisé."""
 engine=request_engine(req)
 verify_origin(req)
 viewer=req.headers.get('X-Camera-Viewer')
 if not viewer or not re.fullmatch(r'[a-f0-9-]{36}',viewer):raise ValueError('Session vidéo invalide')
 async with engine.lock:
  verify_printer_target(req,engine)
  if viewer in engine.camera_viewers:
   engine.camera_viewers.remove(viewer)
   if not engine.camera_viewers and engine.printer:
    previous=engine.camera_close_task
    if previous and not previous.done():previous.cancel()
    engine.camera_close_task=asyncio.create_task(close_idle_camera(engine,str(engine.printer.id)))
 return web.json_response({'ok':True},status=202)

async def upload(req):
 """Renvoie l’acceptation du G-code dédupliqué ; lève ValueError si invalide, trop gros ou machine indisponible."""
 engine=request_engine(req)
 verify_origin(req)
 if not engine.printer:raise ValueError('Connexion en cours')
 if engine.command_lock.locked():raise ValueError('Une opération est déjà en cours')
 if UPLOAD_STAGING.locked():raise ValueError('Un envoi de fichier est déjà en cours')
 # Le dossier d’état est sur le volume persistant, contrairement au /tmp en mémoire du conteneur.
 async with UPLOAD_STAGING:
  with tempfile.TemporaryDirectory(prefix='upload-',dir=engine.state_dir) as directory:
   reader=await req.multipart()
   data={};filename=None;size=0
   path=pathlib.Path(directory)/'payload.gcode'
   async for part in reader:
    if part.name=='file':
     if filename is not None:raise ValueError('Un seul fichier est accepté')
     filename=pathlib.PurePath(part.filename or '').name
     if not filename.lower().endswith('.gcode'):raise ValueError('Un fichier .gcode est requis')
     async with aio_open(path,'wb') as output:
      while chunk:=await part.read_chunk(256*1024):
       size+=len(chunk)
       if size>UPLOAD_LIMIT:raise ValueError('Fichier limité à 100 Mo')
       await output.write(chunk)
    elif part.name in ('mode','request_id','slots') and part.name not in data:
     value=bytearray()
     while chunk:=await part.read_chunk(8192):
      value.extend(chunk)
      if len(value)>8192:raise ValueError('Paramètre d’envoi trop long')
     data[part.name]=value.decode('utf-8')
    else:raise ValueError('Paramètre d’envoi invalide')
   if not size or not filename:raise ValueError('Fichier manquant')
   mode=data.get('mode','upload');rid=data.get('request_id','')
   if not re.fullmatch(r'[a-zA-Z0-9-]{16,80}',rid):raise ValueError('Identifiant de commande manquant')
   if rid in engine.commands:return web.json_response(engine.commands[rid])
   if mode not in ('upload','save-print','temp-print'):raise ValueError('Mode invalide')
   async with command_operation(req):
    if rid in engine.commands:return web.json_response(engine.commands[rid])
    if not engine.api:raise ValueError('Connexion en cours')
    if mode!='upload':
     if not engine.printer.is_available:raise ValueError('Imprimante non disponible')
     slots=engine.slots({'slots':json.loads(data.get('slots','[]'))})
    engine.commands[rid]={'ok':False,'message':'Envoi déjà demandé ; résultat en attente'}
    if mode=='upload':await engine.api.upload_file_to_cloud(full_file_path=str(path),file_name=filename)
    else:
     func=engine.printer.print_and_upload_save_in_cloud if mode=='save-print' else engine.printer.print_and_upload_no_cloud_save
     await func(full_file_path=str(path),file_name=filename,slot_index_list=slots)
    engine.event('G-code','Envoi accepté')
    result={'ok':True,'message':'Envoi accepté par Anycubic'};engine.commands[rid]=result
    return web.json_response(result)

async def sample_temperatures(app,selected=None,store=None):
 """Archive seulement les relevés récents d’une source nouvelle pour éviter les températures périmées."""
 engine=selected if selected is not None else globals()['engine']
 history=store if store is not None else app['temperature_history'];last_source=None
 while True:
  try:
   state=engine.snapshot();p=state.get('printer') or {};source=max((v for v in [state.get('mqtt_updated_at'),state.get('updated_at')] if v),default=None)
   if state.get('ok') and p.get('printer_online') and source and source!=last_source:
    stamp=datetime.fromisoformat(source).timestamp()
    if abs(time.time()-stamp)<120:
     history.add(stamp,{'nozzle':p.get('curr_nozzle_temp'),'bed':p.get('curr_hotbed_temp'),'ace':p.get('ace_current_temperature'),'nozzle_target':p.get('target_nozzle_temp'),'bed_target':p.get('target_hotbed_temp'),'ace_target':p.get('dry_status_target_temperature') if p.get('dry_status_is_drying') else None})
     last_source=source
   if history.rows and time.monotonic()-history.saved_at>=60:history.save()
  except (OSError,ValueError,TypeError):pass
  await asyncio.sleep(10)

async def temperatures(req):
 """Renvoie les relevés sur une à vingt-quatre heures ; lève ValueError hors de cet intervalle."""
 hours=integer(req.query.get('hours',1),1,24)
 return web.json_response({'readings':req.app['printer_registry'].history(request_engine(req)).recent(hours) if 'printer_registry' in req.app else req.app['temperature_history'].recent(hours),'hours':hours,'retention_hours':24,'interval_seconds':10},headers={'Cache-Control':'no-store'})

async def startup(app):
 """Préserve la collecte initiale et initialise le registre des cibles indépendantes."""
 with contextlib.suppress(Exception):engine.presets=json.loads(pathlib.Path('/appdata/state/presets.json').read_text())
 engine.catalogue_source=True
 app['printer_registry']=PrinterRegistry(engine,Engine,sample_temperatures,app)
 app['poll_task']=asyncio.create_task(engine.poll())
 app['temperature_history']=TemperatureHistory()
 app['temperature_task']=asyncio.create_task(sample_temperatures(app))
async def cleanup(app):
 """Arrête la collecte, sauvegarde les températures et ferme les connexions."""
 registry=app['printer_registry']
 for selected in [engine,*registry.entries.values()]:
  task=selected.camera_close_task
  if task and not task.done():
   task.cancel()
   with contextlib.suppress(asyncio.CancelledError):await task
 await registry.close()
 app['temperature_task'].cancel()
 with contextlib.suppress(asyncio.CancelledError):await app['temperature_task']
 with contextlib.suppress(OSError):app['temperature_history'].save()
 app['poll_task'].cancel()
 with contextlib.suppress(asyncio.CancelledError):await app['poll_task']
 if engine.api:engine.api.disconnect_mqtt()
 if engine.session:await engine.session.close()
async def preview(req):
 """Renvoie une image validée ou None ; lève ValueError si la connexion manque ou l’image dépasse la limite."""
 engine=request_engine(req)
 verify_origin(req)
 d=await req.json();url=None
 async with engine.lock:
  if not engine.api or not engine.printer:raise ValueError('Connexion en cours')
  if d.get('source') in ['local','usb']:
   with contextlib.suppress(ValueError):
    image=await engine.local_preview(d['source'],str(d.get('name','')),d.get('path','/'))
    if image:return web.json_response({'image':image},headers={'Cache-Control':'no-store'})
  if d.get('source')=='cloud':
   f=engine.cloudfiles.get(str(d.get('handle')))
   if f:url=safeget(f,'_thumbnail')
  if not url:
   projects=await engine.api.list_all_projects()
   url=find_project_preview_url(projects,engine.printer.id,str(d.get('name','')))
 if not isinstance(url,str):return web.json_response({'image':None})
 parsed=__import__('urllib.parse',fromlist=['urlsplit']).urlsplit(url)
 host=parsed.hostname or ''
 if parsed.scheme!='https' or not any(host==domain or host.endswith('.'+domain) for domain in ['anycubic.com','anycubic-cloud.com','amazonaws.com','makeronline.com']):return web.json_response({'image':None})
 async with engine.session.get(url,allow_redirects=False) as response:
  mime=response.headers.get('Content-Type','').split(';')[0]
  if response.status!=200 or mime not in ['image/png','image/jpeg','image/webp','image/gif']:return web.json_response({'image':None})
  content=bytearray()
  async for chunk in response.content.iter_chunked(65536):
   content.extend(chunk)
   if len(content)>3*1024*1024:raise ValueError('Aperçu trop volumineux')
 return web.json_response({'image':'data:'+mime+';base64,'+base64.b64encode(content).decode()},headers={'Cache-Control':'no-store'})

app=web.Application(middlewares=[access_control,errors,select_printer],client_max_size=102*1024**2)
app.add_routes([web.get('/imprimante-api/printers',printers),web.get('/imprimante-api/health',health),web.get('/imprimante-api/status',status),web.get('/imprimante-api/history',history),web.post('/imprimante-api/history/read',history_read),web.post('/imprimante-api/history/delete',history_delete),web.get('/imprimante-api/ai-settings',ai_settings),web.get('/imprimante-api/temperatures',temperatures),web.get('/imprimante-api/files/cloud',files),web.get('/imprimante-api/files/{source}',local_files),web.post('/imprimante-api/command',command),web.post('/imprimante-api/camera-session',camera),web.post('/imprimante-api/camera-close',camera_close),web.post('/imprimante-api/upload',upload),web.post('/imprimante-api/preview',preview)])
from cloud_extras import install as install_extras
install_extras(app,engine)
app.on_startup.append(startup);app.on_cleanup.append(cleanup)
from web_host import install_static
install_static(app)
if __name__=='__main__':
 if __import__('os').geteuid()==0:raise SystemExit('Le serveur doit être lancé sans privilèges root.')
 if hasattr(time,'tzset'):time.tzset()
 logging.basicConfig(format='%(asctime)s %(levelname)s %(message)s',datefmt='%Y-%m-%dT%H:%M:%S%z')
 web.run_app(app,host=os.environ.get('HOST','127.0.0.1'),port=int(os.environ.get('PORT','8080')),access_log=None,print=None)
