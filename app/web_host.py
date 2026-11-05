"""Ressources de l’interface et contrôle d’accès de la distribution autonome."""
import asyncio,hashlib,hmac,html,os,pathlib,re,secrets,time
from dataclasses import dataclass
from urllib.parse import urlsplit,parse_qs
from zoneinfo import ZoneInfo,ZoneInfoNotFoundError
from aiohttp import web
ROOT=pathlib.Path(__file__).resolve().parents[1]/'web'
HOME_URL_KEY=web.AppKey('home_url',str)
TIME_ZONE_KEY=web.AppKey('time_zone',str)
def display_timezone():
 """Renvoie TZ validé pour l’interface ; ValueError refuse un fuseau absent de la base IANA."""
 value=os.environ.get('TZ','Europe/Paris')
 try:ZoneInfo(value)
 except (ValueError,ZoneInfoNotFoundError):raise ValueError('TZ doit être un fuseau IANA valide.') from None
 return value
def home_url(value):
 """Valide une destination HTTP(S) ou relative ; vide masque les liens, ValueError refuse un schéma dangereux."""
 if not isinstance(value,str) or any(ord(char)<32 or ord(char)==127 for char in value) or '\\' in value:raise ValueError('HOME_URL invalide.')
 value=value.strip()
 parsed=urlsplit(value)
 if parsed.scheme and (parsed.scheme.lower() not in {'http','https'} or not parsed.netloc):raise ValueError('HOME_URL doit être une adresse HTTP(S) ou un chemin relatif.')
 if parsed.netloc and not parsed.scheme or parsed.username or parsed.password:raise ValueError('HOME_URL invalide.')
 return value

COOKIE_NAME='anycubic_session'
SESSION_SECONDS=8*60*60
FAILURE_SECONDS=5*60
FAILURE_LIMIT=5

@dataclass
class Session:
 """Session opaque à expiration fixe, liée aux identifiants actuels pour invalider un changement de mot de passe."""
 expires:float
 fingerprint:bytes

class AccessState:
 """Conserve uniquement les empreintes de sessions et compte les échecs récents, sans persistance de cookie."""
 def __init__(self):
  """Initialise des tables bornées ; un redémarrage déconnecte toutes les sessions web."""
  self.sessions={};self.failures={}
 def prune(self):
  """Retire les sessions et compteurs expirés afin de borner la mémoire de l’authentification."""
  now=time.monotonic()
  self.sessions={key:value for key,value in self.sessions.items() if value.expires>now}
  self.failures={key:value for key,value in self.failures.items() if value[1]>now}

ACCESS_KEY=web.AppKey('access',AccessState)
ORIGIN_KEY=web.AppKey('public_origin',str)

def credentials():
 """Renvoie identifiant, mot de passe et empreinte ; HTTPServiceUnavailable si la configuration est inutilisable."""
 path=pathlib.Path(os.environ.get('WEB_PASSWORD_FILE','/appdata/private/web-password'))
 try:password=path.read_text().strip()
 except OSError:raise web.HTTPServiceUnavailable(text='Configurez le mot de passe web avant de démarrer le service.') from None
 username=os.environ.get('WEB_USER','admin')
 if len(password)<6 or not username.strip():raise web.HTTPServiceUnavailable(text='Configurez un identifiant non vide et un mot de passe web d’au moins six caractères.')
 return username,password,hashlib.sha256((username+'\0'+password).encode()).digest()

def require_origin(request):
 """Refuse les écritures sans origine exacte ; les en-têtes proxy ne remplacent jamais PUBLIC_ORIGIN."""
 if request.headers.get('Origin')!=request.app[ORIGIN_KEY]:raise web.HTTPForbidden(text='Origine refusée.')

