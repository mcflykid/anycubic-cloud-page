"""Vérifie les installations Compose dans GitHub Actions uniquement, avec le cloud simulé."""
import argparse,json,os,pathlib,shutil,subprocess,tempfile

ROOT=pathlib.Path(__file__).resolve().parents[1]
SERVICE='anycubic-cloud-page'

def execute(arguments,cwd,env,label):
 """Renvoie la sortie capturée ; RuntimeError indique seulement l’étape, jamais une configuration privée."""
 result=subprocess.run(arguments,cwd=cwd,env=env,capture_output=True,text=True)
 for line in result.stderr.splitlines():
  if 'warn' in line.lower():print(label+' : '+line,flush=True)
 if result.returncode:raise RuntimeError(label+' a échoué (code '+str(result.returncode)+'). '+result.stderr[-1200:])
 return result.stdout

def verify_config(config,variant):
 """Valide noms, limites et exposition avant de démarrer ; AssertionError signale une régression publique."""
 services=config['services']
 expected={SERVICE}
 assert set(services)==expected,'Services inattendus'
 for name,service in services.items():
  assert service['container_name']==name,'Nom de conteneur incohérent'
  assert service.get('read_only') is True,'Racine non protégée'
  assert float(service.get('cpus',0))>0 and service.get('mem_limit') and service.get('mem_reservation'),'Limites absentes'
  assert any('no-new-privileges' in value for value in service['security_opt']),'Protection des privilèges absente'
  assert service['restart']=='unless-stopped','Redémarrage incohérent'
  assert service['init'] is True and int(service['pids_limit'])==100,'Gestion des processus incorrecte'
  assert {volume['target'] for volume in service['volumes']}=={'/appdata','/etc/localtime'},'Montages inattendus'
 if variant=='proxy-network':
  assert config['networks']['proxy']['external'] is True,'Réseau non externe'
 else:
  assert not config['networks']['proxy'].get('external',False),'Réseau local déclaré externe'
 assert services[SERVICE]['ports'][0]['host_ip']=='127.0.0.1','Écoute hôte trop large'

