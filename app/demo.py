"""Démonstration locale sur données fictives, sans connexion cloud ni commande physique."""
import argparse,base64,math,os,pathlib,re,time
from aiohttp import web
from web_host import ROOT,about,render_page,home_url,display_timezone,access_control,install_access,ACCESS_KEY
T=time.time()
NOTICES=web.AppKey('notices',list)
PRINT_TASKS=web.AppKey('print_tasks',list)
NOTICE_FIXTURES=[{'key':format(i+1,'020x'),'name':name,'printer':'Kobra S1 · Démonstration','time':T-(i+1)*3600,'result':'Impression terminée' if i!=1 else 'Impression arrêtée','kind':'success' if i!=1 else 'interrupted','unread':i<2} for i,name in enumerate(['Cube de calibration.gcode','Boîte de rangement.gcode','Support de téléphone.gcode'])]
SVG=b'<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240"><rect width="320" height="240" rx="20" fill="#f4f7fb"/><path d="M160 45 235 85v80l-75 40-75-40V85Z" fill="#b4cbe2"/><path d="m85 85 75 40 75-40M160 125v80" fill="none" stroke="#4e79a2" stroke-width="5"/><path d="m105 142 35 18m-35-38 35 18m40 20 35-18m-35-2 35-18" stroke="#4e79a2" stroke-width="4"/></svg>'
IMAGE='data:image/svg+xml;base64,'+base64.b64encode(SVG).decode()
SPOOLS=[{'slot':i+1,'local_slot':i+1,'display_slot':i+1,'material_type':'PLA','color':c,'spool_loaded':True,'remaining_percent':v,'rfid':i!=1,'brand':'Anycubic' if i!=1 else None} for i,(c,v) in enumerate([([235,235,235],76),([38,91,145],62),([214,134,64],91),([56,56,59],48)])]
BOX={'box_id':0,'index':0,'spools':SPOOLS,'auto_feed':True,'temperature':42,'humidity':18,'loaded_slot':1,'drying':{'is_drying':True,'target_temperature':45,'total_duration':240,'remaining_time':96}}
PARAMS={'layer_height':0.2,'fill_density':15,'enable_support':False,'perimeters':3,'temperature':210,'bed_temperature':60,'outer_wall_speed':80,'travel_speed':200}
PRINTER={'name':'Kobra S1 · Démonstration','machine_name':'Anycubic Kobra S1','printer_online':True,'is_available':True,'is_busy':False,'job_in_progress':False,'job_is_paused':False,'job_name':'Cube de calibration · PLA','job_state':'finished','job_progress':100,'job_time_elapsed':46,'job_time_remaining':0,'job_current_layer':100,'job_total_layers':100,'curr_nozzle_temp':28,'target_nozzle_temp':0,'curr_hotbed_temp':26,'target_hotbed_temp':0,'fan_speed_pct':0,'aux_fan_speed_pct':0,'box_fan_level':0,'firmware':'2.7.2.7','firmware_available':'2.7.2.7','firmware_update_available':False,'multi_color_box_fw_version':'1.1.36','ace_updates':[{'current':'1.1.36','target':'1.1.36','available':False}],'ace_available':['1.1.36',None],'connected_ace_units':1,'boxes':[BOX],'statistics':{'hours':124,'material':'2.4 kg'},'task_details':{'dimensions':[20,20,20],'layers':100,'estimated_time':'46m','material_grams':12.6,'parameters':PARAMS},'axes_supported':True,'foreign_detection_supported':True,'speed_modes':[{'mode':0,'description':'Quiet'},{'mode':1,'description':'Standard'},{'mode':2,'description':'Sport'}]}
TASKS=[{'key':str(i),'name':name,'start':T-days*86400,'end':None if status==1 else T-days*86400+2760,'status':{1:'Impression en cours',2:'Impression terminée',3:'Impression arrêtée'}[status],'status_code':status,'elapsed_minutes':46,'progress':50 if status==1 else 100,'reason':'','can_reprint':status!=1,'evaluated':False,'printer':'Kobra S1 · Démonstration','printer_key':'demo-printer'} for i,(name,days,status) in enumerate([('Cube de calibration · PLA',1,2),('Boîte de rangement · PLA',2,3),('Support de téléphone · PETG',3,1),('Vase décoratif · PLA',120,2),('Guide-câble · PETG',5,2),('Porte-crayons · PLA',6,2),('Ancien support · PLA',180,3)],1)]
FILES=[{'name':name,'size_mb':size,'is_dir':False,'path':'/','handle':str(i)} for i,(name,size) in enumerate([('Cube de calibration.gcode',2.6),('Boîte de rangement.gcode',8.4),('Support de téléphone.gcode',5.1)])]

async def demo_index(request):
 """Renvoie l’interface marquée comme démonstration, avec une caméra purement illustrative."""
 html=render_page(home_url(os.environ.get('HOME_URL','/imprimante.html')),display_timezone()).replace('<body>','<body><div class="demo-banner">Démonstration · Données fictives · Aucune imprimante connectée</div>')
 if ACCESS_KEY not in request.app:html=re.sub(r'<form action="/logout".*?</form>','',html)
 html=html.replace('<div id="camera-video"></div>','<div id="camera-video" class="demo-camera"><img src="/icons/kobra-s1-ace2pro.png" alt="Illustration de l’imprimante"><p>Zone vidéo · Démonstration sans flux caméra</p></div>')
 return web.Response(text=html,content_type='text/html')
