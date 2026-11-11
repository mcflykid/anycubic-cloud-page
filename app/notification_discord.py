"""Valide un webhook Discord, formate le message et classe le résultat de l’envoi."""

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
import json
import math
import re
from urllib.parse import urlsplit

import aiohttp

from notification_service import notification_error_title

_HOST = "discord.com"
_PATH = re.compile(r"/api(?:/v10)?/webhooks/[0-9]{17,22}/[A-Za-z0-9_-]{30,150}")
_SNOWFLAKE = re.compile(r"[0-9]{17,22}")
_LANGUAGES = {
    "fr": (
        "Impression terminée",
        "Échec de l’impression",
        "Imprimante",
        "Code d’erreur",
        "Test de notification Anycubic Cloud Page.",
    ),
    "en": (
        "Print completed",
        "Print failed",
        "Printer",
        "Error code",
        "Anycubic Cloud Page notification test.",
    ),
    "es": (
        "Impresión terminada",
        "Error de impresión",
        "Impresora",
        "Código de error",
        "Prueba de notificaciones de Anycubic Cloud Page.",
    ),
}


@dataclass(frozen=True)
class DiscordConfig:
    """Rassemble la destination privée et les préférences visibles du canal."""

    url: str = field(default="", repr=False)
    enabled: bool = False
    language: str = "fr"
    include_filename: bool = False

    @classmethod
    def parse(cls, value):
        """Refuse une configuration incomplète ou incohérente avant tout appel réseau."""
        if not isinstance(value, dict):
            raise ValueError("Configuration Discord invalide.")
        url = value.get("url", "")
        enabled, language = value.get("enabled"), value.get("language")
        include_filename = value.get("include_filename")
        if (
            not isinstance(url, str)
            or type(enabled) is not bool
            or type(include_filename) is not bool
            or not isinstance(language, str)
            or language not in _LANGUAGES
        ):
            raise ValueError("Configuration Discord invalide.")
        if url:
            url = discord_url(url)
        elif enabled:
            raise ValueError("Renseignez une adresse de webhook Discord.")
        return cls(url, enabled, language, include_filename)


@dataclass(frozen=True)
class DiscordResult:
    """Distingue confirmation, refus, nouvelle tentative sûre et état ambigu."""

    outcome: str
    status: int | None = None
    retry_after: float | None = None


def discord_url(value):
    """Reconstruit une destination Discord HTTPS exacte, sans variantes ni redirection."""
    if not isinstance(value, str) or len(value) > 250:
        raise ValueError("Adresse de webhook Discord invalide.")
    value = value.strip()
    try:
        url = urlsplit(value)
        if (
            url.scheme == "https"
            and url.netloc in {_HOST, _HOST + ":443", "discordapp.com", "discordapp.com:443"}
            and _PATH.fullmatch(url.path)
            and not url.query
            and not url.fragment
            and value == f"https://{url.netloc}{url.path}"
        ):
            # Les anciennes adresses sont réécrites avant l’envoi. Aucun suivi de redirection.
            return f"https://{_HOST}{url.path}"
    except ValueError:
        pass
    raise ValueError("Adresse de webhook Discord invalide.")


def clean_label(value, limit):
    """Supprime contrôles et liens implicites, puis neutralise les délimiteurs Markdown et mentions."""
    text = re.sub(r"[\x00-\x1f\x7f-\x9f]", " ", value)[:limit]
    text = text.replace("@", "@\u200b")
    text = re.sub(r"(?i)\bhttps?://", "", text)
    return re.sub(r"([\\`*_~|<>()\[\]#])", r"\\\1", text).strip()


def format_message(event, config):
    """Compose un message sobre, sans données fournisseur libres ni mention Discord."""
    complete, failed, printer, code, test = _LANGUAGES[config.language]
    if event is None:
        content = test
    else:
        at = datetime.fromtimestamp(event.timestamp, timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        name = clean_label(event.printer, 80) or printer
        content = f"**{complete if event.result == 'completed' else failed}**\n{name} · {at}"
        if event.code:
            content += f"\n{code} {event.code}"
            if title := notification_error_title(event.code, config.language):
                content += f" · {clean_label(title, 100)}"
        if config.include_filename and (filename := clean_label(event.filename, 140)):
            content += f"\n{filename}"
    return message_payload(content)


def message_payload(content):
    """Ajoute l’avatar public du projet et désactive les mentions et aperçus."""
    return {
        "content": content,
        "allowed_mentions": {"parse": []},
        "flags": 4,
        # Discord lit le fichier public sans contacter l’atelier.
        "avatar_url": "https://raw.githubusercontent.com/mcflykid/anycubic-cloud-page/main/docs/assets/discord-avatar.png",
    }


async def send_discord(session, config, event, *, formatter=format_message):
    """Envoie une seule requête à Discord et classe toute réponse sans conserver son corps."""
    url = discord_url(config.url)
    try:
        async with session.post(
            url,
            params={"wait": "true"},
            json=formatter(event, config),
            allow_redirects=False,
            timeout=aiohttp.ClientTimeout(total=10, connect=3),
        ) as response:
            status = response.status
            if status != 429 and not 200 <= status < 300:
                return DiscordResult("uncertain" if status >= 500 else "failed", status)
            body = {}
            try:
                raw = await response.content.readexactly(16_385)
            except asyncio.IncompleteReadError as error:
                raw = error.partial
            if len(raw) <= 16_384:
                try:
                    candidate = json.loads(raw)
                    if isinstance(candidate, dict):
                        body = candidate
                except (ValueError, UnicodeError):
                    pass
            if status == 429:
                delays = []
                for hint in (response.headers.get("Retry-After"), body.get("retry_after")):
                    try:
                        seconds = float(hint)
                    except (TypeError, ValueError):
                        continue
                    if math.isfinite(seconds) and seconds > 0:
                        delays.append(seconds)
                return (
                    DiscordResult("retry", status, max(delays))
                    if delays
                    else DiscordResult("failed", status)
                )
            message_id = body.get("id")
            return DiscordResult(
                "sent"
                if isinstance(message_id, str) and _SNOWFLAKE.fullmatch(message_id)
                else "uncertain",
                status,
            )
    except (aiohttp.ClientSSLError, aiohttp.ServerFingerprintMismatch):
        return DiscordResult("failed")
    except aiohttp.ClientConnectorError:
        return DiscordResult("retry", retry_after=5)
    except (aiohttp.ClientError, TimeoutError):
        return DiscordResult("uncertain")
