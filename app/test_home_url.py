"""Tests des destinations de navigation, sans accès cloud ni modification des scripts statiques."""
import base64,hashlib,os,pathlib,unittest
from unittest.mock import patch
from aiohttp import web
from aiohttp.test_utils import TestClient,TestServer
from web_host import home_url,install_static

class Navigation(unittest.IsolatedAsyncioTestCase):
 """Vérifie le rendu réel des liens et le refus des destinations dangereuses."""
 def test_unsafe_urls_are_rejected(self):
  """Une configuration ne doit pas injecter de script, d’identifiant ou de schéma implicite."""
  for value in ['javascript:alert(1)','data:text/html,test','//example.test','https:example.test','https://user:password@example.test','/\\example.test','/page\nnext']:
   with self.subTest(scheme=value.split(':')[0]):
    with self.assertRaises(ValueError):home_url(value)
 def test_safe_relative_and_http_urls_are_accepted(self):
  """Les liens relatifs et HTTP(S) explicites restent utilisables, y compris une destination vide."""
  for value in ['', '/imprimante.html','atelier/page','https://example.test/atelier','http://localhost:8080']:
   self.assertEqual(home_url(value),value)
 async def test_rendered_links_are_escaped_and_about_is_reachable(self):
  """La destination est échappée dans les deux liens, sans casser la notice ni l’intégrité des scripts."""
  with patch.dict(os.environ,{'HOME_URL':'/atelier?x="demo"&a=1'}):
   app=web.Application();install_static(app)
  async with TestClient(TestServer(app)) as client:
   page=await (await client.get('/imprimante.html')).text()
   self.assertEqual(page.count('href="/atelier?x=&quot;demo&quot;&amp;a=1"'),2)
   script=pathlib.Path(__file__).resolve().parents[1]/'web/js/imprimante.js'
   digest=base64.b64encode(hashlib.sha256(script.read_bytes()).digest()).decode()
   self.assertTrue('integrity="sha256-'+digest+'"' in page)
   response=await client.get('/about');self.assertEqual(response.status,200)
   self.assertIn('auto-hébergée',await response.text())
 async def test_empty_url_removes_links_and_default_stays_in_workshop(self):
  """Une valeur vide retire les liens ; une variable absente ne renvoie pas vers un autre site."""
  for value in ['',None]:
   with patch.dict(os.environ,{},clear=True):
    if value is not None:os.environ['HOME_URL']=value
    app=web.Application();install_static(app)
   async with TestClient(TestServer(app)) as client:
    page=await (await client.get('/')).text()
    self.assertEqual('class="document-brand"' in page,value is None)
    if value is None:self.assertEqual(page.count('href="/imprimante.html"'),2)

class TimeZone(unittest.IsolatedAsyncioTestCase):
 """Les dates transmises restent UTC ; leur affichage suit le fuseau IANA configuré."""
 async def test_timezone_is_injected_for_history_and_charts(self):
  """Un navigateur dans un autre fuseau reçoit la même référence temporelle pour toutes les vues."""
  with patch.dict(os.environ,{'TZ':'America/Montreal'}):
   app=web.Application();install_static(app)
  async with TestClient(TestServer(app)) as client:
   page=await (await client.get('/')).text()
   self.assertTrue('data-time-zone="America/Montreal"' in page)
 def test_invalid_timezone_fails_before_serving(self):
  """Une faute de fuseau ne doit pas revenir silencieusement à l’heure du navigateur."""
  with patch.dict(os.environ,{'TZ':'Invalid/Fixture'}):
   with self.assertRaises(ValueError):install_static(web.Application())
