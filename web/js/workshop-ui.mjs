export const locale='fr-FR';
/** Insère des valeurs littérales dans les confirmations, sans interpréter leur contenu. */
export const formatText=(label,...values)=>label.replace(/\{(\d+)\}/g,(_,index)=>String(values[index]??''));
export const timeZone=document.documentElement.dataset.timeZone||'Europe/Paris';
/** Renvoie l’élément HTML par identifiant ; les contrôles de cette page partagent ce point d’accès. */
export const $=id=>document.getElementById(id);
/** Écrit du texte littéral et représente une valeur absente par un tiret. */
export const set=(id,value)=>{$(id).textContent=value??'—';};
/** Formate une valeur en français avec suffixe, en distinguant zéro d’une donnée absente. */
export const fmt=(v,suffix='')=>v==null?'—':`${typeof v==='number'?v.toLocaleString(locale,{maximumFractionDigits:1}):v}${suffix}`;
/** Formate des minutes arrondies en durée lisible ; une valeur absente reste inconnue. */
export const mins=v=>{if(v==null)return '—';const n=Math.max(0,Math.round(v)),h=Math.floor(n/60),m=n%60;return h?`${h} h${m?' '+m+' min':''}`:`${m} min`;};
/** Affiche le fuseau configuré pour garder historique et graphiques cohérents ; accepte les horodatages ISO et les secondes Unix du cloud. */
export const date=v=>v?new Date(typeof v==='number'&&v>1e9&&v<1e11?v*1000:v).toLocaleString(locale,{timeZone}):'—';
/** Crée un élément avec texte littéral afin de ne pas interpréter les noms cloud comme du HTML. */
export const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e;};
/** Affiche un retour horodaté ; error distingue une erreur sans exposer de détails internes. */
export function message(text,error=false){set('message-text',text?`${new Date().toLocaleTimeString(locale,{hour:'2-digit',minute:'2-digit',timeZone})} — ${text}`:'');$('message').hidden=!text;$('message').classList.toggle('error',error);}
/** Renvoie une promesse booléenne ; une fermeture du dialogue annule l’action physique proposée. */
export function confirmAction(text){return new Promise(resolve=>{const d=$('confirm-dialog');set('confirm-text',text);d.showModal();const finish=value=>{d.close();resolve(value);};$('confirm-no').onclick=()=>finish(false);$('confirm-yes').onclick=()=>finish(true);d.oncancel=()=>resolve(false);});}
