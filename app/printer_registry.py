"""Cibles par requête et collectes indépendantes pour les imprimantes d’un même compte."""
import asyncio,contextlib,hashlib,json
from aiohttp import web
from cloud_extras import CloudExtras
from temperature_history import TemperatureHistory
from web_host import UI_PREFIX

def printer_key(identifier):
 """Renvoie une référence opaque ; aucun identifiant cloud brut n’est envoyé au navigateur."""
 return hashlib.sha256(str(identifier).encode()).hexdigest()[:20]

class SharedCloudAPI:
 """Délègue au client courant du compte sans créer un second identifiant MQTT concurrent."""
 def __init__(self,registry):
  """Conserve le registre plutôt qu’un ancien client, pour survivre à son renouvellement."""
  self.registry=registry
 @property
 def transport(self):
  """Renvoie le transport prêt, ou None tant que le compte se reconnecte."""
  owner=self.registry.default
  return None if getattr(owner,'reconnect_required',False) else owner.api
 def __bool__(self):
  """Les gardes de connexion des points d’accès s’appliquent aussi aux moteurs secondaires."""
  return self.transport is not None
 def __getattr__(self,name):
  """Résout chaque appel sur la session actuelle ; une reconnexion incomplète bloque la demande."""
  api=self.transport
  if api is None:raise ValueError('Connexion commune Anycubic en cours')
  return getattr(api,name)

