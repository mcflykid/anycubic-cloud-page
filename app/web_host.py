"""Ressources de l’interface et contrôle d’accès de la distribution autonome."""

import asyncio, hashlib, hmac, html, ipaddress, json, mimetypes, os, pathlib, re, secrets, time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from urllib.parse import urlsplit, parse_qs
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from aiohttp import web
from native_controls import TIMELAPSE_GALLERY_ENABLED
from web_assets import UI_PREFIX, build_web_assets
from web_totp import (
    RECOVERY_FORMAT,
    TotpConfig,
    TotpStore,
    matching_step,
    new_recovery_codes,
    new_secret,
    qr_image,
    recovery_digest,
)

ROOT = pathlib.Path(__file__).resolve().parents[1] / "web"
APP_VERSION = json.loads((ROOT.parent / "package.json").read_text())["version"]
PUBLIC_ASSETS = {
    "/css/landing.css",
    "/css/imprimante.css",
    "/css/atelier-tokens.css",
    "/css/atelier-access.css",
    "/css/fonts/Inter-Regular.woff2",
    "/css/fonts/Inter-SemiBold.woff2",
    "/css/visual-states.css",
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
GLOBAL_FAILURE_DELAY = 1.0
LOGIN_QUEUE_LIMIT = 8
LOGIN_QUEUE_PER_CLIENT = 2
REAUTH_SECONDS = 120
LOGIN_CHALLENGE_SECONDS = 180
TOTP_CHALLENGE_LIMIT = 3
TOTP_FAILURE_LIMIT = 20
TOTP_FAILURE_SECONDS = 120
ENROLLMENT_SECONDS = 300
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


@dataclass
class TotpChallenge:
    """Lie la vérification du code à un client et à la version actuelle du mot de passe."""

    expires: float
    client: str
    fingerprint: bytes
    failures: int = 0


@dataclass
class TotpEnrollment:
    """Conserve une clé provisoire uniquement dans la session qui configure le facteur."""

    expires: float
    secret: str
    failures: int = 0


class AccessState:
    """Conserve uniquement les empreintes de sessions et compte les échecs récents, sans persistance de cookie."""

    def __init__(self, clock=time.monotonic, wait=asyncio.sleep):
        """Initialise l’état d’accès ; clock et wait injectables gardent les tests rapides et déterministes."""
        self.clock = clock
        self.wait = wait
        self.login_lock = asyncio.Lock()
        self.login_pending = {}
        self.sessions = {}
        self.challenges = {}
        self.enrollments = {}
        self.failures = {}
        self.global_failures = 0
        self.global_window_until = 0
        self.global_until = 0
        self.totp_failures = 0
        self.totp_window_until = 0

    def prune(self):
        """Retire les sessions et compteurs expirés afin de borner la mémoire de l’authentification."""
        now = self.clock()
        self.sessions = {key: value for key, value in self.sessions.items() if value.expires > now}
        self.challenges = {
            key: value for key, value in self.challenges.items() if value.expires > now
        }
        self.enrollments = {
            key: value
            for key, value in self.enrollments.items()
            if value.expires > now and key in self.sessions
        }
        self.failures = {key: value for key, value in self.failures.items() if value[1] > now}
        if self.totp_window_until <= now:
            self.totp_failures = 0
            self.totp_window_until = 0
        if self.global_window_until <= now:
            self.global_failures = 0
            self.global_window_until = 0
            self.global_until = 0

    @asynccontextmanager
    async def login_slot(self, client, connected=lambda: True):
        """Borne les demandes admises et libère leur place même après une annulation."""
        pending = self.login_pending.get(client, 0)
        if (
            pending >= LOGIN_QUEUE_PER_CLIENT
            or sum(self.login_pending.values()) >= LOGIN_QUEUE_LIMIT
        ):
            yield 429
            return
        self.login_pending[client] = pending + 1
        try:
            async with self.login_lock:
                # Une connexion fermée dans la file ne déclenche ni attente ni vérification.
                if not connected():
                    yield 499
                    return
                if self.global_until > self.clock():
                    await self.wait(GLOBAL_FAILURE_DELAY)
                yield None if connected() else 499
        finally:
            remaining = self.login_pending[client] - 1
            if remaining:
                self.login_pending[client] = remaining
            else:
                del self.login_pending[client]

    def record_failure(self, client, failures, until):
        """Consomme un essai dans le quota individuel et le compteur agrégé."""
        if client not in self.failures and len(self.failures) >= 1024:
            self.failures.pop(next(iter(self.failures)))
        self.failures.pop(client, None)
        self.failures[client] = (failures + 1, until)
        if not self.global_window_until:
            self.global_window_until = self.clock() + FAILURE_SECONDS
        self.global_failures += 1
        if self.global_failures >= GLOBAL_FAILURE_LIMIT:
            self.global_until = self.global_window_until


ACCESS_KEY = web.AppKey("access", AccessState)
ORIGIN_KEY = web.AppKey("public_origin", str)
TOTP_KEY = web.AppKey("web_totp", TotpStore)
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


def password_path():
    """Renvoie l’emplacement privé du mot de passe, y compris pour la démonstration."""
    return pathlib.Path(os.environ.get("WEB_PASSWORD_FILE", "/appdata/private/web-password"))


def credentials():
    """Renvoie identifiant, mot de passe et empreinte ; HTTPServiceUnavailable si la configuration est inutilisable."""
    try:
        password = password_path().read_text().strip()
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
    reset = os.environ.get("WEB_TOTP_RESET", "false").strip().lower()
    if reset not in {"true", "false", ""}:
        raise ValueError("WEB_TOTP_RESET doit être true ou false.")
    app[TOTP_KEY] = TotpStore(password_path(), reset=reset == "true")
    app.router.add_get("/login", login)
    app.router.add_post("/login", login)
    app.router.add_post("/logout", logout)
    app.router.add_get("/imprimante-api/security", totp_settings)
    app.router.add_post("/imprimante-api/security", totp_settings)
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
    response.headers.setdefault("Cache-Control", "no-store")
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://*.agora.io https://*.sd-rtn.com https://*.agoraio.cn wss://*.agora.io wss://*.sd-rtn.com wss://*.agoraio.cn; media-src blob: https:; worker-src blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'"
    )
    return response


