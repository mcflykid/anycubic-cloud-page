# SPDX-License-Identifier: GPL-3.0-or-later
"""Connexion au centre utilisateur Anycubic par code d’autorisation lié à PKCE."""

import aiohttp
import asyncio, base64, contextlib, hashlib, json, math, os, pathlib, secrets, time

UC = "https://uc.makeronline.com"
CLIENT_ID = "b269a3136d26ac6488bb"
REDIRECT = "acnext://login"


def claims(token):
    """Renvoie les claims JWT non vérifiés, ou {} si le jeton est illisible."""
    if not isinstance(token, str):
        return {}
    try:
        part = token.split(".")[1]
        data = json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
        return data if isinstance(data, dict) else {}
    except (ValueError, IndexError, TypeError):
        return {}


class AccountLoginRejected(RuntimeError):
    """Refus explicite du compte : une intervention est nécessaire avant un nouvel envoi du mot de passe."""


class AccountRefreshRejected(RuntimeError):
    """Session de renouvellement refusée explicitement ; une nouvelle connexion peut être nécessaire."""


class AccountAuth:
    """Gère la session du compte et son repli sur un jeton local privé."""

    def __init__(
        self,
        credentials="/appdata/private/anycubic-account",
        state="/appdata/private/account-session.json",
        fallback="/appdata/private/anycubic-token",
    ):
        """Charge les chemins privés des identifiants, de la session et du jeton de repli, sans connexion réseau."""
        self.credentials = pathlib.Path(credentials)
        self.path = pathlib.Path(state)
        self.fallback = pathlib.Path(fallback)
        self.lock = asyncio.Lock()
        self.retry_after = 0
        self.state = {}
        self.retry_failures = 0
        self.credentials_revision = None
        self.login_blocked = False
        self.notice = None
        with contextlib.suppress(OSError, ValueError):
            self.state = json.loads(self.path.read_text())

    def valid(self, token, margin=300):
        """Teste identité et expiration finie avec une marge en secondes ; ne vérifie pas la signature et refuse un schéma illisible."""
        c = claims(token)
        expires = c.get("exp")
        subject = c.get("sub")
        return (
            c.get("iss") == UC
            and c.get("tokenType") == "access-token"
            and isinstance(subject, str)
            and bool(subject.strip())
            and isinstance(expires, (int, float))
            and not isinstance(expires, bool)
            and math.isfinite(expires)
            and expires > time.time() + margin
        )

    def save(self, data):
        """Persiste la session ; lève RuntimeError si le jeton est invalide ou change de compte."""
        if not self.valid(data.get("access_token", "")):
            raise RuntimeError("Jeton Anycubic non valide")
        if self.state.get("access_token"):
            if claims(data["access_token"]).get("sub") != claims(self.state["access_token"]).get(
                "sub"
            ):
                raise RuntimeError("Compte Anycubic différent")
        value = {**data, "obtained_at": time.time()}
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump(value, f)
            f.flush()
            os.fsync(f.fileno())
        tmp.replace(self.path)
        self.state = value

    async def post(self, session, path, *, data=None, params=None, body=None):
        """Renvoie le JSON du centre utilisateur ; lève RuntimeError si la connexion est refusée ou illisible."""
        async with session.post(
            UC + path,
            data=data,
            json=body,
            params=params,
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=aiohttp.ClientTimeout(total=25),
        ) as response:
            if response.status in (401, 403):
                if path == "/api/login":
                    raise AccountLoginRejected(
                        "Connexion Anycubic refusée : vérifiez les identifiants ou les contrôles du compte, puis mettez à jour la configuration."
                    )
                if path.endswith("/refresh_token"):
                    raise AccountRefreshRejected("Renouvellement Anycubic refusé")
            try:
                result = await response.json()
            except (ValueError, aiohttp.ContentTypeError):
                raise RuntimeError("Réponse de connexion Anycubic illisible") from None
            if response.status != 200 or not isinstance(result, dict):
                raise RuntimeError("Connexion au compte Anycubic refusée")
            return result

    async def login(self, session):
        """Échange un code lié au vérificateur PKCE et persiste la session ; propage les erreurs de connexion."""
        c = json.loads(self.credentials.read_text())
        verifier = secrets.token_urlsafe(48)
        challenge = (
            base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
            .decode()
            .rstrip("=")
        )
        params = {
            "clientId": CLIENT_ID,
            "responseType": "code",
            "redirectUri": REDIRECT,
            "type": "code",
            "scope": "read",
            "state": secrets.token_urlsafe(24),
            "code_challenge_method": "S256",
            "code_challenge": challenge,
        }
        response = await self.post(
            session,
            "/api/login",
            params=params,
            body={
                "application": "ac_slicer_next",
                "organization": "anycubic",
                "username": c["email"],
                "password": c["password"],
                "type": "code",
                "autoSignin": True,
            },
        )
        if response.get("status") in ("error", "fail", "failed"):
            raise AccountLoginRejected(
                "Connexion Anycubic refusée : vérifiez les identifiants ou les contrôles du compte, puis mettez à jour la configuration."
            )
        code = response.get("data")
        if (
            response.get("status") != "ok"
            or not isinstance(code, str)
            or not code
            or len(code) > 2048
        ):
            raise RuntimeError("Connexion au compte Anycubic refusée")
        result = await self.post(
            session,
            "/api/login/oauth/access_token",
            data={
                "grant_type": "authorization_code",
                "client_id": CLIENT_ID,
                "code": code,
                "code_verifier": verifier,
                "redirect_uri": REDIRECT,
            },
        )
        self.save(result)

    async def refresh(self, session):
        """Renouvelle et persiste la session, en conservant le refresh_token si le serveur l’omet."""
        result = await self.post(
            session,
            "/api/login/oauth/refresh_token",
            body={
                "grant_type": "refresh_token",
                "refresh_token": self.state["refresh_token"],
                "scope": "read",
                "client_id": CLIENT_ID,
            },
        )
        if (
            result.get("status") in ("error", "fail", "failed")
            or result.get("error") == "invalid_grant"
        ):
            raise AccountRefreshRejected("Renouvellement Anycubic refusé")
        if not result.get("refresh_token"):
            result["refresh_token"] = self.state["refresh_token"]
        self.save(result)

    def check_retry(self):
        """Réarme après changement de configuration ; refuse sans réseau un compte bloqué ou un délai non écoulé."""
        revision = hashlib.sha256(self.credentials.read_bytes()).digest()
        if revision != self.credentials_revision:
            self.credentials_revision = revision
            self.login_blocked = False
            self.retry_after = 0
            self.retry_failures = 0
            self.notice = None
        if self.login_blocked:
            raise AccountLoginRejected(self.notice)
        if time.time() < self.retry_after:
            raise RuntimeError("Connexion Anycubic en attente après un échec temporaire")

    def retry_failed(self, error):
        """Stoppe sur refus explicite ; les pannes temporaires suivent un délai de 30 secondes à 30 minutes."""
        if isinstance(error, AccountLoginRejected):
            self.login_blocked = True
            self.notice = str(error)
        else:
            self.retry_failures = min(self.retry_failures + 1, 7)
            self.retry_after = time.time() + min(1800, 30 * 2 ** (self.retry_failures - 1))
            self.notice = (
                "Connexion Anycubic temporairement indisponible. Nouvelle tentative différée."
            )

    def retry_succeeded(self):
        """Efface les délais et avertissements après une session obtenue avec succès."""
        self.retry_after = 0
        self.retry_failures = 0
        self.login_blocked = False
        self.notice = None

    def slicer_token(self):
        """Prend la dernière écriture valide entre le dépôt du lecteur isolé et le jeton historique."""
        watched = self.fallback.parent / "slicer-token" / "anycubic-token"
        sources = [
            path for path in (self.fallback, watched) if path.is_file() and path.stat().st_size
        ]
        if not sources:
            return ""
        return max(sources, key=lambda path: path.stat().st_mtime_ns).read_text().strip()

    async def token(self, session):
        """Renvoie un jeton utilisable ; lève RuntimeError si aucun repli valide ne survit à l’échec."""
        async with self.lock:
            if not self.credentials.exists():
                return self.slicer_token()
            token = self.state.get("access_token", "")
            current = self.valid(token)
            try:
                self.check_retry()
            except RuntimeError:
                if current:
                    return token
                raise
            # Le jeton de renouvellement expire avant le jeton d’accès : le renouveler chaque semaine.
            due = not current or time.time() - self.state.get("obtained_at", 0) > 7 * 86400
            if not due:
                return token
            try:
                if self.state.get("refresh_token"):
                    try:
                        await self.refresh(session)
                    except AccountRefreshRejected:
                        await self.login(session)
                else:
                    await self.login(session)
                self.retry_succeeded()
                return self.state["access_token"]
            except (
                OSError,
                ValueError,
                RuntimeError,
                TimeoutError,
                aiohttp.ClientError,
            ) as error:
                self.retry_failed(error)
                if current:
                    return token
                raise RuntimeError(self.notice) from None

    async def renew_after_rejection(self, session):
        """Renvoie un nouveau jeton après un refus explicite ; lève RuntimeError si le renouvellement échoue."""
        async with self.lock:
            if not self.credentials.exists():
                token = self.slicer_token()
                if not token:
                    raise RuntimeError(
                        "Token absent. Reconnectez le slicer puis relancez la récupération locale."
                    )
                return token
            self.check_retry()
            try:
                if self.state.get("refresh_token"):
                    try:
                        await self.refresh(session)
                    except AccountRefreshRejected:
                        await self.login(session)
                else:
                    await self.login(session)
                self.retry_succeeded()
                return self.state["access_token"]
            except (
                OSError,
                ValueError,
                RuntimeError,
                TimeoutError,
                aiohttp.ClientError,
            ) as error:
                self.retry_failed(error)
                raise RuntimeError(self.notice) from None