class PrinterRegistry:
 """Conserve un moteur par machine ; aucune sélection globale n’est modifiée par un navigateur."""
 def __init__(self,default_engine,factory,sampler,app):
  """Partage compte et transport ; les états, verrous d’opération et caches restent propres à chaque machine."""
  self.default=default_engine;self.factory=factory;self.sampler=sampler;self.app=app;self.entries={};self.jobs=[];self.histories={};self.lock=asyncio.Lock();default_engine.fleet_registry=self
 def catalogue(self):
  """Renvoie les seules machines découvertes dans le compte, avec leurs noms affichables."""
  return {printer_key(p.id):p for p in getattr(self.default,'known_printers',[]) if getattr(p,'id',None) is not None}
 def default_key(self):
  """Garde la même cible pendant la reconnexion, lorsque son modèle est temporairement absent."""
  identifier=getattr(self.default.printer,'id',None) or getattr(self.default,'pinned_id',None) or self.default.selected_id
  return printer_key(identifier) if identifier else None
 def choices(self):
  """Renvoie le défaut réellement connecté et des clés opaques, sans numéro de série ni compte."""
  rows=self.catalogue();default=self.default_key()
  if default not in rows:default=next(iter(rows),None)
  return {'items':[{'key':k,'name':str(getattr(p,'name','Imprimante'))[:100]} for k,p in rows.items()],'default':default,'pending':not rows}
 async def resolve(self,key,require_explicit=False):
  """Résout une cible autorisée ; une mutation sans cible ou une clé périmée est refusée sans repli."""
  rows=self.catalogue()
  if require_explicit and not key:raise web.HTTPConflict(text=json.dumps({'ok':False,'message':'Une imprimante explicite est requise. Actualisez la page.'}),content_type='application/json')
  if key and key not in rows:raise web.HTTPConflict(text=json.dumps({'ok':False,'message':'Cette imprimante n’est plus disponible dans le compte. Actualisez la page.'}),content_type='application/json')
  if not key:
   if self.default_key() in rows:return self.default
   key=next(iter(rows),None)
   if key is None:return self.default
  if key==self.default_key():return self.default
  async with self.lock:
   if key not in self.entries:
    selected=self.factory();selected.selected_id=str(rows[key].id);selected.account=self.default.account;selected.fleet_registry=self;selected.notifications=self.default.notifications;selected.state_dir=self.default.state_dir/'printers'/key
    selected.state_dir.mkdir(mode=0o700,parents=True,exist_ok=True)
    selected.extras=CloudExtras(selected)
    with contextlib.suppress(OSError,ValueError):selected.presets=__import__('json').loads((selected.state_dir/'presets.json').read_text())
    self.entries[key]=selected
    history=TemperatureHistory(selected.state_dir/'temperatures.json');self.histories[key]=history
    self.jobs.extend([asyncio.create_task(selected.poll()),asyncio.create_task(self.sampler(self.app,selected,history))])
   return self.entries[key]
 def owner(self,device_key):
  """Résout le destinataire d’un rapport sans publier sa clé privée ni toucher aux autres caches."""
  allowed=self.catalogue()
  for selected in [self.default,*self.entries.values()]:
   if selected.printer and printer_key(selected.printer.id) in allowed and str(selected.printer.key)==str(device_key):return selected
  return None
 def subscribe(self,selected):
  """Ajoute le modèle au client MQTT unique ; le protocole interdit des clients homonymes concurrents."""
  api=self.default.api
  if not api or not selected.printer:return
  printer=selected.printer;previous=api._mqtt_subscribed_printers.get(printer.key)
  api._mqtt_subscribed_printers[printer.key]=printer
  if previous is None and api._mqtt_client and api._mqtt_client.is_connected():api._mqtt_subscribe_printer_status(printer)
 def restore_subscriptions(self):
  """Une nouvelle session MQTT retrouve les modèles déjà suivis, sans recréer les moteurs."""
  allowed=self.catalogue();api=self.default.api
  if api:
   for printer in list(api._mqtt_subscribed_printers.values()):
    if printer_key(printer.id) not in allowed:api.mqtt_unsubscribe_printer_status(printer)
  for selected in [self.default,*self.entries.values()]:
   if selected.printer and printer_key(selected.printer.id) in allowed:self.subscribe(selected)
 async def connect_secondary(self,selected):
  """Réutilise la session et un modèle de la cible exacte ; ne crée ni connexion de compte ni fil MQTT."""
  if not SharedCloudAPI(self) or self.default.session is None:raise RuntimeError('Connexion commune Anycubic en cours')
  rows=self.catalogue();key=printer_key(selected.selected_id)
  if key not in rows:raise RuntimeError('Imprimante sélectionnée absente du compte')
  if not selected.printer:selected.printer=rows[key]
  if str(selected.printer.id)!=str(selected.selected_id):raise RuntimeError('La cible du moteur ne peut pas changer')
  selected.api=SharedCloudAPI(self);selected.session=self.default.session;selected.account_token=self.default.account_token;selected.known_printers=list(rows.values());selected.pinned_id=str(selected.printer.id)
  selected.printer._api_parent=selected.api
  await selected.printer.update_info_from_api();self.subscribe(selected)
 def history(self,selected):
  """Sépare les courbes par machine tout en conservant le fichier historique de l’installation initiale."""
  if selected is self.default:return self.app['temperature_history']
  return self.histories[printer_key(selected.selected_id)]
 async def close(self):
  """Annule les collectes et sauvegarde leurs courbes ; le transport commun est fermé par le moteur principal."""
  for job in self.jobs:job.cancel()
  for job in self.jobs:
   with contextlib.suppress(asyncio.CancelledError):await job
  for history in self.histories.values():
   with contextlib.suppress(OSError):history.save()
  for selected in self.entries.values():
   # Le client HTTP/MQTT appartient au moteur principal et n’est fermé qu’une fois.
   selected.api=None;selected.session=None

@web.middleware
async def select_printer(request,handler):
 """Fige la cible pour toute la requête ; une écriture ne dépend jamais du dernier choix d’un autre onglet."""
 registry=request.app.get('printer_registry')
 if registry and request.path.startswith('/imprimante-api/') and not request.path.startswith(UI_PREFIX+'/') and request.path not in ['/imprimante-api/health','/imprimante-api/printers','/imprimante-api/journal']:
  key=request.headers.get('X-Printer-Key') or (request.query.get('printer') if request.method in ['GET','HEAD'] else None)
  request['selected_engine']=await registry.resolve(key,require_explicit=request.method not in ['GET','HEAD'])
  request['printer_key']=key
 return await handler(request)