def login_page(message="", status=200):
    """Renvoie le formulaire français sans refléter les identifiants saisis ; message est échappé."""
    content = build_web_assets(ROOT)[0]["login.html"].replace(
        "<!-- LOGIN_MESSAGE -->",
        '<p class="login-error" role="alert">' + html.escape(message) + "</p>" if message else "",
    )
    return web.Response(text=content, content_type="text/html", status=status)


async def read_login_form(request):
    """Lit un formulaire de sécurité borné avant d’attendre le verrou."""
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
    return {key: values[0] for key, values in form.items()}


def limited_response(
    render, until, now, message="Trop de tentatives. Réessayez dans quelques minutes."
):
    """Indique la durée restante du quota sans révéler les identifiants présentés."""
    response = render(message, 429)
    response.headers["Retry-After"] = str(max(1, int(until - now) + 1))
    return response


def challenge_cookie_name(request):
    """Réserve un cookie distinct qui ne donne aucun droit à l’atelier."""
    return (
        "__Host-web-totp-challenge"
        if session_cookie_name(request) == SECURE_COOKIE_NAME
        else "web-totp-challenge"
    )


def get_challenge(request, state):
    """Retrouve un défi opaque sans accepter un jeton dans un paramètre ou une URL."""
    name = challenge_cookie_name(request)
    digest = session_digest(request.cookies.get(name, ""))
    return digest, state.challenges.get(digest)


def security_page(title, content, message="", status=200):
    """Affiche un écran de sécurité à partir de contenu interne et d’un message échappé."""
    feedback = f'<p role="alert" class="login-error">{html.escape(message)}</p>' if message else ""
    body = f"<h1>{html.escape(title)}</h1>{feedback}{content}"
    return web.Response(
        text=build_web_assets(ROOT)[0]["security.html"].replace("<!-- SECURITY_CONTENT -->", body),
        status=status,
        content_type="text/html",
    )


