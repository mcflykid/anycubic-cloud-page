# SPDX-License-Identifier: GPL-3.0-or-later
"""Fonctions cloud complémentaires avec filtrage des données exposées au navigateur."""
import asyncio,base64,contextlib,hashlib,hmac,json,math,pathlib,re,secrets,time,urllib.parse
import aiohttp
from aiohttp import web
from native_controls import PARAMS,TIMELAPSE_GALLERY_ENABLED
from anycubic_cloud_api.models.http import AnycubicAPIEndpoint,HTTP_METHODS
from anycubic_cloud_api.data_models.orders import AnycubicProjectOrderRequest,AnycubicBaseProjectOrderRequest

def key(value):"""Renvoie une référence opaque stable pour ne pas exposer l’identifiant cloud brut.""";return hashlib.sha256(str(value).encode()).hexdigest()[:20]
def number(v,default=None):
 """Renvoie un flottant fini, ou default si la donnée cloud est absente ou invalide."""
 try:
  n=float(v)
  return n if math.isfinite(n) else default
 except (TypeError,ValueError):return default

def history_minutes(row):
 """Renvoie la durée connue en minutes ; les horodatages ne remplacent pas une fin absente."""
 reported=number(row.get('print_time'))
 if reported is not None:return reported
 start=number(row.get('start_time') or row.get('create_time'));end=number(row.get('end_time'))
 return (end-start)/60 if start is not None and end is not None and end>=start else None

def trusted_url(url):
 """Indique si une URL HTTPS appartient au stockage autorisé, sans identifiants ni port inhabituel."""
 try:
  p=urllib.parse.urlsplit(str(url));host=p.hostname or ''
  return p.scheme=='https' and not p.username and not p.password and p.port in (None,443) and any(host==d or host.endswith('.'+d) for d in ['anycubic.com','anycubic-cloud.com','makeronline.com','amazonaws.com','aliyuncs.com','myqcloud.com','anycubic.cn'])
 except ValueError:return False

def diagnostic_text(value):
 """Renvoie le diagnostic nettoyé ; les codes zéro ne constituent pas une alerte affichable."""
 text=clean_text(value).strip()
 return "" if text in ("0","0.0") else text

def clean_text(value,limit=500):
 """Renvoie un texte borné à limit caractères et dépourvu de caractères nuls."""
 return str(value or '').replace('\x00','')[:limit]

class ResetChallenges:
 """Conserve des confirmations de réinitialisation temporaires liées à une imprimante."""
 def __init__(self):"""Initialise le modèle et ses données locales depuis les paramètres fournis.""";self.items={}
 def issue(self,printer):
  """Renvoie ticket, code et durée ; lève ValueError au-delà de vingt confirmations actives."""
  self.items={k:v for k,v in self.items.items() if v['expires']>time.monotonic()}
  if len(self.items)>=20:raise ValueError('Trop de demandes. Patientez deux minutes.')
  ticket=secrets.token_urlsafe(24);code=f'{secrets.randbelow(1000000):06d}'
  self.items[ticket]={'printer':printer,'digest':hashlib.sha256((ticket+code).encode()).hexdigest(),'expires':time.monotonic()+120,'attempts':0}
  return {'ticket':ticket,'code':code,'expires_in':120}
 def consume(self,ticket,code,printer):
  """Valide puis consomme le code ; lève ValueError si expiré, incorrect ou lié à une autre machine."""
  r=self.items.get(str(ticket))
  if not r or r['expires']<time.monotonic() or r['printer']!=printer:
   self.items.pop(str(ticket),None);raise ValueError('Code expiré. Recommencez la confirmation.')
  r['attempts']+=1
  valid=bool(re.fullmatch(r'\d{6}',str(code))) and hmac.compare_digest(r['digest'],hashlib.sha256((str(ticket)+str(code)).encode()).hexdigest())
  if valid or r['attempts']>=3:self.items.pop(str(ticket),None)
  if not valid:raise ValueError('Code incorrect')

