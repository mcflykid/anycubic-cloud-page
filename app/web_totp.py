"""Calcule les codes TOTP et conserve leur état antirejeu dans le stockage privé."""

import base64
from dataclasses import dataclass, replace
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import stat
import tempfile
from urllib.parse import quote, urlencode

STEP_SECONDS = 30
RECOVERY_COUNT = 10
RECOVERY_FORMAT = re.compile(r"(?:[A-F0-9]{4}-){4}[A-F0-9]{4}")


def new_secret():
    """Crée une clé de 160 bits, encodée pour une application d’authentification."""
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii")


def code_at(secret, step):
    """Calcule le code RFC 6238 à six chiffres pour le pas demandé."""
    digest = hmac.digest(base64.b32decode(secret), step.to_bytes(8, "big"), "sha1")
    offset = digest[-1] & 15
    number = int.from_bytes(digest[offset : offset + 4], "big") & 0x7FFFFFFF
    return f"{number % 1_000_000:06d}"


def matching_step(secret, code, timestamp, last_step=-1):
    """Accepte le pas courant ou un voisin, à condition qu’il soit encore inédit."""
    if not re.fullmatch(r"[0-9]{6}", code):
        return None
    step = int(timestamp) // STEP_SECONDS
    # En cas de collision rare, consommer le pas le plus récent ferme toute la fenêtre.
    matches = [
        candidate
        for candidate in (step - 1, step, step + 1)
        if candidate >= 0 and hmac.compare_digest(code_at(secret, candidate), code)
    ]
    latest = max(matches, default=-1)
    return latest if latest > last_step else None


def recovery_digest(code):
    """Transforme un code de secours aléatoire de 80 bits en empreinte non réutilisable."""
    return hashlib.sha256(code.encode("ascii")).hexdigest()


def new_recovery_codes():
    """Produit des codes de secours groupés pour faciliter leur transcription."""
    codes = set()
    while len(codes) < RECOVERY_COUNT:
        raw = secrets.token_hex(10).upper()
        codes.add("-".join(raw[index : index + 4] for index in range(0, len(raw), 4)))
    return sorted(codes)


def qr_image(secret):
    """Encode localement l’URI dans un QR incorporé à la réponse, jamais dans une URL HTTP."""
    import segno

    issuer = "Anycubic Cloud Page"
    label = quote(issuer, safe="")
    # Certains lecteurs traitent un signe plus comme un caractère littéral dans une URI otpauth.
    query = urlencode({"secret": secret, "issuer": issuer}, quote_via=quote)
    uri = f"otpauth://totp/{label}?{query}"
    return segno.make_qr(uri).png_data_uri(scale=5, border=4)


@dataclass(frozen=True)
class TotpConfig:
    """Associe la clé active au dernier pas consommé et aux empreintes restantes."""

    secret: str
    last_step: int
    recovery: tuple[str, ...]

    def consume(self, code, timestamp):
        """Prépare l’état suivant pour un code inédit, sans encore modifier le disque."""
        step = matching_step(self.secret, code, timestamp, self.last_step)
        if step is not None:
            return replace(self, last_step=step)
        normalized = code.strip().upper()
        if not RECOVERY_FORMAT.fullmatch(normalized):
            return None
        digest = recovery_digest(normalized)
        remaining = tuple(item for item in self.recovery if not hmac.compare_digest(item, digest))
        return replace(self, recovery=remaining) if len(remaining) < len(self.recovery) else None


class TotpStore:
    """Lit et écrit les réglages d’un serveur unique sous le verrou d’authentification."""

    def __init__(self, password_path, reset=False):
        """Place le facteur dans le même dossier privé que le mot de passe."""
        self.path = Path(password_path).with_name("web-totp.json")
        self.reset = reset
        if reset:
            self.disable()

    def read(self):
        """Vérifie la forme et les droits de l’état, en refusant un fichier invalide."""
        try:
            descriptor = os.open(self.path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        except FileNotFoundError:
            return None
        with os.fdopen(descriptor, encoding="utf-8") as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600:
                raise ValueError("Droits du facteur web invalides.")
            value = json.loads(stream.read(4097))
        if not isinstance(value, dict):
            raise ValueError("Format du facteur web invalide.")
        secret, step, recovery = (value.get(key) for key in ("secret", "last_step", "recovery"))
        if (
            value.get("version") != 1
            or not isinstance(secret, str)
            or not re.fullmatch(r"[A-Z2-7]{32}", secret)
            or type(step) is not int
            or not 0 <= step < 2**64
            or not isinstance(recovery, list)
            or len(recovery) > RECOVERY_COUNT
            or not all(
                isinstance(item, str) and re.fullmatch(r"[a-f0-9]{64}", item) for item in recovery
            )
        ):
            raise ValueError("Format du facteur web invalide.")
        return TotpConfig(secret, step, tuple(recovery))

    def save(self, config):
        """Écrit et synchronise la nouvelle preuve avant de confirmer son utilisation."""
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=self.path.parent, prefix=".web-totp-", delete=False
        ) as stream:
            temporary = Path(stream.name)
            try:
                os.fchmod(stream.fileno(), 0o600)
                json.dump(
                    {
                        "version": 1,
                        "secret": config.secret,
                        "last_step": config.last_step,
                        "recovery": config.recovery,
                    },
                    stream,
                )
                stream.flush()
                os.fsync(stream.fileno())
                os.replace(temporary, self.path)
                self.sync_directory()
            finally:
                temporary.unlink(missing_ok=True)

    def disable(self):
        """Efface uniquement la configuration du facteur web et confirme la suppression sur disque."""
        try:
            self.path.unlink()
        except FileNotFoundError:
            return
        self.sync_directory()

    def sync_directory(self):
        """Rend le remplacement ou la suppression durable après un redémarrage abrupt."""
        descriptor = os.open(self.path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
