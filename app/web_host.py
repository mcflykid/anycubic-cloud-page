"""Ressources de l’interface et contrôle d’accès de la distribution autonome."""

import asyncio, hashlib, hmac, html, ipaddress, json, os, pathlib, re, secrets, time
from dataclasses import dataclass
from urllib.parse import urlsplit, parse_qs
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from aiohttp import web
from native_controls import TIMELAPSE_GALLERY_ENABLED

ROOT = pathlib.Path(__file__).resolve().parents[1] / "web"
APP_VERSION = json.loads((ROOT.parent / "package.json").read_text())["version"]
UI_PREFIX = "/imprimante-api/ui"
PUBLIC_ASSETS = {
    "/css/landing.css",
    "/css/imprimante.css",
    "/css/lab.css",
    "/icons/cloud-page.svg",
    # Ces visuels sont des fichiers publics du dépôt ; une session expirée ne doit pas servir une page de connexion à leur place.
    "/icons/kobra-s1-ace2pro.png",
    "/icons/ace2pro.png",
    "/icons/kobra-s1.svg",
    "/icons/ace.svg",
    "/icons/printer.svg",
    "/js/workshop-ui.mjs",
    "/js/workshop-login.mjs",
    "/js/workshop-translations.json",
}
INFORMATION_PAGES = {
    "/about": "privacy.html",
    "/conditions": "terms.html",
    "/cookies": "cookies.html",
    "/credits": "credits.html",
}
HOME_URL_KEY = web.AppKey("home_url", str)
TIME_ZONE_KEY = web.AppKey("time_zone", str)


def display_timezone():
    """Renvoie TZ validé pour l’interface ; ValueError refuse un fuseau absent de la base IANA."""
    value = os.environ.get("TZ", "Europe/Paris")
    try:
        ZoneInfo(value)
    except (ValueError, ZoneInfoNotFoundError):
        raise ValueError("TZ doit être un fuseau IANA valide.") from None
    return value


def home_url(value):
    """Valide une destination HTTP(S) ou relative ; vide masque les liens, ValueError refuse un schéma dangereux."""
    if (
        not isinstance(value, str)
        or any(ord(char) < 32 or ord(char) == 127 for char in value)
        or "\\" in value
    ):
        raise ValueError("HOME_URL invalide.")
    value = value.strip()
    parsed = urlsplit(value)
    if parsed.scheme and (parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc):
        raise ValueError("HOME_URL doit être une adresse HTTP(S) ou un chemin relatif.")
    if parsed.netloc and not parsed.scheme or parsed.username or parsed.password:
        raise ValueError("HOME_URL invalide.")
    return value


COOKIE_NAME = "anycubic_session"
SECURE_COOKIE_NAME = "__Host-" + COOKIE_NAME
SESSION_SECONDS = 8 * 60 * 60
FAILURE_SECONDS = 5 * 60
FAILURE_LIMIT = 5
GLOBAL_FAILURE_LIMIT = 100
REAUTH_SECONDS = 120
SENSITIVE_ACTIONS = frozenset(("firmware", "ace-firmware", "factory-reset"))


@dataclass
class ActionTicket:
    """Lie une confirmation à une action et à une imprimante sans stocker le jeton brut."""

    digest: bytes
    action: str
    printer: str
    expires: float


@dataclass
class Session:
    """Session opaque à expiration fixe, liée aux identifiants actuels pour invalider un changement de mot de passe."""

    expires: float
    fingerprint: bytes
    ticket: ActionTicket | None = None
    reauth_failures: int = 0
    reauth_until: float = 0


class AccessState:
    """Conserve uniquement les empreintes de sessions et compte les échecs récents, sans persistance de cookie."""

    def __init__(self):
        """Initialise des tables bornées ; un redémarrage déconnecte toutes les sessions web."""
        self.sessions = {}
        self.failures = {}
        self.global_failures = 0
        self.global_window_until = 0
        self.global_until = 0

    def prune(self):
        """Retire les sessions et compteurs expirés afin de borner la mémoire de l’authentification."""
        now = time.monotonic()
        self.sessions = {key: value for key, value in self.sessions.items() if value.expires > now}
        self.failures = {key: value for key, value in self.failures.items() if value[1] > now}
        if self.global_window_until <= now:
            self.global_failures = 0
            self.global_window_until = 0
            self.global_until = 0


