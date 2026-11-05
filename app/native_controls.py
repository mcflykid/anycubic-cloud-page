"""Paramètres de commandes validés et informations de tranche autorisées pour l’interface."""
import math
PARAMS=('layer_height','fill_density','enable_support','support_material_auto','brim_type','bed_temperature','temperature','fan_max_speed','filament_retract_length','perimeters','perimeter_extrusion_width','outer_wall_speed','travel_speed')
def task_details(project):
 """Renvoie les paramètres de tranche et dimensions autorisés, ou None sans projet."""
 if project is None:return None
 params=getattr(project,'_slice_param',None) or {};result=getattr(project,'_slice_result',None) or {}
 weights=result.get('filament used [g]');weights=weights if isinstance(weights,list) else [weights]
 grams=sum(x for x in weights if isinstance(x,(int,float)) and math.isfinite(x)) if any(isinstance(x,(int,float)) for x in weights) else None
 return {'dimensions':[result.get(k) for k in ('size_x','size_y','size_z')],'layers':result.get('total_layers'),'estimated_time':result.get('print_time'),'material_grams':round(grams,2) if grams is not None else None,'parameters':{k:params[k] for k in PARAMS if k in params}}
def axis_payload(axis,direction,distance):
 """Renvoie une commande d’axe bornée ; direction=2 désigne l’origine, ValueError si mouvement invalide."""
 if isinstance(axis,bool) or axis not in (1,2,3,4,5):raise ValueError('Axe invalide')
 if isinstance(direction,bool) or direction not in (0,1,2):raise ValueError('Direction invalide')
 if direction==2:return {'axis':axis,'move_type':2,'distance':0}
 if axis not in (1,2,3) or distance not in (1,15,50) or isinstance(distance,bool):raise ValueError('Déplacement invalide')
 return {'axis':axis,'move_type':direction,'distance':distance}
def ai_payload(data,previous=None):
 """Renvoie les réglages IA en conservant les bits non concernés ; lève ValueError si les valeurs sont invalides."""
 previous=previous or {};spaghetti=data.get('spaghetti');foreign=data.get('foreign')
 if not isinstance(spaghetti,bool) or not isinstance(foreign,bool):raise ValueError('Réglage IA invalide')
 levels=previous.get('sensitivity_level') or [1,1,1];notices=previous.get('notice_type') or [0,0,0]
 levels=(list(levels)+[1,1,1])[:3];notices=(list(notices)+[0,0,0])[:3]
 for field,index,enabled in [('foreign_level',0,foreign),('spaghetti_level',1,spaghetti)]:
  value=data.get(field,1)
  if isinstance(value,bool) or value not in (0,1,2):raise ValueError('Sensibilité invalide')
  levels[index]=value if enabled else 0
 pause=data.get('pause',False)
 if not isinstance(pause,bool):raise ValueError('Action de détection invalide')
 notices[1]=(1 if pause else 2) if spaghetti else 0
 raw_status=previous.get('status')
 if raw_status is None:
  raw_status=0
 if type(raw_status) is not int and not (isinstance(raw_status,str) and raw_status.isdecimal()):
  raise ValueError('État IA précédent invalide. Actualisez les réglages avant de réessayer.')
 status=(int(raw_status)&~3)|(1 if spaghetti else 0)|(2 if foreign else 0)
 return {'ai_settings':{'status':status,'type':2 if spaghetti or foreign else 1,'count':60 if spaghetti or foreign else 1,'sensitivity_level':levels,'notice_type':notices}}
