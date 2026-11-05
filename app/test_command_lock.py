"""Tests isolés : command lock, sans commande physique ni connexion au cloud."""
import asyncio,importlib.util,json,pathlib,unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock,Mock

spec=importlib.util.spec_from_file_location('command_lock_adapter',pathlib.Path(__file__).with_name('server.py'))
adapter=importlib.util.module_from_spec(spec);spec.loader.exec_module(adapter)

class Part:
 """Partie multipart fictive pour tester les transferts sans fichier réel."""
 def __init__(self,name,value,filename=None):"""Initialise la doublure de test.""";self.name=name;self.value=value;self.filename=filename
 async def text(self):"""Renvoie la valeur textuelle de cette partie multipart fictive.""";return self.value
 async def read_chunk(self,size):
  """Renvoie le contenu fictif une seule fois, pour reproduire une lecture multipart consommable."""
  value=self.value;self.value=b'';return value

class Parts:
 """Itérateur multipart fictif pour tester la lecture asynchrone d’un transfert."""
 def __init__(self,parts):"""Initialise la doublure de test.""";self.parts=iter(parts)
 def __aiter__(self):"""Renvoie l’itérateur multipart fictif utilisé par les tests de transfert.""";return self
 async def __anext__(self):
  """Renvoie la partie multipart suivante ; lève StopAsyncIteration à la fin du transfert fictif."""
  try:return next(self.parts)
  except StopIteration:raise StopAsyncIteration