def install_access(app):
 """Ajoute la connexion par formulaire et une session en mémoire ; ValueError si PUBLIC_ORIGIN est mal formée."""
 origin=os.environ.get('PUBLIC_ORIGIN','http://localhost:8080')
 try:
  parsed=urlsplit(origin)
  if parsed.scheme not in {'http','https'} or not parsed.netloc or parsed.path or parsed.query or parsed.fragment or parsed.username or parsed.password or parsed.port==0:raise ValueError
 except ValueError:raise ValueError('PUBLIC_ORIGIN doit être une origine HTTP(S), sans chemin.') from None
 app[ORIGIN_KEY]=origin;app[ACCESS_KEY]=AccessState()
 app.router.add_get('/login',login);app.router.add_post('/login',login);app.router.add_post('/logout',logout)

@web.middleware
async def access_control(request,handler):
 """Protège l’atelier par cookie, garde health public et applique Origin aux écritures authentifiées."""
 try:
  if request.path=='/imprimante-api/health' or request.method in {'GET','HEAD'} and request.path in {'/css/landing.css','/css/imprimante.css','/icons/cloud-page.svg'}:
   response=await handler(request)
  else:
   username,password,fingerprint=credentials()
   state=request.app[ACCESS_KEY];state.prune()
   token=request.cookies.get(COOKIE_NAME,'');key=hashlib.sha256(token.encode()).digest()
   session=state.sessions.get(key)
   authenticated=session is not None and hmac.compare_digest(session.fingerprint,fingerprint)
   if request.path=='/login':response=await handler(request)
   elif not authenticated:
    if request.path.startswith('/imprimante-api/') or request.method not in {'GET','HEAD'}:response=web.json_response({'message':'Connexion requise.'},status=401)
    else:response=web.Response(status=303,headers={'Location':'/login'})
   else:
    if request.method not in {'GET','HEAD','OPTIONS'}:require_origin(request)
    response=await handler(request)
 except web.HTTPException as error:
  response=web.Response(body=error.body,status=error.status,headers=error.headers)
 # no-referrer rend Origin nul sur les formulaires ; same-origin le conserve sans fuite vers les sites externes.
 response.headers['X-Content-Type-Options']='nosniff';response.headers['Referrer-Policy']='same-origin'
 response.headers['Cache-Control']='no-store'
 response.headers['Content-Security-Policy']="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://*.agora.io https://*.sd-rtn.com https://*.agoraio.cn wss://*.agora.io wss://*.sd-rtn.com wss://*.agoraio.cn; media-src blob: https:; worker-src blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'"
 return response

def login_page(message='',status=200):
 """Renvoie le formulaire français sans refléter les identifiants saisis ; message est échappé."""
 content=(ROOT/'login.html').read_text().replace('<!-- LOGIN_MESSAGE -->','<p class="login-error" role="alert">'+html.escape(message)+'</p>' if message else '')
 return web.Response(text=content,content_type='text/html',status=status)

