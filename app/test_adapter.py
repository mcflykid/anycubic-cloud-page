"""Tests isolés : adapter, sans commande physique ni connexion au cloud."""
import asyncio,importlib.util,pathlib,unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock
spec=importlib.util.spec_from_file_location('adapter',pathlib.Path(__file__).with_name('server.py'));adapter=importlib.util.module_from_spec(spec);spec.loader.exec_module(adapter)
class AdapterTests(unittest.IsolatedAsyncioTestCase):
 """Vérifications des garde-fous de l’adaptateur web et de ses conversions de données."""
 async def asyncSetUp(self):
  """Prépare les doublures et l’état asynchrone isolés pour chaque scénario."""
  self.e=adapter.Engine();self.p=SimpleNamespace(connected_ace_units=1,is_available=True,latest_project=object(),latest_project_print_in_progress=True,print_slot_numbers_to_indices=lambda v:[x-1 for x in v]);self.e.printer=self.p;self.e.api=SimpleNamespace()
 async def test_notification_failure_does_not_hide_healthy_printer(self):
  """Une panne du centre de messages ne doit pas rendre le suivi de l’imprimante indisponible."""
  from unittest.mock import Mock,patch
  self.e.account=SimpleNamespace(token=AsyncMock(return_value='fixture-token'));self.e.account_token='fixture-token'
  self.p.update_info_from_api=AsyncMock();self.p.id=1
  self.e.api=SimpleNamespace(printer_info_for_id=AsyncMock(return_value={'data':{}}))
  self.e.mqtt_start=Mock();self.e.print_history=AsyncMock(side_effect=ValueError('fixture-only'))
  with patch.object(adapter.asyncio,'sleep',side_effect=asyncio.CancelledError):
   with self.assertRaises(asyncio.CancelledError):await self.e.poll()
  self.assertTrue(self.e.ok);self.assertIsNone(self.e.error)
  self.assertEqual(self.e.notifications_error,'Messages temporairement indisponibles');self.e.print_history.assert_awaited_once_with(1)
 async def test_status_uses_cached_notifications_without_cloud_request(self):
  """Les lectures fréquentes du statut partagent le cache du relevé cloud habituel."""
  self.e.printer=None;self.e.api=None;self.e.history_cache={1:(0,{'items':[],'unread':0})}
  self.e.print_history=AsyncMock()
  for _ in range(3):self.assertEqual(self.e.snapshot()['notifications'],{'items':[],'unread':0})
  self.e.print_history.assert_not_awaited()
 async def test_session_recovery_restarts_tracking_after_old_thread_exits(self):
  """Vérifie que le suivi redémarre après la fin de son ancien fil."""
  from unittest.mock import Mock
  self.e.api=SimpleNamespace(disconnect_mqtt=Mock());self.e.mqtt_thread=Mock();self.e.mqtt_thread.is_alive.side_effect=[True,False]
  self.e.mqtt_auth_pending=True;self.e.mqtt_start=Mock()
  await self.e.restart_mqtt_auth(self.e.api)
  self.e.api.disconnect_mqtt.assert_called_once();self.e.mqtt_start.assert_called_once();self.assertFalse(self.e.mqtt_auth_pending)
 async def test_session_recovery_does_not_overlap_live_tracking_thread(self):
  """Vérifie que le renouvellement ne crée pas deux fils MQTT simultanés."""
  from unittest.mock import Mock
  self.e.api=SimpleNamespace(disconnect_mqtt=Mock());self.e.mqtt_thread=Mock();self.e.mqtt_thread.is_alive.return_value=True
  self.e.mqtt_auth_pending=True;self.e.mqtt_start=Mock()
  await self.e.restart_mqtt_auth(self.e.api)
  self.e.mqtt_start.assert_not_called();self.assertTrue(self.e.mqtt_auth_pending)
 async def test_disabled_tracking_stays_disabled_after_session_recovery(self):
  """Vérifie que le renouvellement respecte la désactivation du suivi MQTT."""
  from unittest.mock import Mock
  self.e.api=SimpleNamespace(disconnect_mqtt=Mock());self.e.mqtt_enabled=False;self.e.mqtt_auth_pending=True
  await self.e.restart_mqtt_auth(self.e.api)
  self.assertIsNone(self.e.mqtt_thread)
 async def test_rfid_identity_and_zero_remaining_are_preserved(self):
  """Vérifie que l’identité RFID et une quantité restante nulle restent distinctes des données absentes."""
  self.e.printer=SimpleNamespace(multi_color_box=[SimpleNamespace(box_id=0,loaded_slot=0)],primary_multi_color_box_spool_info_object=[{'local_slot':1},{'local_slot':2}])
  self.e.api=None;self.e.raw_info={'multi_color_box':{'slots':[{'edit_status':0,'consumables_percent':0,'sku':'private-product-reference'},{'edit_status':1,'consumables_percent':0}]}}
  data=self.e.snapshot()['printer']['boxes'][0]
  self.assertEqual(data['loaded_slot'],0);self.assertTrue(data['spools'][0]['rfid']);self.assertEqual(data['spools'][0]['brand'],'Anycubic');self.assertEqual(data['spools'][0]['remaining_percent'],0)
  self.assertFalse(data['spools'][1]['rfid']);self.assertNotIn('sku',str(data))
 async def test_pause_uses_upstream(self):
  """Vérifie que la pause passe par la méthode de la bibliothèque constructeur."""
  self.p.pause_print=AsyncMock(return_value='accepted');await self.e.action('pause',{});self.p.pause_print.assert_awaited_once_with()
 async def test_no_project_does_not_send(self):
  """Vérifie que aucune commande d’impression ne part sans projet actif."""
  self.p.latest_project=None;self.p.pause_print=AsyncMock()
  with self.assertRaises(ValueError):await self.e.action('pause',{})
  self.p.pause_print.assert_not_called()
 async def test_black_spool_color_is_preserved(self):
  """Vérifie que une couleur noire n’est pas interprétée comme une donnée manquante."""
  self.p.multi_color_box_set_slot=AsyncMock(return_value='accepted');await self.e.action('slot',{'color':'#000000','material':'PLA','slot':3})
  args=self.p.multi_color_box_set_slot.call_args;self.assertEqual(args.args,(2,));self.assertEqual(args.kwargs['slot_color'].red,0)
 async def test_mapping_order_preserved(self):"""Vérifie que la correspondance des bobines conserve l’ordre des matériaux.""";self.assertEqual(self.e.slots({'slots':[3,1,4]}),[2,0,3])
 async def test_file_path_rejects_traversal(self):
  """Vérifie que les chemins ne peuvent pas sortir du dossier par traversée."""
  with self.assertRaises(ValueError):adapter.filepath('/../media')
 async def test_cloud_print_rejects_unknown_handle(self):
  """Vérifie que une référence cloud inconnue ne permet pas d’imprimer."""
  with self.assertRaises(ValueError):await self.e.action('print-cloud',{'handle':'unknown'})
 async def test_out_of_range_temperature_does_not_send(self):
  """Vérifie que une température hors limites est refusée avant envoi."""
  self.e.api._send_order_change_print_settings=AsyncMock()
  with self.assertRaises(ValueError):await self.e.action('settings',{'target_nozzle_temp':500})
  self.e.api._send_order_change_print_settings.assert_not_called()
 async def test_busy_printer_does_not_flash(self):
  """Vérifie que une machine occupée ne reçoit pas de demande de mise à jour."""
  self.p.is_available=False;self.p.update_printer_firmware=AsyncMock()
  with self.assertRaises(ValueError):await self.e.action('firmware',{})
  self.p.update_printer_firmware.assert_not_called()
 async def test_s1_factory_folder_is_verified_before_root_entry(self):
  """Vérifie que le dossier usine S1 est consulté avant d’ajouter son entrée à la racine."""
  from anycubic_cloud_api.data_models.printer import AnycubicPrinter
  e=adapter.Engine();calls=[]
  async def listing(printer,file_path):
   """Simule les réponses de dossiers pour vérifier les chemins envoyés au firmware."""
   calls.append(file_path);mid='reply'+str(len(calls))
   records=[{'filename':'factory.gcode','timestamp':0,'size':10,'is_dir':False}] if file_path=='test_model' else []
   e.file_messages[mid]={'state':'done','data':{'records':records}};return mid
  e.api=SimpleNamespace(_mqtt_client=SimpleNamespace(is_connected=lambda:True),_send_order_list_local_files=listing)
  e.printer=AnycubicPrinter(api_parent=e.api,machine_type=20025,machine_name='Anycubic Kobra S1',id=1,ignore_init_errors=True)
  result=await e.read_files('local','/')
  self.assertEqual(calls,['/','test_model']);self.assertEqual(result['files'][0]['name'],'test_model');self.assertTrue(result['files'][0]['is_dir'])
 async def test_s1_subfolder_uses_relative_wire_path(self):
  """Vérifie que le protocole S1 reçoit un chemin de sous-dossier relatif."""
  from anycubic_cloud_api.data_models.printer import AnycubicPrinter
  e=adapter.Engine();calls=[]
  async def listing(printer,file_path):
   """Simule les réponses de dossiers pour vérifier les chemins envoyés au firmware."""
   calls.append(file_path);e.file_messages['reply']={'state':'done','data':{'records':[{'filename':'a.gcode','timestamp':0,'size':10,'is_dir':False}]}};return 'reply'
  e.api=SimpleNamespace(_mqtt_client=SimpleNamespace(is_connected=lambda:True),_send_order_list_local_files=listing)
  e.printer=AnycubicPrinter(api_parent=e.api,machine_type=20025,machine_name='Anycubic Kobra S1',id=1,ignore_init_errors=True)
  result=await e.read_files('local','/test_model');self.assertEqual(calls,['test_model']);self.assertEqual(result['files'][0]['path'],'/test_model')
 async def test_factory_thumbnail_uses_native_cloud_query_and_nested_image(self):
  """Vérifie que l’aperçu usine utilise la consultation native et accepte une image imbriquée."""
  import base64
  self.p.id=42
  encoded=base64.b64encode(b'\x89PNG\r\n\x1a\nthumbnail').decode()
  async def send(order):
   """Simule le transport pour contrôler la corrélation ou le nombre de demandes envoyées."""
   payload=order.order_request_data
   self.assertEqual(payload['order_id'],1239)
   self.assertEqual(payload['data'],{'root':'local','filename':'test_model/benchy.gcode','plate_index':0})
   self.e.file_messages['preview']={'state':'done','data':{'file_details':{'thumbnail':encoded,'png_image':''}}}
   return 'preview'
  self.e.api._send_anycubic_order=send
  image=await self.e.local_preview('local','benchy.gcode','/test_model')
  self.assertEqual(image,'data:image/png;base64,'+encoded)
  self.e.api._send_anycubic_order=AsyncMock(side_effect=AssertionError('cache expected'))
  self.assertEqual(await self.e.local_preview('local','benchy.gcode','/test_model'),image)
 async def test_history_removes_private_fields_and_translates(self):
  """Vérifie que le journal filtre les identifiants privés et traduit les libellés."""
  entry=adapter.history_entry({'id':99,'user_id':'private','from_id':'private','content':'private','project_name':'model.gcode','print_status':2,'read':0,'create_time':1793308171})
  self.assertEqual(entry['result'],'Impression terminée');self.assertTrue(entry['unread']);self.assertNotIn('user_id',entry);self.assertNotIn('content',entry)
 async def test_history_does_not_label_interruption_as_success(self):
  """Vérifie que une interruption n’est pas présentée comme une impression réussie."""
  entry=adapter.history_entry({'print_status':3,'read':1})
  self.assertEqual(entry['kind'],'interrupted');self.assertEqual(entry['result'],'Impression interrompue');self.assertFalse(entry['unread'])
 async def test_temperature_history_bounds_missing_values_and_duplicates(self):
  """Vérifie que l’historique filtre les températures invalides et les doublons."""
  import tempfile
  with tempfile.TemporaryDirectory() as tmp:
   h=adapter.TemperatureHistory(pathlib.Path(tmp)/'temperatures.json')
   self.assertTrue(h.add(1000,{'nozzle':215,'bed':55,'ace':None}))
   self.assertFalse(h.add(1000,{'nozzle':216}))
   self.assertFalse(h.add(1001,{'nozzle':float('nan'),'bed':999}))
   self.assertIsNone(h.rows[0]['ace']);self.assertEqual(len(h.rows),1)
   h.save();loaded=adapter.TemperatureHistory(h.path)
   self.assertEqual(list(loaded.rows),list(h.rows))
 async def test_temperature_history_keeps_only_last_day(self):
  """Vérifie que la rétention des températures reste limitée à vingt-quatre heures."""
  import tempfile
  with tempfile.TemporaryDirectory() as tmp:
   h=adapter.TemperatureHistory(pathlib.Path(tmp)/'temperatures.json')
   h.add(1000,{'nozzle':20});h.add(100000,{'nozzle':200})
   self.assertEqual(len(h.rows),1);self.assertEqual(h.recent(1,100001)[0]['nozzle'],200)
 async def test_history_read_uses_known_key_and_clears_cache(self):
  """Vérifie que la lecture utilise une clé connue puis invalide le cache."""
  self.e.history_keys={'a'*20:42};self.e.history_cache={1:'cached'}
  self.e.api._fetch_api_resp=AsyncMock(return_value={'code':1})
  await self.e.mark_history_read('a'*20)
  self.assertEqual(self.e.api._fetch_api_resp.call_args.kwargs['params'],{'id':42});self.assertEqual(self.e.history_cache,{})
 async def test_history_read_unknown_key_does_not_send(self):
  """Vérifie que une clé de notification inconnue ne déclenche aucune requête."""
  self.e.api._fetch_api_resp=AsyncMock()
  with self.assertRaises(ValueError):await self.e.mark_history_read('unknown')
  self.e.api._fetch_api_resp.assert_not_called()
 async def test_history_bulk_read_uses_native_endpoint(self):
  """Vérifie que la lecture de toutes les notifications utilise le point d’accès natif."""
  self.e.api._fetch_api_resp=AsyncMock(return_value={'code':1})
  result=await self.e.mark_history_read(all_items=True)
  self.assertTrue(result['ok']);self.assertEqual(self.e.api._fetch_api_resp.call_args.kwargs['params'],{})
 async def test_busy_axis_command_is_never_sent(self):
  """Vérifie que une machine occupée ne reçoit aucun mouvement d’axe."""
  self.p.is_available=False;self.e.api._send_anycubic_order=AsyncMock()
  with self.assertRaises(ValueError):await self.e.action('axis',{'axis':1,'direction':1,'distance':1})
  self.e.api._send_anycubic_order.assert_not_called()
 async def test_axis_payload_rejects_unbounded_motion(self):
  """Vérifie que le contrôle des axes refuse les mouvements non bornés."""
  self.assertEqual(adapter.axis_payload(3,2,0),{'axis':3,'move_type':2,'distance':0})
  with self.assertRaises(ValueError):adapter.axis_payload(1,1,1000)
  with self.assertRaises(ValueError):adapter.axis_payload(5,1,50)
 async def test_ai_payload_preserves_unrelated_flags(self):
  """Vérifie que les réglages IA conservent les bits non concernés."""
  result=adapter.ai_payload({'spaghetti':True,'foreign':False,'spaghetti_level':2,'foreign_level':1,'pause':True},{'status':4,'sensitivity_level':[1,1,2],'notice_type':[0,0,1]})['ai_settings']
  self.assertEqual(result['status'],5);self.assertEqual(result['notice_type'],[0,1,1]);self.assertEqual(result['sensitivity_level'],[0,2,2])
 async def test_delete_history_unknown_key_never_sends(self):
  """Vérifie que une clé inconnue ne permet pas d’effacer une notification."""
  self.e.api._fetch_api_resp=AsyncMock()
  with self.assertRaises(ValueError):await self.e.delete_history('missing')
  self.e.api._fetch_api_resp.assert_not_called()
 async def test_delete_history_uses_only_selected_notification(self):
  """Vérifie que l’effacement vise uniquement la notification sélectionnée."""
  self.e.history_keys={'a'*20:42};self.e.api._fetch_api_resp=AsyncMock(return_value={'code':1})
  await self.e.delete_history('a'*20)
  self.assertEqual(self.e.api._fetch_api_resp.call_args.kwargs['params'],{'ids':[42]})
 async def test_empty_bulk_delete_never_sends_empty_ids(self):
  """Vérifie que un journal vide ne déclenche pas d’effacement global involontaire."""
  self.e.api._fetch_api_resp=AsyncMock(return_value={'code':1,'data':[]})
  await self.e.delete_history(all_items=True)
  self.assertEqual(self.e.api._fetch_api_resp.await_count,1)
 async def test_task_details_exposes_only_file_parameters(self):
  """Vérifie que seuls les paramètres de fichier autorisés sont exposés."""
  project=SimpleNamespace(_slice_param={'layer_height':.2,'user_id':'private','token':'private'},_slice_result={'size_x':73.9,'filament used [g]':[32.06]})
  info=adapter.task_details(project);self.assertEqual(info['material_grams'],32.06);self.assertEqual(info['parameters'],{'layer_height':.2})
 async def test_busy_ai_query_does_not_send(self):
  """Vérifie que une consultation IA n’est pas envoyée pendant une opération machine."""
  self.p.is_available=False;self.e.cloud_query=AsyncMock()
  with self.assertRaises(ValueError):await self.e.ai_settings()
  self.e.cloud_query.assert_not_called()
 async def test_query_refreshes_cloud_without_device_orders(self):
  """Vérifie que l’actualisation HTTP n’envoie pas de commande physique."""
  self.p.id=42;self.p.update_info_from_api=AsyncMock();self.e.api.printer_info_for_id=AsyncMock(return_value={'data':{}})
  self.p.query_printer_options=AsyncMock()
  await self.e.action('query',{})
  self.p.update_info_from_api.assert_awaited_once();self.p.query_printer_options.assert_not_called()


