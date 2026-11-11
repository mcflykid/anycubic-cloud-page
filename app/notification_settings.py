"""Expose le réglage Discord authentifié et rattache son canal au cycle de vie du serveur."""

import asyncio
from functools import partial
import html
import logging
import os
from pathlib import Path
from urllib.parse import parse_qs

import aiohttp
from aiohttp import web

from notification_delivery import Delivery, read_config
from notification_discord import DiscordConfig, send_discord
from operational_logging import log_event
from web_assets import build_web_assets
from web_host import ROOT, confirm_web_password

PATH = "/imprimante-api/discord"
DELIVERY_KEY = web.AppKey("discord_delivery", Delivery)
CONFIG_KEY = web.AppKey("discord_private_config", Path)
_LOG = logging.getLogger("cloud_page.notifications")


def install_discord(app, state_dir, *, fake_sender=None):
    """Installe les réglages et choisit un transport fictif ou la session réseau dédiée."""
    password_path = Path(os.environ.get("WEB_PASSWORD_FILE", "/appdata/private/web-password"))
    app[CONFIG_KEY] = password_path.with_name("discord-webhook")

    async def lifecycle(app):
        """Charge les réglages au démarrage et arrête les livraisons avant de fermer le transport."""
        async with aiohttp.ClientSession(trust_env=False) as session:
            sender = fake_sender if fake_sender is not None else partial(send_discord, session)
            delivery = app[DELIVERY_KEY] = Delivery(state_dir, sender)
            try:
                delivery.configure(read_config(app[CONFIG_KEY]))
            except (OSError, ValueError) as error:
                log_event(
                    _LOG,
                    logging.WARNING,
                    "notification_config_invalid",
                    message="Réglages Discord illisibles, canal désactivé",
                    error_type=type(error).__name__,
                )
            try:
                yield
            finally:
                await delivery.close()

    app.cleanup_ctx.append(lifecycle)
    app.router.add_get(PATH, discord_settings)
    app.router.add_post(PATH, discord_settings)


def discord_page(delivery, message="", status=200):
    """Affiche des options publiques et garde le champ du secret toujours vide."""
    config = delivery.config
    selected = {"fr": "", "en": "", "es": ""}
    selected[config.language] = " selected"
    labels = {
        "sent": "Dernier envoi confirmé.",
        "failed": "Dernier envoi refusé.",
        "uncertain": "Dernier envoi sans confirmation.",
        "unavailable": "État de livraison indisponible.",
    }
    feedback = f'<p role="status">{html.escape(message)}</p>' if message else ""
    configured = "Webhook enregistré." if config.url else "Aucun webhook enregistré."
    last = labels.get(delivery.last_outcome, "")
    last_delivery = f"<p>{last}</p>" if last else ""
    enabled = " checked" if config.enabled else ""
    include_filename = " checked" if config.include_filename else ""
    body = f"""<h1>Notifications Discord</h1>
<p>Recevez un message après une impression terminée ou échouée.</p>
<p>{configured}</p>
{last_delivery}
{feedback}
<form method="post" action="{PATH}">
<label for="discord-url">Adresse du webhook Discord</label>
<input id="discord-url" type="password" name="url" maxlength="250" autocomplete="off" aria-describedby="discord-url-hint">
<p id="discord-url-hint" class="muted">Laissez vide pour conserver le webhook enregistré.</p>
<label for="discord-language">Langue du message</label>
<select id="discord-language" name="language"><option value="fr"{selected["fr"]}>Français</option><option value="en"{selected["en"]}>English</option><option value="es"{selected["es"]}>Español</option></select>
<div class="discord-options">
<label class="check"><input type="checkbox" name="enabled"{enabled}> Activer les notifications Discord</label>
<label class="check"><input type="checkbox" name="include_filename"{include_filename}> Inclure le nom du fichier</label>
</div>
<label for="discord-password">Mot de passe web</label>
<input id="discord-password" type="password" name="password" maxlength="2048" required autocomplete="current-password">
<div class="actions">
<button class="primary" type="submit" name="operation" value="save">Enregistrer</button>
<button type="submit" name="operation" value="test">Envoyer un test</button>
<button type="submit" name="operation" value="delete">Supprimer le webhook</button>
</div>
</form>
<p><a href="/imprimante.html">Retour à l’atelier</a></p>"""
    return web.Response(
        text=build_web_assets(ROOT)[0]["discord.html"].replace("<!-- DISCORD_CONTENT -->", body),
        status=status,
        content_type="text/html",
    )


async def read_discord_form(request):
    """Borne le formulaire avant de lire le secret saisi et refuse les champs multiples."""
    if request.content_type != "application/x-www-form-urlencoded":
        raise web.HTTPUnsupportedMediaType()
    try:
        raw = await request.content.readexactly(4097)
    except asyncio.IncompleteReadError as error:
        raw = error.partial
    if len(raw) > 4096:
        raise web.HTTPRequestEntityTooLarge(max_size=4096, actual_size=len(raw))
    try:
        values = parse_qs(raw.decode(), keep_blank_values=True, max_num_fields=8)
        if any(len(value) != 1 for value in values.values()):
            raise ValueError
        return {key: value[0] for key, value in values.items()}
    except (ValueError, UnicodeError):
        raise web.HTTPBadRequest(text="Formulaire Discord invalide.") from None


async def discord_settings(request):
    """Confirme le mot de passe avant de sauvegarder, retirer ou utiliser la destination."""
    delivery = request.app[DELIVERY_KEY]
    if request.method in {"GET", "HEAD"}:
        return discord_page(delivery)
    form = await read_discord_form(request)
    def render_refusal(message, status):
        return discord_page(delivery, message, status)

    _, refusal = confirm_web_password(request, form.get("password", ""), render=render_refusal)
    if refusal is not None:
        return refusal
    operation = form.get("operation")
    if operation not in {"save", "test", "delete"}:
        raise web.HTTPBadRequest(text="Action Discord invalide.")
    try:
        config = (
            DiscordConfig()
            if operation == "delete"
            else DiscordConfig.parse(
                {
                    "url": form.get("url", "").strip() or delivery.config.url,
                    "enabled": form.get("enabled") == "on" if operation == "save" else True,
                    "language": form.get("language", "fr"),
                    "include_filename": form.get("include_filename") == "on",
                }
            )
        )
    except ValueError as error:
        return discord_page(delivery, str(error), 400)
    if operation == "test":
        result = await delivery.test(config)
        if result.outcome == "sent":
            return discord_page(delivery, "Message de test confirmé.")
        if result.status == 429:
            return discord_page(
                delivery, "Le test est temporairement limité. Réessayez plus tard.", 429
            )
        return discord_page(delivery, "Discord n’a pas confirmé le message de test.", 502)
    try:
        await delivery.save_config(request.app[CONFIG_KEY], config)
    except OSError:
        return discord_page(delivery, "Impossible d’enregistrer le réglage Discord.", 503)
    return discord_page(
        delivery, "Webhook supprimé." if operation == "delete" else "Réglage Discord enregistré."
    )
