"""Vérifie les comportements décrits par les annotations de protocole, sans données cloud réelles."""
import types,unittest
from unittest.mock import Mock
from anycubic_cloud_api.api.mqtt import AnycubicMQTTAPI
from anycubic_cloud_api.data_models.printer import AnycubicPrinter
from anycubic_cloud_api.data_models.project import AnycubicProject

class ProtocolContracts(unittest.TestCase):
 """Les annotations doivent distinguer acquittement, liste complète et champs de tranche différents."""
 def test_delete_ack_keeps_list_until_dedicated_report(self):
  """Les acquittements local et USB conservent la liste ; le rapport dédié remplace son contenu."""
  for delete,list_action,kind in [('deleteLocal','listLocal','local'),('deleteUdisk','listUdisk','udisk')]:
   printer=types.SimpleNamespace(records=['fixture-before'])
   def replace(records,file_path):
    """Applique une liste fictive comme le ferait le modèle, sans transport."""
    printer.records=records
   setattr(printer,'_pending_'+kind+'_file_list_path','/')
   setattr(printer,'_set_'+kind+'_file_list',replace)
   AnycubicPrinter._process_mqtt_update_file(printer,delete,'success',{'data':{}})
   self.assertEqual(printer.records,['fixture-before'])
   AnycubicPrinter._process_mqtt_update_file(printer,list_action,'done',{'data':{'records':['fixture-after'],'path':'/'}})
   self.assertEqual(printer.records,['fixture-after'])
 def test_unused_recommendations_are_consumed_without_changing_files(self):
  """Un rapport sans affichage associé ne doit pas remplacer les fichiers connus."""
  payload=Mock();printer=types.SimpleNamespace(records=['fixture-before'])
  AnycubicPrinter._process_mqtt_update_file(printer,'cloudRecommendList','done',payload)
  payload.force_empty.assert_called_once();self.assertEqual(printer.records,['fixture-before'])
 def test_active_subscriptions_do_not_add_unused_slicer_prefix(self):
  """Le préfixe conservé pour référence ne crée pas implicitement un nouvel abonnement."""
  printer=types.SimpleNamespace(machine_type=20025,key='fixture-key')
  self.assertEqual(AnycubicMQTTAPI._build_mqtt_printer_subscription(None,printer),[
   'anycubic/anycubicCloud/v1/printer/app/20025/fixture-key/#',
   'anycubic/anycubicCloud/v1/+/public/20025/fixture-key/#'])
 def test_raw_slice_data_is_preserved_separately_from_parsed_parameters(self):
  """Un champ de format inconnu n’est ni perdu ni interprété comme les paramètres JSON de tranche."""
  def project(raw,parameters):
   """Crée un projet entièrement fictif avec les seuls champs obligatoires."""
   return AnycubicProject(api_parent=None,id=1,taskid=1,gcode_id=1,estimate=10,progress=0,status=0,create_time=0,gcode_name='fixture.gcode',slice_data=raw,slice_param=parameters)
  original=project({'unknown':'fixture-before'},{'layer_height':0.2})
  updated=project(['fixture-unknown-shape'],{'layer_height':0.3})
  original.update_with_project(updated)
  self.assertEqual(original._slice_data,['fixture-unknown-shape'])
  self.assertEqual(original._slice_param,{'layer_height':0.3})
