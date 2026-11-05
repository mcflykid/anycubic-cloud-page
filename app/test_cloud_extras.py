"""Tests isolés : cloud extras, sans commande physique ni connexion au cloud."""
import asyncio,pathlib,sys,tempfile,time,unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock,patch
from cloud_extras import CloudExtras,ResetChallenges,trusted_url

class ResetTests(unittest.TestCase):
 """Vérifications des codes de confirmation temporaires de réinitialisation."""
 def test_code_is_six_digits_single_use(self):
  """Vérifie que le code de confirmation possède six chiffres et ne peut servir qu’une fois."""
  r=ResetChallenges();d=r.issue(1);self.assertRegex(d['code'],r'^\d{6}$');r.consume(d['ticket'],d['code'],1)
  with self.assertRaises(ValueError):r.consume(d['ticket'],d['code'],1)
 def test_wrong_printer_rejected(self):
  """Vérifie que une confirmation liée à une autre machine est refusée."""
  r=ResetChallenges();d=r.issue(1)
  with self.assertRaises(ValueError):r.consume(d['ticket'],d['code'],2)
 def test_expiration(self):
  """Vérifie que une confirmation expirée est refusée."""
  r=ResetChallenges();d=r.issue(1);r.items[d['ticket']]['expires']=0
  with self.assertRaises(ValueError):r.consume(d['ticket'],d['code'],1)
 def test_three_wrong_attempts_invalidate(self):
  """Vérifie que trois codes erronés invalident la confirmation."""
  r=ResetChallenges();d=r.issue(1)
  for _ in range(3):
   with self.assertRaises(ValueError):r.consume(d['ticket'],'invalid',1)
  with self.assertRaises(ValueError):r.consume(d['ticket'],d['code'],1)
 def test_remote_links_are_vendor_only(self):
  """Vérifie que seules les URL du stockage autorisé sont acceptées."""
  self.assertTrue(trusted_url('https://bucket.s3.amazonaws.com/file?signature=test'))
  for u in ['http://s3.amazonaws.com/file','https://amazonaws.com.evil.test/file','https://127.0.0.1/file','https://x@anycubic.com/file','file:///etc/passwd','https://anycubic.com:123/file']:
   self.assertFalse(trusted_url(u),u)

