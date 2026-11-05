"""Transitions de rapports de micrologiciel sur modèles fictifs, sans mise à jour de matériel."""
import types,unittest
from anycubic_cloud_api.data_models.printer import AnycubicPrinter
from anycubic_cloud_api.data_models.printer_properties import AnycubicMachineFirmwareInfo
from anycubic_cloud_api.exceptions.exceptions import AnycubicMQTTUnknownUpdate

class FirmwareReports(unittest.TestCase):
 """Un acquittement de succès termine l’attente même si la version annoncée reste identique."""
 def setUp(self):
  """Crée deux boîtiers pour vérifier que les rapports restent ciblés."""
  self.versions=[AnycubicMachineFirmwareInfo(1,'fixture-version') for _ in range(2)]
  self.printer=types.SimpleNamespace(multi_color_box_fw_version=self.versions)
 def apply(self,action,state,data=None,box=1):
  """Applique un rapport simulé au seul modèle local, sans abonnement MQTT."""
  AnycubicPrinter._process_mqtt_update_ota_multicolorbox(self.printer,action,state,{'data':data or {}},box)
 def test_success_clears_progress_without_fabricating_version(self):
  """Les deux formes de succès annulent l’état transitoire du bon ACE, même après réinstallation."""
  for state in ['update-success','updateSuccessProcessed']:
   with self.subTest(state=state):
    self.apply('update','start');self.apply('update','downloading',{'progress':75})
    self.apply('update','updating',{'current_progress':80})
    self.apply('update',state)
    self.apply('reportVersion','done',{'firmware_version':'fixture-version'})
    firmware=self.versions[1]
    self.assertFalse(firmware.is_updating);self.assertFalse(firmware.is_downloading)
    self.assertEqual(firmware.download_progress,0);self.assertEqual(firmware.update_progress,0)
    self.assertEqual(firmware.firmware_version,'fixture-version')
 def test_success_does_not_change_other_ace(self):
  """Le succès du second ACE ne remet pas à zéro une mise à jour du premier."""
  self.apply('update','start',box=0);self.apply('update','start',box=1)
  self.apply('update','update-success',box=1)
  self.assertTrue(self.versions[0].is_updating);self.assertFalse(self.versions[1].is_updating)
 def test_unchanged_version_alone_does_not_finish_active_update(self):
  """Un rapport de version courant pendant le téléchargement n’est pas une preuve de fin."""
  self.apply('update','downloading',{'progress':25})
  self.apply('reportVersion','done',{'firmware_version':'fixture-version'})
  self.assertTrue(self.versions[1].is_updating);self.assertTrue(self.versions[1].is_downloading)
 def test_changed_version_finishes_as_before(self):
  """Le rapport d’une nouvelle version conserve le comportement antérieur de remise à zéro."""
  self.apply('update','start');self.apply('reportVersion','done',{'firmware_version':'fixture-new'})
  self.assertFalse(self.versions[1].is_updating);self.assertEqual(self.versions[1].firmware_version,'fixture-new')
 def test_unknown_report_does_not_claim_success(self):
  """Un état non documenté ne doit pas terminer une mise à jour par simple hypothèse."""
  self.apply('update','start')
  with self.assertRaises(AnycubicMQTTUnknownUpdate):self.apply('update','fixture-unknown')
  self.assertTrue(self.versions[1].is_updating)