class CloudExtras:
 """Adapte les fonctions cloud complémentaires aux données autorisées pour le navigateur."""
 def __init__(self,engine):
  """Initialise le modèle et ses données locales depuis les paramètres fournis."""
  self.e=engine;self.tasks={};self.previews={};self.downloads={};self.resets=ResetChallenges();self.device_cache=None;self.notification_projects=None
 async def api(self,path,data=None,query=None,method='POST'):
  """Renvoie data après succès cloud ; lève ValueError si la connexion ou l’opération est refusée."""
  if not self.e.api:raise ValueError('Connexion Anycubic en cours')
  result=await self.e.api._fetch_api_resp(AnycubicAPIEndpoint(HTTP_METHODS.GET if method=='GET' else HTTP_METHODS.POST,path),params=data,query=query)
  if not isinstance(result,dict) or result.get('code')!=1:raise ValueError('Anycubic ne fournit pas cette information ou n’a pas accepté cette opération')
  return result.get('data')
 def idle(self):
  """Exige une imprimante connectée et libre ; lève ValueError sinon."""
  p=self.e.printer
  if not p or not p.printer_online or not p.is_available or p.latest_project_print_in_progress:raise ValueError('Cette action nécessite une imprimante en ligne et libre')
 def account_printers(self):
  """Le catalogue actuel du compte prévaut sur les anciennes découvertes d’un moteur secondaire."""
  registry=getattr(self.e,'fleet_registry',None)
  return registry.default.known_printers if registry else getattr(self.e,'known_printers',[])
 def features(self):"""Renvoie les capacités annoncées avec une valeur strictement booléenne vraie.""";return {r['name']:r.get('value') is True for r in self.e.raw_info.get('features',[]) if isinstance(r,dict) and 'name' in r}
 async def storage(self):
  """Renvoie les octets totaux, utilisés et libres du stockage cloud."""
  d=await self.api('/work/index/getUserStore')
  total=number(d.get('total_bytes'),0);used=number(d.get('used_bytes'),0)
  return {'total':total,'used':used,'free':max(0,total-used)}
 async def task_list(self,page,all_printers=False):
  """Renvoie les pages des machines autorisées ; all_printers agrège seulement des consultations, jamais une cible physique."""
  printers=self.account_printers() if all_printers else [self.e.printer]
  if not printers:printers=[self.e.printer]
  allowed={str(p.id):p for p in printers};rows=[];more=False
  for identifier in allowed:
   page_rows=await self.api('/v2/project/printHistory',query={'printer_id':int(identifier),'page':page,'limit':20},method='GET')
   if not isinstance(page_rows,list):raise ValueError('Historique des impressions indisponible')
   rows.extend(r for r in page_rows if isinstance(r,dict) and str(r.get('printer_id'))==identifier);more=more or len(page_rows)>=20
  projects=[]
  with contextlib.suppress(Exception):projects=await self.api('/work/project/getProjects',query={'page':1,'limit':20},method='GET')
  lookup={(str(r.get('printer_id')),str(r.get('taskid'))):r for r in projects if isinstance(r,dict) and str(r.get('printer_id')) in allowed} if isinstance(projects,list) else {}
  items=[]
  for r in rows:
   taskid=r.get('task_id') or r.get('taskid') or r.get('id');r={**lookup.get((str(r.get('printer_id')),str(taskid)),{}),**r,'taskid':taskid};r.setdefault('id',taskid)
   k=key(str(r.get('printer_id'))+':'+str(taskid));self.tasks[k]=r
   status=r.get('print_status');outcome={0:'En préparation',1:'Impression en cours',2:'Impression terminée',3:'Impression arrêtée'}.get(status,'État non renseigné')
   items.append({'key':k,'name':clean_text(r.get('task_name') or r.get('gcode_name') or r.get('model') or 'Impression',300),'start':r.get('start_time') or r.get('create_time'),'end':r.get('end_time'),'status':outcome,'status_code':status,'elapsed_minutes':history_minutes(r),'progress':number(r.get('progress')),'reason':diagnostic_text(r.get('reason')),'can_reprint':bool(number(r.get('gcode_id'),0)>0),'evaluated':bool(r.get('is_comment')),'printer':clean_text(r.get('printer_name') or getattr(allowed[str(r.get('printer_id'))],'name','Imprimante'),100),'printer_key':key(r.get('printer_id'))})
  while len(self.tasks)>500:self.tasks.pop(next(iter(self.tasks)))
  items.sort(key=lambda r:number(r.get('start'),0),reverse=True)
  return {'items':items,'page':page,'has_more':more}
 def task(self,k,allow_other=False):
  """Résout une fiche connue ; seul un parcours de consultation ou d’historique autorise une autre machine du compte."""
  r=self.tasks.get(str(k))
  if r is None:raise ValueError('Actualisez la liste des impressions')
  allowed={str(p.id) for p in self.account_printers()} if allow_other else set()
  allowed.add(str(self.e.printer.id))
  if str(r.get('printer_id')) not in allowed:raise ValueError('Tâche d’une autre imprimante')
  return r
 async def preview(self,k):
  """Renvoie l’image éventuelle d’une tâche connue ; propage ValueError si sa clé est invalide."""
  return await self.preview_row(k,self.task(k,allow_other=True))
 async def preview_row(self,k,r,lookup_detail=True):
  """Renvoie une image en ligne ou None ; lookup_detail autorise la recherche dans le détail cloud."""
  cached=self.previews.get(k)
  if cached and time.monotonic()-cached[0]<300:return {'image':cached[1]}
  def image_url(row):
   """Retient uniquement une URL d’image autorisée, pour éviter une requête vers un hôte arbitraire."""
   for field in ('img','image_url','thumbnail','thumbnail_url'):
    url=row.get(field)
    if isinstance(url,str) and trusted_url(url):return url
   params=row.get('slice_param')
   for image_id in (row.get('image_id'),params.get('image_id') if isinstance(params,dict) else None):
    if not isinstance(image_id,str) or not image_id:continue
    if trusted_url(image_id):return image_id
    if re.fullmatch(r'[A-Za-z0-9_./%+~-]+',image_id) and not image_id.startswith('/') and '..' not in image_id.split('/'):
     from anycubic_cloud_api.const.const import PROJECT_IMAGE_URL_BASE
     return PROJECT_IMAGE_URL_BASE+image_id
  url=image_url(r);image=None
  if not url and lookup_detail:
   with contextlib.suppress(Exception):
    detail=await self.api('/v5/project/printHistory/detail',query={'task_id':r.get('taskid') or r['id']},method='GET')
    if isinstance(detail,dict):url=image_url(detail)
  if url:
   try:
    async with self.e.session.get(url,allow_redirects=False,timeout=aiohttp.ClientTimeout(total=12)) as response:
     mime=response.headers.get('Content-Type','').split(';')[0]
     if response.status==200 and mime in ['image/png','image/jpeg','image/webp','image/gif']:
      content=bytearray()
      async for chunk in response.content.iter_chunked(65536):
       content.extend(chunk)
       if len(content)>3*1024*1024:raise ValueError('Aperçu trop volumineux')
      image='data:'+mime+';base64,'+base64.b64encode(content).decode()
   except (aiohttp.ClientError,asyncio.TimeoutError,ValueError):pass
  self.previews[k]=(time.monotonic(),image)
  while len(self.previews)>20:self.previews.pop(next(iter(self.previews)))
  return {'image':image}
 async def notification_preview(self,k):
  """Renvoie l’image de la notification ou d’une référence explicite unique ; ValueError si inconnue."""
  row=self.e.notifications.rows.get(str(k))
  if row is None:raise ValueError('Actualisez les notifications avant de consulter leur aperçu')
  printer_id=str(row.get('printer_id') or self.e.printer.id)
  allowed={str(printer.id) for printer in self.account_printers()}
  allowed.add(str(self.e.printer.id))
  if printer_id not in allowed:return {'image':None}
  cachekey='notification:'+str(k)
  cached=self.previews.get(cachekey)
  if cached and time.monotonic()-cached[0]<300:return {'image':cached[1]}
  direct=await self.preview_row(cachekey,row,lookup_detail=False)
  if direct['image']:return direct
  # Les identifiants de tâche et de projet ont des espaces distincts.
  task_id=str(row.get('task_id') or row.get('taskid') or '')
  project_id=str(row.get('project_id') or '')
  if task_id in ('','0') and project_id in ('','0'):return {'image':None}
  task_id=task_id if task_id!='0' else ''
  project_id=project_id if project_id!='0' else ''
  matches=[]
  if task_id:
   task=self.tasks.get(key(printer_id+':'+task_id))
   if task and (not project_id or str(task.get('id'))==project_id):
    matches=[task]
  if not matches:
   if not self.notification_projects or time.monotonic()-self.notification_projects[0]>=30:
    try:projects=await self.api('/work/project/getProjects',query={'page':1,'limit':100},method='GET')
    except (ValueError,aiohttp.ClientError,asyncio.TimeoutError):
     self.previews.pop(cachekey,None)
     return {'image':None}
    self.notification_projects=(time.monotonic(),projects if isinstance(projects,list) else [])
   matches=[
    project for project in self.notification_projects[1]
    if isinstance(project,dict) and str(project.get('printer_id'))==printer_id
    and (not task_id or task_id==str(project.get('taskid') or project.get('task_id')))
    and (not project_id or project_id==str(project.get('id') or project.get('project_id')))
   ]
  if len(matches)!=1:return {'image':None}
  self.previews.pop(cachekey,None)
  return await self.preview_row(cachekey,matches[0])
 async def detail(self,k):
  """Renvoie les détails filtrés d’une tâche ; lève ValueError si Anycubic ne les fournit pas."""
  r=self.task(k,allow_other=True);d=None
  with contextlib.suppress(Exception):d=await self.api('/v5/project/printHistory/detail',query={'task_id':r.get('taskid') or r['id']},method='GET')
  if not isinstance(d,dict):d=await self.e.api.project_info_for_id(r['id'])
  if not isinstance(d,dict):raise ValueError('Détails non fournis par Anycubic')
  # Le navigateur ne doit recevoir ni identifiants cloud privés ni URL arbitraires.
  reason=next((text for value in [d.get('reason_desc'),d.get('reason'),r.get('reason'),d.get('material_warning')] if (text:=diagnostic_text(value))), '')
  help_url=d.get('reason_help_url');params=d.get('print_params') or d.get('slice_param') or r.get('slice_param') or {}
  if not isinstance(params,dict):params={}
  slice_params=d.get('slice_param')
  paint=slice_params.get('paint_infos') if isinstance(slice_params,dict) else None
  materials=[]
  if isinstance(paint,list):
   for entry in paint[:16]:
    if not isinstance(entry,dict):continue
    material=entry.get('material_type');grams=number(entry.get('filament_used'))
    color=entry.get('color')
    color=color if isinstance(color,str) and re.fullmatch(r'#[0-9a-fA-F]{6}',color) else None
    if isinstance(material,str) or grams is not None or color:
     materials.append({'material':clean_text(material,48) if isinstance(material,str) else None,'grams':grams,'color':color})
  result=d.get('slice_result')
  return {
   'name':clean_text(d.get('file_name') or d.get('name') or r.get('task_name') or r.get('model'),300),
   'reason':reason,'reason_code':diagnostic_text(d.get('reason_id')),'help_url':help_url if trusted_url(help_url) else None,
   'parameters':{field:params[field] for field in PARAMS if field in params},
   'dimensions':d.get('model_dimensions') if isinstance(d.get('model_dimensions'),dict) else None,
   'layers':number(d.get('layer_count'),number(result.get('total_layers')) if isinstance(result,dict) else None),
   'estimated_seconds':number(d.get('estimated_time_s')),'material_grams':number(d.get('total_filament_used')),
   'reported_minutes':number(r.get('print_time')),'materials':materials,
  }
 def files(self,handles):
  """Résout toute la sélection avant action ; lève ValueError si une référence est absente ou dupliquée."""
  if not isinstance(handles,list) or not 1<=len(handles)<=100 or len(set(handles))!=len(handles):raise ValueError('Sélectionnez entre 1 et 100 fichiers différents')
  rows=[]
  for h in handles:
   r=self.e.cloudfiles.get(str(h))
   if r is None:raise ValueError('Actualisez les fichiers Cloud avant cette action')
   rows.append(r)
  return rows
 async def download(self,handles):
  """Renvoie des liens locaux temporaires ; lève ValueError si un lien cloud est incomplet ou non autorisé."""
  rows=self.files(handles)
  # Le point d’accès par lot peut réordonner des URL anonymes : interroger chaque identifiant séparément.
  urls=[]
  for row in rows:
   result=await self.api('/work/index/getDownloadUrls',{'ids':[row.id]})
   if not isinstance(result,list) or len(result)!=1:raise ValueError('Anycubic n’a pas fourni tous les liens de téléchargement')
   link=result[0];url=link.get('url') if isinstance(link,dict) else link
   if not trusted_url(url):raise ValueError('Le lien de téléchargement Anycubic n’est pas reconnu')
   urls.append(url)
  now=time.monotonic();self.downloads={k:v for k,v in self.downloads.items() if v['expires']>now}
  links=[]
  for row,url in zip(rows,urls):
   ticket=secrets.token_urlsafe(24);self.downloads[ticket]={'url':url,'expires':now+300,'name':clean_text(row.old_filename or 'fichier',200)}
   links.append({'name':self.downloads[ticket]['name'],'url':'/imprimante-api/download/'+ticket+'?printer='+key(self.e.printer.id)})
  return {'downloads':links}
 async def videos(self,page=1,keyword=''):
  """Liste les vidéos avec les paramètres connus, sans renvoyer de référence de stockage."""
  if not self.features().get('camera_timelapse_support'):
   return {'available':False,'items':[],'message':'Le timelapse n’est pas annoncé par cette imprimante.'}
  try:reply=await self.e.direct_request('file','listVideo',{'page_num':page,'page_size':20,'path':'/','keyword':keyword})
  except ValueError:
   return {'available':False,'items':[],'message':'L’imprimante ne répond pas à la consultation des vidéos par le Cloud.'}
  payload=reply.get('data') if isinstance(reply,dict) else None
  rows=payload.get('records') if isinstance(payload,dict) else None
  if not isinstance(rows,list):
   return {'available':False,'items':[],'message':'La liste des vidéos n’est pas fournie par ce firmware.'}
  items=[{'name':clean_text(r.get('filename'),200),'size':number(r.get('size')),'duration':number(r.get('duration')),'created':r.get('createTime')} for r in rows if isinstance(r,dict)]
  return {'available':True,'items':items,'has_more':len(rows)==20,'message':'Lecture et téléchargement non disponibles par ce protocole.' if items else 'Aucun timelapse trouvé.'}
 async def rating(self,k):
  """Renvoie la disponibilité de l’évaluation ; lève ValueError pour une tâche non terminée."""
  r=self.task(k)
  if r.get('print_status')!=2:raise ValueError('Seule une impression terminée peut être évaluée')
  d=await self.api('/v3/work/getProjectCommentInfo',{'project_id':r.get('taskid') or r['id']})
  return {'available':isinstance(d,dict),'already_rated':bool(r.get('is_comment'))}
 async def device(self):
  """Renvoie les réglages et capacités filtrés, avec un cache de soixante secondes."""
  if self.device_cache and time.monotonic()-self.device_cache[0]<60:return self.device_cache[1]
  f=self.features();properties={};message=None
  try:
   value=await self.api('/v5/printer/properties/query',{'printer_id':self.e.printer.id,'properties':['assistant_settings','hardware_settings','hotbed_settings','option_settings','head_channel_count','camera']})
   if isinstance(value,dict):properties=value.get('properties',value)
   if not isinstance(properties,dict):properties={}
  except Exception:message='Les réglages avancés ne sont pas fournis par le Cloud pour cette imprimante.'
  def records(value):
   """Filtre les champs affichables des options pour ne pas publier tout le dictionnaire constructeur."""
   return [{k:r[k] for k in ['option','value','name','title','key','label'] if k in r} for r in value if isinstance(r,dict)] if isinstance(value,list) else []
  assists=records(properties.get('assistant_settings'));options=records(properties.get('option_settings'));hardware=properties.get('hardware_settings') or {};bed=properties.get('hotbed_settings') or {}
  if not isinstance(hardware,dict):hardware={}
  if not isinstance(bed,dict):bed={}
  # Le constructeur exige calibration_support ; les indicateurs individuels ne suffisent pas à autoriser l’envoi.
  calibration=f.get('calibration_support',False)
  choices=[{'key':k,'label':label} for k,label,flag in [('auto_leveling','Nivellement du plateau','auto_leveling_support'),('shaper_calibration','Compensation des vibrations','vibration_compensation_support'),('pid_calibration','Calibration thermique PID','calibration_support'),('active_noise_reduction','Réduction du bruit','calibration_support')] if calibration and f.get(flag)]
  profile=properties.get('hardware_profile') or self.e.raw_info.get('hardware_profile') or {}
  result={'message':message,'calibrations':choices,'calibration_advertised':bool(f.get('auto_leveling_support') or f.get('vibration_compensation_support')),'assistance':assists,'screen':options,'hardware':{k:hardware[k] for k in ['diameter','material'] if k in hardware},'bed':{k:bed[k] for k in ['material'] if k in bed},'head_channel_count':properties.get('head_channel_count'),'hardware_editable':isinstance(profile,dict) and profile.get('editable') is True,'factory_reset':f.get('factory_reset_support',False),'timelapse':f.get('camera_timelapse_support',False)}
  self.device_cache=(time.monotonic(),result);return result
 async def order(self,order,data=None):
  """Renvoie un message d’envoi ; lève ValueError si la machine est occupée ou si le cloud refuse."""
  self.idle()
  request=AnycubicBaseProjectOrderRequest(order_id=order,printer_id=self.e.printer.id,project_id=0) if order==1257 else AnycubicProjectOrderRequest(order_id=order,printer_id=self.e.printer.id,project_id=0,order_data=data or {})
  result=await self.e.api._send_anycubic_order(request)
  if result is None:raise ValueError('Commande non acceptée par Anycubic')
  self.device_cache=None
  return 'Commande transmise à Anycubic ; confirmation machine en attente'
 async def delete_tasks(self,keys):
  """Retire seulement les fiches validées ; arrête un lot au premier résultat incertain, sans répétition."""
  if not isinstance(keys,list) or not keys or len(keys)>100 or any(not isinstance(k,str) for k in keys) or len(set(keys))!=len(keys):raise ValueError('Choisissez entre une et cent fiches distinctes')
  rows=[(k,self.task(k,allow_other=True)) for k in keys]
  identifiers=[r.get('taskid') or r.get('task_id') or r.get('id') for _,r in rows]
  if any(isinstance(v,bool) or not isinstance(v,int) or v<=0 for v in identifiers) or len(set(identifiers))!=len(identifiers):raise ValueError('Références de fiches non valides')
  removed=0
  for (k,row),identifier in zip(rows,identifiers):
   try:await self.api('/work/project/unsetprojects',{'id':identifier,'checkSign':False})
   except Exception:
    return f'{removed} fiche(s) retirée(s) sur {len(rows)}. Résultat suivant non confirmé : opération arrêtée. Actualisez et vérifiez l’historique avant tout nouvel essai.'
   removed+=1;self.tasks.pop(k,None);self.previews.pop(k,None)
  return f'{removed} fiche(s) retirée(s) de l’historique Anycubic. La liste est relue depuis le cloud.'
 async def action(self,name,d):
  """Valide puis exécute une action complémentaire ; lève ValueError si non autorisée ou non confirmée."""
  if name=='task-delete-many':return await self.delete_tasks(d.get('keys'))
  if name=='cloud-rename':
   rows=self.files([d.get('handle')]);value=str(d.get('name','')).strip()
   if not value or len(value)>200 or re.search(r'[/\\\x00-\x1f]',value):raise ValueError('Nom de fichier invalide')
   # Anycubic ajoute lui-même l’extension d’origine immuable : ne pas la doubler lors du renommage.
   extension=str(getattr(rows[0],'_file_extension','') or pathlib.PurePosixPath(getattr(rows[0],'old_filename','') or '').suffix).lstrip('.')
   if extension:
    suffix='.'+extension
    while value.lower().endswith(suffix.lower()):value=value[:-len(suffix)].rstrip()
   if not value or value in ['.','..']:raise ValueError('Nom de fichier invalide')
   await self.api('/work/index/renameFile',{'id':rows[0].id,'name':value});self.e.cloudfiles.clear();return 'Fichier renommé dans Anycubic Cloud'
  if name=='cloud-delete-many':
   rows=self.files(d.get('handles'));await self.api('/work/index/delFiles',{'idArr':[r.id for r in rows]});self.e.cloudfiles.clear();return 'Fichiers supprimés du Cloud'
  if name=='task-reprint':
   self.idle();r=self.task(d.get('key'));gid=int(r.get('gcode_id') or 0)
   if gid<=0:raise ValueError('Le G-code de cette tâche n’est plus disponible')
   printer=self.e.printer
   try:await asyncio.wait_for(printer.update_info_from_api(),timeout=10)
   except Exception:raise ValueError('État récent de l’imprimante indisponible. Aucune commande envoyée.') from None
   if self.e.printer is not printer:raise ValueError('L’imprimante a changé. Aucune commande envoyée.')
   self.idle()
   result=await printer.print_with_cloud_gcode_id(gid,self.e.slots(d),allow_retry=False)
   if not result or not getattr(result,'order_msg_id',None):raise ValueError('Anycubic n’a pas confirmé la réimpression. Vérifiez l’imprimante avant tout nouvel envoi.')
   return 'Réimpression transmise à Anycubic ; vérifiez la machine'
  if name=='task-rate':
   r=self.task(d.get('key'));rating=await self.rating(d.get('key'));star=d.get('stars')
   if not rating['available'] or rating['already_rated']:raise ValueError('Évaluation indisponible ou déjà envoyée')
   if isinstance(star,bool) or not isinstance(star,int) or not 1<=star<=5:raise ValueError('Choisissez une note entre 1 et 5')
   await self.api('/v3/work/sumbitComment',{'project_id':r.get('taskid') or r['id'],'star':star});r['is_comment']=True
   return 'Votre note a été envoyée à Anycubic'
  if name in ['calibrate','hardware','assist','screen','factory-reset']:
   self.idle();state=await self.device()
   if name=='calibrate':
    items=d.get('items');allowed={r['key'] for r in state['calibrations']}
    if not isinstance(items,list) or not items or not set(items)<=allowed:raise ValueError('Calibration non fournie pour cette imprimante')
    return await self.order(1259,{'target_items':list(dict.fromkeys(items))})
   if name=='assist':
    allowed={r.get('option') for r in state['assistance']};items=d.get('items')
    if not isinstance(items,list) or not items or any(not isinstance(r,dict) or r.get('option') not in allowed or not isinstance(r.get('value'),bool) for r in items):raise ValueError('Option d’assistance non fournie par la machine')
    return await self.order(1253,{'assistant_settings':[{'option':r['option'],'value':int(r['value'])} for r in items]})
   if name=='screen':
    option=d.get('option');minutes=d.get('minutes')
    if option not in [r.get('option') for r in state['screen']] or isinstance(minutes,bool) or minutes not in [0,1,2,5,10,15,30,60]:raise ValueError('Délai non proposé pour cet écran')
    return await self.order(1253,{'option_settings':[{'option':option,'value':minutes*60}]})
   if name=='hardware':
    if not state['hardware_editable']:raise ValueError('Le constructeur ne permet pas cette configuration sur ce modèle')
    diameter=d.get('diameter');material=d.get('material');bed=d.get('bed')
    if diameter not in ([0.2,0.25,0.4,0.6,0.8] if material==1 else [0.4,0.6,0.8]) or material not in [1,2] or bed not in [1,2,3]:raise ValueError('Configuration matérielle invalide')
    return await self.order(1253,{'hardware_settings':{'diameter':str(diameter),'material':material},'hotbed_settings':{'material':bed},'head_channel_count':state.get('head_channel_count') or 1})
   if name=='factory-reset':
    if not state['factory_reset']:raise ValueError('Réinitialisation non annoncée pour cette imprimante')
    self.resets.consume(d.get('ticket'),d.get('code'),self.e.printer.id)
    return await self.order(1257)
  if name=='timelapse':raise ValueError('La machine annonce le timelapse, mais le Cloud ne fournit pas encore sa liste de vidéos à la page web')
  raise ValueError('Fonction non disponible pour cette imprimante')

