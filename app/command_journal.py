"""Journal privé et borné des demandes susceptibles de modifier une machine ou un fichier."""
import hashlib
import ipaddress
import json
import os
import re
import tempfile
import time
import uuid
from pathlib import Path

ACTIONS=frozenset((
 'pause','resume','cancel','light','dry-start','dry-stop','auto-feed','feed','retract','slot','settings',
 'axis','axis-off','ai-settings','delete-local','delete-usb','delete-cloud','cloud-delete-many',
 'task-delete-many','task-reprint','cloud-rename','print-local','print-usb','print-cloud',
 'rename','firmware','ace-firmware','calibrate','hardware','assist','screen','factory-reset',
 'upload','save-print','temp-print','history-delete',
))
OUTCOMES=frozenset(('refusée','expirée','inconnue','envoyée','acceptée','confirmée'))
PRIVATE_TEXT=re.compile(r'[@/\\]|[\x00-\x1f\x7f]|(?:[a-f0-9]{16,}|[A-Za-z0-9_-]{28,})',re.IGNORECASE)

def label(value):
 """Écarte les chaînes qui ressemblent à des identifiants, à des URL ou à des chemins."""
 if not isinstance(value,str) or not value or len(value)>255 or PRIVATE_TEXT.search(value):
  return None
 return value

def request_key(value):
 """Préserve les UUID clients et masque les autres références d’anciens clients."""
 if not value:return None
 try:return str(uuid.UUID(value))
 except (ValueError,TypeError):return hashlib.sha256(value.encode()).hexdigest()[:24]

def filtered_parameters(action,data):
 """N’autorise que les mesures bornées, les emplacements et certains noms de fichiers."""
 result={}
 if action in ('print-local','print-usb','print-cloud','delete-local','delete-usb','delete-cloud','cloud-rename','upload','save-print','temp-print'):
  if name:=label(data.get('name')):result['name']=name
 for name in ('box','slot','temperature','hours','distance','minutes','target_nozzle_temp','target_hotbed_temp'):
  value=data.get(name)
  if type(value) in (int,float) and -1000<=value<=1000:result[name]=value
 slots=data.get('slots')
 if isinstance(slots,list) and len(slots)<=8 and all(type(slot) is int and 1<=slot<=8 for slot in slots):
  result['slots']=slots
 for name in ('enabled','finish'):
  if type(data.get(name)) is bool:result[name]=data[name]
 return result

class CommandJournal:
 """Conserve des entrées JSON Lines privées, en remplaçant atomiquement le fichier borné."""
 def __init__(self,path,max_bytes=512*1024,max_age=30*86400):
  """Choisit la destination du journal et ses limites de taille et d’âge."""
  self.path=Path(path)
  self.max_bytes=max_bytes
  self.max_age=max_age

 def rows(self):
  """Relit les lignes récentes, de la plus ancienne à la plus récente."""
  try:
   with self.path.open('rb') as stream:raw=stream.read(self.max_bytes+1)
  except FileNotFoundError:return []
  if len(raw)>self.max_bytes:raise OSError('Journal de commandes trop volumineux')
  result=[];now=time.time()
  for line in raw.splitlines():
   try:row=json.loads(line)
   except (ValueError,UnicodeError):continue
   if not isinstance(row,dict) or type(row.get('time')) not in (float,int):continue
   if not now-self.max_age<=row['time']<=now:continue
   if not isinstance(row.get('action'),str) or row['action'] not in ACTIONS:continue
   if not isinstance(row.get('outcome'),str) or row['outcome'] not in OUTCOMES:continue
   if row.get('printer') is not None and not isinstance(row['printer'],str):continue
   result.append(row)
  return result

 def record(self,entry):
  """Garde une entrée par imprimante et identifiant, en éliminant les plus anciennes."""
  rows=self.rows()
  if entry['request_id']:
   key=(entry['printer'],entry['request_id'])
   rows=[row for row in rows if (row.get('printer'),row.get('request_id'))!=key]
  rows.append(entry)
  chunks=[];size=0
  for row in reversed(rows):
   chunk=(json.dumps(row,ensure_ascii=True,separators=(',',':'))+'\n').encode()
   size+=len(chunk)
   if size>self.max_bytes:break
   chunks.append(chunk)
  self.path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
  with tempfile.NamedTemporaryFile(dir=self.path.parent,prefix='.command-journal-',delete=False) as stream:
   pending=Path(stream.name)
   try:
    stream.writelines(reversed(chunks))
    stream.flush();os.fsync(stream.fileno())
    os.replace(pending,self.path)
   finally:pending.unlink(missing_ok=True)

def make_entry(action,request_id,printer,printer_name,session,client,parameters):
 """Crée une entrée sans paramètres libres, identifiant cloud brut ni jeton."""
 try:address=str(ipaddress.ip_address(client))
 except ValueError:address=None
 return {
  'time':time.time(),'printer':printer,'printer_name':label(printer_name),'action':action,
  'request_id':request_key(request_id),'session':session.hex()[:16] if session else None,
  'client':address,'parameters':filtered_parameters(action,parameters),'outcome':'refusée',
 }
