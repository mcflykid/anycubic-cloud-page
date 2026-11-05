'use strict';
const {locale,text:translate,format:translateFormat}=workshopLocale;
const timeZone=document.documentElement.dataset.timeZone||'Europe/Paris';
/** Renvoie l’élément HTML par identifiant ; les contrôles de cette page partagent ce point d’accès. */
const $=id=>document.getElementById(id), api='/imprimante-api';
let snapshot=null, source='local', cloudPage=1, cloudRows=[], filePending=false, fileRows=null, currentTab='overview', busy=false, client=null, cameraTrack=null, zoom=1, sdkPromise=null, cameraGeneration=0, presetsReady=false, mqttSeen='', connectionFailure=false, previewJob=null;
let cloudHasMore=false;
/** Écrit du texte littéral et représente une valeur absente par un tiret. */
const set=(id,value)=>{$(id).textContent=value??'—';};
/** Formate une valeur en français avec suffixe, en distinguant zéro d’une donnée absente. */
const fmt=(v,suffix='')=>v==null?'—':`${typeof v==='number'?v.toLocaleString(locale,{maximumFractionDigits:1}):v}${suffix}`;
/** Formate des minutes arrondies en durée lisible ; une valeur absente reste inconnue. */
const mins=v=>{if(v==null)return '—';const n=Math.max(0,Math.round(v)),h=Math.floor(n/60),m=n%60;return h?`${h} h${m?' '+m+' min':''}`:`${m} min`;};
/** Affiche le fuseau configuré pour garder historique et graphiques cohérents ; accepte les horodatages ISO et les secondes Unix du cloud. */
const date=v=>v?new Date(typeof v==='number'&&v>1e9&&v<1e11?v*1000:v).toLocaleString(locale,{timeZone}):'—';
/** Crée un élément avec texte littéral afin de ne pas interpréter les noms cloud comme du HTML. */
const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e;};
/** Affiche un retour horodaté ; error distingue une erreur sans exposer de détails internes. */
function message(text,error=false){set('message-text',text?`${new Date().toLocaleTimeString(locale,{hour:'2-digit',minute:'2-digit',timeZone})} — ${text}`:'');$('message').hidden=!text;$('message').classList.toggle('error',error);}
/** Renvoie une promesse booléenne ; une fermeture du dialogue annule l’action physique proposée. */
function confirmAction(text){return new Promise(resolve=>{const d=$('confirm-dialog');set('confirm-text',translate(text));d.showModal();const finish=value=>{d.close();resolve(value);};$('confirm-no').onclick=()=>finish(false);$('confirm-yes').onclick=()=>finish(true);d.oncancel=()=>resolve(false);});}
let fileContext=null,fileGeneration=0,fileReload=false,uploadAttempt=null;
let cameraWanted=false,cameraViewer=null;
let selectedPrinter='',printerCatalogueReady=false,printerCataloguePending=false;
/** Le choix reste propre au navigateur ; les valeurs périmées se replient sur le défaut fourni par le serveur. */
async function loadPrinters(){if(printerCataloguePending)return;printerCataloguePending=true;try{const d=await request('/printers'),items=d.items||[];if(!items.length)return;let saved='';try{saved=localStorage.getItem('cloud-page-printer')||'';}catch{}selectedPrinter=items.some(x=>x.key===saved)?saved:items.some(x=>x.key===d.default)?d.default:items[0].key;const selector=$('printer-selector');selector.replaceChildren(...items.map(p=>new Option(p.name,p.key)));selector.value=selectedPrinter;$('printer-selector-wrap').hidden=items.length<2;printerCatalogueReady=true;}finally{printerCataloguePending=false;}}
/** Une nouvelle page empêche de réutiliser un dialogue, un aperçu ou un cache de la machine précédente. */
async function choosePrinter(){const selector=$('printer-selector');if(busy){selector.value=selectedPrinter;message('Attendez la fin de l’opération avant de changer d’imprimante.',true);return;}await closeCamera();try{localStorage.setItem('cloud-page-printer',selector.value);}catch{message('Le navigateur ne peut pas mémoriser ce choix.',true);selector.value=selectedPrinter;return;}location.reload();}
$('printer-selector').onchange=choosePrinter;
/** Renvoie le JSON ou rejette avec Error ; un 401 ouvre la connexion sans rejouer une action physique. */
async function request(path,options={}){/* Un échec réseau ne prouve pas qu’une commande physique n’a pas été exécutée. */const {timeoutMs,...fetchOptions}=options,target=options.printerKey??selectedPrinter,read=!options.method||options.method==='GET'||path==='/camera-session';let r;for(let attempt=0;attempt<(read?2:1);attempt++){try{r=await fetch(api+path,{cache:'no-store',signal:AbortSignal.timeout(timeoutMs??(path.startsWith('/files/')?45000:90000)),...fetchOptions,headers:{...options.headers,...(target&&path!=='/printers'?{'X-Printer-Key':target}:{})}});}catch(e){if(read&&attempt===0)continue;throw new Error(path==='/upload'?'Résultat de l’envoi incertain. Vérifiez les fichiers du cloud et l’état de l’imprimante avant tout nouvel essai.':read?'Connexion au serveur interrompue. Nouvelle tentative automatique.':'Connexion interrompue. Vérifiez l’état de la machine avant de renvoyer cette commande.');}if(read&&[502,503,504].includes(r.status)&&attempt===0){await new Promise(resolve=>setTimeout(resolve,1200));continue;}break;}if(r.status===401){window.location.assign('/login');throw new Error('Session expirée. Reconnectez-vous avant toute nouvelle action.');}const raw=await r.text();let d;try{d=JSON.parse(raw);}catch{throw new Error(read?`Le service redémarre ou ne répond pas (HTTP ${r.status}). Nouvelle tentative automatique.`:`Le service n’a pas confirmé la commande (HTTP ${r.status}). Vérifiez l’état de la machine avant un nouvel essai.`);}if(!r.ok||d.ok===false&&path!='/status'){const error=new Error(d.message||`Erreur ${r.status}`);error.cameraReason=d.camera_error;throw error;}return d;}
/** Renvoie le résultat ou null ; question demande confirmation et request_id empêche une répétition côté serveur. */
async function command(action,data={},question){if(busy){message('Une opération est déjà en cours.',true);return null;}const target=selectedPrinter,projectKey=['pause','resume','cancel'].includes(action)?snapshot?.printer?.command_project:null;if(['pause','resume','cancel'].includes(action))data={...data,project_key:projectKey};if(!target){message('Attendez la découverte des imprimantes avant une commande.',true);return null;}if(question&&!await confirmAction(question))return null;if(target!==selectedPrinter){message('La cible a changé : commande annulée.',true);return null;}busy=true;message('Demande en cours…');try{const d=await request('/command',{printerKey:target,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...data,request_id:crypto.randomUUID()})});message(translate(d.message));await refresh();return d;}catch(e){message(translate(e.message),true);return null;}finally{busy=false;}}
/** Remplit une liste descriptive par textContent pour que les valeurs cloud restent du texte. */
function definition(target,values){const dl=$(target);dl.replaceChildren(...values.map(([label,value])=>{const div=node('div');const title=node('dt',translate(label));if(['temperatures','details','ace-stats'].includes(target))decorateMetric(title,metricIcons[label]);div.append(title,node('dd',value));return div;}));}
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
const detailNames={job_eta:'Fin estimée',job_z_thick:'Épaisseur de couche',job_model_height:'Hauteur du modèle',job_speed_mode:'Mode de vitesse',print_speed_pct:'Vitesse (%)',job_anti_alias_count:'Anticrénelage',job_on_time:'Exposition',job_off_time:'Pause exposition',job_bottom_time:'Exposition de base',job_bottom_layers:'Couches de base',job_z_up_height:'Levée Z',job_z_up_speed:'Vitesse de levée Z',job_z_down_speed:'Vitesse de descente Z'};
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
/** Les images spécifiques suivent uniquement un modèle explicitement identifié. */
function renderHardware(printer){
 const model=printer.machine_name||printer.name||'Imprimante';
 const box=printer.boxes?.[0];
 const generation=box?.model;
 const aceName=box?(generation||'Module ACE'):'Aucun module ACE';
 const setImage=(id,source)=>{
  const image=$(id);
  if(image.getAttribute('src')!==source)image.src=source;
 };
 set('printer-model',model);
 set('printer-accessory',aceName);
 $('printer-accessory').hidden=!box;
 const s1=/^(Anycubic )?Kobra S1$/i.test(model);
 setImage('printer-illustration',s1&&generation==='ACE 2 Pro'?'/icons/kobra-s1-ace2pro.png':'/icons/printer.svg');
 set('ace-model',translate(aceName));
 set('firmware-printer-model',model);
 set('firmware-ace-model',translate(aceName));
 set('chart-ace-name',box?(generation||'Module ACE'):'Module ACE');
 setImage('settings-printer-illustration',$('printer-illustration').getAttribute('src'));
 $('ace-illustration').hidden=!box;
 setImage('ace-illustration',generation==='ACE 2 Pro'?'/icons/ace2pro.png':generation==='ACE Pro'?'/icons/ace-pro.svg':'/icons/ace.svg');
}
/** Affiche l’état courant et autorise les commandes selon le projet, sans assimiler l’absence de données à un succès. */
function renderOverview(p){renderHardware(p);renderJobPreview(p);const state=!p.printer_online?'Hors ligne':p.job_is_paused?'En pause':p.is_busy?'Impression en cours':'Disponible';set('printer-status',translate(state));$('job-name').dataset.tooltip=p.job_name||'Imprimante prête';set('job-name',p.job_name||(!p.printer_online?'L’imprimante est hors ligne.':p.is_busy?'Impression en cours':'Prête pour la prochaine création.'));set('job-state',translate(p.job_name?({printing:'Impression en cours',paused:'Impression en pause',finished:'Impression terminée',completed:'Impression terminée'}[p.job_state]||fmt(p.job_state)):p.is_busy?'Le cloud n’a pas encore fourni le projet.':'Aucune impression en cours.'));$('job-state').hidden=$('job-state').textContent===translate(state);$('job-progress-wrap').hidden=p.job_progress==null;if(p.job_progress!=null){$('job-progress').value=p.job_progress;set('job-progress-text',fmt(p.job_progress,' %'));}
 definition('job-stats',[['Temps écoulé',mins(p.job_time_elapsed)],['Temps restant',mins(p.job_time_remaining)],['Couches',p.job_current_layer==null?'—':`${p.job_current_layer} / ${p.job_total_layers??'—'}`]]);
 definition('temperatures',[['Buse actuelle / cible',`${fmt(p.curr_nozzle_temp,' °C')} / ${fmt(p.target_nozzle_temp,' °C')}`],['Plateau actuel / cible',`${fmt(p.curr_hotbed_temp,' °C')} / ${fmt(p.target_hotbed_temp,' °C')}`],['Ventilation pièce',fmt(p.fan_speed_pct,' %')],['Ventilation auxiliaire',fmt(p.aux_fan_speed_pct,' %')],['Ventilation enceinte',fmt(p.box_fan_level)]]);
 definition('details',[['Modèle',p.machine_name||'—'],['Micrologiciel',fmt(p.firmware)],['Temps total',fmt(p.statistics?.hours,' h')],['Nombre d’impressions',fmt(p.statistics?.print_count)],['Filament utilisé',String(p.statistics?.material??'—').replace(/([0-9.]+)\s*(kg|g)$/,(_,n,u)=>Number(n).toLocaleString(locale,{maximumFractionDigits:2})+' '+u)],...Object.entries(detailNames).filter(([key])=>p[key]!=null).map(([key,label])=>[label,key==='job_eta'?date(p[key]):fmt(p[key])])]);
 for(const action of ['pause','resume','cancel'])document.querySelector(`[data-command="${action}"]`).disabled=!p.job_in_progress||!p.command_project||(action==='pause'&&p.job_is_paused)||(action==='resume'&&!p.job_is_paused);
 renderFirmware(p);set('settings-availability',p.job_in_progress?'Réglages disponibles':'Disponibles pendant une impression');$('settings-form').querySelectorAll('input,select,button').forEach(e=>e.disabled=!p.job_in_progress);if(!$('rename-form').dataset.loaded){$('rename-form').elements.name.value=p.name||'';$('rename-form').dataset.loaded='yes';}

 const modes=p.speed_modes||[];if(JSON.stringify(modes)!==$('speed-mode').dataset.values){const previous=$('speed-mode').value;$('speed-mode').replaceChildren(new Option('Ne pas modifier',''),...modes.map(m=>new Option(({Quiet:'Silencieux',Standard:'Standard',Sport:'Sport'}[m.description??m.name??m.label]||m.description||m.name||m.label||String(m.mode??m.value??m.code)),m.mode??m.value??m.code??m.id)));$('speed-mode').value=previous;$('speed-mode').dataset.values=JSON.stringify(modes);}
}
/** N’autorise une mise à jour que si la machine est libre et la disponibilité explicitement annoncée. */
function renderFirmware(p){
 const printerButton=document.querySelector('[data-command=firmware]'),aceButton=document.querySelector('[data-command=ace-firmware]'),ace=p.ace_updates?.[0];
 const idle=!!p.printer_online&&!!p.is_available&&!p.job_in_progress,printerUpdate=p.firmware_update_available===true,aceUpdate=ace?.available===true;
 printerButton.disabled=!idle||!printerUpdate;aceButton.disabled=!idle||!aceUpdate;
 printerButton.title=!idle?'Imprimante occupée ou hors ligne.':printerUpdate?'Installer la version '+p.firmware_available:'Aucune mise à jour proposée par Anycubic.';
 aceButton.title=!idle?'Imprimante occupée ou hors ligne.':aceUpdate?'Installer la version '+(ace.target||'proposée')+' sur le module ACE.':ace?'Aucune mise à jour proposée par Anycubic.':'Version de l’ACE non reçue. Actualisez les informations.';
 for(const [id,current,target,available] of [['printer',p.firmware,p.firmware_available,p.firmware_update_available],['ace',ace?.current??p.multi_color_box_fw_version,ace?.target,ace?.available]]){
  set(`firmware-${id}-version`,available===true?`${fmt(current)} → ${fmt(target)}`:`Version ${fmt(current)}`);
  set(`firmware-${id}-status`,available===true?'Mise à jour disponible':available===false?'À jour':'À vérifier');
  $(`firmware-${id}-status`).className='firmware-status '+(available===true?'available':available===false?'current':'unknown');
 }
 printerButton.dataset.confirm=translateFormat('Installer la version {0} sur l’imprimante ? Ne coupez pas son alimentation pendant la mise à jour.',p.firmware_available||'—');
 aceButton.dataset.confirm=translateFormat('Installer la version {0} sur le module ACE ? Ne coupez pas son alimentation pendant la mise à jour.',ace?.target||'—');
}
/** Renvoie le premier ACE connu, ou null ; cette interface ne propose pas de sélection de second boîtier. */
function selectedBox(){return snapshot?.printer?.boxes?.[0]||null;}
/** Renvoie l’identifiant de l’ACE affiché pour cibler les commandes de bobines et de séchage. */
function boxData(){return {box:selectedBox()?.box_id??0};}
/** Affiche les bobines et le séchage ; préserve une quantité nulle et distingue RFID d’une configuration manuelle. */
function renderAce(p){
 const box=selectedBox();if(!box){set('ace-status','Aucun module ACE détecté.');$('spools').replaceChildren();return;}
 set('ace-status',box.drying?.is_drying?'Séchage en cours':snapshot.printer.printer_online?'Disponible':'Hors ligne');definition('ace-stats',[['Température',fmt(box.temperature,' °C')],['Humidité',fmt(box.humidity,' %')],['Relais automatique',box.auto_feed?'Activé':'Désactivé']]);
 $('spools').replaceChildren(...(box.spools||[]).map(s=>{const art=node('article',null,'slot'),sw=node('div',null,'swatch');if(Array.isArray(s.color))sw.style.backgroundColor=`rgb(${s.color.slice(0,3).map(v=>Math.max(0,Math.min(255,Number(v)||0))).join(',')})`;art.append(sw,node('h3',s.material_type||'Non renseigné'),node('p',`Emplacement ${s.display_slot??s.slot}`),node('p',Number.isInteger(box.loaded_slot)&&box.loaded_slot>=0&&box.loaded_slot===(s.local_slot??s.slot)-1?'● Bobine engagée':s.spool_loaded?'Filament présent':'Filament absent ou non détecté',Number.isInteger(box.loaded_slot)&&box.loaded_slot>=0&&box.loaded_slot===(s.local_slot??s.slot)-1?'engaged-spool':''),node('p',s.remaining_percent==null?'Quantité non renseignée':`${s.remaining_percent} % restants`));if(s.rfid===true)art.append(node('p','Anycubic · RFID reconnu','rfid-badge'));else if(s.rfid===false)art.append(node('p','Configuration manuelle','muted'));const edit=node('button',s.rfid===true?'Voir':'Modifier');edit.type='button';edit.title=s.rfid===true?'Consulter les informations RFID et gérer le chargement de cette bobine.':'Modifier le matériau, la couleur et le chargement de cet emplacement.';edit.onclick=()=>openSpool(s.local_slot||s.slot);art.append(edit);return art;}));
 const dry=box.drying||{};set('drying-state',dry.is_drying?`Séchage en cours à ${fmt(dry.target_temperature,' °C')}. Durée restante signalée : ${mins(dry.remaining_time)}.`:'Séchage inactif.');
 if(document.activeElement!==$('auto-feed'))$('auto-feed').checked=!!box.auto_feed;

 if(!presetsReady){presetsReady=true;$('preset-fields').replaceChildren(...snapshot.presets.map((pr,i)=>{const fs=node('fieldset');fs.append(node('legend',`Préréglage ${i+1}`));for(const [key,label]of[['name','Nom'],['temperature','Température (°C)'],['hours','Durée (heures)']]){const l=node('label',label),input=node('input');input.name=`${i}-${key}`;input.value=pr[key];input.type=key==='name'?'text':'number';input.required=true;fs.append(l);l.append(input);}return fs;}));}
 $('dry-presets').replaceChildren(...snapshot.presets.map(pr=>{const b=node('button',`${pr.name} ${pr.temperature} °C · ${pr.hours} h`);b.type='button';b.onclick=()=>command('dry-start',{...boxData(),temperature:pr.temperature,hours:pr.hours},`Démarrer le séchage ${pr.name} à ${pr.temperature} °C pendant ${pr.hours} h ?`);return b;}));
}
/** Actualise l’interface depuis l’état serveur et signale les erreurs de connexion sans répéter de commande. */
async function refresh(){try{if(!printerCatalogueReady)await loadPrinters();const d=await request('/status');if(connectionFailure&&d.ok){message('');connectionFailure=false;}snapshot=d;if(currentTab==='camera'&&cameraWanted&&!cameraTrack&&d.camera_diagnostic)set('camera-state',d.camera_diagnostic.message);if(d.notifications){updateNoticeCount(d.notifications.unread);const signature=JSON.stringify(d.notifications);if(signature!==noticeSignature){noticeSignature=signature;if(historyPage===1)noticeRows=d.notifications.items;else{const merged=new Map([...noticeRows,...d.notifications.items].map(x=>[x.key,x]));noticeRows=[...merged.values()].sort((a,b)=>b.time-a.time);}if(!$('notifications-panel').hidden)renderNotifications();}}const p=d.printer;set('connection',!d.ok?'Cloud indisponible':p?.printer_online?'En ligne':'Hors ligne');$('connection').classList.toggle('offline',!d.ok||!p?.printer_online);set('updated',`${translate('Dernière actualisation')} : ${date([d.updated_at,d.mqtt_updated_at].filter(Boolean).sort().at(-1))} · ${timeZone}`);if(!d.ok&&d.message){connectionFailure=true;message(d.message,true);}if(d.account_message)message(d.account_message,true);if(!p)return;updateNativeControls(p);updateUploadButton();renderOverview(p);renderAce(p);$('events').replaceChildren(...d.events.map(e=>node('li',`${date(e.time)} — ${e.action} : ${e.state}`)));if(source!=='cloud'&&currentTab==='files')renderFiles();mqttSeen=d.mqtt_updated_at;}catch(e){connectionFailure=true;set('connection','Connexion indisponible');message('Connexion au serveur momentanément indisponible.',true);}}
/** Change le panneau actif, charge ses données et ferme la session vidéo lorsque l’utilisateur quitte la caméra. */
function showTab(name){currentTab=name;for(const panel of document.querySelectorAll('.tab-panel'))panel.hidden=panel.id!==`tab-${name}`;for(const b of document.querySelectorAll('[data-tab]')){if(b.dataset.tab===name)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}if(name==='files'){renderFiles();loadFiles();}if(name==='history')historyViewSet(historyView);if(name==='overview')loadTemperatures();if(name==='settings'&&!deviceOptions)loadDeviceOptions();if(name==='camera'){loadTimelapse();if(snapshot?.demo){const image=node('img');image.src='/icons/kobra-s1-ace2pro.png';image.alt='Illustration de la Kobra S1';$('camera-video').classList.add('demo-camera');$('camera-video').replaceChildren(image,node('p','Zone vidéo · Démonstration sans flux caméra'));}}if(name!=='camera')void closeCamera();}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>showTab(b.dataset.tab));
document.querySelectorAll('[data-command]').forEach(b=>b.onclick=()=>command(b.dataset.command,boxData(),b.dataset.confirm));
$('go-spool').onclick=()=>openSpool($('spool-form').elements.slot.value);$('go-drying').onclick=()=>{const dry=selectedBox()?.drying;if(dry?.is_drying){$('dry-form').elements.temperature.value=dry.target_temperature;if(Number.isFinite(dry.total_duration)&&dry.total_duration>0)$('dry-form').elements.hours.value=Math.max(1,Math.ceil(dry.total_duration/60));}if(!$('dry-dialog').open)$('dry-dialog').showModal();$('dry-form').elements.temperature.focus({preventScroll:true});};
$('spool-color').oninput=()=>set('spool-color-value',$('spool-color').value.toUpperCase());
document.querySelectorAll('.dialog-close').forEach(b=>b.onclick=()=>b.closest('dialog').close());
$('spool-form').onsubmit=e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target));if(!d.material){message('Choisissez un matériau compatible avant d’enregistrer cette bobine.',true);return;}command('slot',{...d,...boxData()},'Enregistrer ce matériau et cette couleur dans l’ACE ?');};
for(const [id,action,extra,question]of[['feed','feed',{},'Charger le filament sélectionné ?'],['feed-finish','feed',{finish:true},'Terminer le chargement ?'],['retract','retract',{},'Rétracter le filament ?']])$(id).onclick=()=>command(action,{...boxData(),slot:$('spool-form').elements.slot.value,...extra},question);
$('dry-form').onsubmit=e=>{e.preventDefault();command('dry-start',{...Object.fromEntries(new FormData(e.target)),...boxData()},'Démarrer le séchage avec ces paramètres ?');};$('dry-stop').onclick=()=>command('dry-stop',boxData(),'Arrêter le séchage du module sélectionné ?');$('auto-feed-save').onclick=()=>command('auto-feed',{...boxData(),enabled:$('auto-feed').checked},'Modifier le relais automatique des bobines ?');
$('presets-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),presets=Array.from({length:4},(_,i)=>Object.fromEntries(['name','temperature','hours'].map(k=>[k,f.get(`${i}-${k}`)])));const d=await command('presets',{presets});if(d){presetsReady=false;await refresh();}};
$('settings-form').onsubmit=e=>{e.preventDefault();command('settings',Object.fromEntries(new FormData(e.target)),'Appliquer ces réglages à l’impression active ?');};$('rename-form').onsubmit=e=>{e.preventDefault();command('rename',Object.fromEntries(new FormData(e.target)),'Renommer l’imprimante dans le compte Anycubic ?');};
/** Renvoie les numéros de bobines dans l’ordre saisi ; lève Error pour un numéro hors de 1 à 8. */
function slots(value){if(!value.trim())return [];const result=value.split(/[ ,;]+/).filter(Boolean).map(Number);if(result.some(v=>!Number.isInteger(v)||v<1||v>8))throw new Error('Indiquez des emplacements de 1 à 8.');return result;}
/** Empêche une ancienne liste de fournir des actions pour une autre source ou un autre dossier. */
function currentFileContext(context){return !!context&&context.source===source&&context.path===$('file-path').value&&context.page===cloudPage&&context.printer===selectedPrinter;}
/** Les actions gardent la source et le chemin de la liste reçue, même après un changement de vue. */
function renderFiles(){const context=fileContext,listedSource=context?.source,listedPath=context?.path;const list=currentFileContext(context)?(listedSource==='cloud'?cloudRows:fileRows):null;const rows=Array.isArray(list)?list:[];$('file-rows').replaceChildren(...rows.map(f=>{const row=node('tr'),name=node('td',f.name),size=node('td',fmt(f.size_mb,' Mo')),actions=node('td'),wrap=node('div',null,'actions');const add=(label,fn,cls)=>{const b=node('button',null,cls);const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('class','ui-icon');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.7');svg.setAttribute('aria-hidden','true');const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',({'Télécharger':'M12 3v12m-4-4l4 4 4-4M4 17v4h16v-4','Renommer':'M4 20l4-1L20 7l-3-3L5 16z','Ouvrir':'M3 7V5h7l2 3h9v12H3z','Aperçu':'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0','Imprimer':'M6 8V3h12v5M6 17H3V8h18v9h-3M6 14h12v7H6z','Supprimer':'M3 6h18M8 6V3h8v3M5 6l1 15h12l1-15'})[label]||'');svg.append(path);b.append(svg,node('span',label));b.title=({'Aperçu':'Afficher l’image associée au G-code.','Imprimer':'Préparer l’impression de ce fichier avec les bobines choisies.','Supprimer':'Supprimer ce fichier après confirmation.','Ouvrir':'Afficher le contenu de ce dossier.'})[label]||label;if(label==='Imprimer'){if(listedSource==='cloud'&&f.printable===false){b.disabled=true;b.title='Ce fichier ne contient pas de G-code imprimable.';}else if(snapshot?.printer?.is_available===false){b.disabled=true;b.title='L’imprimante est occupée.';}}b.type='button';b.onclick=fn;wrap.append(b);};if(source==='cloud'){const check=node('input');check.type='checkbox';check.checked=cloudSelected.has(f.handle);check.setAttribute('aria-label','Sélectionner '+f.name);check.onchange=()=>{check.checked?cloudSelected.add(f.handle):cloudSelected.delete(f.handle);cloudSelectionState();};name.prepend(check);name.classList.add('cloud-file-name');add('Télécharger',()=>downloadCloud([f.handle]));add('Renommer',()=>renameCloud(f));}if(f.is_dir)add('Ouvrir',()=>{$('file-path').value=listedPath.replace(/\/$/,'')+'/'+f.name;loadFiles();});else{add('Aperçu',()=>filePreview(f,context));add('Imprimer',async()=>{try{await command(`print-${listedSource}`,{...f,path:listedPath,slots:slots($('file-slots').value)},`Imprimer « ${f.name} » avec la sélection de bobines indiquée ?`);}catch(e){message(e.message,true);}});add('Supprimer',async()=>{const ok=await command(`delete-${listedSource}`,{...f,path:listedPath},`Supprimer définitivement « ${f.name} » de ${listedSource==='cloud'?'votre espace cloud':listedSource==='usb'?'la clé USB':'la mémoire de l’imprimante'} ?`);if(ok)loadFiles();},'danger');}actions.append(wrap);row.append(name,size,actions);return row;}));
 if(source!=='cloud')set('files-state',list==null?'Liste non reçue. Actualisez ; les résultats arrivent par MQTT.':rows.length?`${rows.length} élément(s).`:'Ce dossier est vide.');
 $('cloud-tools').hidden=source!=='cloud';if(source==='cloud'){cloudSelectionState();loadCloudStorage();} $('prev-page').hidden=$('next-page').hidden=source!=='cloud';set('cloud-page',source==='cloud'?`Page ${cloudPage}`:'');$('prev-page').disabled=cloudPage<=1;$('next-page').disabled=!cloudHasMore||!currentFileContext(context);
}
/** Sérialise les lectures MQTT et relance le dernier choix en ignorant toute réponse périmée. */
async function loadFiles(){
 const generation=++fileGeneration;if(filePending){fileReload=true;renderFiles();return;}
 const context={source,path:$('file-path').value,page:cloudPage,printer:selectedPrinter};filePending=true;renderFiles();
 try{
  set('files-state',context.source==='cloud'?'Chargement du cloud…':'Lecture du dossier sur l’imprimante…');
  const result=await request(context.source==='cloud'?`/files/cloud?page=${context.page}`:`/files/${context.source}?path=${encodeURIComponent(context.path)}`,{printerKey:context.printer});
  if(generation!==fileGeneration||!currentFileContext(context))return;
  fileContext=context;
  if(context.source==='cloud'){cloudRows=result.files;cloudHasMore=result.has_more===true;}else fileRows=result.files;
  renderFiles();set('files-state',context.source==='cloud'?`${cloudRows.length} fichier(s). Espace utilisé : ${fmt(result.store.used_bytes/1e6,' Mo')} sur ${fmt(result.store.total_bytes/1e6,' Mo')}.`:`${fileRows.length} élément(s) dans ${result.path}.`);
 }catch(e){if(generation===fileGeneration&&currentFileContext(context)){fileContext=null;renderFiles();message(e.message,true);set('files-state','Liste indisponible.');}}
 finally{filePending=false;if(fileReload){fileReload=false;void loadFiles();}}
}
document.querySelectorAll('[data-source]').forEach(b=>b.onclick=()=>{source=b.dataset.source;cloudPage=1;fileRows=null;document.querySelectorAll('[data-source]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));$('file-path').disabled=source==='cloud';$('parent-folder').disabled=source==='cloud';renderFiles();loadFiles();});$('files-form').onsubmit=e=>{e.preventDefault();loadFiles();};$('parent-folder').onclick=()=>{const parts=$('file-path').value.split('/').filter(Boolean);parts.pop();$('file-path').value='/'+parts.join('/');loadFiles();};$('prev-page').onclick=()=>{cloudPage=Math.max(1,cloudPage-1);loadFiles();};$('next-page').onclick=()=>{cloudPage++;loadFiles();};
$('upload-form').onsubmit=async e=>{e.preventDefault();if(busy)return;const data=new FormData(e.target),file=data.get('file');if(file.size>100*1024*1024){message('Le fichier dépasse 100 Mo.',true);return;}try{data.set('slots',JSON.stringify(slots(data.get('slots'))));}catch(err){message(err.message,true);return;}if(!await confirmAction(translateFormat(data.get('mode')==='upload'?'Envoyer « {0} » dans votre espace cloud ?':'Envoyer « {0} » et lancer son impression ?',file.name)))return;const chosen=e.target.elements.file.files[0],intent=JSON.stringify([data.get('mode'),data.get('slots'),selectedPrinter]);if(!uploadAttempt||uploadAttempt.file!==chosen||uploadAttempt.intent!==intent)uploadAttempt={file:chosen,intent,id:crypto.randomUUID()};data.set('request_id',uploadAttempt.id);busy=true;set('upload-state','Envoi en cours. Ne fermez pas cette page.');try{const result=await request('/upload',{method:'POST',body:data,timeoutMs:Math.min(7200000,300000+file.size/32768*2000)});uploadAttempt=null;set('upload-state',result.message);message(result.message);}catch(err){set('upload-state',err.message);message(err.message,true);}finally{busy=false;}};
/** Affiche l’image autorisée par le serveur ; l’absence d’aperçu ne rend pas le fichier non imprimable. */
async function filePreview(file,context=fileContext){if(!context)return;try{const d=await request('/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:context.source,handle:file.handle,name:file.name,path:context.path})});if(!d.image){message('L’imprimante et le cloud n’ont pas fourni d’image pour ce fichier. Son impression reste disponible.');return;}const dialog=document.createElement('dialog'),title=node('h2',file.name),img=node('img'),close=node('button','Fermer');img.src=d.image;img.alt=`Aperçu de ${file.name}`;img.style.width='100%';close.onclick=()=>{dialog.close();dialog.remove();};dialog.className='file-preview-dialog';const header=node('div',null,'dialog-top');header.append(title,close);dialog.append(header,img);dialog.oncancel=()=>dialog.remove();document.body.append(dialog);dialog.showModal();}catch(e){message(e.message,true);}}
/** Renvoie une promesse partagée de chargement du lecteur Agora local ; rejette si le script est indisponible. */
function loadSdk(){if(!sdkPromise)sdkPromise=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='/js/agora-rtc.js';s.onload=()=>resolve(window.AgoraRTC);s.onerror=()=>reject(new Error('Le lecteur vidéo n’a pas pu être chargé.'));document.head.append(s);});return sdkPromise;}
/** Ferme la session vidéo et invalide les ouvertures en cours par changement de génération. */
async function closeCamera(){const viewer=cameraViewer;cameraViewer=null;if(viewer){void request('/camera-close',{method:'POST',printerKey:viewer.printer,keepalive:true,headers:{'X-Camera-Viewer':viewer.id}}).catch(()=>{});}cameraWanted=false;cameraGeneration++;$('camera-start').disabled=false;$('camera-stop').disabled=true;cameraTrack?.stop();cameraTrack=null;if(client){const old=client;client=null;try{await old.leave();}catch{}}$('camera-video').replaceChildren();set('camera-state','Caméra éteinte');}
/** Ouvre la vidéo Agora avec les paramètres constructeur ; abandonne une réponse devenue obsolète après fermeture. */
async function openCamera(){let generation;try{await closeCamera();/* Une fermeture pendant la connexion rend sa réponse tardive inutilisable. */generation=++cameraGeneration;cameraWanted=true;$('camera-start').disabled=true;$('camera-stop').disabled=false;set('camera-state','Connexion en cours…');delete $('camera-state').dataset.tooltip;const sdk=await loadSdk();if(generation!==cameraGeneration)return;sdk.setLogLevel(3);const viewer={id:crypto.randomUUID(),printer:selectedPrinter};cameraViewer=viewer;const cameraOptions={method:'POST',printerKey:viewer.printer,headers:{'X-Camera-Viewer':viewer.id}};const session=await request('/camera-session',cameraOptions);if(generation!==cameraGeneration){void request('/camera-close',{...cameraOptions,keepalive:true}).catch(()=>{});return;}client=sdk.createClient({mode:'live',codec:'h264',role:'host'});const mine=client;const subscribe=async user=>{await mine.subscribe(user,'video');cameraTrack=user.videoTrack;cameraTrack.play('camera-video');set('camera-state','Caméra connectée');};mine.on('user-published',(u,type)=>{if(type==='video')subscribe(u).catch(()=>set('camera-state','Flux vidéo indisponible'));});mine.on('user-unpublished',()=>set('camera-state','Flux vidéo interrompu'));mine.on('user-left',()=>set('camera-state','Caméra déconnectée'));mine.on('token-privilege-will-expire',async()=>{try{if(generation!==cameraGeneration)return;const s=await request('/camera-session',cameraOptions);await mine.renewToken(s.rtc_token);}catch{set('camera-state','Session caméra expirée');}});const salt=Uint8Array.from(atob(session.encryption_kdf_salt),c=>c.charCodeAt(0));const modes={'aes-128-gcm2':'aes-128-gcm2','aes-256-gcm2':'aes-256-gcm2'};mine.setEncryptionConfig(String(session.encryption_mode).toLowerCase().replaceAll('_','-'),session.encryption_key,salt);await mine.setClientRole('host');await mine.join(session.appid,session.channel,session.rtc_token||null,session.client_uid||null);if(generation!==cameraGeneration){await mine.leave();return;}await Promise.all(mine.remoteUsers.filter(u=>u.hasVideo).map(subscribe));set('camera-state',cameraTrack?'Caméra connectée':'En attente de la vidéo');}catch(e){if(generation!==cameraGeneration)return;await closeCamera();const known=['missing_credentials','invalid_format','unsupported_transport'].includes(e.cameraReason);set('camera-state',known?e.message:'Caméra indisponible');$('camera-state').dataset.tooltip=known?e.message:'La session vidéo ne peut pas être ouverte pour le moment.';}}
$('camera-start').onclick=openCamera;$('camera-stop').onclick=closeCamera;
/** Applique un zoom d’affichage à la vidéo ; ne modifie aucun réglage de la caméra physique. */
function renderZoom(){$('camera-video').style.transform=`scale(${zoom})`;set('zoom-label',`${Math.round(zoom*100)} %`);}for(const [id,change]of[['zoom-in',.25],['zoom-out',-.25]])$(id).onclick=()=>{zoom=Math.min(4,Math.max(1,zoom+change));renderZoom();};$('zoom-reset').onclick=()=>{zoom=1;renderZoom();};$('fullscreen').onclick=()=>{if(document.fullscreenElement)document.exitFullscreen();else $('camera-wrapper').requestFullscreen();};
for(const[id,enabled]of[['light-on',true],['light-off',false]])$(id).onclick=()=>command('light',{enabled,light_type:3},`${enabled?'Allumer':'Éteindre'} l’éclairage de l’imprimante ?`);

let historyPage=1,historyPending=false,noticeRows=[],noticeFilter='all',noticeMore=false,noticeSignature='';
/** Charge une page de notifications du compte, en empêchant deux lectures simultanées. */
async function loadHistory(force=false){if(historyPending)return;historyPending=true;try{const d=!force&&historyPage===1&&snapshot?.notifications?snapshot.notifications:await request(`/history?page=${historyPage}`);noticeRows=historyPage===1?d.items:[...new Map([...noticeRows,...d.items].map(x=>[x.key,x])).values()];noticeMore=d.has_more;updateNoticeCount(d.unread);renderNotifications();}catch(e){set('history-state',e.message);}finally{historyPending=false;}}
/** Conserve le compteur reçu par le statut, sans ajouter un intervalle de requêtes. */
function updateNoticeCount(count){const unread=Number(count)||0;$('notifications-dot').hidden=!unread;$('notifications-filter-dot').hidden=!unread;set('notifications-title',`Messages (${unread})`);$('notifications-toggle').setAttribute('aria-label',`Notifications : ${unread} message${unread>1?'s':''} non lu${unread>1?'s':''}`);$('history-read-all').disabled=!unread;}
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
  details.append(node('summary',`${items[0].name} · ${items[0].reason||items[0].result} · ${items.length} événements`),events);
  events.append(...items.map(notificationRow));
  wrapper.append(details);list.append(wrapper);
 }
 set('history-state',rows.length?'':'Aucun message');
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
 body.append(node('strong',item.name,'notification-name'),node('span',item.printer,'muted'),node('span',`${item.kind==='success'?'✓':item.kind==='interrupted'?'■':'◷'} ${item.result}`,'notification-result '+item.kind));
 if(item.reason||item.reason_code)body.append(node('span',[item.reason,item.reason_code&&'Code '+item.reason_code].filter(Boolean).join(' · '),'muted'));
 body.append(node('time',date(item.time),'muted'));
 open.append(body);
 if(item.unread){const dot=node('span',null,'unread-dot');dot.setAttribute('aria-label','Non lu');open.append(dot);}
 open.onclick=()=>openNotice(item);row.append(open);
 const remove=node('button','×','notification-delete');
 remove.type='button';remove.setAttribute('aria-label','Supprimer la notification : '+item.name);
 remove.title='Supprimer cette notification';remove.onclick=()=>deleteHistory(item.key,false,remove);
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

let temperaturePending=false;
/** Crée un élément SVG avec attributs ; son texte reste littéral pour ne pas interpréter de balisage cloud. */
function chartElement(tag,attributes,text){const e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value]of Object.entries(attributes||{}))e.setAttribute(key,String(value));if(text!=null)e.textContent=text;return e;}
/** Trace mesures et consignes sur hours heures ; espace les points et interrompt la courbe aux lacunes. */
function renderTemperatureChart(key,rows,hours){const host=$(`chart-${key}`),valid=rows.filter(r=>Number.isFinite(r[key]));host.replaceChildren();set(`temperature-${key}-current`,valid.length?fmt(valid.at(-1)[key],' °C'):'—');if(!valid.length){host.append(node('p','En attente des premiers relevés.','muted'));return;}const W=360,H=180,L=38,R=12,T=12,B=28,colors={nozzle:'#b85c35',bed:'#3372a5',ace:'#42765c'},color=colors[key],end=Date.now()/1000,start=end-hours*3600,top=Math.max({nozzle:250,bed:100,ace:80}[key],Math.ceil(Math.max(...valid.map(r=>r[key]),...rows.map(r=>r[key+'_target']||0))/25)*25),x=t=>L+(t-start)/(end-start)*(W-L-R),y=v=>T+(1-v/top)*(H-T-B),svg=chartElement('svg',{viewBox:`0 0 ${W} ${H}`,role:'img','aria-label':`Température ${key==='nozzle'?'de la buse':key==='bed'?'du plateau':'de l’ACE'}, ${valid.length} relevés. Dernière valeur : ${valid.at(-1)[key]} degrés Celsius.`});for(const value of [0,top/2,top]){svg.append(chartElement('line',{x1:L,x2:W-R,y1:y(value),y2:y(value),stroke:'#e5e7eb','stroke-width':1}),chartElement('text',{x:L-7,y:y(value)+4,'text-anchor':'end',class:'chart-axis'},String(Math.round(value))));}const hour=t=>new Date(t*1000).toLocaleTimeString(locale,{hour:'2-digit',minute:'2-digit',timeZone});svg.append(chartElement('text',{x:L,y:H-6,class:'chart-axis'},hour(start)),chartElement('text',{x:W-R,y:H-6,'text-anchor':'end',class:'chart-axis'},hour(end)));for(const target of [true,false]){const field=key+(target?'_target':''),points=rows.filter(r=>Number.isFinite(r[field]));let previous=null,path='';/* Limiter les points évite de surcharger le SVG tout en conservant le dernier relevé. */const stride=Math.max(1,Math.floor(points.length/600));points.filter((r,i)=>i%stride===0||i===points.length-1).forEach(r=>{path+=(previous&&r.time-previous.time<=Math.max(120,stride*20)?'L':'M')+x(r.time).toFixed(2)+' '+y(r[field]).toFixed(2)+' ';previous=r;});if(path)svg.append(chartElement('path',{d:path,fill:'none',stroke:target?'#8f98a5':color,'stroke-width':target?1.5:2,'stroke-dasharray':target?'5 4':'none','stroke-linecap':'round','stroke-linejoin':'round'}));}const last=valid.at(-1);svg.append(chartElement('circle',{cx:x(last.time),cy:y(last[key]),r:3,fill:color}));host.append(svg);const tip=node('div',null,'chart-tooltip');tip.hidden=true;host.append(tip);svg.onpointermove=e=>{const box=svg.getBoundingClientRect(),stamp=start+((e.clientX-box.left)/box.width*W-L)/(W-L-R)*(end-start);const row=valid.reduce((best,r)=>Math.abs(r.time-stamp)<Math.abs(best.time-stamp)?r:best,valid[0]);tip.textContent=`${hour(row.time)} · ${row[key]} °C`;tip.hidden=false;};svg.onpointerleave=()=>{tip.hidden=true;};const legend=node('p',null,'chart-legend');legend.append(node('span','━ Mesurée'));if(rows.some(r=>r[key+'_target']!=null))legend.append(node('span','┄ Cible'));host.append(legend);}
/** Charge l’historique local pour la période choisie, sans cumuler des consultations concurrentes. */
async function loadTemperatures(){if(temperaturePending)return;temperaturePending=true;try{const hours=Number($('temperature-hours').value),data=await request(`/temperatures?hours=${hours}`);for(const key of ['nozzle','bed','ace'])renderTemperatureChart(key,data.readings,hours);set('temperature-note','Relevés reçus depuis l’activation, conservés 24 heures. Survolez une courbe pour lire une mesure.');}catch(e){set('temperature-note',e.message);}finally{temperaturePending=false;}}
$('temperature-hours').onchange=()=>loadTemperatures();setInterval(()=>{if(currentTab==='overview')loadTemperatures();},30000);void loadTemperatures();

/** Marque une notification ou toutes comme lues ; allItems exige une confirmation puis rafraîchit le journal. */
async function markHistoryRead(key,allItems,button){button.disabled=true;try{const result=await request('/history/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(allItems?{all:true}:{key})});message(result.message);historyPage=1;await loadHistory(true);}catch(e){message(e.message,true);button.disabled=false;}}

$('history-read-all').onclick=()=>markHistoryRead(null,true,$('history-read-all'));
$('history-delete-all').onclick=()=>deleteHistory(null,true,$('history-delete-all'));

const helpById={'camera-start':'Démarrer la vidéo en direct de l’imprimante.','camera-stop':'Fermer la vidéo sans interrompre l’impression.','light-on':'Allumer l’éclairage intérieur de l’imprimante.','light-off':'Éteindre l’éclairage intérieur de l’imprimante.','zoom-reset':'Revenir au zoom initial de la vidéo.','fullscreen':'Afficher la vidéo en plein écran.','go-spool':'Choisir un emplacement, son matériau et sa couleur.','go-drying':'Configurer la température et la durée de séchage de l’ACE.','feed':'Charger le filament de l’emplacement sélectionné.','feed-finish':'Valider la fin du chargement après la sortie du filament.','retract':'Retirer le filament de l’emplacement sélectionné.','parent-folder':'Remonter d’un niveau dans les fichiers de l’imprimante.','history-read-all':'Synchroniser toutes les notifications comme lues dans Anycubic.','temperature-hours':'Choisir la période affichée, parmi les relevés des dernières 24 heures.','file-slots':'Un numéro d’emplacement de l’ACE par couleur du G-code, dans l’ordre. Laissez vide pour utiliser la bobine externe.'};for(const [id,help]of Object.entries(helpById))if($(id))$(id).title=translate(help);
const commandHelp={pause:'Mettre l’impression en cours en pause.',resume:'Reprendre une impression qui est en pause.',cancel:'Arrêter l’impression en cours après confirmation.',firmware:'Installer une nouvelle version lorsque l’imprimante est libre.','ace-firmware':'Mettre à jour l’ACE lorsque l’imprimante est libre.'};for(const b of document.querySelectorAll('[data-command]'))if(commandHelp[b.dataset.command])b.title=translate(commandHelp[b.dataset.command]);
const fieldHelp={target_nozzle_temp:'Température cible de la buse, entre 0 et 320 °C.',target_hotbed_temp:'Température cible du plateau, entre 0 et 120 °C.',fan_speed_pct:'Ventilation de la pièce, entre 0 et 100 %. ',aux_fan_speed_pct:'Ventilateur auxiliaire, entre 0 et 100 %. ',box_fan_level:'Niveau de ventilation de l’enceinte accepté par Anycubic, de 0 à 3.',print_speed_mode:'Mode de vitesse appliqué à l’impression en cours.',slots:'Numéros des bobines de l’ACE, dans l’ordre des couleurs du G-code.',mode:'Choisir entre conserver le fichier dans le cloud et lancer son impression.'};for(const e of document.querySelectorAll('input[name],select[name]'))if(fieldHelp[e.name])e.title=translate(fieldHelp[e.name]);

/** Préremplit la bobine sélectionnée ; les valeurs RFID restent consultables sans modification manuelle. */
function fillSpool(slot){const form=$('spool-form'),data=selectedBox()?.spools?.find(s=>Number(s.local_slot||s.slot)===Number(slot));if(!data)return;form.elements.slot.value=String(slot);const material=form.elements.material;for(const option of [...material.options])if(option.dataset.detected)option.remove();if(data.material_type&&![...material.options].some(o=>o.value===data.material_type)){const option=new Option(data.material_type+' (détecté)',data.material_type);option.dataset.detected='true';option.disabled=true;material.add(option);}material.value=data.material_type||'PLA';form.elements.color.value='#'+(data.color||[150,150,150]).slice(0,3).map(v=>Math.max(0,Math.min(255,Number(v)||0)).toString(16).padStart(2,'0')).join('');set('spool-color-value',form.elements.color.value.toUpperCase());/* Les données RFID sont la référence de l’ACE et ne doivent pas être remplacées par le formulaire. */const automatic=data.rfid===true;form.elements.material.disabled=automatic;form.elements.color.disabled=automatic;form.querySelector('[type=submit]').hidden=automatic;set('spool-rfid-note',automatic?'Bobine Anycubic reconnue par RFID. Le matériau et la couleur sont fournis par l’ACE.':'');$('spool-rfid-note').hidden=!automatic;}
/** Ouvre les données du numéro local de bobine et place le focus sur sa sélection. */
function openSpool(slot){fillSpool(slot);if(!$('spool-dialog').open)$('spool-dialog').showModal();$('spool-form').elements.slot.focus({preventScroll:true});}
$('spool-form').elements.slot.onchange=e=>fillSpool(e.target.value);
/** Distingue un simple stockage cloud d’un lancement d’impression, bloqué si la machine est occupée. */
function updateUploadButton(){const form=$('upload-form'),printing=form.elements.mode.value!=='upload',button=form.querySelector('[type=submit]');button.textContent=printing?'Envoyer et imprimer':'Envoyer';button.disabled=printing&&snapshot?.printer?.is_available===false;button.title=button.disabled?'Une impression est déjà en cours.':printing?'Envoyer le G-code et demander son impression après confirmation.':'Conserver le G-code dans votre espace cloud sans lancer d’impression.';}
$('upload-form').elements.mode.onchange=()=>updateUploadButton();

const helpBubble=node('div',null,'help-bubble');helpBubble.id='ui-help-bubble';helpBubble.setAttribute('role','tooltip');helpBubble.hidden=true;document.body.append(helpBubble);let helpTarget=null,helpPinned=false;
/** Ferme l’aide et restaure les autres associations accessibles de l’élément ciblé. */
function hideHelp(){if(helpTarget){const previous=helpTarget.getAttribute('aria-describedby')||'';const cleaned=previous.split(' ').filter(x=>x!=='ui-help-bubble').join(' ');if(cleaned)helpTarget.setAttribute('aria-describedby',cleaned);else helpTarget.removeAttribute('aria-describedby');}helpTarget=null;helpPinned=false;helpBubble.hidden=true;}
/** Affiche une aide textuelle dans le dialogue actif ; pinned la maintient jusqu’à une fermeture explicite. */
function showHelp(target,pinned=false){const text=target.dataset.tooltip||target.getAttribute('title');if(!text)return;if(target.hasAttribute('title')){target.dataset.tooltip=text;target.removeAttribute('title');}if(helpTarget!==target)hideHelp();helpTarget=target;helpPinned=pinned;const parent=target.closest('dialog')||document.body;if(helpBubble.parentElement!==parent)parent.append(helpBubble);helpBubble.textContent=text;helpBubble.hidden=false;target.setAttribute('aria-describedby','ui-help-bubble');const r=target.getBoundingClientRect(),b=helpBubble.getBoundingClientRect();helpBubble.style.left=Math.max(10,Math.min(innerWidth-b.width-10,r.left+r.width/2-b.width/2))+'px';helpBubble.style.top=(r.top>=b.height+12?r.top-b.height-9:Math.min(innerHeight-b.height-8,r.bottom+9))+'px';}
document.addEventListener('pointerover',e=>{const target=e.target.closest('[title],[data-tooltip]');if(target&&!helpPinned)showHelp(target);});document.addEventListener('pointerout',e=>{if(!helpPinned&&helpTarget&&!helpTarget.contains(e.relatedTarget))hideHelp();});document.addEventListener('focusin',e=>{if(e.target.matches('[title],[data-tooltip]'))showHelp(e.target);});document.addEventListener('focusout',()=>{if(!helpPinned)hideHelp();});document.addEventListener('click',e=>{const help=e.target.closest('[data-tooltip-trigger]');if(help){e.preventDefault();showHelp(help,true);}else if(helpPinned&&!helpBubble.contains(e.target))hideHelp();});document.addEventListener('keydown',e=>{if(e.key==='Escape')hideHelp();});document.addEventListener('scroll',()=>{if(helpTarget)hideHelp();},true);

/** Conditionne axes et IA aux capacités annoncées et à une imprimante disponible. */
function updateNativeControls(p){const canMove=!!p.axes_supported&&p.is_available&&!p.job_in_progress;for(const button of document.querySelectorAll('[data-axis],#axis-release,#axis-step'))button.disabled=!canMove;set('axis-state',!p.axes_supported?'Contrôle non annoncé par cette imprimante':p.job_in_progress?'Indisponible pendant une impression':canMove?'Commandes disponibles':'Imprimante occupée ou hors ligne');$('task-details-open').disabled=!p.task_details;$('ai-open').disabled=!p.printer_online||!p.is_available||p.job_in_progress;$('ai-open').dataset.tooltip=$('ai-open').disabled?'Réglages disponibles lorsque l’imprimante est libre.':'Régler la détection du filament enchevêtré et des objets étrangers.';if($('task-dialog').open)renderTaskDetails();if($('ai-dialog').open&&aiLoaded){$('ai-form').querySelector('fieldset').disabled=!p.is_available||p.job_in_progress;}}
/** Renvoie le premier élément d’une liste ou la valeur scalaire, pour les paramètres de tranche multimatériaux. */
function single(v){return Array.isArray(v)?v[0]:v;}
/** Formate un paramètre scalaire ou son premier matériau, sans doubler une unité déjà présente. */
function valueUnit(v,unit=''){v=single(v);return v==null?'—':typeof v==='number'?v.toLocaleString(locale,{maximumFractionDigits:3})+unit:String(v)+(unit&&!String(v).includes(unit.trim())?unit:'');}
/** Affiche uniquement les paramètres de tranche transmis par le serveur et les données connues du projet courant. */
function renderTaskDetails(){const p=snapshot?.printer,d=p?.task_details;if(!d)return;set('task-name',p.job_name||'Tâche en cours');set('task-progress',`${fmt(p.job_progress,' %')} · ${p.job_current_layer??'—'} / ${p.job_total_layers??'—'} couches · ${mins(p.job_time_remaining)} restantes`);if(!$('job-preview').hidden){$('task-preview').src=$('job-preview').src;$('task-preview').hidden=false;}else $('task-preview').hidden=true;const params=d.parameters||{},time=d.estimated_time?String(d.estimated_time).replace(/(\d+)h/g,'$1 h ').replace(/(\d+)m/g,'$1 min ').replace(/(\d+)s/g,'$1 s').replace(/\s+/g,' ').trim():'—';definition('task-file',[['Dimensions',d.dimensions?.every(v=>v!=null)?d.dimensions.map(v=>fmt(v)).join(' × ')+' mm':'—'],['Couches',fmt(d.layers)],['Temps estimé',time],['Filament estimé',fmt(d.material_grams,' g')]]);const yes=v=>v==null?'—':[true,1,'1','true'].includes(single(v))?'Activé':'Désactivé';definition('task-parameters',[['Hauteur de couche',valueUnit(params.layer_height,' mm')],['Remplissage',valueUnit(params.fill_density,' %')],['Supports',yes(params.enable_support)],['Adhérence au plateau',params.brim_type==null?'—':({no_brim:'Sans bordure',auto_brim:'Automatique',outer_only:'Bordure externe',inner_only:'Bordure interne',outer_and_inner:'Bordures interne et externe'}[params.brim_type]||'Activée')],['Buse',valueUnit(params.temperature,' °C')],['Plateau',valueUnit(params.bed_temperature,' °C')],['Ventilation maximale',valueUnit(params.fan_max_speed,' %')],['Rétraction',valueUnit(params.filament_retract_length,' mm')],['Parois',valueUnit(params.perimeters)],['Largeur de paroi',valueUnit(params.perimeter_extrusion_width,' mm')],['Vitesse de paroi externe',valueUnit(params.outer_wall_speed,' mm/s')],['Déplacements',valueUnit(params.travel_speed,' mm/s')]]);}
$('task-details-open').onclick=()=>{renderTaskDetails();$('task-dialog').showModal();};
let aiLoaded=false;
let aiLoading=false;
/** Masque les anciennes valeurs pendant la consultation IA pour éviter d’appliquer des réglages périmés. */
async function loadAiSettings(){
 if(aiLoading)return;aiLoading=true;aiLoaded=false;const f=$('ai-form');f.hidden=true;f.querySelector('fieldset').disabled=true;$('ai-retry').hidden=true;set('ai-state','Lecture des réglages de l’imprimante…');
 try{const d=await request('/ai-settings'),a=d.settings,status=Number(a.status);f.elements.spaghetti.checked=!!(status&1);f.elements.foreign.checked=!!(status&2);f.elements.spaghetti_level.value=String(a.sensitivity_level?.[1]??1);f.elements.foreign_level.value=String(a.sensitivity_level?.[0]??1);f.elements.pause.value=String(a.notice_type?.[1]===1);$('ai-foreign-option').hidden=!snapshot?.printer?.foreign_detection_supported;aiLoaded=true;const busy=snapshot?.printer?.job_in_progress||!snapshot?.printer?.is_available;f.hidden=false;f.querySelector('fieldset').disabled=busy;set('ai-state',busy?'Imprimante occupée. Les modifications seront disponibles lorsqu’elle sera libre.':'Réglages actuels de la Kobra S1');}catch(e){set('ai-state','Réglages indisponibles : '+e.message+'. Réessayez lorsque l’imprimante est en ligne et libre.');$('ai-retry').hidden=false;}finally{aiLoading=false;}
}
$('ai-open').onclick=()=>{$('ai-dialog').showModal();loadAiSettings();};
$('ai-retry').onclick=loadAiSettings;
$('ai-form').onsubmit=async e=>{e.preventDefault();if(!aiLoaded)return;const f=e.target,result=await command('ai-settings',{spaghetti:f.elements.spaghetti.checked,foreign:f.elements.foreign.checked,spaghetti_level:Number(f.elements.spaghetti_level.value),foreign_level:Number(f.elements.foreign_level.value),pause:f.elements.pause.value==='true'},'Appliquer ces réglages de détection IA à la Kobra S1 ?');if(result)$('ai-dialog').close();};
for(const b of document.querySelectorAll('[data-axis]'))b.onclick=async()=>{if(b.disabled)return;if(!cameraTrack){await openCamera();if(!cameraTrack){message('Ouvrez la caméra avant de déplacer les axes.',true);return;}}await command('axis',{axis:Number(b.dataset.axis),direction:Number(b.dataset.direction),distance:Number($('axis-step').value)},'Déplacer les axes de l’imprimante avec ces paramètres ?');};
$('axis-release').onclick=()=>command('axis-off',{},'Libérer les moteurs de l’imprimante pour un déplacement manuel ?');
/** La suppression vise uniquement les notifications ; elle ne remplace pas celle des fiches d’impression. */
async function deleteHistory(key,allItems,button){if(!await confirmAction(allItems?'Effacer définitivement les notifications d’impression du compte Anycubic ?':'Effacer définitivement cette notification Anycubic ?'))return;button.disabled=true;try{const result=await request('/history/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(allItems?{all:true}:{key})});message(result.message);historyPage=1;await loadHistory(true);}catch(e){message(e.message,true);button.disabled=false;}finally{if(button.id!=='history-delete-all')button.disabled=false;}}

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
 set('notification-preview-state','Chargement de l’aperçu…');
 image.hidden=true;
 dialog.showModal();
 const src=await taskPreview({...item,key:'notification:'+item.key,notification:true});
 if(!dialog.open||dialog.dataset.notification!==item.key)return;
 const unavailable=()=>set('notification-preview-state','Aperçu indisponible pour cette notification.');
 if(!src){unavailable();return;}
 image.src=src;
 try{await image.decode();}catch{
  if(dialog.open&&dialog.dataset.notification===item.key)unavailable();
  return;
 }
 if(dialog.open&&dialog.dataset.notification===item.key){image.hidden=false;set('notification-preview-state',translate(item.result));}
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
 const button=node('button',null,'task-thumbnail'),image=node('img'),fallback=node('span','Aperçu indisponible');
 button.type='button';button.title='Voir les détails de '+t.name;button.setAttribute('aria-label',button.title);button.onclick=onOpen;image.alt='Aperçu de '+t.name;image.hidden=true;fallback.textContent='Chargement…';button.append(image,fallback);
 button.loadPreview=()=>taskPreview(t).then(src=>{/* La page de résultats peut avoir changé avant la fin du téléchargement. */if(!button.isConnected)return;if(src){image.onload=()=>{image.hidden=false;fallback.hidden=true;};image.onerror=()=>{image.hidden=true;fallback.hidden=false;fallback.textContent='Aperçu indisponible';};image.src=src;}else fallback.textContent='Aperçu indisponible';});
 (t.notification?notificationPreviewObserver:taskPreviewObserver).observe(button);return button;
}
const cloudSelected=new Set();let renameHandle=null,pastTaskKey=null,tasksPage=1,taskRows=[],deviceOptions=null,resetTicket=null,resetDeadline=0,historyView='tasks';
/** Formate le quota en unités binaires, en préservant la distinction entre zéro et une donnée absente. */
const bytes=v=>v==null?'—':Number(v)>=1073741824?(Number(v)/1073741824).toLocaleString(locale,{maximumFractionDigits:2})+' Go':Number(v)>=1048576?(Number(v)/1048576).toLocaleString(locale,{maximumFractionDigits:1})+' Mo':Number(v).toLocaleString(locale)+' octets';
/** Renvoie un bouton non soumis à un formulaire, associé au rappel fn. */
function extraButton(label,fn,cls){const b=node('button',translate(label),cls);b.type='button';b.onclick=fn;return b;}
/** Synchronise la sélection cloud et l’état indéterminé de la case de page. */
function cloudSelectionState(){const n=cloudSelected.size;set('cloud-selected-count',`${n} sélection${n>1?'s':''}`);for(const id of ['cloud-download-selected','cloud-delete-selected','cloud-clear-selection'])$(id).disabled=!n;$('cloud-select-page').checked=cloudRows.length>0&&cloudRows.every(f=>cloudSelected.has(f.handle));$('cloud-select-page').indeterminate=cloudRows.some(f=>cloudSelected.has(f.handle))&&!$('cloud-select-page').checked;}
/** Affiche le quota connu du cloud, sans déduire une capacité d’envoi d’une valeur absente. */
async function loadCloudStorage(){try{const d=await request('/extras/storage');set('cloud-quota',`${bytes(d.used)} utilisés sur ${bytes(d.total)} · ${bytes(d.free)} disponibles`);$('cloud-quota-bar').value=d.total?Math.min(100,d.used/d.total*100):0;}catch(e){set('cloud-quota',e.message);}}
/** Demande des tickets de téléchargement serveur afin de garder les URL cloud privées côté navigateur. */
async function downloadCloud(handles){try{const result=await request('/cloud/downloads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({handles})});$('cloud-download-links').replaceChildren(...result.downloads.map(f=>{const li=node('li'),a=node('a',f.name);a.href=f.url;a.target='_blank';a.rel='noopener noreferrer';li.append(a);return li;}));$('cloud-download-dialog').showModal();}catch(e){message(e.message,true);}}
/** Prépare le renommage de la référence opaque du fichier, sans envoyer de requête avant validation. */
function renameCloud(f){renameHandle=f.handle;$('cloud-rename-form').elements.name.value=f.name;$('cloud-rename-dialog').showModal();$('cloud-rename-form').elements.name.focus();}
$('cloud-rename-form').onsubmit=async e=>{e.preventDefault();const result=await command('cloud-rename',{handle:renameHandle,name:e.target.elements.name.value});if(result){$('cloud-rename-dialog').close();cloudSelected.clear();await loadFiles();}};
$('cloud-select-page').onchange=e=>{for(const f of cloudRows)e.target.checked?cloudSelected.add(f.handle):cloudSelected.delete(f.handle);renderFiles();};
$('cloud-clear-selection').onclick=()=>{cloudSelected.clear();renderFiles();};
$('cloud-download-selected').onclick=()=>downloadCloud([...cloudSelected]);
$('cloud-delete-selected').onclick=async()=>{const ok=await command('cloud-delete-many',{handles:[...cloudSelected]},`Supprimer définitivement les ${cloudSelected.size} fichiers sélectionnés du Cloud Anycubic ?`);if(ok){cloudSelected.clear();await loadFiles();await loadCloudStorage();}};
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
function taskSelectionState(){const rows=visibleTasks(),n=taskSelected.size;set('tasks-selected-count',`${n} sélection${n>1?'s':''}`);$('tasks-delete').disabled=!n;$('tasks-select-page').checked=!!rows.length&&rows.every(t=>taskSelected.has(t.key));$('tasks-select-page').indeterminate=rows.some(t=>taskSelected.has(t.key))&&!$('tasks-select-page').checked;}
/** Les cartes affichent les dates connues sans fabriquer une fin ni une durée manquante. */
function renderTasks(){taskPreviewObserver.disconnect();const rows=visibleTasks();$('tasks-list').replaceChildren(...rows.map(t=>{const li=node('li',null,'task-history-item'),select=node('input'),label=node('label',null,'history-card-select'),body=node('div',null,'history-card-body'),name=node('strong',t.name,'history-card-name'),state=node('span',({2:'Terminé',3:'Arrêté',1:'En cours',0:'En préparation'}[t.status_code]||t.status),'history-badge status-'+t.status_code),open=extraButton('Voir le détail',()=>openPastTask(t),'history-detail');select.type='checkbox';select.checked=taskSelected.has(t.key);select.setAttribute('aria-label','Sélectionner '+t.name);select.onchange=()=>{select.checked?taskSelected.add(t.key):taskSelected.delete(t.key);taskSelectionState();};label.append(select,node('span','Sélectionner','sr-only'));name.title=t.name;body.append(name,state,node('p',t.printer||'Imprimante','muted'),node('p','Début : '+date(t.start),'muted'),node('p','Fin : '+(t.end?date(t.end):'Non renseignée'),'muted'),node('p','Durée : '+(t.elapsed_minutes==null?'Non renseignée':Number(t.elapsed_minutes).toLocaleString(locale,{maximumFractionDigits:1})+' min'),'muted'),open);li.append(label,taskThumbnail(t),body);return li;}));set('tasks-state',rows.length?'':taskMore?'Aucune fiche correspondante dans les pages chargées. Chargez la suite pour poursuivre la recherche.':"Aucun historique d'impression");$('tasks-state').hidden=!!rows.length;$('tasks-state').className=rows.length?'muted':'empty-message';set('tasks-page',`${taskRows.length} fiche(s) chargée(s)`);$('tasks-next').hidden=!taskMore;taskSelectionState();}
/** Relit le cloud après mutation ; le cache d’affichage ne constitue pas une preuve de suppression. */
async function loadTasks(append=false){if(!append){tasksPage=1;taskRows=[];}set('tasks-state','Chargement des impressions…');$('tasks-state').hidden=false;try{const d=await request(`/extras/tasks?page=${tasksPage}&device=all`);taskRows=append?[...new Map([...taskRows,...d.items].map(t=>[t.key,t])).values()]:d.items;taskMore=d.has_more;const previous=$('tasks-printer').value,devices=new Map(taskRows.map(t=>[t.printer_key,t.printer]));$('tasks-printer').replaceChildren(new Option('Tous les appareils','all'),...[...devices].filter(([k])=>k).map(([k,name])=>new Option(name||'Imprimante',k)));$('tasks-printer').value=devices.has(previous)?previous:'all';if(!append)for(const key of taskSelected)if(!taskRows.some(t=>t.key===key))taskSelected.delete(key);renderTasks();}catch(e){set('tasks-state',e.message);$('tasks-state').hidden=false;}}
/** L’onglet d’historique est distinct du centre de messages de la cloche. */
function historyViewSet(){historyView='tasks';loadTasks();}
for(const button of document.querySelectorAll('[data-task-status]'))button.onclick=()=>{taskStatus=button.dataset.taskStatus;for(const b of document.querySelectorAll('[data-task-status]'))b.setAttribute('aria-pressed',String(b===button));renderTasks();};
for(const id of ['tasks-printer','tasks-from','tasks-to','tasks-search'])$(id).oninput=renderTasks;
$('tasks-select-page').onchange=e=>{for(const t of visibleTasks())e.target.checked?taskSelected.add(t.key):taskSelected.delete(t.key);taskSelectionState();};
$('tasks-next').onclick=()=>{tasksPage++;loadTasks(true);};
$('tasks-delete').onclick=async()=>{const keys=[...taskSelected],names=taskRows.filter(t=>taskSelected.has(t.key)).map(t=>'• '+t.name).join('\n');const result=await command('task-delete-many',{keys},`Retirer ${keys.length} fiche(s) de l’historique ?\n${names}\nCes fiches seront aussi retirées de l’historique dans l’application Anycubic et le slicer.`);if(result){taskSelected.clear();await loadTasks();}};
/** Affiche détails, diagnostic et aperçu d’une tâche, sans interpréter une donnée absente comme une valeur nulle. */
async function openPastTask(t){
 const dialog=$('past-task-dialog');
 pastTaskKey=t.key;
 set('past-task-name',t.name);
 set('past-task-state','Chargement des détails…');
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
 set('past-task-actions-state',!selected?'Sélectionnez l’imprimante de cette fiche pour agir.':!t.can_reprint?'G-code non disponible pour la réimpression.':reprint.disabled?'Imprimante hors ligne ou occupée.':'');
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
  set('past-task-state',t.status);
  $('past-task-diagnostic').hidden=!(d.reason||d.reason_code||d.help_url);
  set('past-task-reason',d.reason_code?`${d.reason||'Diagnostic Anycubic'} · Code ${d.reason_code}`:d.reason||'');
  if(d.help_url){$('past-task-help').href=d.help_url;$('past-task-help').hidden=false;}
  const dims=d.dimensions,params=d.parameters||{};
  definition('past-task-data',[
   ['Dimensions',dims?['length','width','height'].map(k=>fmt(dims[k])).join(' × ')+' mm':'—'],
   ['Couches',fmt(d.layers)],
   ['Durée rapportée',mins(d.reported_minutes)],
   ['Temps estimé',d.estimated_seconds==null?'—':mins(d.estimated_seconds/60)],
   ['Filament estimé',fmt(d.material_grams,' g')],
  ]);
  if(d.materials?.length){
   const details=node('details'),list=node('ul');
   details.append(node('summary','Filaments estimés par matière'),list);
   for(const {material,grams,color} of d.materials){
    const row=node('li');
    if(color){
     const swatch=node('span',null,'material-color');
     swatch.style.backgroundColor=color;
     swatch.setAttribute('aria-hidden','true');
     row.append(swatch);
    }
    row.append(document.createTextNode([material||'Matière non renseignée',color,fmt(grams,' g')].filter(Boolean).join(' · ')));
    list.append(row);
   }
   $('past-task-parameters').append(details);
  }
  const groups=[
   ['Général',[['Hauteur de couche','layer_height',' mm'],['Remplissage','fill_density',' %'],['Supports','enable_support'],['Adhérence','brim_type']]],
   ['Températures et ventilation',[['Buse','temperature',' °C'],['Plateau','bed_temperature',' °C'],['Ventilation maximale','fan_max_speed',' %']]],
   ['Extrusion et parois',[['Rétraction','filament_retract_length',' mm'],['Nombre de parois','perimeters'],['Largeur des parois','perimeter_extrusion_width',' mm']]],
   ['Vitesses',[['Paroi externe','outer_wall_speed',' mm/s'],['Déplacement','travel_speed',' mm/s']]],
  ];
  for(const [title,fields] of groups){
   const available=fields.filter(([,key])=>params[key]!=null);
   if(!available.length)continue;
   const details=node('details'),list=node('dl',null,'task-data');
   details.append(node('summary',translate(title)),list);
   for(const [label,key,unit] of available){
    const value=params[key];
    const row=node('div');
    row.append(node('dt',translate(label)),node('dd',typeof value==='boolean'?translate(value?'Oui':'Non'):valueUnit(value,unit)));
    list.append(row);
   }
   $('past-task-parameters').append(details);
  }
 }catch(e){if(current())set('past-task-state',e.message);}
}
/** Vérifie l’éligibilité cloud avant d’autoriser l’envoi d’une note sur la tâche sélectionnée. */
async function openRating(t){pastTaskKey=t.key;set('rating-task-name',t.name);set('rating-state','Vérification auprès d’Anycubic…');$('rating-form').reset();$('rating-form').querySelector('fieldset').disabled=true;$('task-rating-dialog').showModal();try{const d=await request('/extras/rating?key='+encodeURIComponent(t.key));$('rating-form').querySelector('fieldset').disabled=!d.available||d.already_rated;set('rating-state',d.already_rated?'Cette impression est déjà évaluée':d.available?'La note sera envoyée au compte Anycubic':'Anycubic ne propose pas d’évaluation pour cette impression');}catch(e){set('rating-state',e.message);}}
$('rating-form').onsubmit=async e=>{e.preventDefault();const ok=await command('task-rate',{key:pastTaskKey,stars:Number(new FormData(e.target).get('stars'))},'Envoyer cette note à Anycubic ?');if(ok){$('task-rating-dialog').close();loadTasks();}};
$('task-reprint-form').onsubmit=async e=>{
 e.preventDefault();
 const form=e.currentTarget,submit=form.querySelector('[type=submit]');
 if(submit.disabled||busy)return;
 let mapping;
 try{mapping=slots(form.elements.slots.value);}catch(err){message(err.message,true);return;}
 const wording=mapping.length
  ?'Réimprimer « {0} » sur {1} ? Vérifiez que le plateau est libre et que les bobines correspondent aux emplacements {2}.'
  :'Réimprimer « {0} » sur {1} ? Vérifiez que le plateau est libre et que les bobines correspondent au fichier.';
 submit.disabled=true;
 try{
  const ok=await command('task-reprint',{key:pastTaskKey,slots:mapping},translateFormat(wording,$('reprint-task-name').textContent,$('reprint-target').textContent,mapping.join(', ')));
  if(ok)$('task-reprint-dialog').close();
 }finally{submit.disabled=false;}
};
const assistLabels={0:'Contrôle de la courroie',1:'Détection de perte de pas',2:'Relais automatique',3:'Alerte de fin de filament',4:'Alerte de blocage du filament',5:'Suivi du filament restant'};
/** N’expose les réglages avancés que si les capacités et options constructeur les autorisent. */
async function loadDeviceOptions(){const button=$('device-options-load');button.disabled=true;set('device-options-state','Lecture des options du constructeur…');try{const d=await request('/extras/device');deviceOptions=d;set('device-options-state',d.message||'Options reçues de l’imprimante');$('calibration-choices').replaceChildren(...d.calibrations.map(c=>{const label=node('label',null,'check'),input=node('input');input.type='checkbox';input.name='items';input.value=c.key;label.append(input,document.createTextNode(c.label));return label;}));$('calibration-fields').disabled=!d.calibrations.length;set('calibration-help',d.calibrations.length?'Choisissez les calibrations à lancer, plateau libre.':d.calibration_advertised?'Le nivellement et la compensation sont annoncés, mais leur commande à distance n’est pas confirmée pour ce firmware.':'Aucune calibration à distance fournie pour ce firmware.');$('hardware-form').hidden=!d.hardware_editable;$('hardware-form').querySelector('fieldset').disabled=!d.hardware_editable;set('hardware-help',d.hardware_editable?'Réglages déclarés par le constructeur.':'Le Cloud ne permet pas de modifier le matériel sur ce firmware.');if(d.hardware_editable){for(const k of ['diameter','material'])if(d.hardware[k]!=null)$('hardware-form').elements[k].value=d.hardware[k];if(d.bed.material!=null)$('hardware-form').elements.bed.value=d.bed.material;}$('assist-options').replaceChildren(...d.assistance.filter(r=>[0,3,4,5].includes(r.option)).map(r=>{const label=node('label',null,'check'),input=node('input');input.type='checkbox';input.name=String(r.option);input.checked=!!Number(r.value);label.append(input,document.createTextNode(assistLabels[r.option]||r.label||'Option constructeur'));return label;}));$('assist-form').querySelector('fieldset').disabled=!d.assistance.length;set('assist-help',d.assistance.length?'Options actuelles communiquées par la machine.':'Options d’assistance non fournies par ce firmware.');$('screen-option').replaceChildren(...d.screen.filter(r=>[0,1].includes(r.option)).map(r=>new Option(r.option===0?'Extinction de l’écran':'Mise en veille',r.option)));$('screen-form').querySelector('fieldset').disabled=!$('screen-option').options.length;set('screen-help',d.screen.length?'Délai avant la mise en veille.':'Réglage de veille non fourni par ce firmware.');const visible=[d.calibrations.length>0,d.hardware_editable,d.assistance.some(r=>[0,3,4,5].includes(r.option)),d.screen.some(r=>[0,1].includes(r.option)),d.factory_reset];document.querySelectorAll('.extras-settings-grid>section').forEach((card,i)=>card.hidden=!visible[i]);document.querySelector('.extras-settings-grid').hidden=!visible.some(Boolean);document.querySelector('.extras-settings-heading').hidden=!visible.some(Boolean);$('reset-open').disabled=!d.factory_reset||!snapshot?.printer?.is_available;set('reset-help',d.factory_reset?'Rétablit les réglages d’usine, après confirmation et code à recopier.':'La réinitialisation Cloud n’est pas annoncée pour ce firmware.');}catch(e){set('device-options-state',e.message);}finally{button.disabled=false;}}
$('device-options-load').onclick=loadDeviceOptions;
$('calibration-form').onsubmit=e=>{e.preventDefault();command('calibrate',{items:new FormData(e.target).getAll('items')},'Lancer les calibrations choisies ? Le plateau doit être libre.');};
$('hardware-form').onsubmit=e=>{e.preventDefault();const f=e.target;command('hardware',{diameter:Number(f.elements.diameter.value),material:Number(f.elements.material.value),bed:Number(f.elements.bed.value)},'Mettre à jour la configuration du matériel ?');};
$('assist-form').onsubmit=e=>{e.preventDefault();command('assist',{items:[...e.target.querySelectorAll('input[type=checkbox]')].map(i=>({option:Number(i.name),value:i.checked}))},'Appliquer ces options d’assistance ?');};
$('screen-form').onsubmit=e=>{e.preventDefault();command('screen',{option:Number(e.target.elements.option.value),minutes:Number(e.target.elements.minutes.value)},'Modifier le délai de veille ?');};
$('reset-open').onclick=()=>{resetTicket=null;$('reset-understood').checked=false;$('reset-get-code').disabled=true;$('reset-form').hidden=true;$('reset-form').reset();$('reset-dialog').showModal();};$('reset-understood').onchange=e=>$('reset-get-code').disabled=!e.target.checked;
$('reset-get-code').onclick=async()=>{if(!$('reset-understood').checked)return;try{const d=await request('/reset/challenge',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});resetTicket=d.ticket;resetDeadline=Date.now()+d.expires_in*1000;set('reset-code',d.code);$('reset-form').hidden=false;set('reset-state','Ce code est à usage unique');$('reset-form').elements.code.focus();}catch(e){set('reset-help',e.message);message(e.message,true);}};
$('reset-form').onsubmit=async e=>{e.preventDefault();if(!resetTicket||Date.now()>resetDeadline){set('reset-state','Code expiré. Demandez un nouveau code.');return;}const ok=await command('factory-reset',{ticket:resetTicket,code:e.target.elements.code.value});resetTicket=null;if(ok)$('reset-dialog').close();else set('reset-state','Demandez un nouveau code avant de réessayer');};
let timelapsePage=1,timelapseKeyword='',timelapseGeneration=0;
/** L’imprimante sélectionnée est la seule interrogée et la dernière recherche prévaut. */
async function loadTimelapse(page=1){
 const generation=++timelapseGeneration;
 const previous=$('timelapse-previous'),next=$('timelapse-next');
 previous.disabled=true;next.disabled=true;
 $('timelapse-list').replaceChildren();
 set('timelapse-state',translate('Lecture des vidéos…'));
 try{
  const d=await request('/extras/videos?'+new URLSearchParams({page,keyword:timelapseKeyword}));
  if(generation!==timelapseGeneration)return;
  timelapsePage=page;
  set('timelapse-state',translate(d.message||(!d.items?.length?'Aucune vidéo signalée':'')));
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
