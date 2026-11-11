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
        """Arrête la collecte et les livraisons avant de fermer leur session HTTP."""
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
    """Affiche les réglages sans inclure le webhook enregistré dans le HTML."""
    config = delivery.config
    selected = {"fr": "", "en": "", "es": ""}
    selected[config.language] = " selected"
    labels = {
        "sent": "Dernier envoi confirmé.",
        "failed": "Dernier envoi refusé.",
        "uncertain": "Dernier envoi sans confirmation.",
        "unavailable": "État de livraison indisponible.",
    }
    configured = "Webhook enregistré" if config.url else "Aucun webhook"
    header_text = message or configured
    feedback_state = "neutral" if not message else "success" if status < 400 else "error"
    last = labels.get(delivery.last_outcome, "")
    last_delivery = f" · {last}" if last else ""
    enabled = " checked" if config.enabled else ""
    include_filename = " checked" if config.include_filename else ""
    title = "Bilans Discord" if report else "Notifications Discord"
    introduction = (
        "Recevez le bilan des impressions à 08 h et à 21 h dans le fuseau de l’atelier."
        if report
        else "Un message après chaque impression terminée ou échouée."
    )
    action = REPORT_PATH if report else PATH
    activation = "Activer les bilans Discord" if report else "Activer les notifications"
    filename = "" if report else (
        f'<label class="check"><input type="checkbox" name="include_filename"{include_filename}> '
        "<span>Inclure le nom du fichier</span></label>"
    )
    other_path = PATH if report else REPORT_PATH
    other_title = (
        "Configurer les notifications Discord" if report else "Configurer les bilans Discord"
    )
    hidden_placeholder = "•" * 60 if config.url else ""
    channel_title = "Notifications Discord" if report else "Bilans Discord"
    channel_description = (
        "Un message après chaque impression terminée ou échouée."
        if report
        else "Bilan des impressions à 08 h et 21 h dans le fuseau de l’atelier."
    )
    line = (
        f'<a class="discord-report-link" href="{other_path}" aria-label="{other_title}">'
        f"<span><strong>{channel_title}</strong><span>{channel_description}</span></span>"
        '<span class="atelier-control">Configurer</span></a>'
    )
    checked = " checked" if config.enabled else ""
    heading = f"""<div class="discord-title"><h1>{title}</h1><p>{introduction}</p></div>"""
    body = f"""{heading}
<main class="discord-content">
<section class="discord-panel" aria-labelledby="discord-panel-title">
  <header class="discord-panel-header">
    <h2 id="discord-panel-title">Webhook</h2>
    <span class="discord-configured" data-configured="{'true' if config.url else 'false'}" data-state="{feedback_state}" data-default="{configured}"><span aria-hidden="true"></span><span id="discord-feedback" role="status" aria-live="polite">{html.escape(header_text + (last_delivery if not message else ""))}</span></span>
  </header>
  <form id="discord-settings-form" method="post" action="{action}">
    <div class="discord-panel-body">
      <div class="discord-url-field"><label for="discord-url">Adresse du webhook Discord</label>
        <span class="discord-secret-control"><input id="discord-url" type="password" name="url" maxlength="250" autocomplete="off" placeholder="{hidden_placeholder}"><button id="discord-reveal" class="atelier-control atelier-control-icon" type="button" aria-label="Afficher l’adresse du webhook" aria-pressed="false" {'disabled' if not config.url else ''}><svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/></svg></button></span>
      </div>
      <div class="discord-form-row">
        <label for="discord-language">Langue du message<select id="discord-language" name="language"><option value="fr"{selected["fr"]}>Français</option><option value="en"{selected["en"]}>English</option><option value="es"{selected["es"]}>Español</option></select></label>
        <label for="discord-password">Mot de passe web<input id="discord-password" type="password" name="password" maxlength="2048" required autocomplete="current-password"></label>
      </div>
      <div class="discord-form-row discord-check-row">
        <label class="check"><input type="checkbox" name="enabled"{checked}> <span>{activation}</span></label>
        {filename}
      </div>
      {line}
    </div>
    <footer class="discord-panel-footer">
      <button class="atelier-control atelier-control-danger" type="submit" name="operation" value="delete">Supprimer le webhook</button>
      <span class="discord-footer-actions"><button class="atelier-control" type="submit" name="operation" value="test">Envoyer un test</button><button class="atelier-control atelier-control-primary" type="submit" name="operation" value="save">Enregistrer</button></span>
    </footer>
  </form>
</section>
<a class="discord-back" href="/imprimante.html">Retour à l’atelier</a>
</main>"""
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

    operation = request.query.get("operation")

    def render(message="", status=200):
        """Retourne les refus JSON de révélation sans inclure la destination."""
        if operation == "reveal":
            return web.json_response(
                {"message": message}, status=status, headers={"Cache-Control": "no-store"}
            )
        return discord_page(delivery, message, status, report=report)

    if request.method in {"GET", "HEAD"}:
        return render()
    form = await read_discord_form(request)
    operation = form.get("operation")
    _, refusal = confirm_web_password(request, form.get("password", ""), render=render)
    if refusal is not None:
        return refusal
    if operation == "reveal":
        if not delivery.config.url:
            return web.json_response(
                {"message": "Aucun webhook enregistré."}, status=404,
                headers={"Cache-Control": "no-store"},
            )
        return web.json_response(
            {"url": delivery.config.url}, headers={"Cache-Control": "no-store"}
        )
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
