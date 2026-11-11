"""Relie le journal local des commandes aux réponses et au contexte HTTP."""

import asyncio
import contextlib
import logging

from aiohttp import web

from command_journal import (
    ACTIONS,
    CLOUD_ONLY_ACTIONS,
    CommandJournal,
    JournalMQTT,
    command_mqtt_context,
    make_entry,
    request_key,
)
from operational_logging import log_event
from web_host import SESSION_DIGEST_KEY, client_address

# Les routes conservent le même canal de diagnostic après la séparation.
OPS_LOG = logging.getLogger("cloud_page.server")

COMMAND_JOURNAL_KEY = web.AppKey("command_journal", CommandJournal)
COMMAND_MQTT_KEY = web.AppKey("command_mqtt", JournalMQTT)


class CommandWaitExpired(ValueError):
    """Signale une attente expirée avant l’envoi d’une commande."""


async def save_command_event(request, entry):
    """Enregistre la trace sans empêcher une commande de sécurité si le disque est indisponible."""
    if not entry:
        return
    journal = request.app[COMMAND_JOURNAL_KEY]
    try:
        await journal.record_async(entry)
    except OSError:
        logging.getLogger(__name__).error("Écriture du journal des commandes impossible")


async def recorded_command(request, request_id):
    """Retrouve une tentative déjà engagée, même après la perte du cache de l’imprimante."""
    journal = request.app.get(COMMAND_JOURNAL_KEY) if isinstance(request, web.Request) else None
    if journal is None:
        return None
    key = request_key(request_id)
    printer = request.get("printer_key")
    try:
        for row in reversed(await asyncio.to_thread(journal.rows)):
            if (
                row.get("printer") != printer
                or row.get("request_id") != key
                or row["outcome"] in ("refusée", "expirée")
            ):
                continue
            known = row["outcome"] != "inconnue"
            message = (
                "Demande déjà traitée."
                if known
                else "Demande déjà engagée, résultat inconnu. Vérifiez l’imprimante."
            )
            return web.json_response(
                {"ok": known, "message": message}, status=200 if known else 409
            )
    except OSError:
        logging.getLogger(__name__).error("Lecture du journal des commandes impossible")
    return None


@contextlib.asynccontextmanager
async def audit_command(request, engine, action, request_id, parameters):
    """Garde un résultat local ou inconnu si la demande se termine avant son retour Anycubic."""
    if (
        isinstance(action, str)
        and action in ACTIONS
        and isinstance(request, web.Request)
        and COMMAND_JOURNAL_KEY in request.app
    ):
        entry = make_entry(
            action,
            request_id,
            request.get("printer_key"),
            getattr(engine.printer, "name", None),
            request.get(SESSION_DIGEST_KEY),
            client_address(request),
            parameters,
        )
    else:
        entry = {}
    tracker = request.app.get(COMMAND_MQTT_KEY) if entry else None
    context = command_mqtt_context.set(
        (tracker, entry, asyncio.current_task()) if tracker else None
    )
    try:
        yield entry
    except CommandWaitExpired:
        if entry:
            entry["outcome"] = "expirée"
        raise
    finally:
        command_mqtt_context.reset(context)
        await save_command_event(request, entry)
        if entry:
            log_event(
                OPS_LOG,
                logging.WARNING
                if entry.get("outcome") in {"inconnue", "refusée", "expirée"}
                else logging.INFO,
                "command_result",
                message=(
                    "Résultat de la mutation Cloud ; une acceptation concerne le compte Anycubic"
                    if entry.get("action") in CLOUD_ONLY_ACTIONS
                    or entry.get("action") in {"history-delete", "upload"}
                    else "Résultat de la demande ; une acceptation ne prouve pas l’exécution physique"
                ),
                action=entry.get("action"),
                outcome=entry.get("outcome"),
                printer=entry.get("printer"),
                command_id=entry.get("request_id"),
            )


async def command_journal(request):
    """Liste les entrées privées filtrées ou télécharge une copie sans adresse ni empreinte de session."""
    try:
        rows = await asyncio.to_thread(request.app[COMMAND_JOURNAL_KEY].rows)
    except OSError:
        return web.json_response(
            {"message": "Le journal des commandes est indisponible."}, status=503
        )
    printers = {row["printer"]: row.get("printer_name") for row in rows if row.get("printer")}
    actions = sorted({row["action"] for row in rows})
    printer = request.query.get("printer")
    action = request.query.get("action")
    rows = [
        row
        for row in reversed(rows)
        if (not printer or row.get("printer") == printer)
        and (not action or row["action"] == action)
    ]
    rows = [{key: value for key, value in row.items() if key != "mqtt"} for row in rows]
    if request.query.get("export") == "1":
        public = [
            {key: value for key, value in row.items() if key not in ("client", "session")}
            for row in rows
        ]
        return web.json_response(
            public, headers={"Content-Disposition": 'attachment; filename="journal-commandes.json"'}
        )
    return web.json_response({"items": rows[:100], "printers": printers, "actions": actions})