class ExtrasTests(unittest.IsolatedAsyncioTestCase):
 """Vérifications des fonctions cloud complémentaires et de leurs validations."""
 def setUp(self):
  """Prépare des données et doublures isolées pour chaque scénario."""
  self.e=SimpleNamespace(api=SimpleNamespace(_fetch_api_resp=AsyncMock(return_value={'code':1,'data':{}})),printer=SimpleNamespace(id=7,printer_online=True,is_available=True,latest_project_print_in_progress=False),raw_info={'features':[]},cloudfiles={},slots=lambda d:[0])
  self.x=CloudExtras(self.e)
 def task(self,status=2):"""Installe une tâche fictive pour tester les restrictions d’évaluation et de réimpression.""";self.x.tasks['key']={'id':99,'taskid':123,'printer_id':7,'print_status':status,'gcode_id':80}
 async def test_rating_uses_device_taskid(self):
  """Vérifie que la note utilise la référence de tâche attendue par le cloud."""
  self.task();self.x.api=AsyncMock(side_effect=[{},{}]);await self.x.action('task-rate',{'key':'key','stars':4})
  self.assertEqual(self.x.api.await_args_list[-1].args,('/v3/work/sumbitComment',{'project_id':123,'star':4}))
 async def test_rating_wrong_status_does_not_submit(self):
  """Vérifie que une impression non terminée ne peut pas être évaluée."""
  self.task(1);self.x.api=AsyncMock()
  with self.assertRaises(ValueError):await self.x.action('task-rate',{'key':'key','stars':4})
  self.x.api.assert_not_called()
 async def test_unrecognised_batch_rejected_before_network(self):
  """Vérifie que une sélection inconnue est refusée avant toute requête réseau."""
  self.e.cloudfiles['ok']=SimpleNamespace(id=12)
  with self.assertRaises(ValueError):await self.x.action('cloud-delete-many',{'handles':['ok','absent']})
  self.e.api._fetch_api_resp.assert_not_called()
 async def test_batch_delete_validates_whole_selection(self):
  """Vérifie que tout le lot est validé avant une demande d’effacement."""
  self.e.cloudfiles={'a':SimpleNamespace(id=12),'b':SimpleNamespace(id=13)};self.x.api=AsyncMock()
  await self.x.action('cloud-delete-many',{'handles':['a','b']});self.x.api.assert_awaited_once_with('/work/index/delFiles',{'idArr':[12,13]})
 async def test_busy_guard_blocks_reprint_before_request(self):
  """Vérifie que une machine occupée ne reçoit pas de réimpression."""
  self.task();self.e.printer.latest_project_print_in_progress=True;self.e.printer.print_with_cloud_gcode_id=AsyncMock()
  with self.assertRaises(ValueError):await self.x.action('task-reprint',{'key':'key'})
  self.e.printer.print_with_cloud_gcode_id.assert_not_called()
 async def test_reset_needs_capability_and_code(self):
  """Vérifie que la réinitialisation exige la capacité annoncée et un code valide."""
  self.x.device=AsyncMock(return_value={'factory_reset':False});self.x.order=AsyncMock()
  with self.assertRaises(ValueError):await self.x.action('factory-reset',{})
  self.x.order.assert_not_called()
  self.x.device.return_value={'factory_reset':True}
  with self.assertRaises(ValueError):await self.x.action('factory-reset',{'ticket':'bad','code':'123456'})
  self.x.order.assert_not_called()
 async def test_reset_good_code_sends_once(self):
  """Vérifie que un code valide ne permet qu’un seul envoi de réinitialisation."""
  self.x.device=AsyncMock(return_value={'factory_reset':True});self.x.order=AsyncMock(return_value='ok');d=self.x.resets.issue(7)
  await self.x.action('factory-reset',d);self.x.order.assert_awaited_once_with(1257)
  with self.assertRaises(ValueError):await self.x.action('factory-reset',d)
 async def test_download_rejects_untrusted_vendor_response(self):
  """Vérifie que un lien non autorisé renvoyé par le cloud est refusé."""
  self.e.cloudfiles['a']=SimpleNamespace(id=4,old_filename='piece.gcode');self.x.api=AsyncMock(return_value=[{'url':'https://evil.test/file'}])
  with self.assertRaises(ValueError):await self.x.download(['a'])
 async def test_download_binds_each_selected_id_to_its_name(self):
  """Vérifie que chaque téléchargement conserve l’association entre fichier et nom."""
  self.e.cloudfiles={'a':SimpleNamespace(id=12,old_filename='a.gcode'),'b':SimpleNamespace(id=13,old_filename='b.gcode')}
  self.x.api=AsyncMock(side_effect=[[{'url':'https://anycubic.com/b'}],[{'url':'https://anycubic.com/a'}]])
  result=await self.x.download(['b','a'])
  self.assertEqual([c.args[1] for c in self.x.api.await_args_list],[{'ids':[13]},{'ids':[12]}])
  for item,expected in zip(result['downloads'],['b','a']):
   self.assertEqual(item['name'],expected+'.gcode');ticket=item['url'].split('/')[-1]
   self.assertEqual(self.x.downloads[ticket]['url'],'https://anycubic.com/'+expected)
 async def test_invalid_last_download_leaves_no_partial_tickets(self):
  """Vérifie que un lot de liens invalide ne laisse aucun ticket partiel."""
  self.e.cloudfiles={k:SimpleNamespace(id=i,old_filename=k) for i,k in enumerate(['a','b'])}
  self.x.api=AsyncMock(side_effect=[['https://anycubic.com/a'],[]])
  with self.assertRaises(ValueError):await self.x.download(['a','b'])
  self.assertFalse(self.x.downloads)
 async def test_rename_removes_only_original_extension_and_repairs_duplicates(self):
  """Vérifie que le renommage retire uniquement les répétitions de l’extension d’origine."""
  for supplied,expected in [('part.v2.gcode','part.v2'),('part.GCODE.gcode','part'),('part.v2','part.v2')]:
   self.e.cloudfiles={'a':SimpleNamespace(id=12,old_filename='original.gcode',_file_extension='gcode')};self.x.api=AsyncMock()
   await self.x.action('cloud-rename',{'handle':'a','name':supplied})
   self.x.api.assert_awaited_once_with('/work/index/renameFile',{'id':12,'name':expected})
 async def test_rename_extension_only_rejected(self):
  """Vérifie que un nom réduit à l’extension est refusé."""
  self.e.cloudfiles={'a':SimpleNamespace(id=12,old_filename='original.gcode')};self.x.api=AsyncMock()
  with self.assertRaises(ValueError):await self.x.action('cloud-rename',{'handle':'a','name':'.gcode'})
  self.x.api.assert_not_called()
 async def test_tasks_are_printer_scoped_and_paged(self):
  """Vérifie que l’historique reste paginé et limité à la machine courante."""
  self.x.api=AsyncMock(side_effect=[[{'task_id':1,'printer_id':8},{'task_id':2,'printer_id':7,'gcode_name':'piece','print_status':2}],[]]);d=await self.x.task_list(2)
  self.assertEqual(len(d['items']),1);self.assertEqual(self.x.api.await_args_list[0].args,('/v2/project/printHistory',));self.assertEqual(self.x.api.await_args_list[0].kwargs['query'],{'printer_id':7,'page':2,'limit':20})
 async def test_calibration_unknown_is_never_sent(self):
  """Vérifie que une calibration non annoncée n’est jamais envoyée."""
  self.x.device=AsyncMock(return_value={'calibrations':[]});self.x.order=AsyncMock()
  with self.assertRaises(ValueError):await self.x.action('calibrate',{'items':['auto_leveling']})
  self.x.order.assert_not_called()
 async def test_rename_rejects_path(self):
  """Vérifie que le renommage refuse les séparateurs de chemin."""
  self.e.cloudfiles['a']=SimpleNamespace(id=12);self.x.api=AsyncMock()
  with self.assertRaises(ValueError):await self.x.action('cloud-rename',{'handle':'a','name':'../x'})
  self.x.api.assert_not_called()