def totp_login_page(message="", status=200):
    """Demande un code temporaire ou un code de secours après l’étape du mot de passe."""
    return security_page(
        "Vérifier la connexion",
        """<p>Saisissez un code de votre application d’authentification ou un code de secours.</p>
<form action="/login" method="post">
<input type="hidden" name="stage" value="totp">
<label for="totp-code">Code temporaire ou de secours</label>
<input id="totp-code" name="code" autocomplete="one-time-code" autocapitalize="none" spellcheck="false" maxlength="24" required autofocus>
<button type="submit" class="primary">Vérifier le code</button>
</form><p><a href="/login?recommencer=1">Recommencer la connexion</a></p>""",
        message,
        status,
    )


def current_totp(request):
    """Refuse l’accès si le fichier privé existe mais ne peut pas être vérifié."""
    try:
        return request.app[TOTP_KEY].read()
    except (OSError, ValueError):
        raise web.HTTPServiceUnavailable(
            text="Le facteur web est indisponible. Consultez le guide de récupération."
        ) from None


def request_connected(request):
    """Contrôle le transport actuel avant de consommer un créneau de connexion."""
    transport = request.transport
    return transport is not None and not transport.is_closing()


async def login(request):
    """Valide le mot de passe puis, si configuré, le facteur à usage unique."""
    state = request.app[ACCESS_KEY]
    state.prune()
    digest, challenge = get_challenge(request, state)
    client = rate_limit_client(request)
    if request.method in {"GET", "HEAD"}:
        if "recommencer" in request.query:
            # Recommencer invalide l’ancien défi sans réinitialiser les quotas.
            state.challenges.pop(digest, None)
            response = login_page()
            set_session_cookie(
                response,
                challenge_cookie_name(request),
                "",
                0,
                session_cookie_name(request) == SECURE_COOKIE_NAME,
            )
            return response
        return totp_login_page() if challenge and challenge.client == client else login_page()
    require_origin(request)
    code_stage = challenge is not None and challenge.client == client
    render = totp_login_page if code_stage else login_page
    failures, until = state.failures.get(client, (0, state.clock() + FAILURE_SECONDS))
    if failures >= FAILURE_LIMIT:
        return limited_response(render, until, state.clock())
    form = await read_login_form(request)
    async with state.login_slot(client, lambda: request_connected(request)) as rejection:
        if rejection == 429:
            now = state.clock()
            return limited_response(
                render, now, now, "Connexion occupée. Réessayez dans un instant."
            )
        if rejection:
            return web.Response(status=rejection)
        state.prune()
        now = state.clock()
        failures, until = state.failures.get(client, (0, now + FAILURE_SECONDS))
        if failures >= FAILURE_LIMIT:
            return limited_response(render, until, now)
        username, password, fingerprint = credentials()
        config = current_totp(request)
        if form.get("stage") == "totp":
            challenge = state.challenges.get(digest)
            if (
                challenge is None
                or challenge.client != client
                or config is None
                or not hmac.compare_digest(challenge.fingerprint, fingerprint)
            ):
                return login_page(
                    "Vérification expirée. Saisissez de nouveau le mot de passe.", 401
                )
            code = form.get("code", "").strip()
            recovery = bool(RECOVERY_FORMAT.fullmatch(code.upper()))
            if not recovery and state.totp_failures >= TOTP_FAILURE_LIMIT:
                return limited_response(
                    totp_login_page,
                    state.totp_window_until,
                    now,
                    "Codes temporaires suspendus. Utilisez un code de secours ou attendez.",
                )
            next_config = config.consume(code, time.time())
            if next_config is None:
                challenge.failures += 1
                if not recovery:
                    if not state.totp_window_until:
                        state.totp_window_until = now + TOTP_FAILURE_SECONDS
                    state.totp_failures += 1
                if challenge.failures >= TOTP_CHALLENGE_LIMIT:
                    state.challenges.pop(digest, None)
                    return login_page("Trop de codes refusés. Recommencez la connexion.", 429)
                return totp_login_page("Code invalide, expiré ou déjà utilisé.", 401)
            save_totp(request, next_config)
            state.challenges.pop(digest, None)
        else:
            valid_user = hmac.compare_digest(form.get("username", "").encode(), username.encode())
            valid_password = hmac.compare_digest(
                form.get("password", "").encode(), password.encode()
            )
            if not (valid_user and valid_password):
                state.record_failure(client, failures, until)
                return login_page("Identifiant ou mot de passe incorrect.", 401)
            if config is not None:
                state.challenges.pop(digest, None)
                if len(state.challenges) >= 128:
                    state.challenges.pop(next(iter(state.challenges)))
                token = secrets.token_urlsafe(32)
                state.challenges[session_digest(token)] = TotpChallenge(
                    state.clock() + LOGIN_CHALLENGE_SECONDS, client, fingerprint
                )
                response = totp_login_page()
                set_session_cookie(
                    response,
                    challenge_cookie_name(request),
                    token,
                    LOGIN_CHALLENGE_SECONDS,
                    session_cookie_name(request) == SECURE_COOKIE_NAME,
                )
                return response
        state.failures.pop(client, None)
        response = create_session(request, state, fingerprint)
        if challenge_cookie_name(request) in request.cookies:
            set_session_cookie(
                response,
                challenge_cookie_name(request),
                "",
                0,
                session_cookie_name(request) == SECURE_COOKIE_NAME,
            )
        return response


