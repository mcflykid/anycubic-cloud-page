/** Lance uniquement la démonstration authentifiée, avec un mot de passe fictif dans un fichier privé temporaire. */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cloud-page-ui-')),secret=path.join(directory,'web-password'),port=process.env.UI_PORT||'8765';
fs.writeFileSync(secret,'ui-fixture-password',{mode:0o600});
const child=spawn(process.env.UI_PYTHON||'python3',['-B','app/demo.py','--auth','--port',port,'--host','127.0.0.1'],{stdio:'inherit',env:{...process.env,PUBLIC_ORIGIN:'http://127.0.0.1:'+port,WEB_USER:'admin',WEB_PASSWORD_FILE:secret}});
/** Ne retire que les fichiers fictifs créés par ce lanceur ; le serveur enfant reçoit le signal d’arrêt. */
function cleanup(){child.kill('SIGTERM');fs.rmSync(directory,{recursive:true,force:true});}
process.on('SIGTERM',cleanup);process.on('SIGINT',cleanup);child.on('exit',code=>{fs.rmSync(directory,{recursive:true,force:true});process.exit(code||0);});
