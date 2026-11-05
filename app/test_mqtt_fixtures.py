"""Rapports MQTT entièrement fictifs : états ACE, ordre d’arrivée et diagnostics sans données privées."""
import json,types,unittest
from unittest.mock import Mock,AsyncMock
from anycubic_cloud_api.api.mqtt import AnycubicMQTTAPI
from anycubic_cloud_api.data_models.printer import AnycubicPrinter
import server as adapter

class FixtureBox:
 """État minimal d’un ACE simulé ; aucun transport ni ordre de commande."""
 def __init__(self,identifier):
  """Conserve l’identité fictive du boîtier pour vérifier le routage des emplacements."""
  self.box_id=identifier;self.loaded_slot=None
 def set_slot_loaded(self,value):
  """Reçoit l’état issu du véritable parseur sans toucher à un appareil."""
  self.loaded_slot=value

class MQTTFixtures(unittest.TestCase):
 """Le routeur consomme des fixtures connues et compte les inconnues sans les republier."""
 def setUp(self):
  """Crée un client non connecté et remplace explicitement toutes les sorties réseau par des doublures."""
  self.log=Mock();self.client=AnycubicMQTTAPI(None,None,debug_logger=self.log);self.client._fetch_api_resp=AsyncMock();self.client._mqtt_publish_to_printer=Mock();self.client.connect_mqtt=Mock();self.client._mqtt_callback_printer_update=Mock()
  self.printer=types.SimpleNamespace(is_available=True,is_busy=False,_multi_color_box=[])
  self.printer.process_mqtt_update=types.MethodType(AnycubicPrinter.process_mqtt_update,self.printer)
  self.printer._process_mqtt_update_multicolorbox=types.MethodType(AnycubicPrinter._process_mqtt_update_multicolorbox,self.printer)
  self.printer._multi_color_box_index_by_id=types.MethodType(AnycubicPrinter._multi_color_box_index_by_id,self.printer)
  def replace_boxes(rows):
   """Simule uniquement la construction de boîtiers ; les branches MQTT exécutées restent celles du projet."""
   self.printer._multi_color_box=[FixtureBox(r['id']) for r in rows]
  self.printer._set_multi_color_box=replace_boxes;self.client._mqtt_subscribed_printers['fixture-private-device']=self.printer
  self.topic='anycubic/anycubicCloud/v1/printer/app/20025/fixture-private-device/report'
 def send(self,payload):
  """Livre une fixture au routeur sans socket ni abonnement réel."""
  self.client._mqtt_message_router(types.SimpleNamespace(topic=self.topic,payload=json.dumps(payload).encode()))
 def tearDown(self):
  """Vérifie systématiquement qu’aucune lecture réseau ni commande n’est partie du banc de test."""
  self.client._fetch_api_resp.assert_not_awaited();self.client._mqtt_publish_to_printer.assert_not_called();self.client.connect_mqtt.assert_not_called()
 def test_ace_update_before_initial_list_is_safe_then_targets_correct_box(self):
  """Un rapport reçu avant la liste initiale ne crée pas un faux boîtier et n’écrase pas son voisin."""
  self.send({'type':'multiColorBox','action':'autoUpdateInfo','state':'done','data':{'id':1,'loaded_slot':3}})
  self.assertEqual(self.printer._multi_color_box,[])
  self.send({'type':'multiColorBox','action':'getInfo','state':'success','data':{'multi_color_box':[{'id':0},{'id':1}]}})
  self.send({'type':'multiColorBox','action':'autoUpdateInfo','state':'done','data':{'id':1,'loaded_slot':2}})
  self.assertIsNone(self.printer._multi_color_box[0].loaded_slot);self.assertEqual(self.printer._multi_color_box[1].loaded_slot,2)
 def test_unknown_type_does_not_change_state_or_claim_a_fresh_reading(self):
  """Un type nouveau ne peut modifier un état connu ou rafraîchir artificiellement ses températures."""
  self.send({'type':'info','action':'report','state':'done','data':{}});calls=self.client._mqtt_callback_printer_update.call_count
  payload={'type':'fixture-private-unknown-type','action':'fixture-private-action','state':'done','data':{'secret':'fixture-private-payload'}}
  self.send(payload);self.send(payload)
  d=self.client.mqtt_diagnostics;self.assertEqual(d['unknown_reports'],2);self.assertEqual(d['unknown_types'],1);self.assertEqual(self.printer._multi_color_box,[]);self.assertEqual(self.client._mqtt_callback_printer_update.call_count,calls)
  self.assertNotIn('fixture-private',str(self.log.mock_calls));self.assertNotIn('fixture-private',json.dumps(d))
 def test_extra_fields_do_not_replace_known_state_or_escape_in_diagnostics(self):
  """Les champs connus sont utilisables ; les suppléments privés restent ignorés et seulement comptés."""
  self.send({'type':'multiColorBox','action':'getInfo','state':'success','data':{'multi_color_box':[{'id':0}]}})
  self.send({'type':'multiColorBox','action':'autoUpdateInfo','state':'done','data':{'id':0,'loaded_slot':2,'fixture-private-extra':'fixture-private-secret'}})
  self.assertEqual(self.printer._multi_color_box[0].loaded_slot,2);self.assertEqual(self.client.mqtt_diagnostics['unhandled_reports'],1);self.assertNotIn('fixture-private',str(self.log.mock_calls))
 def test_invalid_and_account_messages_never_log_payload_even_in_debug(self):
  """Le mode diagnostic n’autorise pas de journaliser jetons, clés ou topics de compte."""
  self.client.set_mqtt_log_all_messages(True)
  for payload in [b'fixture-private-not-json',b'\xfffixture-private-bytes',b'[]']:
   self.client._mqtt_on_message(None,None,types.SimpleNamespace(topic=self.topic,payload=payload))
  self.client._mqtt_message_router(types.SimpleNamespace(topic='anycubic/anycubicCloud/v1/server/app/fixture-private-account/hash/slice/report',payload=json.dumps({'secret':'fixture-private-token'}).encode()))
  self.assertEqual(self.client.mqtt_diagnostics['decode_errors'],3);self.assertNotIn('fixture-private',str(self.log.mock_calls))
 def test_distinct_type_memory_is_bounded_and_limit_is_reported(self):
  """Le compteur ne doit pas accumuler sans limite des noms arbitraires provenant du réseau."""
  for i in range(260):self.send({'type':'fixture-private-type-'+str(i),'action':'report','state':'done','data':{}})
  d=self.client.mqtt_diagnostics;self.assertEqual(d['unknown_reports'],260);self.assertEqual(d['unknown_types'],256);self.assertTrue(d['unknown_types_capped']);self.assertEqual(len(self.client._mqtt_unknown_type_hashes),256)
 def test_callback_exception_is_sanitized_and_snapshot_exposes_only_counts(self):
  """Une exception de rappel ne révèle pas son message privé ; le navigateur reçoit des nombres uniquement."""
  self.client._mqtt_callback_printer_update.side_effect=RuntimeError('fixture-private-callback')
  self.send({'type':'info','action':'report','state':'done','data':{}})
  self.assertNotIn('fixture-private',str(self.log.mock_calls));e=adapter.Engine();e.api=self.client;e.printer=None
  result=e.snapshot()['mqtt_diagnostics'];self.assertEqual(result,self.client.mqtt_diagnostics);self.assertTrue(all(isinstance(v,(int,bool)) for v in result.values()))
