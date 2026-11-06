"""Calcule les versions d’URL et l’intégrité des scripts ainsi que de leurs imports locaux."""

import base64
import hashlib
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1] / "web"
UI = "/imprimante-api/ui"
MODULES = ("workshop-ui.mjs", "workshop-api.mjs")


def signature(content):
    """Renvoie la version courte et l’empreinte SRI du même contenu."""
    digest = hashlib.sha256(content).digest()
    return digest.hex()[:12], "sha256-" + base64.b64encode(digest).decode()


def update(check=False):
    """Actualise les ressources ou vérifie leurs empreintes sans écrire en mode CI."""
    entry = ROOT / "js/imprimante.js"
    script = entry.read_text()
    preload = []
    for name in MODULES:
        version, integrity = signature((ROOT / "js" / name).read_bytes())
        path = f"./{name}"
        script = re.sub(re.escape(path) + r"(?:\?v=[^'\"]*)?", f"{path}?v={version}", script)
        preload.append(
            f'<link rel="modulepreload" href="{UI}/js/{name}?v={version}" integrity="{integrity}" crossorigin="anonymous">'
        )
    version, integrity = signature(script.encode())
    changed = []

    def apply(file, content):
        if file.read_text() == content:
            return
        changed.append(file.name)
        if not check:
            file.write_text(content)

    apply(entry, script)
    for name in ("imprimante.html", "login.html"):
        page = ROOT / name
        html = page.read_text()
        for style in ("imprimante.css", "landing.css"):
            digest, _ = signature((ROOT / "css" / style).read_bytes())
            path = f"{UI}/css/{style}"
            html = re.sub(re.escape(path) + r'\?v=[^"\s]+', f"{path}?v={digest}", html)
        if name == "imprimante.html":
            html = re.sub(r'<link rel="modulepreload"[^>]+>', "", html)
            html = re.sub(
                r'<script id="workshop-script"[^>]+>',
                "".join(preload)
                + f'<script id="workshop-script" type="module" src="{UI}/js/imprimante.js?v={version}" integrity="{integrity}" crossorigin="anonymous">',
                html,
            )
        apply(page, html)
    if check and changed:
        raise SystemExit("Empreintes à régénérer : " + ", ".join(changed))


if __name__ == "__main__":
    update(check="--check" in sys.argv)