ACCESS_KEY = web.AppKey("access", AccessState)
ORIGIN_KEY = web.AppKey("public_origin", str)
TRUSTED_PROXIES_KEY = web.AppKey("trusted_proxies", tuple)
SESSION_DIGEST_KEY = web.RequestKey("session_digest", bytes)


def session_cookie_name(request):
    """Active la protection navigateur __Host- lorsque l’origine configurée est HTTPS."""
    return SECURE_COOKIE_NAME if request.app[ORIGIN_KEY].startswith("https://") else COOKIE_NAME


def session_digest(token):
    """Renvoie l’empreinte d’un jeton à conserver en mémoire."""
    return hashlib.sha256(token.encode()).digest()


def set_session_cookie(response, name, token, remaining, secure):
    """Garde la portée et les attributs du cookie à la connexion, à la migration et à l’effacement."""
    response.set_cookie(
        name, token, max_age=remaining, path="/", httponly=True, secure=secure, samesite="Strict"
    )


def client_address(request):
    """Résout l’adresse réelle du client, sans écouter les en-têtes d’un pair non fiable."""
    remote = request.remote or "unknown"
    trusted = request.app[TRUSTED_PROXIES_KEY]
    try:
        peer = ipaddress.ip_address(remote)
        if not any(peer in network for network in trusted):
            return str(peer)
        for part in reversed(request.headers.get("X-Forwarded-For", "").split(",")):
            try:
                candidate = ipaddress.ip_address(part.strip())
            except ValueError:
                # Ne pas traverser une rupture de provenance avant d’avoir identifié le client.
                break
            if not any(peer in network for network in trusted):
                break
            peer = candidate
        return str(peer)
    except ValueError:
        return remote


def rate_limit_address(address):
    """Regroupe les adresses IPv6 voisines pour limiter le contournement par rotation d’interface."""
    if address.version == 6:
        return str(ipaddress.ip_network(f"{address}/64", strict=False))
    return str(address)


def rate_limit_client(request):
    """Renvoie la clé de quota ; IPv6 est regroupée sans altérer l’adresse du journal."""
    try:
        return rate_limit_address(ipaddress.ip_address(client_address(request)))
    except ValueError:
        return client_address(request)


def credentials():
    """Renvoie identifiant, mot de passe et empreinte ; HTTPServiceUnavailable si la configuration est inutilisable."""
    path = pathlib.Path(os.environ.get("WEB_PASSWORD_FILE", "/appdata/private/web-password"))
    try:
        password = path.read_text().strip()
    except OSError:
        raise web.HTTPServiceUnavailable(
            text="Configurez le mot de passe web avant de démarrer le service."
        ) from None
    username = os.environ.get("WEB_USER", "admin")
    if len(password) < 6 or not username.strip():
        raise web.HTTPServiceUnavailable(
            text="Configurez un identifiant non vide et un mot de passe web d’au moins six caractères."
        )
    return username, password, hashlib.sha256((username + "\0" + password).encode()).digest()


def require_origin(request):
    """Refuse les écritures sans origine exacte ; les en-têtes proxy ne remplacent jamais PUBLIC_ORIGIN."""
    if request.headers.get("Origin") != request.app[ORIGIN_KEY]:
        raise web.HTTPForbidden(text="Origine refusée.")


def install_access(app):
    """Ajoute la connexion par formulaire et une session en mémoire ; ValueError si PUBLIC_ORIGIN est mal formée."""
    origin = os.environ.get("PUBLIC_ORIGIN", "http://localhost:8080")
    try:
        parsed = urlsplit(origin)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.netloc
            or parsed.path
            or parsed.query
            or parsed.fragment
            or parsed.username
            or parsed.password
            or parsed.port == 0
        ):
            raise ValueError
    except ValueError:
        raise ValueError("PUBLIC_ORIGIN doit être une origine HTTP(S), sans chemin.") from None
    try:
        trusted = tuple(
            ipaddress.ip_network(value.strip(), strict=False)
            for value in os.environ.get("TRUSTED_PROXIES", "").split(",")
            if value.strip()
        )
    except ValueError:
        raise ValueError(
            "TRUSTED_PROXIES doit contenir des adresses ou réseaux IP séparés par des virgules."
        ) from None
    app[TRUSTED_PROXIES_KEY] = trusted
    app[ORIGIN_KEY] = origin
    app[ACCESS_KEY] = AccessState()
    app.router.add_get("/login", login)
    app.router.add_post("/login", login)
    app.router.add_post("/logout", logout)
    app.router.add_post("/imprimante-api/reauth", reauthenticate)