async def load(req):
 """Renvoie la section complémentaire en JSON ; lève HTTPNotFound pour une section inconnue."""
 e=req.get('selected_engine',req.app['extras'].e).extras;section=req.match_info['section']
 async with e.e.lock:
  if section=='storage':result=await e.storage()
  elif section=='tasks':result=await e.task_list(max(1,min(1000,int(req.query.get('page',1)))),all_printers=req.query.get('device')=='all')
  elif section=='task':result=await e.detail(req.query.get('key'))
  elif section=='task-preview':result=await e.preview(req.query.get('key'))
  elif section=='notification-preview':result=await e.notification_preview(req.query.get('key'))
  elif section=='device':result=await e.device()
  elif section=='rating':result=await e.rating(req.query.get('key'))
  elif section=='videos':
   if not TIMELAPSE_GALLERY_ENABLED:raise web.HTTPNotFound()
   result=await e.videos(max(1,min(1000,int(req.query.get('page',1)))),clean_text(req.query.get('keyword'),120))
  else:raise web.HTTPNotFound()
 return web.json_response(result,headers={'Cache-Control':'no-store'})

async def downloads(req):
 # server.py peut être chargé comme __main__ : un import recréerait une autre instance du moteur.
 """Renvoie les liens temporaires de la sélection ; lève HTTPForbidden si l’origine est étrangère."""
 origin=req.headers.get('Origin')
 if origin and origin not in [__import__('os').environ.get('PUBLIC_ORIGIN','http://localhost:8080'),'http://127.0.0.1:8080']:raise web.HTTPForbidden()
 e=req.get('selected_engine',req.app['extras'].e).extras;d=await req.json()
 async with e.e.lock:result=await e.download(d.get('handles'))
 return web.json_response(result,headers={'Cache-Control':'no-store'})