def verify_runtime(compose,directory,env,config,baseline):
 """Vérifie santé, montages et refus d’écriture hors appdata sur les conteneurs réellement démarrés."""
 appdata=(directory/'appdata').resolve()
 for name in config['services']:
  container=execute(compose+['ps','-a','-q',name],directory,env,'Identification du service').strip()
  assert container,'Conteneur absent'
  info=json.loads(execute(['docker','inspect',container],directory,env,'Inspection du conteneur'))[0]
  assert info['HostConfig']['ReadonlyRootfs'],'Racine inscriptible'
  for mount in info['Mounts']:
   if mount['Type']=='tmpfs':continue
   if mount['Destination']=='/etc/localtime':
    assert not mount['RW'],'Horloge hôte inscriptible'
    continue
   assert mount['Type']=='bind','Volume persistant hors appdata'
   assert pathlib.Path(mount['Source']).resolve().is_relative_to(appdata),'Montage persistant hors appdata'
  assert info['State']['Running'],'Service arrêté'
  if name==SERVICE:assert info['State']['Health']['Status']=='healthy','Backend non sain'
 assert {path.name for path in directory.iterdir()}==baseline|{'appdata'},'Fichier créé hors appdata'
 # Une écriture réelle prouve les droits du backend ; sa racine doit rester en lecture seule.
 probe="""import errno,pathlib
pathlib.Path('/appdata/state/ci-write-check').write_text('fixture')
pathlib.Path('/appdata/state/ci-write-check').chmod(0o600)
try:
 pathlib.Path('/ci-forbidden-write').write_text('fixture')
except OSError as error:
 assert error.errno in (errno.EROFS,errno.EACCES)
else:
 raise AssertionError('Écriture hors appdata acceptée')
"""
 execute(compose+['exec','-T','--user',env['PUID']+':'+env['PGID'],SERVICE,'python','-c',probe],directory,env,'Contrôle des écritures')
 assert (appdata/'state/ci-write-check').read_text()=='fixture','État non persisté dans appdata'
 assert (appdata/'private').stat().st_mode&0o777==0o700,'Droits privés incorrects'
 for path in [appdata,*appdata.rglob('*')]:
  metadata=path.stat()
  assert metadata.st_uid==int(env['PUID']) and metadata.st_gid==int(env['PGID']),'Propriétaire appdata incorrect'
  assert metadata.st_mode&0o777==(0o700 if path.is_dir() else 0o600),'Permissions appdata incorrectes'
 # init est PID 1 ; l’identité à contrôler est celle du serveur enfant, pas celle de l’init.
 inspect_server="""import json,pathlib
servers=[]
for path in pathlib.Path('/proc').iterdir():
 if not path.name.isdigit():continue
 try:
  arguments=(path/'cmdline').read_bytes().split(b'\\0')
  if len(arguments)<2 or arguments[0].split(b'/')[-1] not in {b'python',b'python3',b'python3.13'}:continue
  if arguments[1] not in {b'/app/app/server.py',b'/app/app/demo.py'}:continue
  fields=dict(line.split(':',1) for line in (path/'status').read_text().splitlines() if ':' in line)
  servers.append({key:fields[key].strip() for key in ['Uid','Gid','CapEff','NoNewPrivs']})
 except (FileNotFoundError,ProcessLookupError):continue
print(json.dumps(servers))
"""
 servers=json.loads(execute(compose+['exec','-T',SERVICE,'python','-c',inspect_server],directory,env,'Identité du serveur'))
 assert len(servers)==1,'Processus serveur introuvable ou multiple'
 fields=servers[0]
 assert set(fields['Uid'].split())=={env['PUID']} and int(env['PUID'])!=0,'Serveur root ou PUID incorrect'
 assert set(fields['Gid'].split())=={env['PGID']},'PGID du serveur incorrect'
 assert int(fields['CapEff'],16)==0,'Capacités conservées par le serveur'
 assert fields['NoNewPrivs']=='1','Élévation de privilèges non bloquée'
 hour=execute(compose+['exec','-T',SERVICE,'python','-c',"import time; print(time.localtime(1704067200).tm_hour)"],directory,env,'Fuseau des logs')
 assert hour.strip()=='1','Fuseau de processus différent de TZ'

