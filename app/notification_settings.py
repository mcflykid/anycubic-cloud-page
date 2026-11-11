"""Expose le réglage Discord authentifié et rattache son canal au cycle de vie du serveur."""

import asyncio
from contextlib import suppress
from functools import partial
import html
import logging
import os
from pathlib import Path
from urllib.parse import parse_qs
from zoneinfo import ZoneInfo

import aiohttp
from aiohttp import web

from notification_delivery import Delivery, read_config
from notification_discord import DiscordConfig, message_payload, send_discord
from notification_reports import ReportSchedule, format_report
from operational_logging import log_event
from web_assets import build_web_assets
from web_host import ROOT, confirm_web_password, display_timezone

PATH = "/imprimante-api/discord"
REPORT_PATH = PATH + "/reports"
DELIVERY_KEY = web.AppKey("discord_delivery", Delivery)
CONFIG_KEY = web.AppKey("discord_private_config", Path)
REPORT_KEY = web.AppKey("discord_reports", Delivery)
REPORT_CONFIG_KEY = web.AppKey("discord_report_private_config", Path)
SETTINGS_LOCK = web.AppKey("discord_destinations_lock", asyncio.Lock)
_LOG = logging.getLogger("cloud_page.notifications")


def _same_destination(first, second):
    # Comparer les identifiants empêche une rotation de jeton de masquer un même webhook.
    return first and second and first.rsplit("/", 2)[-2] == second.rsplit("/", 2)[-2]


def _restore_config(delivery, path):
    try:
        delivery.configure(read_config(path))
    except (OSError, ValueError) as error:
        log_event(
            _LOG,
            logging.WARNING,
            "notification_config_invalid",
            message="Réglages Discord illisibles, canal désactivé",
            error_type=type(error).__name__,
        )


def _report_payload(report, config):
    return message_payload(format_report(report, config))


def install_discord(app, state_dir, *, fake_sender=None, history_reader=None):
    """Installe deux destinations privées et démarre le planificateur en production."""
    password_path = Path(os.environ.get("WEB_PASSWORD_FILE", "/appdata/private/web-password"))
    app[CONFIG_KEY] = password_path.with_name("discord-webhook")
    app[REPORT_CONFIG_KEY] = password_path.with_name("discord-reports-webhook")
    app[SETTINGS_LOCK] = asyncio.Lock()

    async def lifecycle(app):
        async with aiohttp.ClientSession(trust_env=False) as session:
            sender = fake_sender if fake_sender is not None else partial(send_discord, session)
            report_sender = (
                fake_sender
                if fake_sender is not None
                else partial(send_discord, session, formatter=_report_payload)
            )
            delivery = app[DELIVERY_KEY] = Delivery(state_dir, sender)
            schedule = ReportSchedule(
                state_dir, report_sender, ZoneInfo(display_timezone()), history_reader
            )
            reports = app[REPORT_KEY] = schedule.delivery
            _restore_config(delivery, app[CONFIG_KEY])
            _restore_config(reports, app[REPORT_CONFIG_KEY])
            if _same_destination(delivery.config.url, reports.config.url):
                reports.configure(DiscordConfig())
                log_event(
                    _LOG,
                    logging.WARNING,
                    "discord_report_destination_conflict",
                    message="Bilans Discord désactivés : le webhook est déjà celui des alertes",
                )
            task = asyncio.create_task(schedule.run()) if history_reader is not None else None
            try:
                yield
            finally:
                if task is not None:
                    task.cancel()
                    with suppress(asyncio.CancelledError):
                        await task
                await reports.close()
                await delivery.close()

    app.cleanup_ctx.append(lifecycle)
    for path in (PATH, REPORT_PATH):
        app.router.add_get(path, discord_settings)
        app.router.add_post(path, discord_settings)


def discord_enabled(app, *, reports=False):
    """Indique si le canal est actif, ou absent de cette variante de l’atelier."""
    delivery = app.get(REPORT_KEY if reports else DELIVERY_KEY)
    return delivery.config.enabled if delivery is not None else None