def create_session(request, state, fingerprint):
    """Crée un cookie de session seulement après validation de tous les facteurs."""
    if len(state.sessions) >= 128:
        state.sessions.pop(next(iter(state.sessions)))
    # Le jeton change à chaque connexion et seule son empreinte est conservée côté serveur.
    name = session_cookie_name(request)
    secure = name == SECURE_COOKIE_NAME
    for old_name in {name, COOKIE_NAME}:
        state.sessions.pop(session_digest(request.cookies.get(old_name, "")), None)
    token = secrets.token_urlsafe(32)
    state.sessions[session_digest(token)] = Session(state.clock() + SESSION_SECONDS, fingerprint)
    response = web.Response(status=303, headers={"Location": "/imprimante.html"})
    set_session_cookie(response, name, token, SESSION_SECONDS, secure)
    if secure and COOKIE_NAME in request.cookies:
        set_session_cookie(response, COOKIE_NAME, "", 0, True)
    return response


def save_totp(request, config):
    """Confirme une modification de sécurité uniquement après sa persistance privée."""
    store = request.app[TOTP_KEY]
    try:
        if config is None:
            store.disable()
        else:
            store.save(config)
    except OSError:
        raise web.HTTPServiceUnavailable(text="Écriture du facteur web indisponible.") from None


def totp_settings_page(store, config, message="", status=200, *, enrollment=None, codes=()):
    """Affiche la phase de réglage autorisée par le serveur, sans relire de code de secours."""
    path = "/imprimante-api/security"
    back = '<p><a href="/imprimante.html">Retour à l’atelier</a></p>'
    password = '<label for="totp-password">Mot de passe web</label><input id="totp-password" name="password" type="password" autocomplete="current-password" maxlength="2048" required>'
    if store.reset:
        content = "<p>La récupération Compose est active. Retirez WEB_TOTP_RESET puis redémarrez pour configurer le facteur.</p>"
    elif codes:
        items = "".join(f"<li><code>{html.escape(code)}</code></li>" for code in codes)
        content = f"<p>La connexion à deux facteurs est active. Conservez ces codes de secours. Ils sont affichés une seule fois.</p><ul>{items}</ul>"
    elif enrollment:
        key = html.escape(enrollment.secret)
        qr = html.escape(qr_image(enrollment.secret), quote=True)
        content = f"""<p>Scannez le QR ou saisissez la clé dans votre application d’authentification.</p>
<img src="{qr}" width="180" height="180" alt="QR d’activation du facteur temporaire">
<p>Clé manuelle <code>{key}</code></p>
<form method="post" action="{path}">
<input type="hidden" name="stage" value="activate">{password}
<label for="totp-code">Premier code temporaire</label>
<input id="totp-code" name="code" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]{{6}}" maxlength="6" required>
<button type="submit" class="primary">Activer le facteur</button></form>"""
    else:
        stage = "disable" if config else "prepare"
        label = "Désactiver le facteur" if config else "Préparer l’activation"
        state = "activée" if config else "désactivée"
        content = f"""<p>La connexion à deux facteurs est {state}.</p>
<form method="post" action="{path}"><input type="hidden" name="stage" value="{stage}">{password}
<button type="submit" class="primary">{label}</button></form>"""
    return security_page("Connexion à deux facteurs", content + back, message, status)


