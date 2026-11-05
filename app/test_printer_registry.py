"""Isolation de plusieurs machines fictives, sans cloud, MQTT réel ni commande physique."""
import asyncio,json,pathlib,tempfile,unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock,Mock,patch
from aiohttp import web
from aiohttp.test_utils import TestClient,TestServer
import server as adapter
from printer_registry import PrinterRegistry,SharedCloudAPI,printer_key,select_printer

class PrinterTargets(unittest.IsolatedAsyncioTestCase):
 """La cible d’une requête ne dépend ni d’un autre navigateur ni d’une sélection globale mutable."""
 async def asyncSetUp(self):
  """Prépare deux moteurs simulés et un transport HTTP local sans démarrer le serveur de production."""
  self.temp=tempfile.TemporaryDirectory();self.a=SimpleNamespace(id=1,name='Machine A',key='fixture-a',update_info_from_api=AsyncMock());self.b=SimpleNamespace(id=2,name='Machine B',key='fixture-b',update_info_from_api=AsyncMock());self.created=[]
  self.root=self.make_engine();self.root.printer=self.a;self.root.known_printers=[self.a,self.b];self.root.state_dir=pathlib.Path(self.temp.name);self.root.snapshot=lambda:{'ok':True,'printer':{'name':self.root.printer.name}}
  app=web.Application(middlewares=[adapter.errors,select_printer]);app['temperature_history']=SimpleNamespace(recent=lambda h:[],save=lambda:None)
  async def sampler(app,selected,store):
   """Garde une tâche suspendue, sans écriture ni accès à un appareil."""
   await asyncio.Event().wait()
  self.registry=PrinterRegistry(self.root,self.make_engine,sampler,app);app['printer_registry']=self.registry
  app.router.add_get('/imprimante-api/status',adapter.status);app.router.add_post('/imprimante-api/command',adapter.command)
  self.client=TestClient(TestServer(app));await self.client.start_server()
 async def asyncTearDown(self):
  """Annule les seules tâches fictives et supprime leur dossier temporaire."""
  await self.client.close();await self.registry.close();self.temp.cleanup()
 def make_engine(self):
  """Le moteur de test remplace toute exécution de commande et toute connexion par des doublures."""
  e=adapter.Engine();e.action=AsyncMock(return_value='Acceptée fictivement');e.account=object()
  async def poll():
   """Affecte une machine connue une seule fois, puis attend sans réseau."""
   e.printer=next(p for p in [self.a,self.b] if str(p.id)==e.selected_id);await asyncio.Event().wait()
  e.poll=poll;self.created.append(e);return e
 async def secondary(self):
  """Laisse démarrer la collecte simulée pour que la machine secondaire soit prête."""
  e=await self.registry.resolve(printer_key(2));await asyncio.sleep(0);return e
 async def send(self,key=None,requestid='fixture-request-0001',query=''):
  """Envoie seulement au serveur local ; aucune doublure ne transmet au cloud."""
  return await self.client.post('/imprimante-api/command'+query,headers={'X-Printer-Key':key} if key else {},json={'action':'fixture','request_id':requestid})
 async def test_default_keeps_its_engine_during_reconnection(self):
  """Une sélection du défaut sans modèle ne crée aucune tâche secondaire."""
  self.root.pinned_id='1'
  self.root.printer=None
  self.assertIs(await self.registry.resolve(printer_key(1)),self.root)
  self.assertIs(await self.registry.resolve(None),self.root)
  self.assertEqual(len(self.created),1)
 async def test_sampling_survives_unavailable_shared_transport(self):
  """Une coupure suspend les relevés et le même échantillonneur reprend après reconnexion."""
  secondary=await self.secondary()
  secondary.api=SharedCloudAPI(self.registry)
  secondary.printer.multi_color_box=[]
  secondary.printer.printer_online=True
  secondary.ok=True
  secondary.updated=adapter.now()
  self.root.api=None
  store=SimpleNamespace(rows=[],add=Mock())
  self.assertFalse(secondary.snapshot()['ok'])
  async def advance(_):
   """Rétablit le transport au premier intervalle et arrête la simulation au second."""
   if self.root.api is not None:raise asyncio.CancelledError
   self.root.api=SimpleNamespace(_mqtt_client=None,mqtt_diagnostics={'fixture':1})
  with patch.object(adapter.asyncio,'sleep',side_effect=advance):
   with self.assertRaises(asyncio.CancelledError):
    await adapter.sample_temperatures({},secondary,store)
  store.add.assert_called_once()
  self.assertEqual(secondary.snapshot()['mqtt_diagnostics'],{'fixture':1})
 async def test_missing_unknown_and_query_only_targets_never_dispatch(self):
  """Une mutation exige un en-tête explicite autorisé, sans repli silencieux."""
  for key,query in [(None,''),('unknown',''),(None,'?printer='+printer_key(1))]:
   response=await self.send(key,query=query);self.assertEqual(response.status,409)
  self.root.action.assert_not_awaited();self.assertEqual(len(self.created),1)
 async def test_concurrent_browsers_keep_separate_locks_and_same_request_id(self):
  """Le même identifiant de requête dans deux machines n’échange ni résultat ni destinataire."""
  second=await self.secondary();ready=asyncio.Event();seen=[]
  async def action(target,*args):
   """Le rendez-vous force le chevauchement des deux requêtes de test."""
   seen.append(target)
   if len(seen)==2:ready.set()
   await ready.wait();return 'Acceptée fictivement'
  async def first(*a):
   """Attend le rendez-vous de la première machine fictive."""
   return await action(1,*a)
  async def other(*a):
   """Attend le rendez-vous de la seconde machine fictive."""
   return await action(2,*a)
  self.root.action.side_effect=first;second.action.side_effect=other
  responses=await asyncio.wait_for(asyncio.gather(self.send(printer_key(1)),self.send(printer_key(2))),2)
  self.assertEqual([r.status for r in responses],[200,200]);self.assertEqual(set(seen),{1,2});self.assertIsNot(self.root.lock,second.lock);self.assertIs(second.account,self.root.account)
  self.assertIs(await self.registry.resolve(None),self.root)
 async def test_target_rechecked_after_waiting_for_read_lock(self):
  """Une référence devenue différente pendant l’attente est refusée avant le rappel d’exécution."""
  await self.root.lock.acquire();pending=asyncio.create_task(self.send(printer_key(1)))
  await asyncio.sleep(0.02);self.root.printer=self.b;self.root.lock.release();response=await pending
  self.assertEqual(response.status,400);self.root.action.assert_not_awaited()
 async def test_removed_machine_is_not_replaced_by_another(self):
  """Un ancien choix valide devient une erreur explicite après retrait du catalogue."""
  await self.secondary();self.root.known_printers=[self.a]
  with self.assertRaises(web.HTTPConflict):await self.registry.resolve(printer_key(2),True)
 async def test_state_and_temperature_paths_are_independent(self):
  """Les courbes et caches secondaires restent sous leur propre répertoire appdata."""
  second=await self.secondary();self.assertTrue(second.state_dir.is_relative_to(self.root.state_dir/'printers'));self.assertEqual(second.state_dir.stat().st_mode&0o777,0o700)
  self.assertIsNot(second.commands,self.root.commands);self.assertIsNot(second.file_messages,self.root.file_messages);self.assertIsNot(second.extras,self.root.extras if hasattr(self.root,'extras') else None)
  self.assertNotEqual(self.registry.history(second),self.registry.history(self.root))
 async def test_secondary_uses_same_http_mqtt_session_without_closing_it(self):
  """Deux moteurs partagent le transport du compte ; le secondaire ne crée ni ne ferme un client MQTT."""
  second=await self.secondary();client=Mock();client.is_connected.return_value=True
  api=SimpleNamespace(_mqtt_client=client,_mqtt_subscribed_printers={},_mqtt_subscribe_printer_status=Mock(),disconnect_mqtt=Mock(),_fetch_api_resp=AsyncMock(return_value={'code':1}))
  self.root.api=api;self.root.session=SimpleNamespace(close=AsyncMock());self.root.account_token='fixture-token'
  await self.registry.connect_secondary(second)
  self.assertIs(second.session,self.root.session);self.assertIs(second.api._mqtt_client,client);self.assertIs(api._mqtt_subscribed_printers['fixture-b'],second.printer);api._mqtt_subscribe_printer_status.assert_called_once_with(second.printer)
  newer=SimpleNamespace(_fetch_api_resp=AsyncMock(return_value={'code':1,'data':'renewed'}));self.root.api=newer
  self.assertEqual(await second.api._fetch_api_resp('fixture'),{'code':1,'data':'renewed'})
  self.root.session.close.assert_not_awaited();api.disconnect_mqtt.assert_not_called()
 async def test_removed_default_keeps_transport_and_falls_back_to_secondary_model(self):
  """Le retrait du défaut ne recycle pas son identité et ne coupe pas la session commune des autres machines."""
  self.root.catalogue_source=True;self.root.pinned_id='1';client=Mock();client.is_connected.return_value=False
  api=SimpleNamespace(_mqtt_client=client,_mqtt_subscribed_printers={'fixture-a':self.a},list_my_printers=AsyncMock(side_effect=[[self.b],[self.a,self.b]]),disconnect_mqtt=Mock(),_mqtt_subscribe_printer_status=Mock())
  api.mqtt_unsubscribe_printer_status=Mock(side_effect=lambda p:api._mqtt_subscribed_printers.pop(p.key,None));self.root.api=api
  await self.root.refresh_catalogue();self.assertIsNone(self.root.printer);self.assertTrue(self.root.transport_only);self.assertEqual(self.root.pinned_id,'1')
  second=await self.registry.resolve(None);await asyncio.sleep(0);self.assertIsNot(second,self.root);self.assertEqual(second.printer.id,2);self.assertEqual(self.registry.choices()['default'],printer_key(2));self.assertIsNone(self.registry.owner('fixture-a'))
  await self.root.refresh_catalogue();self.assertIs(self.root.printer,self.a);self.assertFalse(self.root.transport_only);api.disconnect_mqtt.assert_not_called()
 async def test_catalogue_contains_no_raw_cloud_ids(self):
  """Seuls noms et références hachées sont nécessaires à la liste du navigateur."""
  result=self.registry.choices();self.assertEqual(result['default'],printer_key(1));self.assertEqual(set(result['items'][0]),{'key','name'});self.assertEqual(len(result['items']),2)