async def download_file(req):
 """Redirige vers le stockage validé ; lève HTTPGone si le ticket a expiré, HTTPFound sinon."""
 e=req.get('selected_engine',req.app['extras'].e).extras;d=e.downloads.get(req.match_info['ticket'])
 if not d or d['expires']<time.monotonic():raise web.HTTPGone(text='Lien expiré. Redemandez le téléchargement.')
 # La redirection reste limitée au stockage prévalidé, sans jeton du compte dans la réponse.
 raise web.HTTPFound(d['url'],headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer'})

async def reset_challenge(req):
 """Renvoie une confirmation liée à la machine ; lève ValueError si elle ne peut pas être réinitialisée."""
 origin=req.headers.get('Origin')
 if origin and origin not in [__import__('os').environ.get('PUBLIC_ORIGIN','http://localhost:8080'),'http://127.0.0.1:8080']:raise web.HTTPForbidden()
 e=req.get('selected_engine',req.app['extras'].e).extras
 async with e.e.lock:
  e.idle();state=await e.device()
  if not state['factory_reset']:raise ValueError('Réinitialisation non annoncée pour cette imprimante')
  result=e.resets.issue(e.e.printer.id)
 return web.json_response(result,headers={'Cache-Control':'no-store'})

def install(app,engine):
 """Rattache les fonctions complémentaires au moteur et ajoute leurs routes à l’application."""
 extras=CloudExtras(engine);app['extras']=extras;engine.extras=extras
 app.add_routes([web.get('/imprimante-api/extras/{section}',load),web.post('/imprimante-api/cloud/downloads',downloads),web.get('/imprimante-api/download/{ticket}',download_file),web.post('/imprimante-api/reset/challenge',reset_challenge)])