@web.middleware
async def access_control(request, handler):
    """Protège l’atelier par cookie, garde health public et applique Origin aux écritures authentifiées."""
    migration = None
    try:
        ui_path = request.path.startswith(UI_PREFIX + "/")
        if (
            request.path == "/imprimante-api/health"
            or request.method in {"GET", "HEAD"}
            and request.path.removeprefix(UI_PREFIX) in PUBLIC_ASSETS
        ):
            response = await handler(request)
        else:
            username, password, fingerprint = credentials()
            state = request.app[ACCESS_KEY]
            state.prune()
            name = session_cookie_name(request)
            token = request.cookies.get(name)
            legacy = name == SECURE_COOKIE_NAME and token is None
            if legacy:
                token = request.cookies.get(COOKIE_NAME)
            key = session_digest(token or "")
            session = state.sessions.get(key)
            authenticated = session is not None and hmac.compare_digest(
                session.fingerprint, fingerprint
            )
            if request.path == "/login":
                response = await handler(request)
            elif not authenticated:
                if (
                    request.path.startswith("/imprimante-api/") and not ui_path
                ) or request.method not in {"GET", "HEAD"}:
                    response = web.json_response({"message": "Connexion requise."}, status=401)
                else:
                    response = web.Response(status=303, headers={"Location": "/login"})
            else:
                if request.method not in {"GET", "HEAD", "OPTIONS"}:
                    require_origin(request)
                if legacy and request.path != "/logout":
                    state.sessions.pop(key)
                    token = secrets.token_urlsafe(32)
                    key = session_digest(token)
                    state.sessions[key] = session
                    migration = (token, max(1, int(session.expires - time.monotonic())))
                request[SESSION_DIGEST_KEY] = key
                request["session_expires"] = session.expires
                response = await handler(request)
    except web.HTTPException as error:
        response = web.Response(body=error.body, status=error.status, headers=error.headers)
    if migration is not None:
        set_session_cookie(response, SECURE_COOKIE_NAME, *migration, True)
        set_session_cookie(response, COOKIE_NAME, "", 0, True)
    # no-referrer rend Origin nul sur les formulaires ; same-origin le conserve sans fuite vers les sites externes.
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["Cache-Control"] = "no-store"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://*.agora.io https://*.sd-rtn.com https://*.agoraio.cn wss://*.agora.io wss://*.sd-rtn.com wss://*.agoraio.cn; media-src blob: https:; worker-src blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'"
    )
    return response


def login_page(message="", status=200):
    """Renvoie le formulaire français sans refléter les identifiants saisis ; message est échappé."""
    content = (
        (ROOT / "login.html")
        .read_text()
        .replace(
            "<!-- LOGIN_MESSAGE -->",
            '<p class="login-error" role="alert">' + html.escape(message) + "</p>"
            if message
            else "",
        )
    )
    return web.Response(text=content, content_type="text/html", status=status)