class EngineSelection(unittest.IsolatedAsyncioTestCase):
 """Le moteur se fixe à une identité ; une reconnexion n’en choisit jamais une autre implicitement."""
 async def test_default_fallback_and_pin_survive_account_list_change(self):
  """Le défaut facultatif se replie une seule fois ; une machine épinglée absente bloque la reconnexion."""
  a=SimpleNamespace(id=1,update_info_from_api=AsyncMock());b=SimpleNamespace(id=2,update_info_from_api=AsyncMock())
  e=adapter.Engine();e.selected_id='absent';e.catalogue_source=True;e.session=SimpleNamespace(cookie_jar=None);e.account=SimpleNamespace(token=AsyncMock(return_value='fixture-token'));e.mqtt_start=Mock()
  client=SimpleNamespace(check_api_tokens=AsyncMock(return_value=True),list_my_printers=AsyncMock(side_effect=[[a,b],[b]]),mqtt_add_subscribed_printer=Mock(),disconnect_mqtt=Mock())
  with patch.object(adapter,'CloudPageAPI',return_value=client):
   await e.connect();self.assertIs(e.printer,a);self.assertEqual(e.pinned_id,'1')
   with self.assertRaises(RuntimeError):await e.connect()
  self.assertIsNone(e.printer);b.update_info_from_api.assert_not_awaited()
 async def test_transport_only_owner_does_not_reconnect_every_minute(self):
  """Une machine retirée n’entraîne pas des coupures répétées du client partagé déjà authentifié."""
  e=adapter.Engine();e.catalogue_source=True;e.pinned_id='1';e.transport_only=True;e.account_token='fixture';e.account=SimpleNamespace(token=AsyncMock(return_value='fixture'));e.session=object();e.fleet_registry=SimpleNamespace(default=e,restore_subscriptions=Mock())
  e.api=SimpleNamespace(list_my_printers=AsyncMock(return_value=[SimpleNamespace(id=2)]),disconnect_mqtt=Mock());e.connect=AsyncMock();e.mqtt_start=Mock();e.print_history=AsyncMock(return_value={})
  with patch.object(adapter.asyncio,'sleep',side_effect=asyncio.CancelledError):
   with self.assertRaises(asyncio.CancelledError):await e.poll()
  e.connect.assert_not_awaited();e.api.disconnect_mqtt.assert_not_called();e.mqtt_start.assert_called_once();self.assertIsNone(e.printer)
 def test_mqtt_capture_belongs_to_its_engine_only(self):
  """Une réponse d’une autre clé ne contamine pas le cache d’un moteur, même avec un msgid identique."""
  owner=adapter.Engine();owner.printer=SimpleNamespace(key='fixture-a');other=adapter.Engine();api=object.__new__(adapter.CloudPageAPI);api.cloud_engine=owner
  payload={'type':'file','action':'listLocal','msgid':'fixture-id','data':{}}
  with patch.object(adapter.AnycubicMQTTAPI,'_mqtt_message_router',return_value=None):
   api._mqtt_message_router(SimpleNamespace(topic='anycubic/anycubicCloud/v1/printer/app/20025/fixture-b/file',payload=json.dumps(payload).encode()))
   self.assertFalse(owner.file_messages)
   api._mqtt_message_router(SimpleNamespace(topic='anycubic/anycubicCloud/v1/printer/app/20025/fixture-a/file',payload=json.dumps(payload).encode()))
  self.assertIn('fixture-id',owner.file_messages);self.assertFalse(other.file_messages)
