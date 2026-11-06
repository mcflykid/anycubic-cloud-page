"""Historique des notifications partagé entre les imprimantes d’un même compte."""
import asyncio
import hashlib
import json
import time
from datetime import datetime,timezone

from anycubic_cloud_api.models.http import AnycubicAPIEndpoint,HTTP_METHODS

def history_entry(row):
 """Renvoie une notification affichable avec référence opaque et libellé français."""
 from cloud_extras import diagnostic_text,key as history_task_key
 code=row.get('print_status')
 labels={2:'Impression terminée',3:'Impression arrêtée'}
 title=labels.get(code) or {'Print complete':'Impression terminée','Print to terminate':'Impression arrêtée','Print failed':'Échec de l’impression','Print to paused':'Impression en pause'}.get(row.get('title'),'Notification d’impression')
 reason=next((text for value in (row.get('reason_desc'),row.get('reason')) if (text:=diagnostic_text(value))), '')
 reason={'User Initiated':'Pause demandée par l’utilisateur','Abnormal consumables, please reload consumables':'Problème de filament. Rechargez le filament.'}.get(reason,reason)
 reason_code=diagnostic_text(row.get('reason_id'))
 printer=row.get('printer_id')
 task=next((row[field] for field in ('task_id','taskid','project_id') if isinstance(row.get(field),(str,int)) and row[field] not in ('','0',0)),None)
 group=printer and task and (reason or reason_code)
 task_id=row.get('task_id') or row.get('taskid')
 return {
  'key':hashlib.sha256(str(row.get('id','')).encode()).hexdigest()[:20],
  'name':str(row.get('project_name') or 'Impression sans nom')[:300],
  'printer':str(row.get('printer_name') or 'Imprimante')[:100],
  'time':row.get('create_time'),'result':title,'kind':'success' if code==2 else 'interrupted' if code==3 else 'info',
  'unread':row.get('read')==0,'reason':reason,'reason_code':reason_code,
  'task_key':history_task_key(str(printer)+':'+str(task_id)) if printer and isinstance(task_id,(int,str)) and task_id not in ('','0',0) else None,
  'group':hashlib.sha256(json.dumps([str(printer),str(task),title,reason,reason_code]).encode()).hexdigest()[:20] if group else None,
 }

class AccountNotifications:
 """Sérialise les lectures et mutations d’un même historique de compte."""
 def __init__(self):
  """Déclare les caches partagés et leur verrou, indépendamment du transport courant."""
  self.lock=asyncio.Lock()
  self.cache={}
  self.keys={}
  self.rows={}

 async def page(self,api,page):
  """Renvoie les notifications paginées filtrées ; lève ValueError si le cloud refuse la lecture."""
  async with self.lock:
   cached=self.cache.get(page)
   if cached and time.monotonic()-cached[0]<30:return cached[1]
   response=await api._fetch_api_resp(AnycubicAPIEndpoint(HTTP_METHODS.POST,'/v2/message/getMessages'),params={'type':1,'page':page,'limit':20})
   counts=await api._fetch_api_resp(AnycubicAPIEndpoint(HTTP_METHODS.POST,'/v2/message/getMessageCount'),params={})
   if response.get('code')!=1 or not isinstance(response.get('data'),list):raise ValueError('Le journal Anycubic est temporairement indisponible')
   rows=[history_entry(r) for r in response['data'] if isinstance(r,dict)]
   for raw in response['data']:
    if isinstance(raw,dict) and isinstance(raw.get('id'),int):
     k=history_entry(raw)['key'];self.keys[k]=raw['id'];self.rows[k]=raw
   while len(self.keys)>1000:self.keys.pop(next(iter(self.keys)))
   while len(self.rows)>1000:self.rows.pop(next(iter(self.rows)))
   count=next((r for r in counts.get('data') or [] if r.get('type')==1),{})
   result={'items':rows,'page':page,'total':int(count.get('count',len(rows))),'unread':int(count.get('newcount',0)),'has_more':page*20<int(count.get('count',0)),'updated_at':datetime.now(timezone.utc).isoformat()}
   self.cache[page]=(time.monotonic(),result)
   while len(self.cache)>10:self.cache.pop(next(iter(self.cache)))
   return result
 async def mark_read(self,api,key=None,all_items=False):
  """Marque une clé connue ou toutes les notifications ; lève ValueError sans confirmation cloud."""
  async with self.lock:
   if all_items:
    endpoint='/v2/message/setRead';params={}
   else:
    mid=self.keys.get(str(key))
    if mid is None:raise ValueError('Actualisez l’historique avant de marquer cette notification comme lue')
    endpoint='/v2/message/setReadById';params={'id':mid}
   result=await api._fetch_api_resp(AnycubicAPIEndpoint(HTTP_METHODS.POST,endpoint),params=params,query=params or None)
   if result.get('code')!=1:raise ValueError('Anycubic n’a pas confirmé la mise à jour de lecture')
   self.cache={}
   return {'ok':True,'message':'Notifications marquées comme lues' if all_items else 'Notification marquée comme lue'}
 async def delete(self,api,key=None,all_items=False):
  """Efface une clé connue ou les identifiants collectés ; lève ValueError si la collecte est incomplète."""
  async with self.lock:
   if all_items:
    ids=[]
    for page in range(1,251):
     result=await api._fetch_api_resp(AnycubicAPIEndpoint(HTTP_METHODS.POST,'/v2/message/getMessages'),params={'type':1,'page':page,'limit':20})
     if result.get('code')!=1 or not isinstance(result.get('data'),list):raise ValueError('Lecture de l’historique impossible ; aucun effacement envoyé')
     rows=result['data'];ids.extend(r['id'] for r in rows if isinstance(r,dict) and isinstance(r.get('id'),int))
     if len(rows)<20:break
    else:raise ValueError('Trop de notifications pour un effacement unique')
   else:
    mid=self.keys.get(str(key))
    if mid is None:raise ValueError('Actualisez l’historique avant d’effacer cette notification')
    ids=[mid]
   if ids:
    result=await api._fetch_api_resp(AnycubicAPIEndpoint(HTTP_METHODS.POST,'/v2/message/delete'),params={'ids':ids})
    if result.get('code')!=1:raise ValueError('Anycubic n’a pas confirmé l’effacement')
   self.cache={};self.keys={};self.rows={}
   return {'ok':True,'message':'Notifications effacées' if all_items else 'Notification effacée'}