async def login(request):
    """Vérifie le formulaire borné avec quotas par client et plafond agrégé temporaire."""
    if request.method in {"GET", "HEAD"}:
        return login_page()
    require_origin(request)
    state = request.app[ACCESS_KEY]
    state.prune()
    client = rate_limit_client(request)
    # Le quota individuel garde son comportement historique avant le traitement du formulaire.
    failures, until = state.failures.get(client, (0, time.monotonic() + FAILURE_SECONDS))
    if failures >= FAILURE_LIMIT:
        response = login_page("Trop de tentatives. Réessayez dans quelques minutes.", 429)
        response.headers["Retry-After"] = str(max(1, int(until - time.monotonic()) + 1))
        return response
    if request.content_type != "application/x-www-form-urlencoded":
        raise web.HTTPUnsupportedMediaType()
    try:
        raw = await request.content.readexactly(4097)
    except asyncio.IncompleteReadError as error:
        raw = error.partial
    if len(raw) > 4096:
        raise web.HTTPRequestEntityTooLarge(max_size=4096, actual_size=len(raw))
    try:
        form = parse_qs(raw.decode(), keep_blank_values=True, max_num_fields=8)
    except (ValueError, UnicodeError):
        raise web.HTTPBadRequest(text="Formulaire invalide.") from None
    username, password, fingerprint = credentials()
    supplied_user = form.get("username", [""])[0]
    supplied_password = form.get("password", [""])[0]
    valid_user = hmac.compare_digest(supplied_user.encode(), username.encode())
    valid_password = hmac.compare_digest(supplied_password.encode(), password.encode())
    if valid_user and valid_password:
        # Le plafond agrégé freine les refus, mais ne verrouille pas les identifiants valides.
        state.failures.pop(client, None)
    else:
        now = time.monotonic()
        if state.global_until > now:
            response = login_page("Trop de tentatives. Réessayez dans quelques minutes.", 429)
            response.headers["Retry-After"] = str(max(1, int(state.global_until - now) + 1))
            return response
        if client not in state.failures and len(state.failures) >= 1024:
            state.failures.pop(next(iter(state.failures)))
        state.failures.pop(client, None)
        state.failures[client] = (failures + 1, until)
        if not state.global_window_until:
            state.global_window_until = now + FAILURE_SECONDS
        state.global_failures += 1
        if state.global_failures >= GLOBAL_FAILURE_LIMIT:
            state.global_until = state.global_window_until
            response = login_page("Trop de tentatives. Réessayez dans quelques minutes.", 429)
            response.headers["Retry-After"] = str(max(1, int(state.global_until - now) + 1))
            return response
        return login_page("Identifiant ou mot de passe incorrect.", 401)
    if len(state.sessions) >= 128:
        state.sessions.pop(next(iter(state.sessions)))
    # Le jeton change à chaque connexion et seule son empreinte est conservée côté serveur.
    name = session_cookie_name(request)
    secure = name == SECURE_COOKIE_NAME
    for old_name in {name, COOKIE_NAME}:
        state.sessions.pop(session_digest(request.cookies.get(old_name, "")), None)
    token = secrets.token_urlsafe(32)
    state.sessions[session_digest(token)] = Session(time.monotonic() + SESSION_SECONDS, fingerprint)
    response = web.Response(status=303, headers={"Location": "/imprimante.html"})
    set_session_cookie(response, name, token, SESSION_SECONDS, secure)
    if secure and COOKIE_NAME in request.cookies:
        set_session_cookie(response, COOKIE_NAME, "", 0, True)
    return response


async def logout(request):
    """Révoque la session côté serveur et efface le cookie ; Origin est contrôlé par le middleware."""
    name = session_cookie_name(request)
    response = web.Response(status=303, headers={"Location": "/login"})
    for old_name in {name, COOKIE_NAME}:
        request.app[ACCESS_KEY].sessions.pop(
            session_digest(request.cookies.get(old_name, "")), None
        )
        set_session_cookie(response, old_name, "", 0, name == SECURE_COOKIE_NAME)
    return response


def active_session(request):
    """Relit la session après une attente pour respecter une expiration ou déconnexion concurrente."""
    state = request.app.get(ACCESS_KEY)
    session = state.sessions.get(request.get(SESSION_DIGEST_KEY)) if state else None
    return session if session and session.expires > time.monotonic() else None


async def reauthenticate(request):
    """Émet une confirmation à usage unique après vérification et limitation propres à la session."""
    if request.content_type != "application/json":
        raise web.HTTPUnsupportedMediaType()
    try:
        raw = await request.content.readexactly(4097)
    except asyncio.IncompleteReadError as error:
        raw = error.partial
    if len(raw) > 4096:
        raise web.HTTPRequestEntityTooLarge(max_size=4096, actual_size=len(raw))
    try:
        data = json.loads(raw)
    except (ValueError, UnicodeError):
        data = None
    action = data.get("action") if isinstance(data, dict) else None
    password = data.get("password") if isinstance(data, dict) else None
    printer = request.headers.get("X-Printer-Key", "")
    if (
        not isinstance(action, str)
        or action not in SENSITIVE_ACTIONS
        or not printer
        or not isinstance(password, str)
    ):
        return web.json_response({"message": "Demande de confirmation invalide."}, status=400)
    session, refusal = confirm_web_password(request, password)
    if refusal is not None:
        return refusal
    token = secrets.token_urlsafe(32)
    session.ticket = ActionTicket(
        session_digest(token), action, printer, time.monotonic() + REAUTH_SECONDS
    )
    return web.json_response({"confirmation": token})