async def totp_settings(request):
    """Protège la préparation, l’activation et la désactivation par la session et le mot de passe."""
    store = request.app[TOTP_KEY]
    config = current_totp(request)
    if request.method in {"GET", "HEAD"} or store.reset:
        return totp_settings_page(store, config)
    form = await read_login_form(request)
    state = request.app[ACCESS_KEY]
    client = rate_limit_client(request)
    key = request.get(SESSION_DIGEST_KEY)
    async with state.login_slot(client, lambda: request_connected(request)) as rejection:
        if rejection == 429:
            response = totp_settings_page(
                store, config, "Trop de tentatives. Réessayez dans un instant.", 429
            )
            response.headers["Retry-After"] = "1"
            return response
        if rejection:
            return web.Response(status=rejection)
        state.prune()
        config = current_totp(request)

        def render_refusal(message, status):
            return totp_settings_page(store, config, message, status)

        session, refusal = confirm_web_password(
            request, form.get("password", ""), render=render_refusal
        )
        if refusal is not None:
            return refusal
        now = state.clock()
        stage = form.get("stage")
        if stage == "prepare" and config is None:
            enrollment = TotpEnrollment(now + ENROLLMENT_SECONDS, new_secret())
            state.enrollments[key] = enrollment
            return totp_settings_page(store, config, enrollment=enrollment)
        if stage == "activate" and config is None:
            enrollment = state.enrollments.get(key)
            if enrollment is None:
                return totp_settings_page(
                    store, config, "Préparation expirée. Recommencez l’activation.", 409
                )
            step = matching_step(enrollment.secret, form.get("code", ""), time.time())
            if step is None:
                # L’inscription provisoire borne aussi ses essais sans toucher au quota de connexion.
                enrollment.failures += 1
                if enrollment.failures >= TOTP_CHALLENGE_LIMIT:
                    state.enrollments.pop(key, None)
                return totp_settings_page(
                    store, config, "Code invalide. Recommencez la préparation.", 400
                )
            codes = new_recovery_codes()
            config = TotpConfig(enrollment.secret, step, tuple(map(recovery_digest, codes)))
        elif stage == "disable" and config is not None:
            codes = ()
            config = None
        else:
            return totp_settings_page(
                store, config, "Le réglage a changé. Actualisez la page.", 409
            )
        try:
            save_totp(request, config)
        except web.HTTPServiceUnavailable:
            # Un remplacement peut avoir précédé l’échec de synchronisation.
            state.sessions.clear()
            state.enrollments.clear()
            state.challenges.clear()
            raise
        # L’ancienne confirmation et les autres sessions appartiennent au réglage précédent.
        session.ticket = None
        state.sessions = {key: session}
        state.enrollments.clear()
        state.challenges.clear()
        return totp_settings_page(store, config, codes=codes)


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


def password_refusal(message, status):
    """Présente les refus de confirmation aux clients JSON."""
    return web.json_response({"message": message}, status=status)


