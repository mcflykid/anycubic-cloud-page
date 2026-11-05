#!/usr/bin/env python3
"""Lecture locale d’un jeton d’accès non expiré dans les journaux du slicer, sans l’afficher."""
import argparse,base64,json,os,pathlib,re,sys,time
from prepare_vendor import appdata_path,private_write
PATTERN=re.compile(r'(?:accessToken\s*=\s*|id_token=)(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)')

def default_logs():
 """Renvoie le dossier habituel des journaux du slicer selon le système, sans vérifier son existence."""
 if sys.platform=='darwin':return pathlib.Path.home()/'Library/Application Support/AnycubicSlicerNext/log'
 if sys.platform=='win32':return pathlib.Path(os.environ.get('APPDATA',pathlib.Path.home()))/'AnycubicSlicerNext/log'
 return pathlib.Path.home()/'.config/AnycubicSlicerNext/log'

def extract(directory=None):
 """Renvoie le premier jeton déclaré valide avec cinq minutes de marge, sans vérifier sa signature ; ValueError si aucun, OSError si lecture impossible."""
 directory=pathlib.Path(directory or default_logs())
 if not directory.is_dir():raise ValueError('Journaux introuvables. Indiquez leur dossier avec --log-dir.')
 for f in sorted(directory.iterdir(),key=lambda p:p.stat().st_mtime,reverse=True):
  if not f.is_file() or f.stat().st_size>100*1024*1024:continue
  for token in reversed(PATTERN.findall(f.read_text(errors='ignore'))):
   try:
    claims=json.loads(base64.urlsafe_b64decode(token.split('.')[1]+'==='))
    if claims.get('iss')=='https://uc.makeronline.com' and claims.get('tokenType')=='access-token' and claims.get('exp',0)>time.time()+300:return token
   except (ValueError,TypeError):continue
 raise ValueError('Aucun token d’accès encore valide trouvé. Reconnectez-vous dans le slicer ou utilisez la connexion directe au compte.')

def main():
 """Écrit le jeton dans le fichier privé choisi ; --watch recommence toutes les trente secondes, sinon lève SystemExit en cas d’échec."""
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--log-dir',type=pathlib.Path);parser.add_argument('--output',type=pathlib.Path,default=appdata_path()/'private/anycubic-token');parser.add_argument('--watch',action='store_true');args=parser.parse_args();previous=None
 while True:
  try:
   token=extract(args.log_dir)
   if token!=previous:private_write(args.output,token.encode());previous=token;print('Token récupéré localement (valeur non affichée).',flush=True)
  except (ValueError,OSError) as error:
   if not args.watch:raise SystemExit(str(error))
   if previous is None:print('En attente d’un token valide dans les journaux du slicer.',flush=True);previous='waiting'
  if not args.watch:break
  time.sleep(30)
if __name__=='__main__':main()