class FirmwareGuards(unittest.IsolatedAsyncioTestCase):
 """Vérifications des conditions préalables aux mises à jour ACE."""
 async def test_ace_without_vendor_update_never_sends(self):
  """Vérifie que aucune mise à jour ACE ne part sans proposition constructeur."""
  p=SimpleNamespace(connected_ace_units=1,is_available=True,multi_color_box_fw_version=[SimpleNamespace(update_available=False,firmware_version='1.1.36',available_version='1.1.36')],update_printer_multi_color_box_firmware=AsyncMock())
  engine=adapter.Engine();engine.printer=p;engine.api=SimpleNamespace()
  with self.assertRaisesRegex(ValueError,'Aucune mise à jour'):await engine.action('ace-firmware',{'box':0})
  p.update_printer_multi_color_box_firmware.assert_not_called()
 async def test_offered_ace_update_targets_selected_box(self):
  """Vérifie que la mise à jour ACE vise le boîtier sélectionné."""
  p=SimpleNamespace(connected_ace_units=2,is_available=True,multi_color_box_fw_version=[SimpleNamespace(update_available=False),SimpleNamespace(update_available=True)],update_printer_multi_color_box_firmware=AsyncMock(return_value='1.2'))
  engine=adapter.Engine();engine.printer=p;engine.api=SimpleNamespace()
  await engine.action('ace-firmware',{'box':1});p.update_printer_multi_color_box_firmware.assert_awaited_once_with(box_id=1)
 async def test_missing_ace_version_never_sends(self):
  """Vérifie que une version ACE inconnue bloque la demande de mise à jour."""
  p=SimpleNamespace(connected_ace_units=1,is_available=True,multi_color_box_fw_version=[],update_printer_multi_color_box_firmware=AsyncMock())
  engine=adapter.Engine();engine.printer=p;engine.api=SimpleNamespace()
  with self.assertRaisesRegex(ValueError,'non reçue'):await engine.action('ace-firmware',{'box':0})
  p.update_printer_multi_color_box_firmware.assert_not_called()