def confirm_web_password(request, password):
    """Confirme le mot de passe de la session avec le quota des opérations sensibles."""
    session = active_session(request)
    if session is None:
        return None, web.json_response({"message": "Session expirée."}, status=401)
    now = time.monotonic()
    if session.reauth_until <= now:
        session.reauth_failures = 0
        session.reauth_until = now + FAILURE_SECONDS
    if session.reauth_failures >= FAILURE_LIMIT:
        return None, web.json_response(
            {"message": "Trop de tentatives. Réessayez dans quelques minutes."},
            status=429,
            headers={"Retry-After": str(max(1, int(session.reauth_until - now) + 1))},
        )
    _, expected, fingerprint = credentials()
    if not hmac.compare_digest(fingerprint, session.fingerprint):
        return None, web.json_response({"message": "Session expirée."}, status=401)
    if not hmac.compare_digest(password.encode(errors="surrogatepass"), expected.encode()):
        session.reauth_failures += 1
        return None, web.json_response({"message": "Mot de passe web incorrect."}, status=403)
    session.reauth_failures = 0
    return session, None


def consume_action_ticket(request, action, token):
    """Valide et consomme la confirmation sous le verrou qui protège l’envoi physique."""
    session = active_session(request)
    ticket = session.ticket if session else None
    if (
        not ticket
        or ticket.expires <= time.monotonic()
        or ticket.action != action
        or ticket.printer != request.get("printer_key")
    ):
        return False
    if (
        not isinstance(token, str)
        or len(token) != 43
        or not token.isascii()
        or not hmac.compare_digest(ticket.digest, session_digest(token))
    ):
        return False
    if not hmac.compare_digest(credentials()[2], session.fingerprint):
        return False
    session.ticket = None
    return True


def render_page(destination, time_zone):
    """Renvoie le HTML avec navigation et fuseau échappés, sans toucher aux scripts protégés par SRI."""
    content = (
        (ROOT / "imprimante.html")
        .read_text()
        .replace("<!-- APP_VERSION -->", html.escape(APP_VERSION))
    )
    if TIMELAPSE_GALLERY_ENABLED:
        content = content.replace(
            'class="form-panel timelapse-panel" hidden', 'class="form-panel timelapse-panel"', 1
        )
    # Le fuseau explicite évite que le navigateur et l’historique utilisent deux heures différentes.
    content = content.replace(
        '<html lang="fr">',
        '<html lang="fr" data-time-zone="' + html.escape(time_zone, quote=True) + '">',
        1,
    )
    if destination:
        content = re.sub(
            r'(<a class="document-brand" href=")[^"]*(")',
            lambda match: match[1] + html.escape(destination, quote=True) + match[2],
            content,
        )
    else:
        content = re.sub(r'<a class="document-brand" href="[^"]*">.*?</a>', "", content, flags=re.S)
    return content


async def index(request):
    """Renvoie l’interface avec les destinations et le fuseau validés au démarrage."""
    return web.Response(
        text=render_page(request.app[HOME_URL_KEY], request.app[TIME_ZONE_KEY]),
        content_type="text/html",
    )


async def about(request):
    """Sert uniquement les notices statiques déclarées par l’application."""
    return web.Response(
        text=(ROOT / INFORMATION_PAGES[request.path.removeprefix(UI_PREFIX)]).read_text(),
        content_type="text/html",
    )


def install_ui_resources(app):
    """Sert les ressources via le préfixe déjà routé et conserve les anciennes adresses."""
    for prefix in ("", UI_PREFIX):
        for path in INFORMATION_PAGES:
            app.router.add_get(prefix + path, about)
        for folder in ("css", "js", "icons"):
            app.router.add_static(prefix + "/" + folder + "/", ROOT / folder, show_index=False)


def install_static(app):
    """Ajoute les routes des ressources statiques, sans exposer les fichiers privés du serveur."""
    install_access(app)
    app[HOME_URL_KEY] = home_url(os.environ.get("HOME_URL", "/imprimante.html"))
    app[TIME_ZONE_KEY] = display_timezone()
    app.router.add_get("/", index)
    app.router.add_get("/imprimante.html", index)
    install_ui_resources(app)
