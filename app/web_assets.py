"""Prépare les URL et les empreintes d’intégrité des ressources au démarrage."""

import base64
from functools import lru_cache
import hashlib
import re

UI_PREFIX = "/imprimante-api/ui"
CATALOGUE = "workshop-translations.json"
CATALOGUE_MARKER = "__CATALOGUE_INTEGRITY__"
REQUIRED = {
    "imprimante.html",
    "login.html",
    "privacy.html",
    "terms.html",
    "cookies.html",
    "credits.html",
    "js/imprimante.js",
    "js/workshop-ui.mjs",
    "js/workshop-login.mjs",
    f"js/{CATALOGUE}",
}
LOCAL_IMPORT = re.compile(r"""(['"])(\./[\w.-]+\.(?:mjs|json))\1""")
ASSET_LINK = re.compile(rf'\b(?:src|href)="({UI_PREFIX}/((?:css|js|icons)/[\w.-]+))"')
SCRIPT = re.compile(r'<script\b[^>]+\bsrc="[^"]+"[^>]*>')
VERSIONED_SOURCE = re.compile(r"\?v=[0-9a-f]{12}\b|integrity=\"sha256-")


def integrity(content):
    """Calcule l’empreinte SRI des octets qui seront servis."""
    return "sha256-" + base64.b64encode(hashlib.sha256(content).digest()).decode("ascii")


@lru_cache(maxsize=4)
def build_web_assets(root):
    """Prépare en mémoire le HTML et les scripts du même instantané de ressources."""
    files = {
        path.relative_to(root).as_posix(): path.read_bytes()
        for path in sorted(root.rglob("*"))
        if path.is_file()
        # Les sources d’origine conservées à part ne font pas partie des ressources servies.
        and path.relative_to(root).parts[0] != "vendor"
        and path.suffix in {".html", ".js", ".mjs", ".json", ".css", ".svg", ".png"}
    }
    missing = REQUIRED.difference(files)
    if missing:
        raise ValueError("Ressources obligatoires absentes : " + ", ".join(sorted(missing)))
    # Une révision partagée propage le changement d’une dépendance à toutes ses URL d’import.
    revision = hashlib.sha256(
        b"".join(
            name.encode() + b"\0" + hashlib.sha256(data).digest() for name, data in files.items()
        )
    ).hexdigest()[:12]
    query = f"?v={revision}"
    scripts = {}

    def local_import(match):
        name = match[2][2:]
        if f"js/{name}" not in files:
            raise ValueError(f"Import local absent : {name}")
        return f"{match[1]}{match[2]}{query}{match[1]}"

    for name, content in files.items():
        if name == "js/imprimante.js" or name.endswith(".mjs"):
            source = content.decode()
            if VERSIONED_SOURCE.search(source):
                raise ValueError(f"Empreinte générée dans le source : {name}")
            if name == "js/workshop-ui.mjs":
                if source.count(CATALOGUE_MARKER) != 1:
                    raise ValueError("Marqueur d’intégrité du catalogue absent ou dupliqué.")
                source = source.replace(CATALOGUE_MARKER, integrity(files[f"js/{CATALOGUE}"]))
            scripts[name] = LOCAL_IMPORT.sub(local_import, source).encode()

    def asset_link(match):
        if match[2] not in files:
            raise ValueError(f"Ressource web absente : {match[2]}")
        return match[0][:-1] + query + '"'

    def script_integrity(match):
        tag = match[0]
        path = ASSET_LINK.search(tag)
        if not path or path[2] not in scripts:
            return tag
        return tag[:-1] + f' integrity="{integrity(scripts[path[2]])}" crossorigin="anonymous">'

    preload = "".join(
        f'<link rel="modulepreload" href="{UI_PREFIX}/{name}{query}" '
        f'integrity="{integrity(content)}" crossorigin="anonymous">'
        for name, content in scripts.items()
        if name.endswith(".mjs")
    )
    pages = {}
    for name, content in files.items():
        if not name.endswith(".html"):
            continue
        source = content.decode()
        if VERSIONED_SOURCE.search(source):
            raise ValueError(f"Empreinte générée dans le source : {name}")
        rendered = ASSET_LINK.sub(asset_link, SCRIPT.sub(script_integrity, source))
        if name == "imprimante.html":
            rendered = rendered.replace(
                '<script id="workshop-script"', preload + '<script id="workshop-script"'
            )
        pages[name] = rendered
    return pages, scripts