def confirm_web_password(request, password, *, render=password_refusal):
    """Vérifie le mot de passe et applique le même quota pour toutes les actions authentifiées."""
    session = active_session(request)
    if session is None:
        return None, render("Session expirée.", 401)
    _, expected, fingerprint = credentials()
    if not hmac.compare_digest(fingerprint, session.fingerprint):
        return None, render("Session expirée.", 401)
    now = time.monotonic()
    if session.reauth_until <= now:
        session.reauth_failures = 0
        session.reauth_until = now + FAILURE_SECONDS
    if session.reauth_failures >= FAILURE_LIMIT:
        refusal = render("Trop de tentatives. Réessayez dans quelques minutes.", 429)
        refusal.headers["Retry-After"] = str(max(1, int(session.reauth_until - now) + 1))
        return None, refusal
    if not hmac.compare_digest(password.encode(errors="surrogatepass"), expected.encode()):
        session.reauth_failures += 1
        return None, render("Mot de passe web incorrect.", 403)
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


def render_page(destination, time_zone, *, totp_active=False, discord_active=None):
    """Renvoie le HTML avec navigation et fuseau échappés, sans toucher aux scripts protégés par SRI."""
    content = build_web_assets(ROOT)[0]["imprimante.html"].replace(
        "<!-- APP_VERSION -->", html.escape(APP_VERSION)
    )
    content = content.replace("<!-- TOTP_BADGE_STATE -->", "normal" if totp_active else "unknown")
    content = content.replace("<!-- TOTP_STATE -->", "Activée" if totp_active else "Désactivée")
    content = (
        content.replace(
            "<!-- DISCORD_CARD_VISIBILITY -->", "hidden" if discord_active is None else ""
        )
        .replace("<!-- DISCORD_BADGE_STATE -->", "normal" if discord_active else "unknown")
        .replace("<!-- DISCORD_STATE -->", "Activées" if discord_active else "Désactivées")
    )
    # Les métadonnées affichées utilisent uniquement les valeurs publiques attendues.
    level = os.environ.get("LOG_LEVEL", "INFO").strip().upper() or "INFO"
    log_format = os.environ.get("LOG_FORMAT", "text").strip().lower() or "text"
    content = (
        content.replace("<!-- CONTAINER_TIME_ZONE -->", html.escape(time_zone))
        .replace(
            "<!-- CONTAINER_LOG_LEVEL -->",
            level if level in {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"} else "—",
        )
        .replace(
            "<!-- CONTAINER_LOG_FORMAT -->", log_format if log_format in {"text", "json"} else "—"
        )
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
    from notification_settings import discord_enabled

    return web.Response(
        text=render_page(
            request.app[HOME_URL_KEY],
            request.app[TIME_ZONE_KEY],
            totp_active=TOTP_KEY in request.app and current_totp(request) is not None,
            discord_active=discord_enabled(request.app),
        ),
        content_type="text/html",
    )


async def about(request):
    """Sert uniquement les notices statiques déclarées par l’application."""
    return web.Response(
        text=build_web_assets(ROOT)[0][INFORMATION_PAGES[request.path.removeprefix(UI_PREFIX)]],
        content_type="text/html",
    )


async def versioned_asset(request):
    """Sert l’instantané lié à l’empreinte et réserve le cache long à son URL exacte."""
    name = request.path.removeprefix(UI_PREFIX).lstrip("/")
    _, scripts, revision, assets = build_web_assets(ROOT)
    content_type = (
        "text/javascript"
        if name in scripts or name.endswith(".js")
        else mimetypes.guess_type(name)[0] or "application/octet-stream"
    )
    headers = {}
    if request.query_string == f"v={revision}":
        # Le cache navigateur conserve l’instantané, sans autoriser un cache partagé.
        headers["Cache-Control"] = "private, max-age=31536000, immutable"
    return web.Response(body=assets[name], content_type=content_type, headers=headers)


def install_ui_resources(app):
    """Sert les ressources via le préfixe déjà routé et conserve les anciennes adresses."""
    _, _, _, assets = build_web_assets(ROOT)
    for prefix in ("", UI_PREFIX):
        for name in assets:
            app.router.add_get(f"{prefix}/{name}", versioned_asset)
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
