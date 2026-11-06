import {$,confirmAction,date,fmt,formatText,locale,message,mins,node,serverText,set,timeZone,tr} from './workshop-ui.mjs?v=60097cdec556';
import {createTemperatureLoader} from './workshop-temperatures.mjs?v=2414b95f0ddd';
import {api,createRequest} from './workshop-api.mjs?v=f28638a19076';

let snapshot=null, source='local', cloudPage=1, cloudRows=[], filePending=false, fileRows=null, currentTab='overview', busy=false, client=null, cameraTrack=null, zoom=1, sdkPromise=null, cameraGeneration=0, presetsReady=false, mqttSeen='', connectionFailure=false;
export let previewJob=null;
let cloudHasMore=false;
/** Un changement de langue recharge la page, donc le sélecteur attend la fin de l’action en cours. */
function setBusy(value){
 busy=value;
 $('interface-language').disabled=value;
}
let fileContext=null,fileGeneration=0,fileReload=false,uploadAttempt=null;
let cameraWanted=false,cameraViewer=null;
let selectedPrinter='',printerCatalogueReady=false,printerCataloguePending=false;
/** Le choix reste propre au navigateur ; les valeurs périmées se replient sur le défaut fourni par le serveur. */
async function loadPrinters(){if(printerCataloguePending)return;printerCataloguePending=true;try{const d=await request('/printers'),items=d.items||[];if(!items.length)return;let saved='';try{saved=localStorage.getItem('cloud-page-printer')||'';}catch{}selectedPrinter=items.some(x=>x.key===saved)?saved:items.some(x=>x.key===d.default)?d.default:items[0].key;const selector=$('printer-selector');selector.replaceChildren(...items.map(p=>new Option(p.name,p.key)));selector.value=selectedPrinter;$('printer-selector-wrap').hidden=items.length<2;printerCatalogueReady=true;}finally{printerCataloguePending=false;}}
/** Une nouvelle page empêche de réutiliser un dialogue, un aperçu ou un cache de la machine précédente. */
async function choosePrinter(){const selector=$('printer-selector');if(busy){selector.value=selectedPrinter;message(tr('Attendez la fin de l’opération avant de changer d’imprimante.'),true);return;}await closeCamera();try{localStorage.setItem('cloud-page-printer',selector.value);}catch{message(tr('Le navigateur ne peut pas mémoriser ce choix.'),true);selector.value=selectedPrinter;return;}location.reload();}
$('printer-selector').onchange=choosePrinter;
const request=createRequest(()=>selectedPrinter);
const loadTemperatures=createTemperatureLoader(request);
const sensitiveActions=new Set(['firmware','ace-firmware','factory-reset']);
/** Vérifie le mot de passe séparément de la commande et abandonne la confirmation si le dialogue ferme. */
function confirmPassword(action,target){
 const dialog=$('reauth-dialog'),form=$('reauth-form'),submit=$('reauth-submit'),controller=new AbortController();
 let confirmation=null;
 form.reset();submit.disabled=false;set('reauth-state','');
 return new Promise(resolve=>{
  dialog.addEventListener('close',()=>{
   controller.abort();form.reset();form.onsubmit=null;resolve(confirmation);
  },{once:true});
  form.onsubmit=async event=>{
   event.preventDefault();
   if(submit.disabled)return;
   submit.disabled=true;set('reauth-state',tr('Vérification…'));
   const body=JSON.stringify({action,password:form.elements.password.value});
   form.reset();
   try{
    const result=await request('/reauth',{method:'POST',printerKey:target,signal:controller.signal,headers:{'Content-Type':'application/json'},body});
    if(!dialog.open||controller.signal.aborted)return;
    confirmation=result.confirmation;
    dialog.close();
   }catch(error){
    if(!dialog.open||controller.signal.aborted)return;
    submit.disabled=false;set('reauth-state',error.message);form.elements.password.focus();
   }
  };
  dialog.showModal();
 });
}
/** Renvoie le résultat ou null ; question demande confirmation et request_id empêche une répétition côté serveur. */
async function command(action,data={},question,feedback){const notify=(text,error)=>{message(text,error);feedback?.(text);};if(busy){notify(tr('Une opération est déjà en cours.'),true);return null;}const target=selectedPrinter,projectKey=['pause','resume','cancel'].includes(action)?snapshot?.printer?.command_project:null;if(['pause','resume','cancel'].includes(action))data={...data,project_key:projectKey};if(!target){notify(tr('Attendez la découverte des imprimantes avant une commande.'),true);return null;}if(question&&!await confirmAction(question))return null;if(target!==selectedPrinter){notify(tr('La cible a changé : commande annulée.'),true);return null;}setBusy(true);try{
 if(sensitiveActions.has(action)){
  const confirmation=await confirmPassword(action,target);
  if(!confirmation)return null;
  data={...data,confirmation};
 }
 notify(tr('Demande en cours…'));
 const d=await request('/command',{printerKey:target,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...data,request_id:crypto.randomUUID()})});notify(d.message);await refresh();return d;}catch(e){notify(e.message,true);return null;}finally{setBusy(false);}}