class HistoryPreviewTests(unittest.IsolatedAsyncioTestCase):
 """Vérifications du filtrage et de la récupération des aperçus de tâches."""
 setUp=ExtrasTests.setUp
 task=ExtrasTests.task
 async def test_zero_reason_is_hidden_but_real_warning_retained(self):
  """Vérifie que le code zéro est masqué sans supprimer une alerte réelle."""
  self.task();self.x.api=AsyncMock(return_value={'reason':'0','reason_id':'0','material_warning':'Filament épuisé'})
  result=await self.x.detail('key');self.assertEqual(result['reason'],'Filament épuisé');self.assertEqual(result['reason_code'],'')
  self.x.api=AsyncMock(return_value={'reason':'0','reason_id':0})
  result=await self.x.detail('key');self.assertEqual(result['reason'],'');self.assertEqual(result['reason_code'],'')
 async def test_preview_does_not_match_another_task_or_untrusted_host(self):
  """Vérifie que un aperçu ne provient ni d’une autre tâche ni d’un hôte non autorisé."""
  self.task();self.x.tasks['key']['img']='https://evil.example/image.png';self.x.api=AsyncMock(return_value={});self.e.session=SimpleNamespace(get=unittest.mock.Mock())
  self.assertEqual(await self.x.preview('key'),{'image':None});self.e.session.get.assert_not_called()
 async def test_preview_rejects_wrong_printer(self):
  """Vérifie que une tâche d’une autre machine ne fournit pas d’aperçu."""
  self.task();self.x.tasks['key']['printer_id']=8;self.x.api=AsyncMock()
  with self.assertRaises(ValueError):await self.x.preview('key')
  self.x.api.assert_not_called()
 async def test_preview_is_bounded_cached_and_keeps_url_private(self):
  """Vérifie que l’aperçu est borné, mis en cache et n’expose pas son URL cloud."""
  self.task();self.x.tasks['key']['img']='https://anycubic.com/thumb.png?signature=private'
  async def chunks(n):"""Simule une lecture réseau fragmentée pour vérifier la taille et le contenu de l’aperçu.""";yield b'image'
  response=SimpleNamespace(status=200,headers={'Content-Type':'image/png'},content=SimpleNamespace(iter_chunked=chunks))
  context=unittest.mock.MagicMock();context.__aenter__=AsyncMock(return_value=response);context.__aexit__=AsyncMock(return_value=False)
  self.e.session=SimpleNamespace(get=unittest.mock.Mock(return_value=context))
  result=await self.x.preview('key');self.assertEqual(result,{'image':'data:image/png;base64,aW1hZ2U='})
  self.assertEqual(await self.x.preview('key'),result);self.e.session.get.assert_called_once()

