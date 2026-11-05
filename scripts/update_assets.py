"""Actualisation des versions et empreintes d’intégrité HTML après modification du JavaScript ou des CSS."""
from pathlib import Path
import base64,hashlib,re
root=Path(__file__).resolve().parents[1]/'web';file=root/'imprimante.html';html=file.read_text()
for folder,name in [('css','imprimante.css'),('css','landing.css'),('js','imprimante.js')]:
 digest=hashlib.sha256((root/folder/name).read_bytes()).hexdigest()[:12]
 html=re.sub(r'/'+folder+'/'+re.escape(name)+r'\?v=[^"\s]+','/'+folder+'/'+name+'?v='+digest,html)
# Le navigateur bloque le JavaScript si l’empreinte SRI ne correspond plus, même après un simple commentaire.
digest=base64.b64encode(hashlib.sha256((root/'js/imprimante.js').read_bytes()).digest()).decode();html=re.sub(r'integrity="sha256-[^"]+"','integrity="sha256-'+digest+'"',html);file.write_text(html)
