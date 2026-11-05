"""Tests isolés : session api, sans commande physique ni connexion au cloud."""
import asyncio,unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock,Mock
from session_api import SessionRecovery,CloudSessionAuthError
from anycubic_cloud_api.api.base import AnycubicAPIBase
from types import SimpleNamespace
from anycubic_cloud_api.exceptions.exceptions import AnycubicAuthError

class Transport:
 """Transport simulé permettant de compter les requêtes et échanges de jetons."""
 def __init__(self):
  """Initialise la doublure de test."""
  self.send=AsyncMock();self._get_user_token_with_access_token=AsyncMock()
  self.anycubic_auth=SimpleNamespace(set_access_token=Mock())
 async def _fetch_api_resp(self,*a,**kw):return await self.send(*a,**kw)
class Client(SessionRecovery,Transport):"""Client de test combinant le rétablissement de session et un transport simulé.""";pass
class RecoveryTests(unittest.IsolatedAsyncioTestCase):
 """Vérifications du renouvellement après refus explicite sans répétition ambiguë."""
 async def test_explicit_rejection_renews_once_and_retries_same_request(self):
  """Vérifie que un refus explicite renouvelle une fois la session puis rejoue la requête identique."""
  done=Mock();c=Client(session_renewed=done);c.send.side_effect=[{'code':10001},{'code':1,'data':'ok'}]
  self.assertEqual((await c._fetch_api_resp('rename',params={'name':'test'}))['data'],'ok')
  c._get_user_token_with_access_token.assert_awaited_once();done.assert_called_once_with(c)
  self.assertEqual(c.send.await_args_list[0],c.send.await_args_list[1])
 async def test_session_exchange_diagnostics_never_echo_provider_payload(self):
  """Un refus de session peut contenir un secret dans msg ; journaux et exception restent génériques."""
  for response in [None,{}, {'code':10001,'msg':'fixture-private-token','data':None},{'code':1,'data':{'token':{'secret':'fixture-private-token'}}}]:
   c=SimpleNamespace(anycubic_auth=SimpleNamespace(auth_access_token_payload={},set_auth_token=Mock()),_fetch_api_resp=AsyncMock(return_value=response),_log_to_debug=Mock())
   with self.assertRaises(AnycubicAuthError) as caught:await AnycubicAPIBase._get_user_token_with_access_token(c)
   self.assertNotIn('fixture-private',str(caught.exception));self.assertNotIn('fixture-private',str(c._log_to_debug.call_args));c.anycubic_auth.set_auth_token.assert_not_called()
 async def test_ambiguous_failure_never_retried(self):
  """Vérifie que une erreur ambiguë ne provoque jamais de nouvel envoi."""
  for error in [TimeoutError(),ValueError('unreadable')]:
   c=Client();c.send.side_effect=error
   with self.assertRaises(type(error)):await c._fetch_api_resp('command')
   self.assertEqual(c.send.await_count,1);c._get_user_token_with_access_token.assert_not_called()
 async def test_other_vendor_errors_never_retried(self):
  """Vérifie que les autres erreurs constructeur ne déclenchent pas de renouvellement de session."""
  c=Client();c.send.return_value={'code':500,'data':None}
  self.assertEqual((await c._fetch_api_resp('command'))['code'],500)
  self.assertEqual(c.send.await_count,1)
 async def test_login_exchange_is_not_recursively_retried(self):
  """Vérifie que l’échange de connexion n’entre pas dans une boucle de renouvellement."""
  c=Client();c.send.return_value={'code':10001}
  await c._fetch_api_resp('login',with_token=False)
  c._get_user_token_with_access_token.assert_not_called()
 async def test_concurrent_expired_requests_share_one_refresh(self):
  """Vérifie que les requêtes concurrentes partagent un seul renouvellement de session."""
  c=Client();arrived=0;ready=asyncio.Event();counts={}
  async def send(endpoint):
   """Simule le transport pour contrôler la corrélation ou le nombre de demandes envoyées."""
   nonlocal arrived
   counts[endpoint]=counts.get(endpoint,0)+1
   if counts[endpoint]==1:
    arrived+=1
    if arrived==4:ready.set()
    await ready.wait();return {'code':10001}
   return {'code':1}
  c.send.side_effect=send
  self.assertEqual(len(await asyncio.gather(*(c._fetch_api_resp(str(i)) for i in range(4)))),4)
  c._get_user_token_with_access_token.assert_awaited_once()
 async def test_rejected_access_token_falls_back_to_account_login(self):
  """Vérifie que un jeton d’accès refusé déclenche la reconnexion du compte."""
  refresh=AsyncMock(return_value='replacement');c=Client(refresh_access=refresh)
  c.send.side_effect=[{'code':10001},{'code':1}]
  c._get_user_token_with_access_token.side_effect=[AnycubicAuthError('expired'),None]
  await c._fetch_api_resp('read');refresh.assert_awaited_once();c.anycubic_auth.set_access_token.assert_called_once_with('replacement')
 async def test_failed_recovery_backs_off_and_does_not_return_empty_success(self):
  """Vérifie que un renouvellement en échec impose un délai sans faux résultat réussi."""
  c=Client();c.send.return_value={'code':10001};c._get_user_token_with_access_token.side_effect=TimeoutError()
  for _ in range(2):
   with self.assertRaises(CloudSessionAuthError):await c._fetch_api_resp('read')
  c._get_user_token_with_access_token.assert_awaited_once();self.assertEqual(c.send.await_count,2)
 async def test_second_rejection_does_not_loop(self):
  """Vérifie que un second refus arrête la tentative de rétablissement."""
  c=Client();c.send.return_value={'code':10001}
  with self.assertRaises(CloudSessionAuthError):await c._fetch_api_resp('command')
  self.assertEqual(c.send.await_count,2);c._get_user_token_with_access_token.assert_awaited_once()
if __name__=='__main__':unittest.main()