async def login(request):
 """Vérifie le formulaire de taille bornée ; renvoie 401 en cas d’échec ou 429 après cinq échecs en cinq minutes."""
 if request.method in {'GET','HEAD'}:return login_page()
 require_origin(request)
 state=request.app[ACCESS_KEY];state.prune();client=request.remote or 'unknown'
 # Une adresse fournie par le client dans X-Forwarded-For ne doit pas contourner la limitation.
 failures,until=state.failures.get(client,(0,time.monotonic()+FAILURE_SECONDS))
 if failures>=FAILURE_LIMIT or len(state.failures)>=1024 and client not in state.failures:
  response=login_page('Trop de tentatives. Réessayez dans quelques minutes.',429);response.headers['Retry-After']=str(max(1,int(until-time.monotonic())+1));return response
 if request.content_type!='application/x-www-form-urlencoded':raise web.HTTPUnsupportedMediaType()
 try:raw=await request.content.readexactly(4097)
 except asyncio.IncompleteReadError as error:raw=error.partial
 if len(raw)>4096:raise web.HTTPRequestEntityTooLarge(max_size=4096,actual_size=len(raw))
 try:form=parse_qs(raw.decode(),keep_blank_values=True,max_num_fields=8)
 except (ValueError,UnicodeError):raise web.HTTPBadRequest(text='Formulaire invalide.') from None
 username,password,fingerprint=credentials()
 supplied_user=form.get('username',[''])[0];supplied_password=form.get('password',[''])[0]
 valid_user=hmac.compare_digest(supplied_user.encode(),username.encode())
 valid_password=hmac.compare_digest(supplied_password.encode(),password.encode())
 if not (valid_user and valid_password):
  state.failures[client]=(failures+1,until)
  return login_page('Identifiant ou mot de passe incorrect.',401)
 state.failures.pop(client,None)
 if len(state.sessions)>=128:state.sessions.pop(next(iter(state.sessions)))
 # Le jeton change à chaque connexion et seule son empreinte est conservée côté serveur.
 old=request.cookies.get(COOKIE_NAME,'');state.sessions.pop(hashlib.sha256(old.encode()).digest(),None)
 token=secrets.token_urlsafe(32);state.sessions[hashlib.sha256(token.encode()).digest()]=Session(time.monotonic()+SESSION_SECONDS,fingerprint)
 response=web.Response(status=303,headers={'Location':'/imprimante.html'})
 response.set_cookie(COOKIE_NAME,token,max_age=SESSION_SECONDS,path='/',httponly=True,secure=request.app[ORIGIN_KEY].startswith('https://'),samesite='Strict')
 return response

async def logout(request):
 """Révoque la session côté serveur et efface le cookie ; Origin est contrôlé par le middleware."""
 token=request.cookies.get(COOKIE_NAME,'');request.app[ACCESS_KEY].sessions.pop(hashlib.sha256(token.encode()).digest(),None)
 response=web.Response(status=303,headers={'Location':'/login'})
 response.del_cookie(COOKIE_NAME,path='/',httponly=True,secure=request.app[ORIGIN_KEY].startswith('https://'),samesite='Strict')
 return response

def render_page(destination,time_zone):
 """Renvoie le HTML avec navigation et fuseau échappés, sans toucher aux scripts protégés par SRI."""
 content=(ROOT/'imprimante.html').read_text()
 # Le fuseau explicite évite que le navigateur et l’historique utilisent deux heures différentes.
 content=content.replace('<html lang="fr">','<html lang="fr" data-time-zone="'+html.escape(time_zone,quote=True)+'">',1)
 if destination:content=re.sub(r'(<a class="document-brand" href=")[^"]*(")',lambda match:match[1]+html.escape(destination,quote=True)+match[2],content)
 else:content=re.sub(r'<a class="document-brand" href="[^"]*">.*?</a>','',content,flags=re.S)
 return content

async def index(request):
 """Renvoie l’interface avec les destinations et le fuseau validés au démarrage."""
 return web.Response(text=render_page(request.app[HOME_URL_KEY],request.app[TIME_ZONE_KEY]),content_type='text/html')
async def about(request):"""Renvoie la notice sur l’hébergement et les services externes utilisés.""";return web.Response(text='Anycubic Cloud Page — application auto-hébergée indépendante. Les requêtes sont traitées par votre serveur et Anycubic. Aucun outil de mesure ajouté. Les sessions caméra sont établies avec Agora. Conservez le dossier appdata privé.',content_type='text/plain')
def install_static(app):
 """Ajoute les routes des ressources statiques, sans exposer les fichiers privés du serveur."""
 install_access(app)
 app[HOME_URL_KEY]=home_url(os.environ.get('HOME_URL','/imprimante.html'))
 app[TIME_ZONE_KEY]=display_timezone()
 app.router.add_get('/',index);app.router.add_get('/imprimante.html',index);app.router.add_get('/about',about)
 for folder in ['css','js','icons']:app.router.add_static('/'+folder+'/',ROOT/folder,show_index=False)
