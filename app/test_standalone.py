"""Tests isolés des sessions web, sans commande physique ni connexion au cloud."""
import os,pathlib,tempfile,time,unittest
from unittest.mock import patch
from aiohttp import web
from aiohttp.test_utils import TestClient,TestServer
from web_host import access_control,install_access,ACCESS_KEY,COOKIE_NAME,TRUSTED_PROXIES_KEY
from demo import create_demo

class WebBoundary(unittest.IsolatedAsyncioTestCase):
 """Vérifie formulaire, cookies, expiration, révocation, limitation et protection Origin."""
 async def asyncSetUp(self):
  """Crée un secret fictif et un serveur de test qui ne connaît aucune imprimante."""
  self.temp=tempfile.TemporaryDirectory();self.path=pathlib.Path(self.temp.name)/'password';self.path.write_text('test-only-password')
  self.origin='http://localhost:8080'
  self.env=patch.dict(os.environ,{'WEB_PASSWORD_FILE':str(self.path),'WEB_USER':'admin','PUBLIC_ORIGIN':self.origin});self.env.start()
  async def ok(request):"""Renvoie un témoin pour tester uniquement la frontière d’accès.""";return web.json_response({'ok':True})
  app=web.Application(middlewares=[access_control]);install_access(app)
  app.router.add_get('/',ok);app.router.add_get('/imprimante.html',ok);app.router.add_post('/command',ok)
  app.router.add_get('/imprimante-api/status',ok);app.router.add_post('/imprimante-api/command',ok);app.router.add_get('/imprimante-api/health',ok)
  self.client=TestClient(TestServer(app));await self.client.start_server();self.app=app
 async def asyncTearDown(self):
  """Ferme la frontière locale et restaure les variables de chaque scénario."""
  await self.client.close();self.env.stop();self.temp.cleanup()
 async def sign_in(self,username='admin',password='test-only-password',origin=None,headers=None):
  """Poste un formulaire fictif et conserve le cookie sans suivre la redirection."""
  return await self.client.post('/login',data={'username':username,'password':password},headers={'Origin':self.origin if origin is None else origin,**(headers or {})},allow_redirects=False)
 async def test_ui_redirects_and_api_returns_401_without_basic_challenge(self):
  """Les visiteurs voient la page française ; les appels API expirés ne reçoivent aucune fenêtre Basic."""
  response=await self.client.get('/',allow_redirects=False)
  self.assertEqual(response.status,303);self.assertEqual(response.headers['Location'],'/login')
  self.assertNotIn('WWW-Authenticate',response.headers)
  page=await self.client.get('/login');self.assertEqual(page.status,200);self.assertIn('Se connecter',await page.text());self.assertEqual(page.headers['Referrer-Policy'],'same-origin')
  self.assertEqual((await self.client.get('/imprimante-api/status')).status,401)
  self.assertEqual((await self.client.post('/imprimante-api/command')).status,401)
 async def test_login_sets_limited_httponly_strict_cookie(self):
  """Le cookie opaque a une durée fixe ; une lecture et une écriture de même origine deviennent possibles."""
  response=await self.sign_in();self.assertEqual(response.status,303)
  cookie=response.cookies[COOKIE_NAME]
  self.assertTrue(cookie['httponly']);self.assertEqual(cookie['samesite'],'Strict');self.assertEqual(cookie['max-age'],'28800');self.assertEqual(cookie['path'],'/')
  self.assertFalse(cookie['secure']);self.assertNotIn('admin',cookie.value)
  self.assertEqual((await self.client.get('/imprimante-api/status')).status,200)
  self.assertEqual((await self.client.post('/command',headers={'Origin':self.origin})).status,200)
 async def test_public_https_forces_secure_even_with_untrusted_proxy_headers(self):
  """Le protocole déclaré gouverne Secure ; un client ne le désactive pas avec X-Forwarded-Proto."""
  await self.client.close()
  with patch.dict(os.environ,{'PUBLIC_ORIGIN':'https://printer.example.com'}):
   app=web.Application(middlewares=[access_control]);install_access(app)
  self.client=TestClient(TestServer(app));await self.client.start_server()
  response=await self.sign_in(origin='https://printer.example.com',headers={'X-Forwarded-Proto':'http'})
  self.assertEqual(response.status,303);self.assertTrue(response.cookies[COOKIE_NAME]['secure'])
 async def test_wrong_login_does_not_echo_password(self):
  """L’erreur reste générique, y compris pour un identifiant inconnu."""
  response=await self.sign_in(username='other',password='fixture-wrong-password')
  self.assertEqual(response.status,401);self.assertNotIn('fixture-wrong-password',await response.text());self.assertNotIn(COOKIE_NAME,response.cookies)
 async def test_origin_rejects_login_command_and_logout(self):
  """Aucune route d’écriture n’accepte une origine étrangère ou absente, même avec une session valide."""
  self.assertEqual((await self.sign_in(origin='https://foreign.example')).status,403)
  response=await self.client.post('/login',data={'username':'admin','password':'test-only-password'});self.assertEqual(response.status,403)
  await self.sign_in()
  for path in ['/command','/imprimante-api/command','/logout']:
   for headers in [{},{'Origin':'https://foreign.example'}]:
    self.assertEqual((await self.client.post(path,headers=headers)).status,403)
  self.assertEqual((await self.client.get('/imprimante-api/status')).status,200)
 async def test_logout_revokes_cookie_even_if_replayed(self):
  """Effacer le cookie seul ne suffit pas : une copie du jeton doit être inutilisable après déconnexion."""
  login=await self.sign_in();token=login.cookies[COOKIE_NAME].value
  response=await self.client.post('/logout',headers={'Origin':self.origin},allow_redirects=False)
  self.assertEqual(response.status,303);self.assertEqual(response.cookies[COOKIE_NAME]['max-age'],'0')
  replay=await self.client.get('/imprimante-api/status',headers={'Cookie':COOKIE_NAME+'='+token})
  self.assertEqual(replay.status,401)
 async def test_expiry_and_password_change_invalidate_session(self):
  """L’expiration est côté serveur et un changement du secret ne laisse pas de session précédente valide."""
  await self.sign_in();next(iter(self.app[ACCESS_KEY].sessions.values())).expires=time.monotonic()-1
  self.assertEqual((await self.client.get('/imprimante-api/status')).status,401)
  await self.sign_in();self.path.write_text('test-only-new-password')
  self.assertEqual((await self.client.get('/imprimante-api/status')).status,401)
 async def test_failure_limit_cannot_be_bypassed_with_forwarded_headers(self):
  """Cinq échecs bloquent l’adresse réelle, puis la fenêtre expire sans bloquer définitivement le compte."""
  for index in range(5):self.assertEqual((await self.sign_in(password='wrong',headers={'X-Forwarded-For':str(index)})).status,401)
  response=await self.sign_in();self.assertEqual(response.status,429);self.assertGreater(int(response.headers['Retry-After']),0)
  for key in self.app[ACCESS_KEY].failures:self.app[ACCESS_KEY].failures[key]=(5,time.monotonic()-1)
  self.assertEqual((await self.sign_in()).status,303)
 async def test_counter_saturation_does_not_block_new_valid_client(self):
  """Un millier d’échecs d’autres adresses ne bloque plus le propriétaire."""
  state=self.app[ACCESS_KEY];state.failures={f'fixture-address-{i}':(1,time.monotonic()+300) for i in range(1024)}
  self.assertEqual((await self.sign_in()).status,303)
  self.assertEqual((await self.sign_in(password='wrong')).status,401);self.assertLessEqual(len(state.failures),1024)
 async def test_trusted_proxy_isolates_clients_and_stops_at_untrusted_hop(self):
  """Le proxy connu sépare les compteurs ; un préfixe injecté ne contourne pas le pair réel."""
  self.app[TRUSTED_PROXIES_KEY]=(__import__('ipaddress').ip_network('127.0.0.1/32'),)
  for _ in range(5):self.assertEqual((await self.sign_in(password='wrong',headers={'X-Forwarded-For':'192.0.2.1'})).status,401)
  self.assertEqual((await self.sign_in(headers={'X-Forwarded-For':'192.0.2.2'})).status,303)
  self.assertEqual((await self.sign_in(headers={'X-Forwarded-For':'192.0.2.99, 192.0.2.1'})).status,429)
  self.assertEqual((await self.sign_in(headers={'X-Forwarded-For':'invalid'})).status,303)
 async def test_health_stays_public_even_without_secret(self):
  """La supervision reste indépendante du secret ; les routes privées échouent fermées."""
  self.path.unlink();self.assertEqual((await self.client.get('/imprimante-api/health')).status,200)
  self.assertEqual((await self.client.get('/login')).status,503)
 async def test_login_body_is_bounded(self):
  """Un formulaire surdimensionné est refusé sans conserver le contenu dans les compteurs."""
  response=await self.client.post('/login',data={'username':'admin','password':'x'*5000},headers={'Origin':self.origin})
  self.assertEqual(response.status,413);self.assertFalse(self.app[ACCESS_KEY].failures)

class OfflineDemo(unittest.IsolatedAsyncioTestCase):
 """La démonstration conserve l’interdiction des commandes physiques."""
 async def test_demo_never_accepts_real_actions(self):
  """Le mode visuel n’envoie rien au cloud, même lorsqu’une commande est demandée."""
  async with TestClient(TestServer(create_demo())) as client:
   response=await client.post('/imprimante-api/command',json={'action':'ace-firmware'});self.assertEqual(response.status,403)
   response=await client.get('/imprimante-api/status');self.assertTrue((await response.json())['demo'])