class NotificationPreviewTests(unittest.IsolatedAsyncioTestCase):
 """Vérifications des références explicites utilisées pour les aperçus de notifications."""
 setUp=ExtrasTests.setUp
 async def test_unknown_notification_rejected(self):
  """Vérifie que une notification inconnue est refusée avant recherche d’aperçu."""
  with self.assertRaises(ValueError):await self.x.notification_preview('unknown')
 async def test_notification_image_uses_its_own_row(self):
  """Vérifie que une notification utilise d’abord sa propre image."""
  row={'id':77,'img':'https://anycubic.com/image.png'};self.e.notification_rows={'a':row};self.x.preview_row=AsyncMock(return_value={'image':'data:image/png;base64,eA=='})
  self.assertTrue((await self.x.notification_preview('a'))['image']);self.x.preview_row.assert_awaited_once_with('notification:a',row,lookup_detail=False)
 async def test_same_filename_never_matches_without_task_reference(self):
  """Vérifie que un nom de fichier seul ne suffit pas à associer un aperçu de notification."""
  self.e.notification_rows={'a':{'id':1,'project_name':'same.gcode'}};self.x.preview_row=AsyncMock(return_value={'image':None});self.x.api=AsyncMock()
  self.assertEqual(await self.x.notification_preview('a'),{'image':None});self.x.api.assert_not_called()
 async def test_task_reference_requires_unique_project_on_current_printer(self):
  """Vérifie que la référence doit correspondre à un projet unique de la machine courante."""
  self.e.notification_rows={'a':{'id':1,'project_id':44}};self.x.preview_row=AsyncMock(side_effect=[{'image':None},{'image':'data:image/png;base64,eA=='}]);self.x.api=AsyncMock(return_value=[{'id':44,'printer_id':8},{'id':44,'printer_id':7,'taskid':55,'img':'https://anycubic.com/a.png'}])
  self.assertTrue((await self.x.notification_preview('a'))['image']);self.assertEqual(self.x.preview_row.await_args.args[1]['printer_id'],7)
 async def test_ambiguous_reference_keeps_preview_unavailable(self):
  """Vérifie que une référence ambiguë ne fournit aucun aperçu."""
  self.e.notification_rows={'a':{'project_id':44}};self.x.preview_row=AsyncMock(return_value={'image':None});self.x.api=AsyncMock(return_value=[{'id':44,'printer_id':7},{'taskid':44,'printer_id':7}])
  self.assertEqual(await self.x.notification_preview('a'),{'image':None});self.x.preview_row.assert_awaited_once()

if __name__=='__main__':unittest.main()
