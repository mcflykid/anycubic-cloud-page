# SPDX-License-Identifier: GPL-3.0-or-later
"""Connexion au centre utilisateur Anycubic par code d’autorisation lié à PKCE."""
import asyncio,base64,contextlib,hashlib,json,os,pathlib,secrets,time

UC='https://uc.makeronline.com'
CLIENT_ID='b269a3136d26ac6488bb'
REDIRECT='acnext://login'

def claims(token):
 """Renvoie les claims JWT non vérifiés, ou {} si le jeton est illisible."""
 try:
  part=token.split('.')[1]
  return json.loads(base64.urlsafe_b64decode(part+'='*(-len(part)%4)))
 except (ValueError,IndexError,TypeError):return {}

class AccountAuth:
 """Gère la session du compte et son repli sur un jeton local privé."""
 def __init__(self,credentials='/appdata/private/anycubic-account',state='/appdata/state/account-session.json',fallback='/appdata/private/anycubic-token'):
  """Charge les chemins privés des identifiants, de la session et du jeton de repli, sans connexion réseau."""
  self.credentials=pathlib.Path(credentials);self.path=pathlib.Path(state);self.fallback=pathlib.Path(fallback)
  self.lock=asyncio.Lock();self.retry_after=0;self.state={}
  with contextlib.suppress(OSError,ValueError):self.state=json.loads(self.path.read_text())
 def valid(self,token,margin=300):
  """Teste émetteur, type et expiration avec une marge en secondes, sans vérifier la signature."""
  c=claims(token)
  return c.get('iss')==UC and c.get('tokenType')=='access-token' and c.get('exp',0)>time.time()+margin
 def save(self,data):
  """Persiste la session ; lève RuntimeError si le jeton est invalide ou change de compte."""
  if not self.valid(data.get('access_token','')):raise RuntimeError('Jeton Anycubic non valide')
  if self.state.get('access_token'):
   if claims(data['access_token']).get('sub')!=claims(self.state['access_token']).get('sub'):raise RuntimeError('Compte Anycubic différent')
  value={**data,'obtained_at':time.time()}
  self.path.parent.mkdir(parents=True,exist_ok=True)
  tmp=self.path.with_suffix('.tmp')
  fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
  with os.fdopen(fd,'w') as f:json.dump(value,f);f.flush();os.fsync(f.fileno())
  tmp.replace(self.path);self.state=value
 async def post(self,session,path,*,data=None,params=None,body=None):
  """Renvoie le JSON du centre utilisateur ; lève RuntimeError si la connexion est refusée ou illisible."""
  async with session.post(UC+path,data=data,json=body,params=params,headers={'User-Agent':'Mozilla/5.0'},timeout=__import__('aiohttp').ClientTimeout(total=25)) as response:
   try:result=await response.json()
   except (ValueError,__import__('aiohttp').ContentTypeError):raise RuntimeError('Réponse de connexion Anycubic illisible') from None
   if response.status!=200 or not isinstance(result,dict):raise RuntimeError('Connexion au compte Anycubic refusée')
   return result
 async def login(self,session):
  """Échange un code lié au vérificateur PKCE et persiste la session ; propage les erreurs de connexion."""
  c=json.loads(self.credentials.read_text())
  verifier=secrets.token_urlsafe(48)
  challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
  params={'clientId':CLIENT_ID,'responseType':'code','redirectUri':REDIRECT,'type':'code','scope':'read','state':secrets.token_urlsafe(24),'code_challenge_method':'S256','code_challenge':challenge}
  response=await self.post(session,'/api/login',params=params,body={'application':'ac_slicer_next','organization':'anycubic','username':c['email'],'password':c['password'],'type':'code','autoSignin':True})
  code=response.get('data')
  if response.get('status')!='ok' or not isinstance(code,str) or not code or len(code)>2048:raise RuntimeError('Connexion au compte Anycubic refusée')
  result=await self.post(session,'/api/login/oauth/access_token',data={'grant_type':'authorization_code','client_id':CLIENT_ID,'code':code,'code_verifier':verifier,'redirect_uri':REDIRECT})
  self.save(result)
 async def refresh(self,session):
  """Renouvelle et persiste la session, en conservant le refresh_token si le serveur l’omet."""
  result=await self.post(session,'/api/login/oauth/refresh_token',body={'grant_type':'refresh_token','refresh_token':self.state['refresh_token'],'scope':'read','client_id':CLIENT_ID})
  if not result.get('refresh_token'):result['refresh_token']=self.state['refresh_token']
  self.save(result)
 async def token(self,session):
  """Renvoie un jeton utilisable ; lève RuntimeError si aucun repli valide ne survit à l’échec."""
  async with self.lock:
   if not self.credentials.exists():return self.fallback.read_text().strip()
   token=self.state.get('access_token','');current=self.valid(token)
   # Le jeton de renouvellement expire avant le jeton d’accès : le renouveler chaque semaine.
   due=not current or time.time()-self.state.get('obtained_at',0)>7*86400
   if not due:return token
   if time.time()<self.retry_after:
    if current:return token
    raise RuntimeError('Connexion Anycubic en attente')
   try:
    if self.state.get('refresh_token'):
     try:await self.refresh(session)
     except (RuntimeError,TimeoutError,__import__('aiohttp').ClientError):await self.login(session)
    else:await self.login(session)
    self.retry_after=0
    return self.state['access_token']
   except (OSError,ValueError,RuntimeError,TimeoutError,__import__('aiohttp').ClientError):
    self.retry_after=time.time()+300
    if current:return token
    raise RuntimeError('Connexion au compte Anycubic indisponible') from None

 async def renew_after_rejection(self,session):
  """Renvoie un nouveau jeton après un refus explicite ; lève RuntimeError si le renouvellement échoue."""
  async with self.lock:
   if time.time()<self.retry_after:raise RuntimeError('Connexion Anycubic en attente')
   if not self.credentials.exists():
    token=self.fallback.read_text().strip()
    if not token:raise RuntimeError('Token absent. Reconnectez le slicer puis relancez la récupération locale.')
    return token
   try:
    if self.state.get('refresh_token'):
     try:await self.refresh(session)
     except (RuntimeError,TimeoutError,__import__('aiohttp').ClientError):await self.login(session)
    else:await self.login(session)
    self.retry_after=0
    return self.state['access_token']
   except (OSError,ValueError,RuntimeError,TimeoutError,__import__('aiohttp').ClientError):
    self.retry_after=time.time()+300
    raise RuntimeError('Connexion au compte Anycubic indisponible') from None
