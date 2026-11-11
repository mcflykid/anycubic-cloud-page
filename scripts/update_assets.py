"""Calcule les versions d’URL et l’intégrité des scripts ainsi que de leurs imports locaux."""

import base64
import hashlib
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1] / "web"
UI = "/imprimante-api/ui"
MODULES = (
    "workshop-ui.mjs",
    "workshop-api.mjs",
    "workshop-temperatures.mjs",
    "workshop-camera.mjs",
    "workshop-file-previews.mjs",
    "workshop-state.mjs",
    "workshop-commands.mjs",
    "workshop-overview.mjs",
    "workshop-ace.mjs",
    "workshop-selection.mjs",
    "workshop-files.mjs",
    "workshop-history.mjs",
    "workshop-settings.mjs",
    "workshop-timelapses.mjs",
    "workshop-help.mjs",
    "workshop-fleet.mjs",
    "workshop-navigation.mjs",
    "workshop-login.mjs",
    "workshop-interactions.mjs",
    "workshop-monitoring.mjs",
    "workshop-lab.mjs",
)


def signature(content):
    """Renvoie la version courte et l’empreinte SRI du même contenu."""
    digest = hashlib.sha256(content).digest()
    return digest.hex()[:12], "sha256-" + base64.b64encode(digest).decode()


def update(check=False):
    """Actualise les ressources ou vérifie leurs empreintes sans écrire en mode CI."""
    js_dir = ROOT / "js"
    if {path.name for path in js_dir.glob("*.mjs")} != set(MODULES):
        raise SystemExit(
            "Chaque module JavaScript doit être déclaré pour le versionnement et le SRI."
        )
    entry = js_dir / "imprimante.js"
    preload = []
    versions = {}
    catalogue = "workshop-translations.json"
    versions[catalogue], catalogue_integrity = signature((ROOT / "js" / catalogue).read_bytes())
    changed = []

    def apply(file, content):
        if file.read_text() == content:
            return
        changed.append(file.name)
        if not check:
            file.write_text(content)

    def version_imports(content):
        for module, version in versions.items():
            path = f"./{module}"
            content = re.sub(re.escape(path) + r"(?:\?v=[^'\"]*)?", f"{path}?v={version}", content)
        return content

    # Le module d’utilitaires est calculé avant les modules qui l’importent.
    for name in MODULES:
        module = ROOT / "js" / name
        content = version_imports(module.read_text())
        if name == "workshop-ui.mjs":
            content = re.sub(
                r"const catalogueIntegrity\s*=\s*'[^']*';",
                f"const catalogueIntegrity = '{catalogue_integrity}';",
                content,
            )
        apply(module, content)
        version, integrity = signature(content.encode())
        versions[name] = version
        preload.append(
            f'<link rel="modulepreload" href="{UI}/js/{name}?v={version}" integrity="{integrity}" crossorigin="anonymous">'
        )
    script = version_imports(entry.read_text())
    version, integrity = signature(script.encode())
    apply(entry, script)
    for name in (
        "imprimante.html",
        "login.html",
        "cookies.html",
        "credits.html",
        "privacy.html",
        "terms.html",
    ):
        page = ROOT / name
        html = page.read_text()
        for style in (
            "imprimante.css",
            "landing.css",
            "monitoring.css",
            "interactions.css",
            "lab.css",
        ):
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
        if name != "imprimante.html":
            html = re.sub(
                r'<script id="workshop-language"[^>]+>',
                preload[0].replace(
                    '<link rel="modulepreload" href=',
                    '<script id="workshop-language" type="module" src=',
                ),
                html,
            )
        if name == "login.html":
            login_version, login_integrity = signature((js_dir / "workshop-login.mjs").read_bytes())
            html = re.sub(
                r'<script id="login-interactions"[^>]+>',
                f'<script id="login-interactions" type="module" src="{UI}/js/workshop-login.mjs?v={login_version}" integrity="{login_integrity}" crossorigin="anonymous">',
                html,
            )
        apply(page, html)
    if check and changed:
        raise SystemExit("Empreintes à régénérer : " + ", ".join(changed))


if __name__ == "__main__":
    update(check="--check" in sys.argv)