class AiReadProtocol(unittest.IsolatedAsyncioTestCase):
 """Vérifications de l’enveloppe native des consultations IA."""
 async def test_ai_read_uses_vendor_query_payload_without_project_or_data(self):
  """Vérifie que la consultation IA conserve l’enveloppe native sans projet ni données."""
  engine=adapter.Engine();engine.printer=SimpleNamespace(id=7,key='printer-key',is_available=True,latest_project_print_in_progress=False)
  async def send(request):
   """Simule le transport pour contrôler la corrélation ou le nombre de demandes envoyées."""
   self.assertEqual(request.order_request_data,{'order_id':1242,'printer_id':7})
   engine.receive_ai_reply('anycubic/anycubicCloud/v1/printer/public/model/printer-key/aiSettings/report',{'type':'aiSettings','action':'query','state':'done','msgid':'device-generated-id','data':{'ai_settings':{'status':3,'sensitivity_level':[1,2,0],'notice_type':[0,2,0]}}});return 'different-cloud-id'
  engine.api=SimpleNamespace(_send_anycubic_order=send)
  result=await engine.ai_settings();self.assertEqual(result['status'],3)
 async def test_rejected_read_does_not_wait_for_nonexistent_message(self):
  """Vérifie que un refus de consultation n’attend pas une réponse MQTT inexistante."""
  engine=adapter.Engine();engine.printer=SimpleNamespace(id=7);engine.api=SimpleNamespace(_send_anycubic_order=AsyncMock(return_value=None))
  with self.assertRaisesRegex(ValueError,'pas été acceptée'):await engine.cloud_query(1242)