class CommandLockTests(unittest.IsolatedAsyncioTestCase):
 """Vérifications de l’attente des lectures et de l’exclusion entre opérations utilisateur."""
 async def asyncSetUp(self):
  """Prépare les doublures et l’état asynchrone isolés pour chaque scénario."""
  self.previous=adapter.engine;self.timeout=adapter.COMMAND_READ_WAIT_SECONDS
  self.engine=SimpleNamespace(lock=asyncio.Lock(),command_lock=asyncio.Lock(),commands={},action=AsyncMock(return_value='accepted'),event=Mock(),printer=SimpleNamespace(is_available=True),api=SimpleNamespace(upload_file_to_cloud=AsyncMock()))
  adapter.engine=self.engine;adapter.COMMAND_READ_WAIT_SECONDS=.2
 async def asyncTearDown(self):"""Restaure l’état partagé et ferme les ressources ouvertes par le scénario.""";adapter.engine=self.previous;adapter.COMMAND_READ_WAIT_SECONDS=self.timeout
 def req(self,rid='command-test-0001'):
  """Renvoie une requête de commande fictive avec identifiant stable pour tester la déduplication."""
  return SimpleNamespace(headers={},transport=SimpleNamespace(is_closing=lambda:False),json=AsyncMock(return_value={'request_id':rid,'action':'light','enabled':True}))
 def upload_req(self,rid='upload-test-00001'):
  """Renvoie un transfert multipart fictif avec fichier et identifiant de demande."""
  parts=Parts([Part('file',b'G28\n','fixture.gcode'),Part('request_id',rid),Part('mode','upload')])
  return SimpleNamespace(headers={},transport=SimpleNamespace(is_closing=lambda:False),multipart=AsyncMock(return_value=parts))
 async def test_command_waits_for_read_then_sends_once(self):
  """Vérifie que une commande attend la lecture puis n’est envoyée qu’une fois."""
  await self.engine.lock.acquire()
  task=asyncio.create_task(adapter.command(self.req()))
  await asyncio.sleep(0)
  self.assertTrue(self.engine.command_lock.locked());self.engine.action.assert_not_awaited()
  self.engine.lock.release();result=await task
  self.assertTrue(json.loads(result.body)['ok']);self.engine.action.assert_awaited_once_with('light',{'enabled':True})
  self.assertFalse(self.engine.lock.locked());self.assertFalse(self.engine.command_lock.locked())
 async def test_second_command_is_rejected_while_first_waits_for_read(self):
  """Vérifie que une seconde commande est refusée même si la première attend une lecture."""
  await self.engine.lock.acquire();task=asyncio.create_task(adapter.command(self.req()))
  await asyncio.sleep(0)
  with self.assertRaisesRegex(ValueError,'opération est en cours'):await adapter.command(self.req('command-test-0002'))
  self.engine.action.assert_not_awaited();self.engine.lock.release();await task
  self.engine.action.assert_awaited_once()
 async def test_second_command_is_rejected_during_actual_operation(self):
  """Vérifie que une seconde commande est refusée pendant l’opération effective."""
  entered=asyncio.Event();finish=asyncio.Event()
  async def action(*args):"""Simule une commande suspendue afin de vérifier le verrou des opérations concurrentes.""";entered.set();await finish.wait();return 'accepted'
  self.engine.action.side_effect=action;task=asyncio.create_task(adapter.command(self.req()))
  await entered.wait()
  with self.assertRaisesRegex(ValueError,'opération est en cours'):await adapter.command(self.req('command-test-0002'))
  finish.set();await task;self.engine.action.assert_awaited_once()
 async def test_slow_read_times_out_without_send_or_unknown_reservation(self):
  """Vérifie que une lecture trop lente expire avant tout envoi ou réservation de résultat."""
  adapter.COMMAND_READ_WAIT_SECONDS=.01;await self.engine.lock.acquire()
  with self.assertRaisesRegex(ValueError,'Aucune commande envoyée'):await adapter.command(self.req())
  self.engine.action.assert_not_awaited();self.assertNotIn('command-test-0001',self.engine.commands)
  self.assertTrue(self.engine.lock.locked());self.assertFalse(self.engine.command_lock.locked())
  self.engine.lock.release()
 async def test_cancellation_while_waiting_does_not_leak_operation_guard(self):
  """Vérifie que l’annulation d’une attente libère le verrou d’opération."""
  await self.engine.lock.acquire();task=asyncio.create_task(adapter.command(self.req()))
  await asyncio.sleep(0);task.cancel()
  with self.assertRaises(asyncio.CancelledError):await task
  self.assertTrue(self.engine.lock.locked());self.assertFalse(self.engine.command_lock.locked())
  self.engine.action.assert_not_awaited();self.assertFalse(self.engine.commands);self.engine.lock.release()
 async def test_disconnected_client_is_not_sent_after_waiting_for_read(self):
  """Vérifie que une demande abandonnée pendant l’attente n’est pas envoyée ensuite."""
  for disconnected in ['closing','missing']:
   with self.subTest(disconnected=disconnected):
    await self.engine.lock.acquire();req=self.req()
    task=asyncio.create_task(adapter.command(req));await asyncio.sleep(0)
    req.transport=None if disconnected=='missing' else SimpleNamespace(is_closing=lambda:True)
    self.engine.lock.release()
    with self.assertRaisesRegex(ValueError,'Aucune commande envoyée'):await task
    self.engine.action.assert_not_awaited();self.assertFalse(self.engine.commands)
    self.assertFalse(self.engine.lock.locked());self.assertFalse(self.engine.command_lock.locked())
 async def test_unknown_physical_result_is_not_automatically_retried(self):
  """Vérifie que un résultat physique inconnu ne provoque pas de répétition automatique."""
  self.engine.action.side_effect=TimeoutError('ambiguous result')
  with self.assertRaises(TimeoutError):await adapter.command(self.req())
  result=await adapter.command(self.req());self.assertFalse(json.loads(result.body)['ok'])
  self.engine.action.assert_awaited_once();self.assertFalse(self.engine.lock.locked());self.assertFalse(self.engine.command_lock.locked())
 async def test_upload_waits_for_read_and_only_then_uploads(self):
  """Vérifie que le transfert attend la fin de la lecture avant de commencer."""
  await self.engine.lock.acquire();task=asyncio.create_task(adapter.upload(self.upload_req()))
  await asyncio.sleep(0);self.engine.api.upload_file_to_cloud.assert_not_awaited()
  self.engine.lock.release();result=await task
  self.assertTrue(json.loads(result.body)['ok']);self.engine.api.upload_file_to_cloud.assert_awaited_once_with(file_name='fixture.gcode',file_bytes=b'G28\n')
 async def test_upload_timeout_does_not_reserve_or_upload(self):
  """Vérifie que une attente expirée n’effectue ni transfert ni réservation de résultat."""
  adapter.COMMAND_READ_WAIT_SECONDS=.01;await self.engine.lock.acquire()
  with self.assertRaisesRegex(ValueError,'Aucune commande envoyée'):await adapter.upload(self.upload_req())
  self.engine.api.upload_file_to_cloud.assert_not_awaited();self.assertFalse(self.engine.commands)
  self.assertFalse(self.engine.command_lock.locked());self.engine.lock.release()
 async def test_upload_and_command_share_operation_guard(self):
  """Vérifie que les transferts et commandes partagent le même verrou d’opération."""
  entered=asyncio.Event();finish=asyncio.Event()
  async def upload(**kwargs):"""Simule un transfert suspendu afin de vérifier son exclusion avec les commandes.""";entered.set();await finish.wait()
  self.engine.api.upload_file_to_cloud.side_effect=upload
  task=asyncio.create_task(adapter.upload(self.upload_req()));await entered.wait()
  with self.assertRaisesRegex(ValueError,'opération est en cours'):await adapter.command(self.req())
  self.engine.action.assert_not_awaited();finish.set();await task
 async def test_cached_command_reply_works_while_another_operation_runs(self):
  """Vérifie que un résultat déjà connu reste consultable pendant une autre opération."""
  cached={'ok':True,'message':'previously accepted'};self.engine.commands['command-test-0001']=cached
  await self.engine.command_lock.acquire()
  result=await adapter.command(self.req());self.assertEqual(json.loads(result.body),cached)
  self.engine.action.assert_not_awaited();self.engine.command_lock.release()

if __name__=='__main__':unittest.main()