/** Remplit une liste descriptive par textContent pour que les valeurs cloud restent du texte. */
function definition(target,values){const dl=$(target);dl.replaceChildren(...values.map(([label,value])=>{const div=node('div');const title=node('dt',tr(label));if(['temperatures','details','ace-stats'].includes(target))decorateMetric(title,metricIcons[label]);div.append(title,node('dd',value));return div;}));}
$('message-close').onclick=()=>message('');
const metricPaths={
 nozzle:'M6 3h12v6l-6 5-6-5zM12 14v4m-6 3h12',
 bed:'M3 13h18v4H3zM6 17v4m12-4v4M8 9V5m4 4V3m4 6V5',
 ace:'M3 6h18v12H3zM6 10h12m-12 4h2m2 0h2m2 0h2m2 0h2',
 fan:'M12 12c-3-2-7-1-7 2 0 2 4 3 7-2 3 2 7 1 7-2 0-2-4-3-7 2 1 3 0 6-2 6',
 gauge:'M4 16a8 8 0 1 1 16 0M12 15l3-4',
 model:'M12 3l8 4v10l-8 4-8-4V7zM4 7l8 4 8-4m-8 4v10',
 clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4v5l4 2',
 settings:'M4 7h16M4 17h16M8 5v4m8 6v4',
 layers:'M3 8l9-4 9 4-9 4zM3 12l9 4 9-4m-18 4 9 4 9-4',
 thermometer:'M10 14V5a2 2 0 0 1 4 0v9a4 4 0 1 1-4 0zM12 9v8',
 drop:'M12 3c-3 4-6 7-6 11a6 6 0 1 0 12 0c0-4-3-7-6-11z',
 relay:'M6 8h12a4 4 0 0 1 0 8H6a4 4 0 0 1 0-8zm1 2v4',
};
const metricIcons={
 'Buse actuelle / cible':'nozzle','Plateau actuel / cible':'bed','Ventilation pièce':'fan','Ventilation auxiliaire':'fan','Ventilation enceinte':'fan',
 'Modèle':'model','Micrologiciel':'settings','Temps total':'clock','Nombre d’impressions':'layers','Filament utilisé':'ace',
 'Fin estimée':'clock','Épaisseur de couche':'layers','Mode de vitesse':'gauge','Vitesse (%)':'gauge',
 'Température':'thermometer','Humidité':'drop','Relais automatique':'relay',
};
/** Les pictogrammes décorent les libellés et gardent les mesures textuelles. */
function decorateMetric(label,icon){
 if(!icon)return;
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),path=document.createElementNS(ns,'path');
 svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('class','metric-icon');
 path.setAttribute('d',metricPaths[icon]);svg.append(path);label.prepend(svg);
}
for(const title of document.querySelectorAll('[data-metric-icon]'))decorateMetric(title,title.dataset.metricIcon);
const detailNames={job_eta:tr('Fin estimée'),job_z_thick:tr('Épaisseur de couche'),job_model_height:tr('Hauteur du modèle'),job_speed_mode:tr('Mode de vitesse'),print_speed_pct:'Vitesse (%)',job_anti_alias_count:tr('Anticrénelage'),job_on_time:'Exposition',job_off_time:tr('Pause exposition'),job_bottom_time:tr('Exposition de base'),job_bottom_layers:tr('Couches de base'),job_z_up_height:tr('Levée Z'),job_z_up_speed:tr('Vitesse de levée Z'),job_z_down_speed:tr('Vitesse de descente Z')};
/** Réessaie un aperçu indisponible avec un délai borné et ignore les réponses d’un ancien projet. */
function renderJobPreview(printer){
 const key=printer.job_name&&(printer.command_project||printer.job_name);
 const image=$('job-preview');
 if(!key||previewJob?.key!==key){
  image.hidden=true;
  previewJob=key?{key,attempts:0,next:0,pending:false,done:false}:null;
 }
 const current=previewJob;
 if(!current||current.done||current.pending||current.attempts>=3||Date.now()<current.next)return;
 current.attempts++;
 current.pending=true;
 request('/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:'local',name:printer.job_name})})
  .then(result=>{if(previewJob===current&&result.image){image.src=result.image;image.hidden=false;current.done=true;}})
  .catch(()=>{})
  .finally(()=>{current.pending=false;current.next=Date.now()+10000;});
}
/** Garde le texte de statut et la couleur synchronisés avec la dernière mesure. */
function statusBadge(id,text,active){
 const badge=$(id);
 if(badge.textContent!==text)badge.textContent=text;
 badge.classList.toggle('inactive',active===false);
 badge.classList.toggle('offline',active==null);
}
const hardwareIcons='/imprimante-api/ui/icons/';
const printerIllustrations=new Map([
 ['kobra s1','kobra-s1.svg'],['kobra s1 combo','kobra-s1.svg'],
 ['kobra 3','kobra-3.svg'],['kobra 3 combo','kobra-3.svg'],
 ['kobra x','kobra-x.svg'],['kobra x combo','kobra-x.svg'],
]);
/** Les illustrations suivent le modèle constructeur et la génération explicitement rapportée. */
function renderHardware(printer){
 const model=printer.machine_name||printer.name||tr('Imprimante');
 const box=printer.boxes?.[0];
 const generation=box?.model;
 const aceName=box?(generation||tr('Module ACE')):tr('Aucun module ACE');
 const setImage=(id,source)=>{
  const image=$(id);
  if(image.getAttribute('src')!==source)image.src=source;
 };
 set('printer-model',model);
 set('printer-accessory',aceName);
 $('printer-accessory').hidden=!box;
 const modelKey=String(printer.machine_name||'').trim().toLowerCase().replace(/^anycubic\s+/,'').replace(/\s+/g,' ');
 const illustration=printerIllustrations.get(modelKey);
 const s1Combo=illustration==='kobra-s1.svg'&&generation==='ACE 2 Pro';
 setImage('printer-illustration',hardwareIcons+(s1Combo?'kobra-s1-ace2pro.png':illustration||'printer.svg'));
 set('ace-model',aceName);
 set('firmware-printer-model',model);
 set('firmware-ace-model',aceName);
 set('chart-ace-name',box?(generation||tr('Module ACE')):tr('Module ACE'));
 setImage('settings-printer-illustration',$('printer-illustration').getAttribute('src'));
 $('ace-illustration').hidden=!box;
 setImage('ace-illustration',hardwareIcons+(generation==='ACE 2 Pro'?'ace2pro.png':generation==='ACE Pro'?'ace-pro.svg':'ace.svg'));
}
/** Affiche l’état courant et autorise les commandes selon le projet, sans assimiler l’absence de données à un succès. */
function renderOverview(p){renderHardware(p);renderJobPreview(p);const state=!p.printer_online?tr('Hors ligne'):p.job_is_paused?tr('En pause'):p.is_busy?tr('Impression en cours'):tr('Disponible');statusBadge('printer-status',state,p.printer_online?p.job_is_paused?null:true:false);$('job-name').dataset.tooltip=p.job_name||tr('Imprimante prête');set('job-name',p.job_name||(!p.printer_online?tr('L’imprimante est hors ligne.'):p.is_busy?tr('Impression en cours'):tr('Prête pour la prochaine création.')));set('job-state',p.job_name?({printing:tr('Impression en cours'),paused:tr('Impression en pause'),finished:tr('Impression terminée'),completed:tr('Impression terminée')}[p.job_state]||fmt(p.job_state)):p.is_busy?tr('Le cloud n’a pas encore fourni le projet.'):tr('Aucune impression en cours.'));$('job-state').hidden=$('job-state').textContent===state;$('job-progress-wrap').hidden=p.job_progress==null;if(p.job_progress!=null){$('job-progress').value=p.job_progress;set('job-progress-text',fmt(p.job_progress,' %'));}
 definition('job-stats',[['Temps écoulé',mins(p.job_time_elapsed)],['Temps restant',mins(p.job_time_remaining)],['Couches',p.job_current_layer==null?'—':`${p.job_current_layer} / ${p.job_total_layers??'—'}`]]);
 const measurements=[['Buse actuelle / cible',`${fmt(p.curr_nozzle_temp,' °C')} / ${fmt(p.target_nozzle_temp,' °C')}`],['Plateau actuel / cible',`${fmt(p.curr_hotbed_temp,' °C')} / ${fmt(p.target_hotbed_temp,' °C')}`],['Ventilation pièce',fmt(p.fan_speed_pct,' %')],['Ventilation auxiliaire',fmt(p.aux_fan_speed_pct,' %')],['Ventilation enceinte',fmt(p.box_fan_level)]];
 definition('temperatures',measurements);definition('control-metrics',measurements);
 set('control-light-state',p.camera_light===true?tr('Allumé'):p.camera_light===false?tr('Éteint'):tr('État inconnu'));
 for(const id of ['control-light-on','control-light-off'])$(id).disabled=!snapshot.ok||!p.printer_online;
 definition('details',[['Modèle',p.machine_name||'—'],['Micrologiciel',fmt(p.firmware)],['Temps total',fmt(p.statistics?.hours,' h')],['Nombre d’impressions',fmt(p.statistics?.print_count)],['Filament utilisé',String(p.statistics?.material??'—').replace(/([0-9.]+)\s*(kg|g)$/,(_,n,u)=>Number(n).toLocaleString(locale,{maximumFractionDigits:2})+' '+u)],...Object.entries(detailNames).filter(([key])=>p[key]!=null).map(([key,label])=>[label,key==='job_eta'?date(p[key]):fmt(p[key])])]);
 for(const action of ['pause','resume','cancel'])document.querySelector(`[data-command="${action}"]`).disabled=!p.job_in_progress||!p.command_project||(action==='pause'&&p.job_is_paused)||(action==='resume'&&!p.job_is_paused);
 renderFirmware(p);set('settings-availability',snapshot.ok&&p.job_in_progress?tr('Réglages disponibles'):tr('Disponibles pendant une impression'));$('settings-form').querySelectorAll('input,select,button').forEach(e=>e.disabled=!snapshot.ok||!p.job_in_progress);if(!$('rename-form').dataset.loaded){$('rename-form').elements.name.value=p.name||'';$('rename-form').dataset.loaded='yes';}

 const modes=p.speed_modes||[];if(JSON.stringify(modes)!==$('speed-mode').dataset.values){const previous=$('speed-mode').value;$('speed-mode').replaceChildren(new Option(tr('Ne pas modifier'),''),...modes.map(m=>new Option(({Quiet:tr('Silencieux'),Standard:'Standard',Sport:'Sport'}[m.description??m.name??m.label]||m.description||m.name||m.label||String(m.mode??m.value??m.code)),m.mode??m.value??m.code??m.id)));$('speed-mode').value=previous;$('speed-mode').dataset.values=JSON.stringify(modes);}
}
/** N’autorise une mise à jour que si la machine est libre et la disponibilité explicitement annoncée. */
function renderFirmware(p){
 const printerButton=document.querySelector('[data-command=firmware]'),aceButton=document.querySelector('[data-command=ace-firmware]'),ace=p.ace_updates?.[0];
 const idle=!!p.printer_online&&!!p.is_available&&!p.job_in_progress,printerUpdate=p.firmware_update_available===true,aceUpdate=ace?.available===true;
 printerButton.disabled=!idle||!printerUpdate;aceButton.disabled=!idle||!aceUpdate;
 printerButton.title=!idle?tr('Imprimante occupée ou hors ligne.'):printerUpdate?tr('Installer la version ')+p.firmware_available:tr('Aucune mise à jour proposée par Anycubic.');
 aceButton.title=!idle?tr('Imprimante occupée ou hors ligne.'):aceUpdate?tr('Installer la version ')+(ace.target||tr('proposée'))+' sur le module ACE.':ace?tr('Aucune mise à jour proposée par Anycubic.'):tr('Version de l’ACE non reçue. Actualisez les informations.');
 for(const [id,current,target,available] of [['printer',p.firmware,p.firmware_available,p.firmware_update_available],['ace',ace?.current??p.multi_color_box_fw_version,ace?.target,ace?.available]]){
  set(`firmware-${id}-version`,available===true?`${fmt(current)} → ${fmt(target)}`:formatText("Version {0}",fmt(current)));
  set(`firmware-${id}-status`,available===true?tr('Mise à jour disponible'):available===false?tr('À jour'):tr('À vérifier'));
  $(`firmware-${id}-status`).className='firmware-status '+(available===true?'available':available===false?'current':'unknown');
 }
 printerButton.dataset.confirm=formatText(tr('Installer la version {0} sur l’imprimante ? Ne coupez pas son alimentation pendant la mise à jour.'),p.firmware_available||'—');
 aceButton.dataset.confirm=formatText(tr('Installer la version {0} sur le module ACE ? Ne coupez pas son alimentation pendant la mise à jour.'),ace?.target||'—');
}
/** Renvoie le premier ACE connu, ou null ; cette interface ne propose pas de sélection de second boîtier. */
function selectedBox(){return snapshot?.printer?.boxes?.[0]||null;}
/** Renvoie l’identifiant de l’ACE affiché pour cibler les commandes de bobines et de séchage. */
function boxData(){return {box:selectedBox()?.box_id??0};}
/** Affiche les bobines et le séchage ; préserve une quantité nulle et distingue RFID d’une configuration manuelle. */
function renderAce(p){
 const box=selectedBox();if(!box){statusBadge('ace-status',tr('Aucun module ACE détecté.'),false);$('spools').replaceChildren();return;}
 statusBadge('ace-status',!p.printer_online?tr('Hors ligne'):box.drying?.is_drying?tr('Séchage en cours'):tr('Disponible'),!!p.printer_online);definition('ace-stats',[['Température',fmt(box.temperature,' °C')],['Humidité',fmt(box.humidity,' %')],['Relais automatique',box.auto_feed?tr('Activé'):tr('Désactivé')]]);
 $('spools').replaceChildren(...(box.spools||[]).map(s=>{const art=node('article',null,'slot'),sw=node('div',null,'swatch');if(Array.isArray(s.color))sw.style.backgroundColor=`rgb(${s.color.slice(0,3).map(v=>Math.max(0,Math.min(255,Number(v)||0))).join(',')})`;art.append(sw,node('h3',s.material_type||tr('Non renseigné')),node('p',formatText("Emplacement {0}",s.display_slot??s.slot)),node('p',Number.isInteger(box.loaded_slot)&&box.loaded_slot>=0&&box.loaded_slot===(s.local_slot??s.slot)-1?tr('● Bobine engagée'):s.spool_loaded?tr('Filament présent'):tr('Filament absent ou non détecté'),Number.isInteger(box.loaded_slot)&&box.loaded_slot>=0&&box.loaded_slot===(s.local_slot??s.slot)-1?'engaged-spool':''),node('p',s.remaining_percent==null?tr('Quantité non renseignée'):formatText("{0} % restants",s.remaining_percent)));if(s.rfid===true)art.append(node('p','Anycubic · RFID reconnu','rfid-badge'));else if(s.rfid===false)art.append(node('p',tr('Configuration manuelle'),'muted'));const edit=node('button',s.rfid===true?'Voir':'Modifier');edit.type='button';edit.title=s.rfid===true?tr('Consulter les informations RFID et gérer le chargement de cette bobine.'):tr('Modifier le matériau, la couleur et le chargement de cet emplacement.');edit.onclick=()=>openSpool(s.local_slot||s.slot);art.append(edit);return art;}));
 const dry=box.drying||{};
 const drying=typeof dry.is_drying==='boolean'?dry.is_drying:null;
 statusBadge('drying-state',drying===true?tr('Séchage actif'):drying===false?tr('Séchage inactif'):tr('État du séchage inconnu'),drying);
 $('drying-detail').hidden=drying!==true;
 if(drying)set('drying-detail',formatText("{0} · Durée restante {1}",fmt(dry.target_temperature,' °C'),mins(dry.remaining_time)));
 if(document.activeElement!==$('auto-feed'))$('auto-feed').checked=!!box.auto_feed;

 if(!presetsReady){presetsReady=true;$('preset-fields').replaceChildren(...snapshot.presets.map((pr,i)=>{const fs=node('fieldset');fs.append(node('legend',formatText("Préréglage {0}",i+1)));for(const [key,label]of[['name',tr('Nom')],['temperature',tr('Température (°C)')],['hours',tr('Durée (heures)')]]){const l=node('label',label),input=node('input');input.name=`${i}-${key}`;input.value=pr[key];input.type=key==='name'?'text':'number';input.required=true;fs.append(l);l.append(input);}return fs;}));}
 $('dry-presets').replaceChildren(...snapshot.presets.map(pr=>{const b=node('button',`${pr.name} ${pr.temperature} °C · ${pr.hours} h`);b.type='button';b.onclick=()=>command('dry-start',{...boxData(),temperature:pr.temperature,hours:pr.hours},formatText("Démarrer le séchage {0} à {1} °C pendant {2} h ?",pr.name,pr.temperature,pr.hours));return b;}));
}
/** Actualise l’interface depuis l’état serveur et signale les erreurs de connexion sans répéter de commande. */
export async function refresh(){try{if(!printerCatalogueReady)await loadPrinters();const d=await request('/status');if(connectionFailure&&d.ok){message('');connectionFailure=false;}snapshot=d;if(currentTab==='camera'&&cameraWanted&&!cameraTrack&&d.camera_diagnostic)set('camera-state',serverText(d.camera_diagnostic.message,'Pas de diagnostic traduit pour cet événement.'));if(d.notifications){updateNoticeCount(d.notifications.unread);const signature=JSON.stringify(d.notifications);if(signature!==noticeSignature){noticeSignature=signature;if(historyPage===1)noticeRows=d.notifications.items;else{const merged=new Map([...noticeRows,...d.notifications.items].map(x=>[x.key,x]));noticeRows=[...merged.values()].sort((a,b)=>b.time-a.time);}if(!$('notifications-panel').hidden)renderNotifications();}}const p=d.printer;set('connection',!d.ok?tr('Cloud indisponible'):p?.printer_online?tr('En ligne'):tr('Hors ligne'));$('connection').classList.toggle('offline',!d.ok||!p?.printer_online);set('updated',`${tr('Dernière actualisation')} : ${date([d.updated_at,d.mqtt_updated_at].filter(Boolean).sort().at(-1))} · ${timeZone}`);if(!d.ok&&d.message){connectionFailure=true;message(d.message,true);}if(d.account_message)message(serverText(d.account_message,'Échec de la lecture auprès d’Anycubic.'),true);if(!p){disableQuickControls();return;}updateNativeControls(p);updateUploadButton();renderOverview(p);renderAce(p);$('events').replaceChildren(...d.events.map(e=>node('li',`${date(e.time)} — ${e.action} : ${serverText(e.state,'Pas de diagnostic traduit pour cet événement.')}`)));if(source!=='cloud'&&currentTab==='files')renderFiles();mqttSeen=d.mqtt_updated_at;}catch(e){disableQuickControls();connectionFailure=true;set('connection',tr('Connexion indisponible'));message(tr('Connexion au serveur momentanément indisponible.'),true);}}
/** Change le panneau actif, charge ses données et ferme la session vidéo lorsque l’utilisateur quitte la caméra. */
function showTab(name){currentTab=name;for(const panel of document.querySelectorAll('.tab-panel'))panel.hidden=panel.id!==`tab-${name}`;for(const b of document.querySelectorAll('[data-tab]')){if(b.dataset.tab===name)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}if(name==='files'){renderFiles();loadFiles();}if(name==='history')historyViewSet(historyView);if(name==='overview')loadTemperatures();if(name==='settings'&&!deviceOptions)loadDeviceOptions();if(name==='camera'){loadTimelapse();if(snapshot?.demo){const image=node('img');image.src='/imprimante-api/ui/icons/kobra-s1-ace2pro.png';image.alt=tr('Illustration de la Kobra S1');$('camera-video').classList.add('demo-camera');$('camera-video').replaceChildren(image,node('p',tr('Zone vidéo · Démonstration sans flux caméra')));}}if(name!=='camera')void closeCamera();}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>showTab(b.dataset.tab));
document.querySelectorAll('[data-command]').forEach(b=>b.onclick=()=>command(b.dataset.command,boxData(),b.dataset.confirm));
$('go-spool').onclick=()=>openSpool($('spool-form').elements.slot.value);$('go-drying').onclick=()=>{const dry=selectedBox()?.drying;if(dry?.is_drying){$('dry-form').elements.temperature.value=dry.target_temperature;if(Number.isFinite(dry.total_duration)&&dry.total_duration>0)$('dry-form').elements.hours.value=Math.max(1,Math.ceil(dry.total_duration/60));}if(!$('dry-dialog').open)$('dry-dialog').showModal();$('dry-form').elements.temperature.focus({preventScroll:true});};
$('spool-color').oninput=()=>set('spool-color-value',$('spool-color').value.toUpperCase());
document.querySelectorAll('.dialog-close').forEach(b=>b.onclick=()=>b.closest('dialog').close());
$('spool-form').onsubmit=e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target));if(!d.material){message(tr('Choisissez un matériau compatible avant d’enregistrer cette bobine.'),true);return;}command('slot',{...d,...boxData()},tr('Enregistrer ce matériau et cette couleur dans l’ACE ?'));};
for(const [id,action,extra,question]of[['feed','feed',{},tr('Charger le filament sélectionné ?')],['feed-finish','feed',{finish:true},tr('Terminer le chargement ?')],['retract','retract',{},tr('Rétracter le filament ?')]])$(id).onclick=()=>command(action,{...boxData(),slot:$('spool-form').elements.slot.value,...extra},question);
$('dry-form').onsubmit=e=>{e.preventDefault();command('dry-start',{...Object.fromEntries(new FormData(e.target)),...boxData()},tr('Démarrer le séchage avec ces paramètres ?'));};$('dry-stop').onclick=()=>command('dry-stop',boxData(),tr('Arrêter le séchage du module sélectionné ?'));$('auto-feed-save').onclick=()=>command('auto-feed',{...boxData(),enabled:$('auto-feed').checked},tr('Modifier le relais automatique des bobines ?'));
$('presets-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),presets=Array.from({length:4},(_,i)=>Object.fromEntries(['name','temperature','hours'].map(k=>[k,f.get(`${i}-${k}`)])));const d=await command('presets',{presets});if(d){presetsReady=false;await refresh();}};
const controlFeedback=text=>set('control-feedback',text);
/** Refuse les nouvelles commandes lorsque le serveur n’a plus d’état utilisable. */
function disableQuickControls(){
 for(const button of $('controls-dialog').querySelectorAll('form input,form select,form button,#control-light-on,#control-light-off'))button.disabled=true;
 set('control-light-state',tr('État inconnu'));
}
$('controls-open').onclick=()=>{controlFeedback('');$('controls-dialog').showModal();};
$('settings-form').onsubmit=e=>{
 e.preventDefault();controlFeedback('');
 void command('settings',Object.fromEntries(new FormData(e.target)),tr('Appliquer ces réglages à l’impression active ?'),controlFeedback);
};$('rename-form').onsubmit=e=>{e.preventDefault();command('rename',Object.fromEntries(new FormData(e.target)),tr('Renommer l’imprimante dans le compte Anycubic ?'));};
/** Renvoie les numéros de bobines dans l’ordre saisi ; lève Error pour un numéro hors de 1 à 8. */
function slots(value){if(!value.trim())return [];const result=value.split(/[ ,;]+/).filter(Boolean).map(Number);if(result.some(v=>!Number.isInteger(v)||v<1||v>8))throw new Error(tr('Indiquez des emplacements de 1 à 8.'));return result;}
/** Empêche une ancienne liste de fournir des actions pour une autre source ou un autre dossier. */
function currentFileContext(context){return !!context&&context.source===source&&context.path===$('file-path').value&&context.page===cloudPage&&context.printer===selectedPrinter;}
const fileThumbnailCache=new Map(),fileThumbnailQueue=new Map();
let fileThumbnailLoading=false;
const fileThumbnailObserver=new IntersectionObserver(entries=>{
 for(const {target,isIntersecting} of entries){
  if(!isIntersecting||!target.isConnected)continue;
  fileThumbnailObserver.unobserve(target);
  fileThumbnailQueue.set(target,target.previewJob);
 }
 void loadFileThumbnails();
},{rootMargin:'48px'});

/** Une seule miniature en cours évite de monopoliser le canal MQTT de la machine. */
async function loadFileThumbnails(){
 if(fileThumbnailLoading)return;
 fileThumbnailLoading=true;
 try{
  while(fileThumbnailQueue.size){
   const [host,job]=fileThumbnailQueue.entries().next().value;
   fileThumbnailQueue.delete(host);
   if(!host.isConnected||fileContext!==job.context||!currentFileContext(job.context)||currentTab!=='files')continue;
   let cached=fileThumbnailCache.get(job.key);
   if(!cached||cached.expires<=Date.now()){
    const {context,file}=job;
    let image=null;
    try{
     const result=await request('/preview',{
      method:'POST',printerKey:context.printer,timeoutMs:20000,headers:{'Content-Type':'application/json'},
      body:JSON.stringify({source:context.source,handle:file.handle,name:file.name,path:context.path})
     });
     image=result.image||null;
    }catch{}
    cached={image,expires:Date.now()+(image?300000:30000)};
    fileThumbnailCache.delete(job.key);
    fileThumbnailCache.set(job.key,cached);
    while(fileThumbnailCache.size>20)fileThumbnailCache.delete(fileThumbnailCache.keys().next().value);
   }
   if(host.isConnected&&fileContext===job.context&&currentFileContext(job.context))showFileThumbnail(host,job.file,cached.image);
  }
 }finally{fileThumbnailLoading=false;}
}

/** Le nom reste lisible si le fichier n’a pas d’image ou si son décodage échoue. */
function showFileThumbnail(host,file,src){
 const unavailable=()=>{
  host.removeAttribute('aria-busy');
  host.title=tr('Aperçu indisponible');
  host.textContent='—';
 };
 if(!src){unavailable();return;}
 const image=node('img'),button=node('button',null,'file-thumbnail-open');
 image.alt='';
 button.type='button';
 button.setAttribute('aria-label',tr('Agrandir l’aperçu de ')+file.name);
 button.onclick=()=>openFilePreview(file.name,src);
 button.append(image);
 image.onload=()=>{
  host.removeAttribute('aria-busy');
  host.title='';
  host.replaceChildren(button);
 };
 image.onerror=unavailable;
 image.src=src;
}

/** Prépare une vignette liée au dossier, à la source et à la cible de la ligne. */
function fileThumbnail(file,context){
 const host=node('span',null,'file-thumbnail');
 host.setAttribute('aria-busy','true');
 const key=JSON.stringify([context.printer,context.source,context.path,file.handle,file.name,file.size_mb]);
 host.previewJob={file,context,key};
 host.title=tr('Chargement de l’aperçu');
 const cached=fileThumbnailCache.get(key);
 if(cached&&cached.expires>Date.now())showFileThumbnail(host,file,cached.image);
 else fileThumbnailObserver.observe(host);
 return host;
}
/** Les actions gardent la source et le chemin de la liste reçue, même après un changement de vue. */
function renderFiles(){fileThumbnailObserver.disconnect();fileThumbnailQueue.clear();const context=fileContext,listedSource=context?.source,listedPath=context?.path;const list=currentFileContext(context)?(listedSource==='cloud'?cloudRows:fileRows):null;const rows=Array.isArray(list)?list:[];$('file-rows').replaceChildren(...rows.map(f=>{const row=node('tr'),name=node('td'),size=node('td',fmt(f.size_mb,tr(' Mo'))),actions=node('td'),wrap=node('div',null,'actions');const identity=node('span',null,'file-row-identity');if(!f.is_dir)identity.append(fileThumbnail(f,context));identity.append(node('span',f.name));name.append(identity);const add=(label,fn,cls)=>{const b=node('button',null,cls);const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('class','ui-icon');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.7');svg.setAttribute('aria-hidden','true');const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',({'Télécharger':'M12 3v12m-4-4l4 4 4-4M4 17v4h16v-4','Renommer':'M4 20l4-1L20 7l-3-3L5 16z','Ouvrir':'M3 7V5h7l2 3h9v12H3z','Imprimer':'M6 8V3h12v5M6 17H3V8h18v9h-3M6 14h12v7H6z','Supprimer':'M3 6h18M8 6V3h8v3M5 6l1 15h12l1-15'})[label]||'');svg.append(path);b.append(svg,node('span',tr(label)));b.title=({'Imprimer':tr('Préparer l’impression de ce fichier avec les bobines choisies.'),'Supprimer':tr('Supprimer ce fichier après confirmation.'),'Ouvrir':tr('Afficher le contenu de ce dossier.')})[label]||label;if(label==='Imprimer'){if(listedSource==='cloud'&&f.printable===false){b.disabled=true;b.title=tr('Ce fichier ne contient pas de G-code imprimable.');}else if(snapshot?.printer?.is_available===false){b.disabled=true;b.title=tr('L’imprimante est occupée.');}}b.type='button';b.onclick=fn;wrap.append(b);};if(source==='cloud'){const check=node('input');check.type='checkbox';check.checked=cloudSelected.has(f.handle);check.setAttribute('aria-label',tr('Sélectionner ')+f.name);check.onchange=()=>{check.checked?cloudSelected.add(f.handle):cloudSelected.delete(f.handle);cloudSelectionState();};name.prepend(check);name.classList.add('cloud-file-name');add('Télécharger',()=>downloadCloud([f.handle]));add('Renommer',()=>renameCloud(f));}if(f.is_dir)add('Ouvrir',()=>{$('file-path').value=listedPath.replace(/\/$/,'')+'/'+f.name;loadFiles();});else{add('Imprimer',async()=>{try{await command(`print-${listedSource}`,{...f,path:listedPath,slots:slots($('file-slots').value)},formatText("Imprimer « {0} » avec la sélection de bobines indiquée ?",f.name));}catch(e){message(e.message,true);}});add('Supprimer',async()=>{const ok=await command(`delete-${listedSource}`,{...f,path:listedPath},formatText("Supprimer définitivement « {0} » de {1} ?",f.name,listedSource==='cloud'?tr('votre espace cloud'):listedSource==='usb'?tr('la clé USB'):tr('la mémoire de l’imprimante')));if(ok)loadFiles();},'danger');}actions.append(wrap);row.append(name,size,actions);return row;}));
 if(source!=='cloud')set('files-state',list==null?tr('Liste non reçue. Actualisez ; les résultats arrivent par MQTT.'):rows.length?formatText("{0} élément(s).",rows.length):tr('Ce dossier est vide.'));
 $('cloud-tools').hidden=source!=='cloud';if(source==='cloud'){cloudSelectionState();loadCloudStorage();} $('prev-page').hidden=$('next-page').hidden=source!=='cloud';set('cloud-page',source==='cloud'?formatText("Page {0}",cloudPage):'');$('prev-page').disabled=cloudPage<=1;$('next-page').disabled=!cloudHasMore||!currentFileContext(context);
}
/** Sérialise les lectures MQTT et relance le dernier choix en ignorant toute réponse périmée. */
async function loadFiles(){
 const generation=++fileGeneration;if(filePending){fileReload=true;renderFiles();return;}
 const context={source,path:$('file-path').value,page:cloudPage,printer:selectedPrinter};filePending=true;renderFiles();
 try{
  set('files-state',context.source==='cloud'?tr('Chargement du cloud…'):tr('Lecture du dossier sur l’imprimante…'));
  const result=await request(context.source==='cloud'?`/files/cloud?page=${context.page}`:`/files/${context.source}?path=${encodeURIComponent(context.path)}`,{printerKey:context.printer});
  if(generation!==fileGeneration||!currentFileContext(context))return;
  fileContext=context;
  if(context.source==='cloud'){cloudRows=result.files;cloudHasMore=result.has_more===true;}else fileRows=result.files;
  renderFiles();set('files-state',context.source==='cloud'?formatText("{0} fichier(s). Espace utilisé : {1} sur {2}.",cloudRows.length,fmt(result.store.used_bytes/1e6,tr(' Mo')),fmt(result.store.total_bytes/1e6,tr(' Mo'))):formatText("{0} élément(s) dans {1}.",fileRows.length,result.path));
 }catch(e){if(generation===fileGeneration&&currentFileContext(context)){fileContext=null;renderFiles();message(e.message,true);set('files-state',tr('Liste indisponible.'));}}
 finally{filePending=false;if(fileReload){fileReload=false;void loadFiles();}}
}
document.querySelectorAll('[data-source]').forEach(b=>b.onclick=()=>{source=b.dataset.source;cloudPage=1;fileRows=null;document.querySelectorAll('[data-source]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));$('file-path').disabled=source==='cloud';$('parent-folder').disabled=source==='cloud';renderFiles();loadFiles();});$('files-form').onsubmit=e=>{e.preventDefault();loadFiles();};$('parent-folder').onclick=()=>{const parts=$('file-path').value.split('/').filter(Boolean);parts.pop();$('file-path').value='/'+parts.join('/');loadFiles();};$('prev-page').onclick=()=>{cloudPage=Math.max(1,cloudPage-1);loadFiles();};$('next-page').onclick=()=>{cloudPage++;loadFiles();};
$('upload-form').onsubmit=async e=>{e.preventDefault();if(busy)return;const data=new FormData(e.target),file=data.get('file');if(file.size>100*1024*1024){message(tr('Le fichier dépasse 100 Mo.'),true);return;}try{data.set('slots',JSON.stringify(slots(data.get('slots'))));}catch(err){message(err.message,true);return;}if(!await confirmAction(formatText(data.get('mode')==='upload'?tr('Envoyer « {0} » dans votre espace cloud ?'):tr('Envoyer « {0} » et lancer son impression ?'),file.name)))return;const chosen=e.target.elements.file.files[0],intent=JSON.stringify([data.get('mode'),data.get('slots'),selectedPrinter]);if(!uploadAttempt||uploadAttempt.file!==chosen||uploadAttempt.intent!==intent)uploadAttempt={file:chosen,intent,id:crypto.randomUUID()};data.set('request_id',uploadAttempt.id);setBusy(true);set('upload-state',tr('Envoi en cours. Ne fermez pas cette page.'));try{const result=await request('/upload',{method:'POST',body:data,timeoutMs:Math.min(7200000,300000+file.size/32768*2000)});uploadAttempt=null;set('upload-state',result.message);message(result.message);}catch(err){set('upload-state',err.message);message(err.message,true);}finally{setBusy(false);}};
/** Agrandit l’image déjà chargée sans une nouvelle requête à l’imprimante. */
function openFilePreview(name,src){
 const dialog=node('dialog',null,'file-preview-dialog'),title=node('h2',name),img=node('img'),close=node('button',tr('Fermer'));
 img.src=src;img.alt=tr('Aperçu de ')+name;img.style.width='100%';
 close.type='button';close.onclick=()=>dialog.close();
 dialog.onclose=()=>dialog.remove();
 const header=node('div',null,'dialog-top');header.append(title,close);
 dialog.append(header,img);document.body.append(dialog);dialog.showModal();
}
/** Renvoie une promesse partagée de chargement du lecteur Agora local ; rejette si le script est indisponible. */
function loadSdk(){if(!sdkPromise)sdkPromise=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='/imprimante-api/ui/js/agora-rtc.js';s.onload=()=>resolve(window.AgoraRTC);s.onerror=()=>reject(new Error(tr('Le lecteur vidéo n’a pas pu être chargé.')));document.head.append(s);});return sdkPromise;}
/** Ferme la session vidéo et invalide les ouvertures en cours par changement de génération. */
async function closeCamera(){const viewer=cameraViewer;cameraViewer=null;if(viewer){void request('/camera-close',{method:'POST',printerKey:viewer.printer,keepalive:true,headers:{'X-Camera-Viewer':viewer.id}}).catch(()=>{});}cameraWanted=false;cameraGeneration++;$('camera-start').disabled=false;$('camera-stop').disabled=true;cameraTrack?.stop();cameraTrack=null;if(client){const old=client;client=null;try{await old.leave();}catch{}}$('camera-video').replaceChildren();set('camera-state',tr('Caméra éteinte'));}
/** Ouvre la vidéo Agora avec les paramètres constructeur ; abandonne une réponse devenue obsolète après fermeture. */
async function openCamera(){let generation;try{await closeCamera();/* Une fermeture pendant la connexion rend sa réponse tardive inutilisable. */generation=++cameraGeneration;cameraWanted=true;$('camera-start').disabled=true;$('camera-stop').disabled=false;set('camera-state',tr('Connexion en cours…'));delete $('camera-state').dataset.tooltip;const sdk=await loadSdk();if(generation!==cameraGeneration)return;sdk.setLogLevel(3);const viewer={id:crypto.randomUUID(),printer:selectedPrinter};cameraViewer=viewer;const cameraOptions={method:'POST',printerKey:viewer.printer,headers:{'X-Camera-Viewer':viewer.id}};const session=await request('/camera-session',cameraOptions);if(generation!==cameraGeneration){void request('/camera-close',{...cameraOptions,keepalive:true}).catch(()=>{});return;}client=sdk.createClient({mode:'live',codec:'h264',role:'host'});const mine=client;const subscribe=async user=>{await mine.subscribe(user,'video');cameraTrack=user.videoTrack;cameraTrack.play('camera-video');set('camera-state',tr('Caméra connectée'));};mine.on('user-published',(u,type)=>{if(type==='video')subscribe(u).catch(()=>set('camera-state',tr('Flux vidéo indisponible')));});mine.on('user-unpublished',()=>set('camera-state',tr('Flux vidéo interrompu')));mine.on('user-left',()=>set('camera-state',tr('Caméra déconnectée')));mine.on('token-privilege-will-expire',async()=>{try{if(generation!==cameraGeneration)return;const s=await request('/camera-session',cameraOptions);await mine.renewToken(s.rtc_token);}catch{set('camera-state',tr('Session caméra expirée'));}});const salt=Uint8Array.from(atob(session.encryption_kdf_salt),c=>c.charCodeAt(0));const modes={'aes-128-gcm2':'aes-128-gcm2','aes-256-gcm2':'aes-256-gcm2'};mine.setEncryptionConfig(String(session.encryption_mode).toLowerCase().replaceAll('_','-'),session.encryption_key,salt);await mine.setClientRole('host');await mine.join(session.appid,session.channel,session.rtc_token||null,session.client_uid||null);if(generation!==cameraGeneration){await mine.leave();return;}await Promise.all(mine.remoteUsers.filter(u=>u.hasVideo).map(subscribe));set('camera-state',cameraTrack?tr('Caméra connectée'):tr('En attente de la vidéo'));}catch(e){if(generation!==cameraGeneration)return;await closeCamera();const known=['missing_credentials','invalid_format','unsupported_transport'].includes(e.cameraReason);set('camera-state',known?e.message:tr('Caméra indisponible'));$('camera-state').dataset.tooltip=known?e.message:tr('La session vidéo ne peut pas être ouverte pour le moment.');}}
$('camera-start').onclick=openCamera;$('camera-stop').onclick=closeCamera;
/** Applique un zoom d’affichage à la vidéo ; ne modifie aucun réglage de la caméra physique. */
function renderZoom(){$('camera-video').style.transform=`scale(${zoom})`;set('zoom-label',`${Math.round(zoom*100)} %`);}for(const [id,change]of[['zoom-in',.25],['zoom-out',-.25]])$(id).onclick=()=>{zoom=Math.min(4,Math.max(1,zoom+change));renderZoom();};$('zoom-reset').onclick=()=>{zoom=1;renderZoom();};$('fullscreen').onclick=()=>{if(document.fullscreenElement)document.exitFullscreen();else $('camera-wrapper').requestFullscreen();};
for(const [id,enabled] of [['light-on',true],['light-off',false],['control-light-on',true],['control-light-off',false]]){
 const feedback=id.startsWith('control-')?controlFeedback:undefined;
 $(id).onclick=()=>{
  feedback?.('');
  void command('light',{enabled,light_type:3},tr(enabled?'Allumer l’éclairage de l’imprimante ?':'Éteindre l’éclairage de l’imprimante ?'),feedback);
 };
}

let historyPage=1,historyPending=false,noticeRows=[],noticeFilter='all',noticeMore=false,noticeSignature='';
/** Charge une page de notifications du compte, en empêchant deux lectures simultanées. */
async function loadHistory(force=false){if(historyPending)return;historyPending=true;try{const d=!force&&historyPage===1&&snapshot?.notifications?snapshot.notifications:await request(`/history?page=${historyPage}`);noticeRows=historyPage===1?d.items:[...new Map([...noticeRows,...d.items].map(x=>[x.key,x])).values()];noticeMore=d.has_more;updateNoticeCount(d.unread);renderNotifications();}catch(e){set('history-state',e.message);}finally{historyPending=false;}}
/** Conserve le compteur reçu par le statut, sans ajouter un intervalle de requêtes. */
function updateNoticeCount(count){const unread=Number(count)||0;$('notifications-dot').hidden=!unread;$('notifications-filter-dot').hidden=!unread;set('notifications-title',formatText("Messages ({0})",unread));$('notifications-toggle').setAttribute('aria-label',formatText("Notifications : {0} message{1} non lu{2}",unread,unread>1?'s':'',unread>1?'s':''));$('history-read-all').disabled=!unread;}
/** Filtre les messages chargés ; les noms du cloud restent du texte et les aperçus sont différés. */
function renderNotifications(){
 notificationPreviewObserver.disconnect();
 const query=$('notification-search').value.trim().toLocaleLowerCase(locale);
 const rows=noticeRows.filter(x=>(noticeFilter==='all'||(noticeFilter==='unread')===!!x.unread)&&x.name.toLocaleLowerCase(locale).includes(query));
 const groups=new Map(),list=$('history-list');
 const expanded=new Set([...list.querySelectorAll('details[open]')].map(item=>item.dataset.group));
 list.replaceChildren();
 for(const item of rows){
  const key=item.group||item.key;
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(item);
 }
 for(const [key,items] of groups){
  if(items.length===1){list.append(notificationRow(items[0]));continue;}
  const wrapper=node('li'),details=node('details',null,'notification-group'),events=node('ul');
  details.dataset.group=key;
  details.open=expanded.has(key);
  details.append(node('summary',formatText("{0} · {1} · {2} événements",items[0].name,serverText(items[0].reason||items[0].result,'Notification d’impression'),fmt(items.length))),events);
  events.append(...items.map(notificationRow));
  wrapper.append(details);list.append(wrapper);
 }
 set('history-state',rows.length?'':tr('Aucun message'));
 $('history-state').className=rows.length?'':'empty-message';
 $('history-state').hidden=!!rows.length;
 $('notifications-more').hidden=!noticeMore;
 $('history-delete-all').disabled=!noticeRows.length;
}
/** Chaque événement conserve sa miniature, son horodatage et ses actions individuelles. */
function notificationRow(item){
 const row=node('li',null,'notification-row'),open=node('button',null,'notification-open'),body=node('span',null,'notification-copy');
 open.type='button';
 const thumb=taskThumbnail({...item,key:'notification:'+item.key,notification:true},()=>openNotice(item));
 thumb.tabIndex=-1;row.append(thumb);
 body.append(node('strong',item.name,'notification-name'),node('span',item.printer,'muted'),node('span',`${item.kind==='success'?'✓':item.kind==='interrupted'?'■':'◷'} ${tr(item.result)}`,'notification-result '+item.kind));
 if(item.reason||item.reason_code)body.append(node('span',[item.reason&&serverText(item.reason,'Pas de diagnostic traduit pour cet événement.'),item.reason_code&&tr('Code')+' '+item.reason_code].filter(Boolean).join(' · '),'muted'));
 body.append(node('time',date(item.time),'muted'));
 open.append(body);
 if(item.unread){const dot=node('span',null,'unread-dot');dot.setAttribute('aria-label',tr('Non lu'));open.append(dot);}
 open.onclick=()=>openNotice(item);row.append(open);
 const remove=node('button','×','notification-delete');
 remove.type='button';remove.setAttribute('aria-label',tr('Supprimer la notification : ')+item.name);
 remove.title=tr('Supprimer cette notification');remove.onclick=()=>deleteHistory(item.key,false,remove);
 row.append(remove);return row;
}
/** Le marquage est confirmé avant le détail ; aucune impression n’est déclenchée. */
async function openNotice(item){try{if(item.unread){await request('/history/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:item.key})});item.unread=false;updateNoticeCount(Math.max(0,Number($('notifications-title').textContent.match(/\d+/)?.[0]||0)-1));renderNotifications();}await openNotificationPreview(item);}catch(e){message(e.message,true);}}
/** Ferme le panneau et restitue le clavier à la cloche sur Échap. */
function noticePanel(open,focus=false){$('notifications-panel').hidden=!open;$('notifications-toggle').setAttribute('aria-expanded',String(open));if(open){historyPage=1;void loadHistory();}else if(focus)$('notifications-toggle').focus();}
$('notifications-toggle').onclick=()=>noticePanel($('notifications-panel').hidden);
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!document.querySelector('dialog[open]')&&!$('notifications-panel').hidden){event.preventDefault();noticePanel(false,true);}});
document.addEventListener('pointerdown',event=>{if(!document.querySelector('dialog[open]')&&!$('notifications-panel').hidden&&!event.target.closest('.notifications'))noticePanel(false);});
for(const button of document.querySelectorAll('[data-notice-filter]'))button.onclick=()=>{noticeFilter=button.dataset.noticeFilter;document.querySelectorAll('[data-notice-filter]').forEach(x=>x.setAttribute('aria-pressed',String(x===button)));renderNotifications();};
$('notification-search').oninput=renderNotifications;$('notifications-more').onclick=()=>{historyPage++;void loadHistory(true);};

$('temperature-hours').onchange=()=>loadTemperatures();setInterval(()=>{if(currentTab==='overview')loadTemperatures();},30000);void loadTemperatures();

/** Marque une notification ou toutes comme lues ; allItems exige une confirmation puis rafraîchit le journal. */
async function markHistoryRead(key,allItems,button){button.disabled=true;try{const result=await request('/history/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(allItems?{all:true}:{key})});message(result.message);historyPage=1;await loadHistory(true);}catch(e){message(e.message,true);button.disabled=false;}}

$('history-read-all').onclick=()=>markHistoryRead(null,true,$('history-read-all'));
$('history-delete-all').onclick=()=>deleteHistory(null,true,$('history-delete-all'));

const helpById={'camera-start':tr('Démarrer la vidéo en direct de l’imprimante.'),'camera-stop':tr('Fermer la vidéo sans interrompre l’impression.'),'light-on':tr('Allumer l’éclairage intérieur de l’imprimante.'),'light-off':tr('Éteindre l’éclairage intérieur de l’imprimante.'),'zoom-reset':tr('Revenir au zoom initial de la vidéo.'),'fullscreen':tr('Afficher la vidéo en plein écran.'),'go-spool':tr('Choisir un emplacement, son matériau et sa couleur.'),'go-drying':tr('Configurer la température et la durée de séchage de l’ACE.'),'feed':tr('Charger le filament de l’emplacement sélectionné.'),'feed-finish':tr('Valider la fin du chargement après la sortie du filament.'),'retract':tr('Retirer le filament de l’emplacement sélectionné.'),'parent-folder':tr('Remonter d’un niveau dans les fichiers de l’imprimante.'),'history-read-all':tr('Synchroniser toutes les notifications comme lues dans Anycubic.'),'temperature-hours':tr('Choisir la période affichée, parmi les relevés des dernières 24 heures.'),'file-slots':tr('Un numéro d’emplacement de l’ACE par couleur du G-code, dans l’ordre. Laissez vide pour utiliser la bobine externe.')};for(const [id,help]of Object.entries(helpById))if($(id))$(id).title=help;
const commandHelp={pause:tr('Mettre l’impression en cours en pause.'),resume:tr('Reprendre une impression qui est en pause.'),cancel:tr('Arrêter l’impression en cours après confirmation.'),firmware:tr('Installer une nouvelle version lorsque l’imprimante est libre.'),'ace-firmware':tr('Mettre à jour l’ACE lorsque l’imprimante est libre.')};for(const b of document.querySelectorAll('[data-command]'))if(commandHelp[b.dataset.command])b.title=commandHelp[b.dataset.command];
const fieldHelp={target_nozzle_temp:tr('Température cible de la buse, entre 0 et 320 °C.'),target_hotbed_temp:tr('Température cible du plateau, entre 0 et 120 °C.'),fan_speed_pct:tr('Ventilation de la pièce, entre 0 et 100 %. '),aux_fan_speed_pct:tr('Ventilateur auxiliaire, entre 0 et 100 %. '),box_fan_level:tr('Niveau de ventilation de l’enceinte accepté par Anycubic, de 0 à 3.'),print_speed_mode:tr('Mode de vitesse appliqué à l’impression en cours.'),slots:tr('Numéros des bobines de l’ACE, dans l’ordre des couleurs du G-code.'),mode:tr('Choisir entre conserver le fichier dans le cloud et lancer son impression.')};for(const e of document.querySelectorAll('input[name],select[name]'))if(fieldHelp[e.name])e.title=fieldHelp[e.name];

/** Préremplit la bobine sélectionnée ; les valeurs RFID restent consultables sans modification manuelle. */
function fillSpool(slot){const form=$('spool-form'),data=selectedBox()?.spools?.find(s=>Number(s.local_slot||s.slot)===Number(slot));if(!data)return;form.elements.slot.value=String(slot);const material=form.elements.material;for(const option of [...material.options])if(option.dataset.detected)option.remove();if(data.material_type&&![...material.options].some(o=>o.value===data.material_type)){const option=new Option(data.material_type+tr(' (détecté)'),data.material_type);option.dataset.detected='true';option.disabled=true;material.add(option);}material.value=data.material_type||'PLA';form.elements.color.value='#'+(data.color||[150,150,150]).slice(0,3).map(v=>Math.max(0,Math.min(255,Number(v)||0)).toString(16).padStart(2,'0')).join('');set('spool-color-value',form.elements.color.value.toUpperCase());/* Les données RFID sont la référence de l’ACE et ne doivent pas être remplacées par le formulaire. */const automatic=data.rfid===true;form.elements.material.disabled=automatic;form.elements.color.disabled=automatic;form.querySelector('[type=submit]').hidden=automatic;set('spool-rfid-note',automatic?tr('Bobine RFID · matière et couleur détectées.'):'');$('spool-rfid-note').hidden=!automatic;}
/** Ouvre les données du numéro local de bobine et place le focus sur sa sélection. */
function openSpool(slot){fillSpool(slot);if(!$('spool-dialog').open)$('spool-dialog').showModal();$('spool-form').elements.slot.focus({preventScroll:true});}
$('spool-form').elements.slot.onchange=e=>fillSpool(e.target.value);
/** Distingue un simple stockage cloud d’un lancement d’impression, bloqué si la machine est occupée. */
function updateUploadButton(){const form=$('upload-form'),printing=form.elements.mode.value!=='upload',button=form.querySelector('[type=submit]');button.textContent=printing?tr('Envoyer et imprimer'):tr('Envoyer');button.disabled=printing&&snapshot?.printer?.is_available===false;button.title=button.disabled?tr('Une impression est déjà en cours.'):printing?tr('Envoyer le G-code et demander son impression après confirmation.'):tr('Conserver le G-code dans votre espace cloud sans lancer d’impression.');}
$('upload-form').elements.mode.onchange=()=>updateUploadButton();

const helpBubble=node('div',null,'help-bubble');helpBubble.id='ui-help-bubble';helpBubble.setAttribute('role','tooltip');helpBubble.hidden=true;document.body.append(helpBubble);let helpTarget=null,helpPinned=false;
/** Ferme l’aide et restaure les autres associations accessibles de l’élément ciblé. */
function hideHelp(){if(helpTarget){const previous=helpTarget.getAttribute('aria-describedby')||'';const cleaned=previous.split(' ').filter(x=>x!=='ui-help-bubble').join(' ');if(cleaned)helpTarget.setAttribute('aria-describedby',cleaned);else helpTarget.removeAttribute('aria-describedby');}helpTarget=null;helpPinned=false;helpBubble.hidden=true;}
/** Affiche une aide textuelle dans le dialogue actif ; pinned la maintient jusqu’à une fermeture explicite. */
function showHelp(target,pinned=false){const text=target.dataset.tooltip||target.getAttribute('title');if(!text)return;if(target.hasAttribute('title')){target.dataset.tooltip=text;target.removeAttribute('title');}if(helpTarget!==target)hideHelp();helpTarget=target;helpPinned=pinned;const parent=target.closest('dialog')||document.body;if(helpBubble.parentElement!==parent)parent.append(helpBubble);helpBubble.textContent=text;helpBubble.hidden=false;target.setAttribute('aria-describedby','ui-help-bubble');const r=target.getBoundingClientRect(),b=helpBubble.getBoundingClientRect();helpBubble.style.left=Math.max(10,Math.min(innerWidth-b.width-10,r.left+r.width/2-b.width/2))+'px';helpBubble.style.top=(r.top>=b.height+12?r.top-b.height-9:Math.min(innerHeight-b.height-8,r.bottom+9))+'px';}
document.addEventListener('pointerover',e=>{const target=e.target.closest('[title],[data-tooltip]');if(target&&!helpPinned)showHelp(target);});document.addEventListener('pointerout',e=>{if(!helpPinned&&helpTarget&&!helpTarget.contains(e.relatedTarget))hideHelp();});document.addEventListener('focusin',e=>{if(e.target.matches('[title],[data-tooltip]'))showHelp(e.target);});document.addEventListener('focusout',()=>{if(!helpPinned)hideHelp();});document.addEventListener('click',e=>{const help=e.target.closest('[data-tooltip-trigger]');if(help){e.preventDefault();showHelp(help,true);}else if(helpPinned&&!helpBubble.contains(e.target))hideHelp();});document.addEventListener('keydown',e=>{if(e.key==='Escape')hideHelp();});document.addEventListener('scroll',()=>{if(helpTarget)hideHelp();},true);

/** Conditionne axes et IA aux capacités annoncées et à une imprimante disponible. */
function updateNativeControls(p){const canMove=!!p.axes_supported&&p.is_available&&!p.job_in_progress;for(const button of document.querySelectorAll('[data-axis],#axis-release,#axis-step'))button.disabled=!canMove;set('axis-state',!p.axes_supported?tr('Contrôle non annoncé par cette imprimante'):p.job_in_progress?tr('Indisponible pendant une impression'):canMove?tr('Commandes disponibles'):tr('Imprimante occupée ou hors ligne'));$('task-details-open').disabled=!p.task_details;$('ai-open').disabled=!p.printer_online||!p.is_available||p.job_in_progress;$('ai-open').dataset.tooltip=$('ai-open').disabled?tr('Réglages disponibles lorsque l’imprimante est libre.'):tr('Régler la détection du filament enchevêtré et des objets étrangers.');if($('task-dialog').open)renderTaskDetails();if($('ai-dialog').open&&aiLoaded){$('ai-form').querySelector('fieldset').disabled=!p.is_available||p.job_in_progress;}}
/** Renvoie le premier élément d’une liste ou la valeur scalaire, pour les paramètres de tranche multimatériaux. */
function single(v){return Array.isArray(v)?v[0]:v;}
/** Formate un paramètre scalaire ou son premier matériau, sans doubler une unité déjà présente. */
function valueUnit(v,unit=''){v=single(v);return v==null?'—':typeof v==='number'?v.toLocaleString(locale,{maximumFractionDigits:3})+unit:String(v)+(unit&&!String(v).includes(unit.trim())?unit:'');}
/** Affiche uniquement les paramètres de tranche transmis par le serveur et les données connues du projet courant. */
function renderTaskDetails(){const p=snapshot?.printer,d=p?.task_details;if(!d)return;set('task-name',p.job_name||tr('Tâche en cours'));set('task-progress',formatText("{0} · {1} / {2} couches · {3} restantes",fmt(p.job_progress,' %'),p.job_current_layer??'—',p.job_total_layers??'—',mins(p.job_time_remaining)));if(!$('job-preview').hidden){$('task-preview').src=$('job-preview').src;$('task-preview').hidden=false;}else $('task-preview').hidden=true;const params=d.parameters||{},time=d.estimated_time?String(d.estimated_time).replace(/(\d+)h/g,'$1 h ').replace(/(\d+)m/g,'$1 min ').replace(/(\d+)s/g,'$1 s').replace(/\s+/g,' ').trim():'—';definition('task-file',[[tr('Dimensions'),d.dimensions?.every(v=>v!=null)?d.dimensions.map(v=>fmt(v)).join(' × ')+' mm':'—'],[tr('Couches'),fmt(d.layers)],[tr('Temps estimé'),time],[tr('Filament estimé'),fmt(d.material_grams,' g')]]);const yes=v=>v==null?'—':[true,1,'1','true'].includes(single(v))?tr('Activé'):tr('Désactivé');definition('task-parameters',[[tr('Hauteur de couche'),valueUnit(params.layer_height,' mm')],['Remplissage',valueUnit(params.fill_density,' %')],['Supports',yes(params.enable_support)],[tr('Adhérence au plateau'),params.brim_type==null?'—':({no_brim:tr('Sans bordure'),auto_brim:'Automatique',outer_only:tr('Bordure externe'),inner_only:tr('Bordure interne'),outer_and_inner:tr('Bordures interne et externe')}[params.brim_type]||tr('Activée'))],[tr('Buse'),valueUnit(params.temperature,' °C')],[tr('Plateau'),valueUnit(params.bed_temperature,' °C')],[tr('Ventilation maximale'),valueUnit(params.fan_max_speed,' %')],[tr('Rétraction'),valueUnit(params.filament_retract_length,' mm')],['Parois',valueUnit(params.perimeters)],[tr('Largeur de paroi'),valueUnit(params.perimeter_extrusion_width,' mm')],[tr('Vitesse de paroi externe'),valueUnit(params.outer_wall_speed,' mm/s')],[tr('Déplacements'),valueUnit(params.travel_speed,' mm/s')]]);}
$('task-details-open').onclick=()=>{renderTaskDetails();$('task-dialog').showModal();};
let aiLoaded=false;
let aiLoading=false;
/** Masque les anciennes valeurs pendant la consultation IA pour éviter d’appliquer des réglages périmés. */
async function loadAiSettings(){
 if(aiLoading)return;aiLoading=true;aiLoaded=false;const f=$('ai-form');f.hidden=true;f.querySelector('fieldset').disabled=true;$('ai-retry').hidden=true;set('ai-state',tr('Lecture des réglages de l’imprimante…'));
 try{const d=await request('/ai-settings'),a=d.settings,status=Number(a.status);f.elements.spaghetti.checked=!!(status&1);f.elements.foreign.checked=!!(status&2);f.elements.spaghetti_level.value=String(a.sensitivity_level?.[1]??1);f.elements.foreign_level.value=String(a.sensitivity_level?.[0]??1);f.elements.pause.value=String(a.notice_type?.[1]===1);$('ai-foreign-option').hidden=!snapshot?.printer?.foreign_detection_supported;aiLoaded=true;const busy=snapshot?.printer?.job_in_progress||!snapshot?.printer?.is_available;f.hidden=false;f.querySelector('fieldset').disabled=busy;set('ai-state',busy?tr('Imprimante occupée. Les modifications seront disponibles lorsqu’elle sera libre.'):tr('Réglages actuels de la Kobra S1'));}catch(e){set('ai-state',tr('Réglages indisponibles : ')+e.message+tr('. Réessayez lorsque l’imprimante est en ligne et libre.'));$('ai-retry').hidden=false;}finally{aiLoading=false;}
}
$('ai-open').onclick=()=>{$('ai-dialog').showModal();loadAiSettings();};
$('ai-retry').onclick=loadAiSettings;
$('ai-form').onsubmit=async e=>{e.preventDefault();if(!aiLoaded)return;const f=e.target,result=await command('ai-settings',{spaghetti:f.elements.spaghetti.checked,foreign:f.elements.foreign.checked,spaghetti_level:Number(f.elements.spaghetti_level.value),foreign_level:Number(f.elements.foreign_level.value),pause:f.elements.pause.value==='true'},tr('Appliquer ces réglages de détection IA à la Kobra S1 ?'));if(result)$('ai-dialog').close();};
for(const b of document.querySelectorAll('[data-axis]'))b.onclick=async()=>{if(b.disabled)return;if(!cameraTrack){await openCamera();if(!cameraTrack){message(tr('Ouvrez la caméra avant de déplacer les axes.'),true);return;}}await command('axis',{axis:Number(b.dataset.axis),direction:Number(b.dataset.direction),distance:Number($('axis-step').value)},tr('Déplacer les axes de l’imprimante avec ces paramètres ?'));};
$('axis-release').onclick=()=>command('axis-off',{},tr('Libérer les moteurs de l’imprimante pour un déplacement manuel ?'));
/** La suppression vise uniquement les notifications ; elle ne remplace pas celle des fiches d’impression. */
async function deleteHistory(key,allItems,button){if(!await confirmAction(allItems?tr('Effacer définitivement les notifications d’impression du compte Anycubic ?'):tr('Effacer définitivement cette notification Anycubic ?')))return;button.disabled=true;try{const result=await request('/history/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(allItems?{all:true}:{key})});message(result.message);historyPage=1;await loadHistory(true);}catch(e){message(e.message,true);button.disabled=false;}finally{if(button.id!=='history-delete-all')button.disabled=false;}}

const taskPreviewCache=new Map();
/** Renvoie une promesse d’image mise en cache ; sépare les références de notifications de celles des tâches. */
function taskPreview(t){
 const cached=taskPreviewCache.get(t.key);
 if(cached&&cached.expires>Date.now())return cached.pending;
 const entry={expires:Infinity};
 entry.pending=request('/extras/'+(t.notification?'notification-preview':'task-preview')+'?key='+encodeURIComponent(t.notification?t.key.slice(13):t.key))
  .then(data=>data.image||null)
  .catch(()=>null)
  .then(src=>{entry.expires=Date.now()+(src?300000:30000);return src;});
 taskPreviewCache.set(t.key,entry);
 while(taskPreviewCache.size>40)taskPreviewCache.delete(taskPreviewCache.keys().next().value);
 return entry.pending;
}
/** Ouvre l’aperçu d’une notification et ignore la réponse si son dialogue a changé entre-temps. */
async function openNotificationPreview(item){
 const dialog=$('notification-preview-dialog'),image=$('notification-preview-image'),open=$('notification-task-open');
 const task=item.task_key&&taskRows.find(row=>row.key===item.task_key);
 open.hidden=!task;
 open.onclick=task?()=>{dialog.close();void openPastTask(task);}:null;
 dialog.dataset.notification=item.key;
 set('notification-preview-name',item.name);
 set('notification-preview-state',tr('Chargement de l’aperçu…'));
 image.hidden=true;
 dialog.showModal();
 const src=await taskPreview({...item,key:'notification:'+item.key,notification:true});
 if(!dialog.open||dialog.dataset.notification!==item.key)return;
 const unavailable=()=>set('notification-preview-state',tr('Aperçu indisponible pour cette notification.'));
 if(!src){unavailable();return;}
 image.src=src;
 try{await image.decode();}catch{
  if(dialog.open&&dialog.dataset.notification===item.key)unavailable();
  return;
 }
 if(dialog.open&&dialog.dataset.notification===item.key){image.hidden=false;set('notification-preview-state',tr(item.result));}
}
/** Chaque liste possède son observateur pour que le rafraîchissement de l’historique préserve les notifications. */
function previewObserver(){
 return new IntersectionObserver((entries,observer)=>{
  for(const entry of entries){
   if(!entry.isIntersecting)continue;
   observer.unobserve(entry.target);
   entry.target.loadPreview();
  }
 },{rootMargin:'100px'});
}
const taskPreviewObserver=previewObserver(),notificationPreviewObserver=previewObserver();
/** Renvoie un bouton dont l’image est chargée près de la zone visible ; onOpen remplace l’ouverture des détails. */
function taskThumbnail(t,onOpen=()=>openPastTask(t)){
 const button=node('button',null,'task-thumbnail'),image=node('img'),fallback=node('span',tr('Aperçu indisponible'));
 button.type='button';button.title=tr('Voir les détails de ')+t.name;button.setAttribute('aria-label',button.title);button.onclick=onOpen;image.alt=tr('Aperçu de ')+t.name;image.hidden=true;fallback.textContent=tr('Chargement…');button.append(image,fallback);
 button.loadPreview=()=>taskPreview(t).then(src=>{/* La page de résultats peut avoir changé avant la fin du téléchargement. */if(!button.isConnected)return;if(src){image.onload=()=>{image.hidden=false;fallback.hidden=true;};image.onerror=()=>{image.hidden=true;fallback.hidden=false;fallback.textContent=tr('Aperçu indisponible');};image.src=src;}else fallback.textContent=tr('Aperçu indisponible');});
 (t.notification?notificationPreviewObserver:taskPreviewObserver).observe(button);return button;
}
const cloudSelected=new Set();let renameHandle=null,pastTaskKey=null,tasksPage=1,taskRows=[],deviceOptions=null,resetTicket=null,resetDeadline=0,historyView='tasks';
/** Formate le quota en unités binaires, en préservant la distinction entre zéro et une donnée absente. */
const bytes=v=>v==null?'—':Number(v)>=1073741824?(Number(v)/1073741824).toLocaleString(locale,{maximumFractionDigits:2})+tr(' Go'):Number(v)>=1048576?(Number(v)/1048576).toLocaleString(locale,{maximumFractionDigits:1})+tr(' Mo'):Number(v).toLocaleString(locale)+tr(' octets');
/** Renvoie un bouton non soumis à un formulaire, associé au rappel fn. */
function extraButton(label,fn,cls){const b=node('button',label,cls);b.type='button';b.onclick=fn;return b;}
/** Synchronise la sélection cloud et l’état indéterminé de la case de page. */
function cloudSelectionState(){const n=cloudSelected.size;set('cloud-selected-count',formatText("{0} sélection{1}",n,n>1?'s':''));for(const id of ['cloud-download-selected','cloud-delete-selected','cloud-clear-selection'])$(id).disabled=!n;$('cloud-select-page').checked=cloudRows.length>0&&cloudRows.every(f=>cloudSelected.has(f.handle));$('cloud-select-page').indeterminate=cloudRows.some(f=>cloudSelected.has(f.handle))&&!$('cloud-select-page').checked;}
/** Affiche le quota connu du cloud, sans déduire une capacité d’envoi d’une valeur absente. */
async function loadCloudStorage(){try{const d=await request('/extras/storage');set('cloud-quota',formatText("{0} utilisés sur {1} · {2} disponibles",bytes(d.used),bytes(d.total),bytes(d.free)));$('cloud-quota-bar').value=d.total?Math.min(100,d.used/d.total*100):0;}catch(e){set('cloud-quota',e.message);}}
/** Demande des tickets de téléchargement serveur afin de garder les URL cloud privées côté navigateur. */
async function downloadCloud(handles){try{const result=await request('/cloud/downloads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({handles})});$('cloud-download-links').replaceChildren(...result.downloads.map(f=>{const li=node('li'),a=node('a',f.name);a.href=f.url;a.target='_blank';a.rel='noopener noreferrer';li.append(a);return li;}));$('cloud-download-dialog').showModal();}catch(e){message(e.message,true);}}
/** Prépare le renommage de la référence opaque du fichier, sans envoyer de requête avant validation. */
function renameCloud(f){renameHandle=f.handle;$('cloud-rename-form').elements.name.value=f.name;$('cloud-rename-dialog').showModal();$('cloud-rename-form').elements.name.focus();}
$('cloud-rename-form').onsubmit=async e=>{e.preventDefault();const result=await command('cloud-rename',{handle:renameHandle,name:e.target.elements.name.value});if(result){$('cloud-rename-dialog').close();cloudSelected.clear();await loadFiles();}};
$('cloud-select-page').onchange=e=>{for(const f of cloudRows)e.target.checked?cloudSelected.add(f.handle):cloudSelected.delete(f.handle);renderFiles();};
$('cloud-clear-selection').onclick=()=>{cloudSelected.clear();renderFiles();};
$('cloud-download-selected').onclick=()=>downloadCloud([...cloudSelected]);
$('cloud-delete-selected').onclick=async()=>{const ok=await command('cloud-delete-many',{handles:[...cloudSelected]},formatText("Supprimer définitivement les {0} fichiers sélectionnés du Cloud Anycubic ?",cloudSelected.size));if(ok){cloudSelected.clear();await loadFiles();await loadCloudStorage();}};
let taskStatus='all',taskMore=false;const taskSelected=new Set();
/** Les bornes de date suivent le fuseau de l’atelier, y compris pour les dates cloud en secondes. */
function taskDay(value){if(value==null||value==='')return '';const n=Number(value),d=Number.isFinite(n)?new Date(n*1000):new Date(value);return Number.isNaN(d.getTime())?'':new Intl.DateTimeFormat('sv-SE',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(d);}
$('tasks-to').value=taskDay(Date.now()/1000);
// Soustrait des jours calendaires à la date affichée, indépendamment des changements d’heure.
const historyStart=new Date($('tasks-to').value);
historyStart.setUTCDate(historyStart.getUTCDate()-89);
$('tasks-from').value=historyStart.toISOString().slice(0,10);
/** Les filtres combinés portent sur les pages déjà chargées ; une page suivante ne remplace pas la sélection. */
function visibleTasks(){const query=$('tasks-search').value.trim().toLocaleLowerCase(locale),device=$('tasks-printer').value,from=$('tasks-from').value,to=$('tasks-to').value;return taskRows.filter(t=>{const day=taskDay(t.start);return(taskStatus==='all'||String(t.status_code)===taskStatus)&&(device==='all'||t.printer_key===device)&&(!from||day>=from)&&(!to||day<=to)&&t.name.toLocaleLowerCase(locale).includes(query);});}
/** La case globale ne sélectionne que les cartes visibles, jamais des fiches non chargées. */
function taskSelectionState(){const rows=visibleTasks(),n=taskSelected.size;set('tasks-selected-count',formatText("{0} sélection{1}",n,n>1?'s':''));$('tasks-delete').disabled=!n;$('tasks-select-page').checked=!!rows.length&&rows.every(t=>taskSelected.has(t.key));$('tasks-select-page').indeterminate=rows.some(t=>taskSelected.has(t.key))&&!$('tasks-select-page').checked;}
/** Les cartes affichent les dates connues sans fabriquer une fin ni une durée manquante. */
export function renderTasks(){taskPreviewObserver.disconnect();const rows=visibleTasks();$('tasks-list').replaceChildren(...rows.map(t=>{const li=node('li',null,'task-history-item'),select=node('input'),label=node('label',null,'history-card-select'),body=node('div',null,'history-card-body'),name=node('strong',t.name,'history-card-name'),state=node('span',({2:tr('Terminé'),3:tr('Arrêté'),1:tr('En cours'),0:tr('En préparation')}[t.status_code]||t.status),'history-badge status-'+t.status_code),open=extraButton(tr('Voir le détail'),()=>openPastTask(t),'history-detail');select.type='checkbox';select.checked=taskSelected.has(t.key);select.setAttribute('aria-label',tr('Sélectionner ')+t.name);select.onchange=()=>{select.checked?taskSelected.add(t.key):taskSelected.delete(t.key);taskSelectionState();};label.append(select,node('span',tr('Sélectionner'),'sr-only'));name.title=t.name;body.append(name,state,node('p',t.printer||tr('Imprimante'),'muted'),node('p',tr('Début : ')+date(t.start),'muted'),node('p',tr('Fin : ')+(t.end?date(t.end):tr('Non renseignée')),'muted'),node('p',tr('Durée : ')+(t.elapsed_minutes==null?tr('Non renseignée'):Number(t.elapsed_minutes).toLocaleString(locale,{maximumFractionDigits:1})+' min'),'muted'),open);li.append(label,taskThumbnail(t),body);return li;}));set('tasks-state',rows.length?'':taskMore?tr('Aucune fiche correspondante dans les pages chargées. Chargez la suite pour poursuivre la recherche.'):tr("Aucun historique d'impression"));$('tasks-state').hidden=!!rows.length;$('tasks-state').className=rows.length?'muted':'empty-message';set('tasks-page',formatText("{0} fiche(s) chargée(s)",taskRows.length));$('tasks-next').hidden=!taskMore;taskSelectionState();}
/** Relit le cloud après mutation ; le cache d’affichage ne constitue pas une preuve de suppression. */
async function loadTasks(append=false){if(!append){tasksPage=1;taskRows=[];}set('tasks-state',tr('Chargement des impressions…'));$('tasks-state').hidden=false;try{const d=await request(`/extras/tasks?page=${tasksPage}&device=all`);taskRows=append?[...new Map([...taskRows,...d.items].map(t=>[t.key,t])).values()]:d.items;taskMore=d.has_more;const previous=$('tasks-printer').value,devices=new Map(taskRows.map(t=>[t.printer_key,t.printer]));$('tasks-printer').replaceChildren(new Option(tr('Tous les appareils'),'all'),...[...devices].filter(([k])=>k).map(([k,name])=>new Option(name||tr('Imprimante'),k)));$('tasks-printer').value=devices.has(previous)?previous:'all';if(!append)for(const key of taskSelected)if(!taskRows.some(t=>t.key===key))taskSelected.delete(key);renderTasks();}catch(e){set('tasks-state',e.message);$('tasks-state').hidden=false;}}
/** L’onglet d’historique est distinct du centre de messages de la cloche. */
function historyViewSet(){historyView='tasks';loadTasks();}
for(const button of document.querySelectorAll('[data-task-status]'))button.onclick=()=>{taskStatus=button.dataset.taskStatus;for(const b of document.querySelectorAll('[data-task-status]'))b.setAttribute('aria-pressed',String(b===button));renderTasks();};
for(const id of ['tasks-printer','tasks-from','tasks-to','tasks-search'])$(id).oninput=renderTasks;
$('tasks-select-page').onchange=e=>{for(const t of visibleTasks())e.target.checked?taskSelected.add(t.key):taskSelected.delete(t.key);taskSelectionState();};
$('tasks-next').onclick=()=>{tasksPage++;loadTasks(true);};
$('tasks-delete').onclick=async()=>{const keys=[...taskSelected],names=taskRows.filter(t=>taskSelected.has(t.key)).map(t=>'• '+t.name).join('\n');const result=await command('task-delete-many',{keys},formatText("Retirer {0} fiche(s) de l’historique ?\n{1}\nCes fiches seront aussi retirées de l’historique dans l’application Anycubic et le slicer.",keys.length,names));if(result){taskSelected.clear();await loadTasks();}};
/** Affiche détails, diagnostic et aperçu d’une tâche, sans interpréter une donnée absente comme une valeur nulle. */
async function openPastTask(t){
 const dialog=$('past-task-dialog');
 pastTaskKey=t.key;
 set('past-task-name',t.name);
 set('past-task-state',tr('Chargement des détails…'));
 set('past-task-reason','');
 $('past-task-preview').hidden=true;
 $('past-task-diagnostic').hidden=true;
 $('past-task-help').hidden=true;
 $('past-task-data').replaceChildren();
 $('past-task-parameters').replaceChildren();
 const selected=t.printer_key===selectedPrinter;
 const rate=$('past-task-rate'),reprint=$('past-task-reprint');
 rate.hidden=!selected||t.status_code!==2;
 rate.disabled=t.evaluated===true;
 reprint.hidden=!selected||!t.can_reprint;
 reprint.disabled=!snapshot?.printer?.printer_online||!snapshot.printer.is_available;
 set('past-task-actions-state',!selected?tr('Sélectionnez l’imprimante de cette fiche pour agir.'):!t.can_reprint?tr('G-code non disponible pour la réimpression.'):reprint.disabled?tr('Imprimante hors ligne ou occupée.'):'');
 rate.onclick=()=>{dialog.close();void openRating(t);};
 reprint.onclick=()=>{
  dialog.close();
  set('reprint-task-name',t.name);
  set('reprint-target',snapshot?.printer?.name||t.printer);
  const form=$('task-reprint-form');
  form.reset();
  form.elements.slots.required=!!selectedBox();
  form.elements.slots.disabled=!selectedBox();
  $('task-reprint-dialog').showModal();
 };
 dialog.showModal();
 const current=()=>dialog.open&&pastTaskKey===t.key;
 taskPreview(t).then(src=>{if(src&&current()){$('past-task-preview').src=src;$('past-task-preview').hidden=false;}});
 try{
  const d=await request('/extras/task?key='+encodeURIComponent(t.key));
  if(!current())return;
  set('past-task-state',tr(t.status));
  $('past-task-diagnostic').hidden=!(d.reason||d.reason_code||d.help_url);
  set('past-task-reason',[d.reason&&serverText(d.reason,'Pas de diagnostic traduit pour cet événement.'),d.reason_code&&tr('Code')+' '+d.reason_code].filter(Boolean).join(' · '));
  if(d.help_url){$('past-task-help').href=d.help_url;$('past-task-help').hidden=false;}
  const dims=d.dimensions,params=d.parameters||{};
  definition('past-task-data',[
   [tr('Dimensions'),dims?['length','width','height'].map(k=>fmt(dims[k])).join(' × ')+' mm':'—'],
   [tr('Couches'),fmt(d.layers)],
   [tr('Durée rapportée'),mins(d.reported_minutes)],
   [tr('Temps estimé'),d.estimated_seconds==null?'—':mins(d.estimated_seconds/60)],
   [tr('Filament estimé'),fmt(d.material_grams,' g')],
  ]);
  if(d.materials?.length){
   const details=node('details'),list=node('ul');
   details.append(node('summary',tr('Filaments estimés par matière')),list);
   for(const {material,grams,color} of d.materials){
    const row=node('li');
    if(color){
     const swatch=node('span',null,'material-color');
     swatch.style.backgroundColor=color;
     swatch.setAttribute('aria-hidden','true');
     row.append(swatch);
    }
    row.append(document.createTextNode([material||tr('Matière non renseignée'),color,fmt(grams,' g')].filter(Boolean).join(' · ')));
    list.append(row);
   }
   $('past-task-parameters').append(details);
  }
  const groups=[
   [tr('Général'),[[tr('Hauteur de couche'),'layer_height',' mm'],['Remplissage','fill_density',' %'],['Supports','enable_support'],[tr('Adhérence'),'brim_type']]],
   [tr('Températures et ventilation'),[[tr('Buse'),'temperature',' °C'],[tr('Plateau'),'bed_temperature',' °C'],[tr('Ventilation maximale'),'fan_max_speed',' %']]],
   [tr('Extrusion et parois'),[[tr('Rétraction'),'filament_retract_length',' mm'],[tr('Nombre de parois'),'perimeters'],[tr('Largeur des parois'),'perimeter_extrusion_width',' mm']]],
   ['Vitesses',[[tr('Paroi externe'),'outer_wall_speed',' mm/s'],[tr('Déplacement'),'travel_speed',' mm/s']]],
  ];
  for(const [title,fields] of groups){
   const available=fields.filter(([,key])=>params[key]!=null);
   if(!available.length)continue;
   const details=node('details'),list=node('dl',null,'task-data');
   details.append(node('summary',title),list);
   for(const [label,key,unit] of available){
    const value=params[key];
    const row=node('div');
    row.append(node('dt',label),node('dd',typeof value==='boolean'?value?tr('Oui'):tr('Non'):valueUnit(value,unit)));
    list.append(row);
   }
   $('past-task-parameters').append(details);
  }
 }catch(e){if(current())set('past-task-state',e.message);}
}
/** Vérifie l’éligibilité cloud avant d’autoriser l’envoi d’une note sur la tâche sélectionnée. */
async function openRating(t){pastTaskKey=t.key;set('rating-task-name',t.name);set('rating-state',tr('Vérification auprès d’Anycubic…'));$('rating-form').reset();$('rating-form').querySelector('fieldset').disabled=true;$('task-rating-dialog').showModal();try{const d=await request('/extras/rating?key='+encodeURIComponent(t.key));$('rating-form').querySelector('fieldset').disabled=!d.available||d.already_rated;set('rating-state',d.already_rated?tr('Cette impression est déjà évaluée'):d.available?tr('La note sera envoyée au compte Anycubic'):tr('Anycubic ne propose pas d’évaluation pour cette impression'));}catch(e){set('rating-state',e.message);}}
$('rating-form').onsubmit=async e=>{e.preventDefault();const ok=await command('task-rate',{key:pastTaskKey,stars:Number(new FormData(e.target).get('stars'))},tr('Envoyer cette note à Anycubic ?'));if(ok){$('task-rating-dialog').close();loadTasks();}};
$('task-reprint-form').onsubmit=async e=>{
 e.preventDefault();
 const form=e.currentTarget,submit=form.querySelector('[type=submit]');
 if(submit.disabled||busy)return;
 let mapping;
 try{mapping=slots(form.elements.slots.value);}catch(err){message(err.message,true);return;}
 const wording=mapping.length
  ?tr('Réimprimer « {0} » sur {1} ? Vérifiez que le plateau est libre et que les bobines correspondent aux emplacements {2}.')
  :tr('Réimprimer « {0} » sur {1} ? Vérifiez que le plateau est libre et que les bobines correspondent au fichier.');
 submit.disabled=true;
 try{
  const ok=await command('task-reprint',{key:pastTaskKey,slots:mapping},formatText(wording,$('reprint-task-name').textContent,$('reprint-target').textContent,mapping.join(', ')));
  if(ok)$('task-reprint-dialog').close();
 }finally{submit.disabled=false;}
};
let journalLoad=0;
/** Affiche la dernière lecture demandée et garde l’export cohérent avec les filtres. */
async function loadCommandJournal(){
 const generation=++journalLoad,form=$('journal-filters'),filters=new URLSearchParams(new FormData(form));
 const exportLink=$('journal-export');
 exportLink.hidden=true;set('journal-state',tr('Chargement du journal…'));
 try{
  const {items,printers,actions}=await request('/journal?'+filters);
  if(generation!==journalLoad)return;
  const {printer,action}=form.elements;
  printer.replaceChildren(new Option(tr('Toutes les imprimantes'),''),...Object.entries(printers).map(([key,name])=>new Option(name||key,key)));
  action.replaceChildren(new Option(tr('Toutes les actions'),''),...actions.map(value=>new Option(value,value)));
  printer.value=filters.get('printer');action.value=filters.get('action');
  $('journal-entries').replaceChildren(...items.map(row=>{
   const item=node('li');
   const details=Object.entries(row.parameters||{}).map(([key,value])=>key+' '+value).join(' · ');
   item.append(node('strong',row.action+' · '+tr(row.outcome)),node('p',[date(row.time),row.printer_name,details].filter(Boolean).join(' · ')));
   return item;
  }));
  set('journal-state',items.length?items.length+tr(' entrée(s) récente(s)'):tr('Aucune commande pour ces filtres.'));
  filters.set('export','1');exportLink.href=api+'/journal?'+filters;exportLink.hidden=!items.length;
 }catch(error){
  if(generation!==journalLoad)return;
  $('journal-entries').replaceChildren();set('journal-state',error.message);
 }
}
$('journal-panel').ontoggle=()=>{if($('journal-panel').open)void loadCommandJournal();};
$('journal-filters').onsubmit=event=>{event.preventDefault();void loadCommandJournal();};
$('journal-filters').onchange=()=>void loadCommandJournal();
const assistLabels={0:tr('Contrôle de la courroie'),1:tr('Détection de perte de pas'),2:tr('Relais automatique'),3:tr('Alerte de fin de filament'),4:tr('Alerte de blocage du filament'),5:tr('Suivi du filament restant')};
/** N’expose les réglages avancés que si les capacités et options constructeur les autorisent. */
async function loadDeviceOptions(){const button=$('device-options-load');button.disabled=true;set('device-options-state',tr('Lecture des options du constructeur…'));try{const d=await request('/extras/device');deviceOptions=d;set('device-options-state',d.message||tr('Options reçues de l’imprimante'));$('calibration-choices').replaceChildren(...d.calibrations.map(c=>{const label=node('label',null,'check'),input=node('input');input.type='checkbox';input.name='items';input.value=c.key;label.append(input,document.createTextNode(tr(c.label)));return label;}));$('calibration-fields').disabled=!d.calibrations.length;set('calibration-help',d.calibrations.length?tr('Choisissez les calibrations à lancer, plateau libre.'):d.calibration_advertised?tr('Le nivellement et la compensation sont annoncés, mais leur commande à distance n’est pas confirmée pour ce firmware.'):tr('Aucune calibration à distance fournie pour ce firmware.'));$('hardware-form').hidden=!d.hardware_editable;$('hardware-form').querySelector('fieldset').disabled=!d.hardware_editable;set('hardware-help',d.hardware_editable?tr('Réglages déclarés par le constructeur.'):tr('Le Cloud ne permet pas de modifier le matériel sur ce firmware.'));if(d.hardware_editable){for(const k of ['diameter','material'])if(d.hardware[k]!=null)$('hardware-form').elements[k].value=d.hardware[k];if(d.bed.material!=null)$('hardware-form').elements.bed.value=d.bed.material;}$('assist-options').replaceChildren(...d.assistance.filter(r=>[0,3,4,5].includes(r.option)).map(r=>{const label=node('label',null,'check'),input=node('input');input.type='checkbox';input.name=String(r.option);input.checked=!!Number(r.value);label.append(input,document.createTextNode(assistLabels[r.option]||r.label||tr('Option constructeur')));return label;}));$('assist-form').querySelector('fieldset').disabled=!d.assistance.length;set('assist-help',d.assistance.length?tr('Options actuelles communiquées par la machine.'):tr('Options d’assistance non fournies par ce firmware.'));$('screen-option').replaceChildren(...d.screen.filter(r=>[0,1].includes(r.option)).map(r=>new Option(r.option===0?tr('Extinction de l’écran'):tr('Mise en veille'),r.option)));$('screen-form').querySelector('fieldset').disabled=!$('screen-option').options.length;set('screen-help',d.screen.length?tr('Délai avant la mise en veille.'):tr('Réglage de veille non fourni par ce firmware.'));const visible=[d.calibrations.length>0,d.hardware_editable,d.assistance.some(r=>[0,3,4,5].includes(r.option)),d.screen.some(r=>[0,1].includes(r.option)),d.factory_reset];document.querySelectorAll('.extras-settings-grid>section').forEach((card,i)=>card.hidden=!visible[i]);document.querySelector('.extras-settings-grid').hidden=!visible.some(Boolean);document.querySelector('.extras-settings-heading').hidden=!visible.some(Boolean);$('reset-open').disabled=!d.factory_reset||!snapshot?.printer?.is_available;set('reset-help',d.factory_reset?tr('Rétablit les réglages d’usine après saisie du code et du mot de passe web.'):tr('La réinitialisation Cloud n’est pas annoncée pour ce firmware.'));}catch(e){set('device-options-state',e.message);}finally{button.disabled=false;}}
$('device-options-load').onclick=loadDeviceOptions;
$('calibration-form').onsubmit=e=>{e.preventDefault();command('calibrate',{items:new FormData(e.target).getAll('items')},tr('Lancer les calibrations choisies ? Le plateau doit être libre.'));};
$('hardware-form').onsubmit=e=>{e.preventDefault();const f=e.target;command('hardware',{diameter:Number(f.elements.diameter.value),material:Number(f.elements.material.value),bed:Number(f.elements.bed.value)},tr('Mettre à jour la configuration du matériel ?'));};
$('assist-form').onsubmit=e=>{e.preventDefault();command('assist',{items:[...e.target.querySelectorAll('input[type=checkbox]')].map(i=>({option:Number(i.name),value:i.checked}))},tr('Appliquer ces options d’assistance ?'));};
$('screen-form').onsubmit=e=>{e.preventDefault();command('screen',{option:Number(e.target.elements.option.value),minutes:Number(e.target.elements.minutes.value)},tr('Modifier le délai de veille ?'));};
$('reset-open').onclick=()=>{resetTicket=null;$('reset-understood').checked=false;$('reset-get-code').disabled=true;$('reset-form').hidden=true;$('reset-form').reset();$('reset-dialog').showModal();};$('reset-understood').onchange=e=>$('reset-get-code').disabled=!e.target.checked;
$('reset-get-code').onclick=async()=>{if(!$('reset-understood').checked)return;try{const d=await request('/reset/challenge',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});resetTicket=d.ticket;resetDeadline=Date.now()+d.expires_in*1000;set('reset-code',d.code);$('reset-form').hidden=false;set('reset-state',tr('Ce code est à usage unique'));$('reset-form').elements.code.focus();}catch(e){set('reset-help',e.message);message(e.message,true);}};
$('reset-form').onsubmit=async e=>{e.preventDefault();if(!resetTicket||Date.now()>resetDeadline){set('reset-state',tr('Code expiré. Demandez un nouveau code.'));return;}const ok=await command('factory-reset',{ticket:resetTicket,code:e.target.elements.code.value});resetTicket=null;if(ok)$('reset-dialog').close();else set('reset-state',tr('Demandez un nouveau code avant de réessayer'));};
let timelapsePage=1,timelapseKeyword='',timelapseGeneration=0;
/** L’imprimante sélectionnée est la seule interrogée et la dernière recherche prévaut. */
async function loadTimelapse(page=1){
 if(document.querySelector('.timelapse-panel').hidden)return;
 const generation=++timelapseGeneration;
 const previous=$('timelapse-previous'),next=$('timelapse-next');
 previous.disabled=true;next.disabled=true;
 $('timelapse-list').replaceChildren();
 set('timelapse-state',tr('Lecture des vidéos…'));
 try{
  const d=await request('/extras/videos?'+new URLSearchParams({page,keyword:timelapseKeyword}));
  if(generation!==timelapseGeneration)return;
  timelapsePage=page;
  set('timelapse-state',d.message||(!d.items?.length?tr('Aucune vidéo signalée'):''));
  previous.disabled=!d.available||page<=1;
  next.disabled=!d.available||!d.has_more;
  $('timelapse-list').replaceChildren(...(d.items||[]).map(v=>{
   const item=node('article',null,'task-history-item');
   item.append(node('h4',v.name),node('p',`${date(v.created)} · ${bytes(v.size)} · ${fmt(v.duration,' s')}`,'muted'));
   return item;
  }));
 }catch(e){if(generation===timelapseGeneration)set('timelapse-state',e.message);}
}
$('timelapse-load').onclick=()=>void loadTimelapse();
$('timelapse-previous').onclick=()=>void loadTimelapse(timelapsePage-1);
$('timelapse-next').onclick=()=>void loadTimelapse(timelapsePage+1);
$('timelapse-search').onsubmit=e=>{
 e.preventDefault();
 timelapseKeyword=e.target.elements.keyword.value.trim();
 void loadTimelapse();
};

refresh();setInterval(()=>{if(!document.hidden)refresh();},3000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});window.addEventListener('pagehide',()=>{void closeCamera();});
