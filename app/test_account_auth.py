"""Tests isolés : account auth, sans commande physique ni connexion au cloud."""
import asyncio,base64,hashlib,json,pathlib,tempfile,time,unittest
from unittest.mock import AsyncMock
from account_auth import AccountAuth

def token(sub='owner',exp=None):
 """Renvoie un JWT fictif non signé ; sub et exp pilotent l’identité et l’expiration du scénario."""
 body={'iss':'https://uc.makeronline.com','tokenType':'access-token','sub':sub,'exp':exp or time.time()+86400}
 return 'header.'+base64.urlsafe_b64encode(json.dumps(body).encode()).decode().rstrip('=')+'.sig'

class AccountTests(unittest.IsolatedAsyncioTestCase):
 """Vérifications du renouvellement et de la persistance privée de la session de compte."""
 def setUp(self):
  """Prépare des données et doublures isolées pour chaque scénario."""
  self.tmp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.tmp.name)
  (self.root/'credentials').write_text(json.dumps({'email':'test@example.test','password':'test-only'}))
  self.a=AccountAuth(self.root/'credentials',self.root/'session',self.root/'fallback')
 def tearDown(self):"""Libère les fichiers temporaires créés par le scénario.""";self.tmp.cleanup()
 async def test_login_binds_code_to_pkce_and_persists(self):
  """Vérifie que le code est lié au vérificateur PKCE et la session est persistée."""
  self.a.post=AsyncMock(side_effect=[{'status':'ok','data':'code'}, {'access_token':token(),'refresh_token':'test-refresh'}])
  await self.a.login(None)
  calls=self.a.post.await_args_list;params=calls[0].kwargs['params'];verifier=calls[1].kwargs['data']['code_verifier']
  self.assertEqual(params['code_challenge'],base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('='))
  self.assertEqual(self.a.path.stat().st_mode & 0o777,0o600)
  b=AccountAuth(self.root/'credentials',self.a.path);b.login=AsyncMock()
  self.assertEqual(await b.token(None),self.a.state['access_token']);b.login.assert_not_called()
 async def test_reject_account_switch_without_overwriting(self):
  """Vérifie que un autre compte ne peut pas écraser la session enregistrée."""
  self.a.save({'access_token':token()});before=self.a.path.read_text()
  with self.assertRaises(RuntimeError):self.a.save({'access_token':token('other')})
  self.assertEqual(self.a.path.read_text(),before)
 async def test_refresh_failure_falls_back_to_login(self):
  """Vérifie que un renouvellement refusé déclenche une connexion complète."""
  self.a.save({'access_token':token(),'refresh_token':'test-refresh'});self.a.state['obtained_at']=0
  self.a.refresh=AsyncMock(side_effect=TimeoutError());self.a.login=AsyncMock()
  await self.a.token(None);self.a.login.assert_awaited_once()
 async def test_valid_session_survives_provider_outage_with_backoff(self):
  """Vérifie que une session valide reste utilisable pendant le délai de repli."""
  self.a.save({'access_token':token()});self.a.state['obtained_at']=0;self.a.login=AsyncMock(side_effect=RuntimeError())
  expected=self.a.state['access_token']
  self.assertEqual(await self.a.token(None),expected);self.assertEqual(await self.a.token(None),expected)
  self.a.login.assert_awaited_once()
 async def test_expired_session_is_not_returned_on_failure(self):
  """Vérifie que une session expirée n’est jamais utilisée comme repli."""
  self.a.state={'access_token':token(exp=time.time()-5)};self.a.login=AsyncMock(side_effect=RuntimeError())
  with self.assertRaises(RuntimeError):await self.a.token(None)
 async def test_known_rejected_access_is_renewed_even_before_jwt_expiry(self):
  """Vérifie que un jeton refusé est renouvelé même avant son expiration déclarée."""
  self.a.save({'access_token':token()});old=self.a.state['access_token']
  async def login(session):"""Simule une connexion réussie en remplaçant la session expirée par un jeton fictif.""";self.a.save({'access_token':token(exp=time.time()+172800)})
  self.a.login=AsyncMock(side_effect=login)
  self.assertNotEqual(await self.a.renew_after_rejection(None),old);self.a.login.assert_awaited_once()
 async def test_known_rejected_token_never_returned_during_outage(self):
  """Vérifie que un jeton explicitement refusé ne sert pas de repli pendant une panne."""
  self.a.save({'access_token':token()});self.a.login=AsyncMock(side_effect=RuntimeError())
  for _ in range(2):
   with self.assertRaises(RuntimeError):await self.a.renew_after_rejection(None)
  self.a.login.assert_awaited_once()
 async def test_concurrent_expiration_uses_one_refresh_and_propagates_new_token(self):
  """Les appels simultanés attendent le même renouvellement et obtiennent tous le jeton persisté."""
  self.a.state={'access_token':token(exp=time.time()+60),'refresh_token':'fixture-refresh','obtained_at':0};replacement=token(exp=time.time()+172800)
  async def refresh(session):
   """Simule un seul aller-retour de renouvellement et sa persistance privée."""
   await asyncio.sleep(0);self.a.save({'access_token':replacement,'refresh_token':'fixture-refresh'})
  self.a.refresh=AsyncMock(side_effect=refresh);self.a.login=AsyncMock()
  values=await asyncio.gather(*(self.a.token(None) for _ in range(6)))
  self.assertEqual(values,[replacement]*6);self.a.refresh.assert_awaited_once();self.a.login.assert_not_awaited();self.assertEqual(json.loads(self.a.path.read_text())['access_token'],replacement)
 async def test_refresh_retains_existing_refresh_token_when_provider_omits_it(self):
  """Un renouvellement valide ne perd pas la possibilité du renouvellement suivant."""
  self.a.save({'access_token':token(),'refresh_token':'fixture-refresh'});replacement=token(exp=time.time()+172800);self.a.post=AsyncMock(return_value={'access_token':replacement})
  await self.a.refresh(None)
  self.assertEqual(self.a.state['refresh_token'],'fixture-refresh');self.assertEqual(self.a.state['access_token'],replacement);self.assertEqual(self.a.path.stat().st_mode&0o777,0o600)
 async def test_rejected_account_switch_keeps_original_session_and_sanitizes_error(self):
  """Le refus explicite ne permet ni un changement de compte ni un retour du jeton rejeté."""
  self.a.save({'access_token':token(),'refresh_token':'fixture-private-refresh'});before=self.a.path.read_text();self.a.refresh=AsyncMock(side_effect=RuntimeError('fixture-private-provider'))
  async def login(session):
   """Le faux fournisseur tente de répondre avec une autre identité."""
   self.a.save({'access_token':token('fixture-other-account')})
  self.a.login=AsyncMock(side_effect=login)
  with self.assertRaises(RuntimeError) as caught:await self.a.renew_after_rejection(None)
  self.assertEqual(self.a.path.read_text(),before);self.assertNotIn('fixture-private',str(caught.exception));self.assertNotIn('fixture-other',str(caught.exception))
 def test_malformed_claims_are_rejected_without_type_errors(self):
  """Un JWT illisible, sans identité ou à expiration non numérique n’interrompt pas le mécanisme de repli."""
  payload={'iss':'https://uc.makeronline.com','tokenType':'access-token','sub':'fixture-owner','exp':time.time()+86400}
  bodies=[[],{**payload,'exp':'fixture-private-invalid'},{**payload,'exp':None},{**payload,'exp':float('inf')},{**payload,'sub':None}]
  for body in bodies:
   value='header.'+base64.urlsafe_b64encode(json.dumps(body).encode()).decode().rstrip('=')+'.sig'
   self.assertFalse(self.a.valid(value))
  for value in [None,{},'not-a-token']:self.assertFalse(self.a.valid(value))
 async def test_rejected_login_never_exchanges_code(self):
  """Vérifie que un refus de connexion empêche tout échange du code."""
  self.a.post=AsyncMock(return_value={'status':'error','data':None})
  with self.assertRaises(RuntimeError):await self.a.login(None)
  self.assertEqual(self.a.post.await_count,1);self.assertFalse(self.a.path.exists())
if __name__=='__main__':unittest.main()