class AiReplyGuards(unittest.TestCase):
 """Vérifications de la corrélation des réponses IA avec la machine et la demande courantes."""
 def test_only_current_printer_and_active_query_can_supply_settings(self):
  """Vérifie que seule une réponse IA de la machine et de la demande courantes est acceptée."""
  import time
  e=adapter.Engine();e.printer=SimpleNamespace(key='ours');payload={'type':'aiSettings','action':'query','state':'done','data':{'ai_settings':{'status':3}}}
  e.receive_ai_reply('a/b/c/d/e/f/ours/report',payload);self.assertIsNone(getattr(e,'ai_query_reply',None))
  e.ai_query_started=time.monotonic();e.receive_ai_reply('a/b/c/d/e/f/other/report',payload);self.assertIsNone(getattr(e,'ai_query_reply',None))
  e.receive_ai_reply('a/b/c/d/e/f/ours/report',{**payload,'action':'set'});self.assertIsNone(getattr(e,'ai_query_reply',None))
  e.receive_ai_reply('a/b/c/d/e/f/ours/report',payload);self.assertEqual(e.ai_query_reply[1]['data']['ai_settings']['status'],3)
 def test_old_query_does_not_accept_unsolicited_report(self):
  """Vérifie que une consultation expirée ne consomme pas un rapport spontané."""
  import time
  e=adapter.Engine();e.printer=SimpleNamespace(key='ours');e.ai_query_started=time.monotonic()-31
  e.receive_ai_reply('a/b/c/d/e/f/ours/report',{'type':'aiSettings','action':'query','state':'done','data':{'ai_settings':{'status':3}}})
  self.assertIsNone(getattr(e,'ai_query_reply',None))

if __name__=='__main__':unittest.main()
