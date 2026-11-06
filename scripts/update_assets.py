"""Actualisation des versions et empreintes d’intégrité des ressources de l’atelier."""
from pathlib import Path
import base64
import hashlib
import re

root = Path(__file__).resolve().parents[1] / 'web'
for page in ('imprimante.html', 'login.html'):
    file = root / page
    html = file.read_text()
    for name in ('imprimante.css', 'landing.css'):
        digest = hashlib.sha256((root / 'css' / name).read_bytes()).hexdigest()[:12]
        path = '/imprimante-api/ui/css/' + name
        html = re.sub(re.escape(path) + r'\?v=[^"\s]+', path + '?v=' + digest, html)
    for name in ('imprimante.js',):
        path = '/imprimante-api/ui/js/' + name
        digest = hashlib.sha256((root / 'js' / name).read_bytes())
        version = digest.hexdigest()[:12]
        integrity = base64.b64encode(digest.digest()).decode()
        # Chaque script doit conserver sa propre empreinte SRI après modification.
        pattern = r'<script src="' + re.escape(path) + r'(?:\?v=[^"]*)?"[^>]*>'
        html = re.sub(pattern, f'<script src="{path}?v={version}" integrity="sha256-{integrity}" crossorigin="anonymous">', html)
    file.write_text(html)