async def api(request):
 """Renvoie des données fictives ; simule les messages en mémoire et refuse toute commande physique."""
 path=request.match_info['tail'];notices=request.app[NOTICES];tasks=request.app[PRINT_TASKS]
 if path=='demo/reset' and request.method=='POST':notices[:]=[dict(x) for x in NOTICE_FIXTURES];tasks[:]=[dict(x) for x in TASKS];return web.json_response({'ok':True})
 if path=='history/read' and request.method=='POST':
  data=await request.json()
  for item in notices:
   if data.get('all') or item['key']==data.get('key'):item['unread']=False
  return web.json_response({'ok':True,'message':'Messages fictifs marqués comme lus'})
 if path=='history/delete' and request.method=='POST':
  data=await request.json();notices[:]=[x for x in notices if not data.get('all') and x['key']!=data.get('key')]
  return web.json_response({'ok':True,'message':'Messages fictifs supprimés'})
 if path=='command' and request.method=='POST':
  data=await request.json()
  if data.get('action')=='task-delete-many':
   keys=data.get('keys');known={t['key'] for t in tasks}
   if not isinstance(keys,list) or not keys or any(k not in known for k in keys):return web.json_response({'ok':False,'message':'Sélection fictive inconnue'},status=400)
   tasks[:]=[t for t in tasks if t['key'] not in keys]
   return web.json_response({'ok':True,'message':'Fiches fictives retirées'})
 if request.method not in ['GET','HEAD'] and path!='preview':return web.json_response({'ok':False,'message':'Démonstration : aucune commande réelle n’est envoyée.'},status=403)
 if path=='printers':d={'items':[{'key':'demo-printer','name':'Kobra S1 · Démonstration'}],'default':'demo-printer','pending':False}
 elif path=='status':d={'ok':True,'demo':True,'printer':PRINTER,'updated_at':T,'mqtt_updated_at':T,'mqtt_connected':True,'presets':[{'name':n,'temperature':t,'hours':h} for n,t,h in [('PLA',45,4),('PETG',55,6),('ABS / ASA',60,6),('PA',65,8)]],'notifications':{'items':notices,'page':1,'total':len(notices),'unread':sum(x['unread'] for x in notices),'has_more':False},'events':[{'time':T-600,'action':'Démonstration','state':'Impression terminée'}]}
 elif path=='preview' or path in ['extras/task-preview','extras/notification-preview']:d={'image':IMAGE}
 elif path=='temperatures':d={'readings':[{'time':int(T)-i*30,'nozzle':round(28+182*(1-math.exp(-i/30)),1),'bed':round(26+34*(1-math.exp(-i/45)),1),'ace':42,'nozzle_target':0,'bed_target':0,'ace_target':45} for i in range(120,-1,-1)],'hours':1,'retention_hours':24}
 elif path.startswith('files/'):d={'files':FILES,'page':1,'has_more':False,'path':'/'}
 elif path=='extras/storage':d={'total':2*1024**3,'used':184*1024**2,'free':2*1024**3-184*1024**2}
 elif path=='extras/tasks':
  page=max(1,int(request.query.get('page',1)));offset=(page-1)*3;d={'items':tasks[offset:offset+3],'page':page,'has_more':offset+3<len(tasks)}
 elif path=='extras/task':d={'name':TASKS[0]['name'],'reason':'','reason_code':'','help_url':None,'dimensions':{'length':20,'width':20,'height':20},'layers':100,'estimated_seconds':2760,'material_grams':12.6,'parameters':PARAMS}
 elif path=='history':d={'items':notices,'page':1,'total':len(notices),'unread':sum(x['unread'] for x in notices),'has_more':False}
 elif path=='ai-settings':d={'settings':{'status':3,'sensitivity_level':[1,2,0],'notice_type':[0,2,0]}}
 elif path=='extras/device':d={'message':None,'calibrations':[],'assistance':[],'screen':[],'hardware':{},'bed':{},'factory_reset':False,'timelapse':False}
 elif path=='extras/videos':d={'available':False,'items':[],'message':'Aucun flux ni timelapse n’est simulé.'}
 elif path=='extras/rating':d={'available':True,'already_rated':False}
 elif path=='health':d={'service':'ok','demo':True}
 else:return web.json_response({'message':'Fonction absente de la démonstration.'},status=404)
 return web.json_response(d)

def create_demo(authenticated=False):
 """Renvoie une démonstration sans cloud ; authenticated active la connexion web réelle."""
 app=web.Application(middlewares=[access_control] if authenticated else []);app[NOTICES]=[dict(x) for x in NOTICE_FIXTURES];app[PRINT_TASKS]=[dict(x) for x in TASKS]
 if authenticated:install_access(app)
 app.router.add_get('/',demo_index);app.router.add_get('/imprimante.html',demo_index);app.router.add_get('/about',about)
 for folder in ['css','js','icons']:app.router.add_static('/'+folder+'/',ROOT/folder,show_index=False)
 app.router.add_route('*','/imprimante-api/{tail:.*}',api);return app
if __name__=='__main__':
 if __import__('os').geteuid()==0:raise SystemExit('Le serveur doit être lancé sans privilèges root.')
 parser=argparse.ArgumentParser();parser.add_argument('--auth',action='store_true');parser.add_argument('--port',type=int,default=8081);parser.add_argument('--host',default='127.0.0.1');args=parser.parse_args();web.run_app(create_demo(authenticated=args.auth),host=args.host,port=args.port,access_log=None)
