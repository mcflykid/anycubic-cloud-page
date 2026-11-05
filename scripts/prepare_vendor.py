#!/usr/bin/env python3
"""Récupération des éléments du client amont figé vers un dossier privé ignoré par Git."""
import ast,json,os,pathlib,urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[1]
def appdata_path():
 """Renvoie APPDATA_DIR ou appdata, les chemins relatifs étant résolus depuis le projet."""
 path=pathlib.Path(os.environ.get('APPDATA_DIR','./appdata'))
 return path if path.is_absolute() else ROOT/path
# Figer l’amont rend les éléments client reproductibles et empêche une évolution distante implicite.
COMMIT='2051298aebb73bdc059e96dac638dc9424cfc8b1'
BASE=f'https://raw.githubusercontent.com/ljschmitt/hass-anycubic_cloud_v3/{COMMIT}/custom_components/anycubic_ha_integration/anycubic_cloud_api/'

def private_write(path,content):
 """Écrit content par remplacement atomique de path avec droits privés ; propage OSError si le stockage est inaccessible."""
 path.parent.mkdir(parents=True,exist_ok=True);os.chmod(path.parent,0o700)
 temp=path.with_suffix(path.suffix+'.tmp');fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
 with os.fdopen(fd,'wb') as f:f.write(content)
 temp.replace(path)

def prepare(output=None):
 """Prépare le client amont figé dans output ou appdata privé ; lève RuntimeError si le secret attendu manque, propage les erreurs réseau et fichier."""
 out=pathlib.Path(output) if output else appdata_path()/'private/vendor'
 source=urllib.request.urlopen(BASE+'const/const.py',timeout=30).read().decode()
 value=None
 for node in ast.parse(source).body:
  if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='AC_KNOWN_SEC' for t in node.targets):value=ast.literal_eval(node.value)
 if not isinstance(value,str) or not value:raise RuntimeError('Le format du client amont a changé.')
 private_write(out/'client.json',json.dumps({'app_secret':value}).encode())
 for name in ['anycubic_mqqt_tls_ca.crt','anycubic_mqqt_tls_client.crt','anycubic_mqqt_tls_client.key']:
  content=urllib.request.urlopen(BASE+'resources/'+name,timeout=30).read();private_write(out/'mqtt'/name,content)
 print('Matériel client préparé localement. Aucune valeur affichée.')
if __name__=='__main__':prepare()
