"""Prépare les données privées avant l’abandon des privilèges du conteneur."""

import json, os, pathlib, sys

APP_DIRECTORY = str(pathlib.Path(__file__).resolve().parents[1] / "app")
if APP_DIRECTORY not in sys.path:
    sys.path.insert(0, APP_DIRECTORY)

import logging
from prepare_vendor import prepare, private_write
from operational_logging import log_event

_log = logging.getLogger("cloud_page.bootstrap")


def identity(environ):
    """Renvoie PUID et PGID validés ; ValueError refuse un serveur root ou un identifiant Unix invalide."""
    try:
        uid = int(environ.get("PUID", "1000"))
        gid = int(environ.get("PGID", "1000"))
    except (ValueError, TypeError):
        raise ValueError("PUID et PGID doivent être des identifiants Unix numériques.") from None
    if not 0 < uid < 2**32 - 1 or not 0 <= gid < 2**32 - 1:
        raise ValueError(
            "PUID doit être non nul et PUID/PGID doivent être des identifiants Unix valides."
        )
    return uid, gid


def initialize(
    secret_dir="/appdata/private",
    state_dir="/appdata/state",
    environ=None,
    prepare_fn=prepare,
    appdata_dir=None,
):
    """Valide puis prépare secrets et état ; prepare_fn isole le réseau. ValueError si incohérent, OSError si inaccessible."""
    log_event(
        _log,
        logging.INFO,
        "container_setup_started",
        message="Vérification des répertoires privés, des droits et des ressources client",
    )
    env = os.environ if environ is None else environ
    secret = pathlib.Path(secret_dir)
    state = pathlib.Path(state_dir)
    uid, gid = identity(env)
    email = env.get("ANYCUBIC_EMAIL", "").strip()
    password = env.get("ANYCUBIC_PASSWORD", "")
    token = env.get("ANYCUBIC_TOKEN", "").strip()
    web_password = env.get("WEB_PASSWORD", "")
    roots = [secret, state] if appdata_dir is None else [pathlib.Path(appdata_dir), secret, state]
    # Une donnée persistée ne doit pas rediriger l’initialisation vers un emplacement extérieur.
    for root in roots:
        if any(path.is_symlink() for path in [root, *root.rglob("*")]):
            raise ValueError("Les dossiers privés ne doivent pas contenir de liens symboliques.")
    saved_account = None
    if (secret / "anycubic-account").is_file():
        try:
            saved_account = json.loads((secret / "anycubic-account").read_text())
            if (
                not isinstance(saved_account, dict)
                or not saved_account.get("email")
                or not saved_account.get("password")
            ):
                raise ValueError
        except (ValueError, TypeError):
            raise ValueError("Le compte enregistré est illisible ou incomplet.") from None
    saved_token = (
        (secret / "anycubic-token").read_text().strip()
        if (secret / "anycubic-token").is_file()
        else ""
    )
    if not env.get("WEB_USER", "admin").strip():
        raise ValueError("WEB_USER ne peut pas être vide.")
    if email and saved_account and saved_account["email"].casefold() != email.casefold():
        raise ValueError(
            "Un autre compte Anycubic est enregistré. Utilisez un nouvel APPDATA_DIR pour changer de compte."
        )
    if password and not email:
        raise ValueError("Renseignez ANYCUBIC_EMAIL avec ANYCUBIC_PASSWORD.")
    # Le compte existant a déjà été comparé sans distinction de casse.
    if email and not password and not saved_account:
        raise ValueError("Renseignez le mot de passe pour ce compte Anycubic non enregistré.")
    if not (email and password) and not token and not saved_account and not saved_token:
        raise ValueError("Renseignez le compte Anycubic dans le Compose ou le fichier .env.")
    if token and saved_account and not (email and password):
        raise ValueError(
            "Un compte est déjà enregistré. Ne remplacez pas implicitement son mode de connexion par un token."
        )
    if not web_password:
        if not (secret / "web-password").is_file():
            raise ValueError("Renseignez WEB_PASSWORD (au moins 6 caractères).")
        effective_password = (secret / "web-password").read_text().strip()
    else:
        effective_password = web_password.strip()
    if len(effective_password) < 6:
        raise ValueError("WEB_PASSWORD doit contenir au moins 6 caractères.")
    for root in roots:
        root.mkdir(parents=True, exist_ok=True)
    legacy_session = state / "account-session.json"
    private_session = secret / "account-session.json"
    if legacy_session.is_file():
        if private_session.exists() and legacy_session.read_bytes() != private_session.read_bytes():
            raise ValueError(
                "Deux sessions Anycubic différentes sont présentes. Vérifiez la migration du dossier privé."
            )
        if not private_session.exists():
            os.chmod(legacy_session, 0o600)
            legacy_session.replace(private_session)
        else:
            legacy_session.unlink()
    (secret / "slicer-token").mkdir(mode=0o700, exist_ok=True)
    if email and password:
        private_write(
            secret / "anycubic-account", json.dumps({"email": email, "password": password}).encode()
        )
    elif token:
        private_write(secret / "anycubic-token", token.encode())
    if web_password:
        private_write(secret / "web-password", web_password.encode())
    if not (secret / "anycubic-token").exists():
        private_write(secret / "anycubic-token", b"")
    required = [
        secret / "vendor/client.json",
        *[
            secret / "vendor/mqtt" / n
            for n in [
                "anycubic_mqqt_tls_ca.crt",
                "anycubic_mqqt_tls_client.crt",
                "anycubic_mqqt_tls_client.key",
            ]
        ],
    ]
    if not all(p.is_file() and p.stat().st_size > 0 for p in required):
        prepare_fn(secret / "vendor")
    for root in roots:
        for path in [root, *root.rglob("*")]:
            os.chmod(path, 0o700 if path.is_dir() else 0o600)
            if getattr(os, "geteuid", lambda: -1)() == 0:
                os.chown(path, uid, gid)
    log_event(
        _log,
        logging.INFO,
        "container_setup_complete",
        message="Préparation terminée; les identifiants restent dans le stockage privé",
    )
