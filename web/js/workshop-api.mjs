export const api='/imprimante-api';

/** Applique la cible propre au navigateur et réserve les reprises automatiques aux lectures. */
export function createRequest(getPrinter){
 return async function request(path,options={}){
  const {timeoutMs,...fetchOptions}=options;
  const target=options.printerKey??getPrinter();
  const read=!options.method||options.method==='GET'||path==='/camera-session';
  let response;
  for(let attempt=0;attempt<(read?2:1);attempt++){
   try{
    response=await fetch(api+path,{
     cache:'no-store',
     signal:AbortSignal.timeout(timeoutMs??(path.startsWith('/files/')?45000:90000)),
     ...fetchOptions,
     headers:{...options.headers,...(target&&path!=='/printers'?{'X-Printer-Key':target}:{})}
    });
   }catch(error){
    if(read&&attempt===0)continue;
    throw new Error(path==='/upload'
     ?'Résultat de l’envoi incertain. Vérifiez les fichiers du cloud et l’état de l’imprimante avant tout nouvel essai.'
     :read?'Connexion au serveur interrompue. Nouvelle tentative automatique.'
     :'Connexion interrompue. Vérifiez l’état de la machine avant de renvoyer cette commande.');
   }
   if(read&&[502,503,504].includes(response.status)&&attempt===0){
    await new Promise(resolve=>setTimeout(resolve,1200));
    continue;
   }
   break;
  }
  if(response.status===401){
   window.location.assign('/login');
   throw new Error('Session expirée. Reconnectez-vous avant toute nouvelle action.');
  }
  const raw=await response.text();
  let data;
  try{data=JSON.parse(raw);}
  catch{
   throw new Error(read
    ?`Le service redémarre ou ne répond pas (HTTP ${response.status}). Nouvelle tentative automatique.`
    :`Le service n’a pas confirmé la commande (HTTP ${response.status}). Vérifiez l’état de la machine avant un nouvel essai.`);
  }
  if(!response.ok||data.ok===false&&path!='/status'){
   const error=new Error(data.message||`Erreur ${response.status}`);
   error.cameraReason=data.camera_error;
   throw error;
  }
  return data;
 };
}