def run_variant(variant):
 """Installe depuis un dossier vide ; nettoie ses seuls conteneurs de test, même en cas d’erreur."""
 env=os.environ.copy();env.update({'PUID':str(os.getuid()),'PGID':str(os.getgid()),'TZ':'Europe/Paris','APPDATA_DIR':'./appdata','BIND_ADDRESS':'127.0.0.1','WEB_PORT':'8080','PUBLIC_ORIGIN':'http://localhost:8080','HOME_URL':'/imprimante.html','WEB_USER':'admin','PROXY_NETWORK':'cloud-page-ci-proxy','PROXY_NETWORK_EXTERNAL':'true'})
 with tempfile.TemporaryDirectory(prefix='cloud-page-ci-') as temporary:
  directory=pathlib.Path(temporary)
  filenames=['compose.yaml']
  if variant=='host':env.pop('PROXY_NETWORK',None);env.pop('PROXY_NETWORK_EXTERNAL',None)
  filenames.append('compose.ci.yaml')
  for filename in filenames:shutil.copy2(ROOT/filename,directory/filename)
  for name in ['ANYCUBIC_EMAIL','ANYCUBIC_PASSWORD','ANYCUBIC_TOKEN','WEB_PASSWORD']:env.pop(name,None)
  dotenv=directory/'.env'
  dotenv.write_text("ANYCUBIC_EMAIL=fixture@example.test\nANYCUBIC_PASSWORD=test-only-password\nWEB_PASSWORD=long-test-only-password\n")
  dotenv.chmod(0o600)
  baseline={path.name for path in directory.iterdir()}
  compose=['docker','compose','-p','cloud-page-ci']
  for filename in filenames:compose+=['-f',filename]
  owner=None;network_id=None
  if variant=='proxy-network':
   owner_directory=pathlib.Path(tempfile.mkdtemp(prefix='cloud-page-ci-owner-'))
   owner_file=owner_directory/'compose.yaml'
   owner_file.write_text(json.dumps({'services':{'proxy-client':{'image':'anycubic-cloud-page:test','entrypoint':['python','-c','import time; time.sleep(600)'],'networks':['proxy']}},'networks':{'proxy':{'name':env['PROXY_NETWORK']}}}))
   owner=['docker','compose','-p','cloud-page-ci-owner','-f',str(owner_file)]
   execute(owner+['up','-d'],directory,env,'Démarrage du projet proxy indépendant')
   network_id=json.loads(execute(['docker','network','inspect',env['PROXY_NETWORK']],directory,env,'Identification du réseau partagé'))[0]['Id']
  try:
   config=json.loads(execute(compose+['config','--format','json'],directory,env,'Validation Compose'))
   verify_config(config,variant)
   execute(compose+['up','-d','--wait','--wait-timeout','180'],directory,env,'Démarrage depuis un dossier vide')
   target='http://anycubic-cloud-page:8080' if variant=='proxy-network' else 'http://127.0.0.1:8080'
   read_fixture="""import http.cookiejar,urllib.parse,urllib.request
jar=http.cookiejar.CookieJar();client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
base=TARGET
print(client.open(base+'/imprimante-api/health').read().decode())
form=urllib.parse.urlencode({'username':'admin','password':'long-test-only-password'}).encode()
request=urllib.request.Request(base+'/login',data=form,headers={'Origin':'http://localhost:8080'})
print(client.open(request).read().decode())
""".replace('TARGET',repr(target))
   if variant=='proxy-network':
    # Ce client partage uniquement le réseau du proxy, sans port hôte ni réseau du projet.
    fetch=owner+['exec','-T','proxy-client','python','-c',read_fixture]
   else:fetch=['python3','-c',read_fixture]
   response=execute(fetch,directory,env,'Lecture depuis le côté proxy')
   assert 'data-time-zone="Europe/Paris"' in response and 'Démonstration' in response and '"demo": true' in response,'Réponse de démonstration absente'
   verify_runtime(compose,directory,env,config,baseline)
   retained={name:(directory/'appdata/private'/name).read_bytes() for name in ['anycubic-account','web-password']}
   dotenv.write_text("ANYCUBIC_EMAIL=fixture@example.test\nANYCUBIC_PASSWORD=\nWEB_PASSWORD=\n")
   execute(compose+['up','-d','--force-recreate','--wait','--wait-timeout','180'],directory,env,'Redémarrage sans mots de passe dans .env')
   verify_runtime(compose,directory,env,config,baseline)
   for name,content in retained.items():assert (directory/'appdata/private'/name).read_bytes()==content,'Secret persisté modifié au redémarrage'
   container=execute(compose+['ps','-q',SERVICE],directory,env,'Identification après redémarrage').strip()
   variables=json.loads(execute(['docker','inspect',container],directory,env,'Environnement après redémarrage'))[0]['Config']['Env']
   assert 'ANYCUBIC_PASSWORD=' in variables and 'WEB_PASSWORD=' in variables,'Mots de passe non vidés dans le conteneur recréé'
   print(variant+' : santé, PUID/PGID non-root, permissions, appdata et redémarrage sans mots de passe OK',flush=True)
  finally:
   execute(compose+['down'],directory,env,'Arrêt de la fixture')
   if owner:
    try:
     shared=json.loads(execute(['docker','network','inspect',env['PROXY_NETWORK']],directory,env,'Réseau conservé après down'))[0]
     assert shared['Id']==network_id and shared['Containers'],'Le réseau du proxy a été supprimé ou vidé'
     assert shared['Labels']['com.docker.compose.project']=='cloud-page-ci-owner','Propriétaire du réseau modifié'
     print('Réseau du projet proxy conservé après docker compose down.',flush=True)
    finally:
     execute(owner+['down'],directory,env,'Arrêt du projet proxy indépendant');shutil.rmtree(owner_directory)

def main():
 """Lance le scénario demandé uniquement sur un runner CI ; renvoie une erreur explicite hors CI."""
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('variant',choices=['host','proxy-network']);args=parser.parse_args()
 if os.environ.get('GITHUB_ACTIONS')!='true':raise SystemExit('Ces tests Docker sont réservés à GitHub Actions.')
 run_variant(args.variant)

if __name__=='__main__':main()