def discord_page(delivery, message="", status=200, *, report=False):
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
    title = "Bilans Discord" if report else "Notifications Discord"
    introduction = (
        "Recevez le bilan des impressions à 08 h et à 21 h dans le fuseau de l’atelier."
        if report
        else "Recevez un message après une impression terminée ou échouée."
    )
    action = REPORT_PATH if report else PATH
    activation = "Activer les bilans Discord" if report else "Activer les notifications Discord"
    filename = (
        ""
        if report
        else (
            f'<label class="check"><input type="checkbox" name="include_filename"{include_filename}> '
            "Inclure le nom du fichier</label>"
        )
    )
    other_path = PATH if report else REPORT_PATH
    other_title = (
        "Configurer les notifications Discord" if report else "Configurer les bilans Discord"
    )
    body = f"""<h1>{title}</h1>
<p>{introduction}</p>
<p><a href="{other_path}">{other_title}</a></p>
<p>{configured}</p>
{last_delivery}
{feedback}
<form method="post" action="{action}">
<label for="discord-url">Adresse du webhook Discord</label>
<input id="discord-url" type="password" name="url" maxlength="250" autocomplete="off" aria-describedby="discord-url-hint">
<p id="discord-url-hint" class="muted">Laissez vide pour conserver le webhook enregistré.</p>
<label for="discord-language">Langue du message</label>
<select id="discord-language" name="language"><option value="fr"{selected["fr"]}>Français</option><option value="en"{selected["en"]}>English</option><option value="es"{selected["es"]}>Español</option></select>
<div class="discord-options">
<label class="check"><input type="checkbox" name="enabled"{enabled}> {activation}</label>
{filename}
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
        text=build_web_assets(ROOT)[0]["discord.html"]
        .replace("Notifications Discord — Anycubic Cloud Page", f"{title} — Anycubic Cloud Page")
        .replace("<!-- DISCORD_CONTENT -->", body),
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
    report = request.path == REPORT_PATH
    delivery = request.app[REPORT_KEY if report else DELIVERY_KEY]
    other = request.app[DELIVERY_KEY if report else REPORT_KEY]
    config_path = request.app[REPORT_CONFIG_KEY if report else CONFIG_KEY]

    def render(message="", status=200):
        return discord_page(delivery, message, status, report=report)

    if request.method in {"GET", "HEAD"}:
        return render()
    form = await read_discord_form(request)
    _, refusal = confirm_web_password(request, form.get("password", ""), render=render)
    if refusal is not None:
        return refusal
    operation = form.get("operation")
    if operation not in {"save", "test", "delete"}:
        raise web.HTTPBadRequest(text="Action Discord invalide.")
    async with request.app[SETTINGS_LOCK]:
        try:
            config = (
                DiscordConfig()
                if operation == "delete"
                else DiscordConfig.parse(
                    {
                        "url": form.get("url", "").strip() or delivery.config.url,
                        "enabled": form.get("enabled") == "on" if operation == "save" else True,
                        "language": form.get("language", "fr"),
                        "include_filename": not report and form.get("include_filename") == "on",
                    }
                )
            )
            if _same_destination(config.url, other.config.url):
                raise ValueError("Choisissez deux webhooks Discord distincts.")
        except ValueError as error:
            return render(str(error), 400)
        if operation != "test":
            try:
                await delivery.save_config(config_path, config)
            except OSError:
                return render("Impossible d’enregistrer le réglage Discord.", 503)
            return render(
                "Webhook supprimé." if operation == "delete" else "Réglage Discord enregistré."
            )
        result = await delivery.test(config)
    if result.outcome == "sent":
        return render("Message de test confirmé.")
    if result.status == 429:
        return render("Le test est temporairement limité. Réessayez plus tard.", 429)
    return render("Discord n’a pas confirmé le message de test.", 502)
