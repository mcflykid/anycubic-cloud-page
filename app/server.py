# SPDX-License-Identifier: GPL-3.0-or-later
"""Adaptateur web autonome de l’API Anycubic avec suivi MQTT et commandes sérialisées."""

import asyncio, contextlib, json, logging, os, pathlib, re, time, uuid
from datetime import datetime
from aiohttp import web
from vendor_config import load_vendor_config

load_vendor_config()
import camera_sessions
from camera_sessions import (
    CAMERA_VIEWER_TTL as CAMERA_VIEWER_TTL,
    camera_transport_failure as camera_transport_failure,
    camera_viewer_deadline as camera_viewer_deadline,
    close_idle_camera as close_idle_camera,
    expire_camera_viewers as expire_camera_viewers,
    prune_camera_viewers as prune_camera_viewers,
    schedule_camera_expiry as schedule_camera_expiry,
)
from file_preview import find_project_preview_url
from file_uploads import purge_abandoned_uploads, upload_operation
from cloud_extras import download_preview, trusted_url
from temperature_history import TemperatureHistory, ace_readings
from print_preflight import ensure_firmware_ready, evaluate_preflight
from printer_registry import PrinterRegistry, select_printer, printer_key
from printer_engine import CloudPageAPI as CloudPageAPI, Engine, engine
from fleet_health import FleetHealth
from monitoring import Monitoring
from request_validation import json_object
from printer_values import integer, now as now, safeget
import printer_files
from web_host import (
    APP_VERSION,
    SENSITIVE_ACTIONS,
    access_control,
    consume_action_ticket,
)
from command_journal import (
    CLOUD_ONLY_ACTIONS,
    CommandJournal,
    JournalMQTT,
    command_dispatch,
)
from command_journal_web import (
    COMMAND_JOURNAL_KEY,
    COMMAND_MQTT_KEY,
    CommandWaitExpired,
    audit_command,
    command_journal,
    recorded_command,
    save_command_event,
)
from operational_logging import (
    LoggingConfigurationError,
    configure_logging,
    log_event,
    request_context,
    safe_exception_frames,
)
from anycubic_cloud_api.api.base import AnycubicRateLimited
from native_controls import task_details as task_details
from anycubic_cloud_api.api.mqtt import AnycubicMQTTAPI as AnycubicMQTTAPI
from anycubic_cloud_api.data_models.orders import (
    AnycubicBaseOrderRequest as AnycubicBaseOrderRequest,
)
from anycubic_cloud_api.exceptions.exceptions import (
    AnycubicCameraSessionError,
)

COMMAND_READ_WAIT_SECONDS = 30
OPS_LOG = logging.getLogger("cloud_page.server")
HTTP_LOG = logging.getLogger("cloud_page.http")
MONITORING_KEY = web.AppKey("monitoring", Monitoring)


def request_engine(request):
    """Les appels directs de tests gardent leur doublure ; les requêtes HTTP ont une cible figée par middleware."""
    return request.get("selected_engine", engine) if isinstance(request, web.Request) else engine


def verify_printer_target(request, selected, *, require_model=True):
    """Refuse une cible modifiée pendant une attente ; la vérification précède tout envoi physique sous verrou."""
    if isinstance(request, web.Request):
        expected = request.get("printer_key")
        registry = getattr(selected, "fleet_registry", None)
        if expected and registry and expected not in registry.catalogue():
            raise ValueError("Cette imprimante a quitté le compte. Aucune commande envoyée.")
        if expected and (
            (selected.printer is None and require_model)
            or (selected.printer is not None and printer_key(selected.printer.id) != expected)
        ):
            raise ValueError(
                "L’imprimante ciblée a changé ou n’est pas prête. Actualisez sans répéter la commande."
            )


@web.middleware
async def operational_requests(request, handler):
    """Corrèle statut et durée HTTP sans enregistrer paramètres, corps, cookie ni adresse client."""
    request_id = uuid.uuid4().hex
    resource = getattr(request.match_info.route, "resource", None)
    route = getattr(resource, "canonical", None) or "unmatched"
    context = {"request_id": request_id, "method": request.method, "route": route}
    token = request_context.set(context)
    started = time.monotonic()
    status = 500
    try:
        try:
            response = await handler(request)
        except web.HTTPException as error:
            status = error.status
            if not error.prepared:
                error.headers["X-Request-ID"] = request_id
            raise
        status = response.status
        if not response.prepared:
            response.headers["X-Request-ID"] = request_id
        return response
    finally:
        if monitor := request.app.get(MONITORING_KEY):
            with contextlib.suppress(Exception):
                monitor.record_http(status, (time.monotonic() - started) * 1000)
        level = (
            logging.ERROR
            if status >= 500
            else logging.WARNING
            if status >= 400
            else logging.INFO
            if request.method not in {"GET", "HEAD", "OPTIONS"}
            else logging.DEBUG
        )
        log_event(
            HTTP_LOG,
            level,
            "http_request",
            message="Requête HTTP terminée"
            if status < 400
            else "Requête HTTP refusée ou en échec ; consultez les événements de cette requête",
            **context,
            status=status,
            duration_ms=round((time.monotonic() - started) * 1000, 1),
        )
        request_context.reset(token)


@web.middleware
async def errors(request, handler):
    """Convertit les erreurs en réponses HTTP sans publier les détails internes des exceptions inattendues."""
    try:
        return await handler(request)
    except web.HTTPException:
        raise
    except AnycubicRateLimited as error:
        return web.json_response(
            {"ok": False, "message": str(error), "retry_after_seconds": error.retry_after},
            status=503,
            headers={"Retry-After": str(error.retry_after), "Cache-Control": "no-store"},
        )
    except AnycubicCameraSessionError as e:
        request_engine(request).event("Caméra", e.reason)
        return web.json_response(
            {"ok": False, "message": str(e), "camera_error": e.reason}, status=409
        )
    except ValueError as e:
        log_event(
            OPS_LOG,
            logging.WARNING,
            "invalid_request",
            message="Paramètres de la requête refusés; consultez le type et les repères de pile",
            error_type=type(e).__name__,
            frames=safe_exception_frames(e),
        )
        return web.json_response({"ok": False, "message": str(e)[:200]}, status=400)
    except (KeyError, TypeError) as e:
        log_event(
            OPS_LOG,
            logging.WARNING,
            "invalid_request",
            message="Structure de requête invalide ; vérifiez les paramètres du formulaire",
            error_type=type(e).__name__,
            frames=safe_exception_frames(e),
        )
        return web.json_response(
            {"ok": False, "message": "Données de la demande invalides."}, status=400
        )
    except Exception as e:
        log_event(
            OPS_LOG,
            logging.ERROR,
            "request_failure",
            message="Traitement interrompu par une erreur inattendue ; utilisez la référence de requête pour retrouver son contexte",
            error_type=type(e).__name__,
            frames=safe_exception_frames(e),
        )
        request_engine(request).event("Erreur", type(e).__name__)
        return web.json_response(
            {
                "ok": False,
                "message": (
                    "La caméra ne répond pas pour le moment. Réessayez dans quelques secondes."
                    if request.path == "/imprimante-api/camera-session"
                    else "Anycubic n’a pas confirmé cette opération. Vérifiez l’état de la machine avant un nouvel essai."
                ),
            },
            status=409,
        )


async def status(req):
    """Renvoie l’état de la cible propre à la requête, sans sélection globale ni cache navigateur."""
    return web.json_response(request_engine(req).snapshot(), headers={"Cache-Control": "no-store"})


async def printers(req):
    """Renvoie les noms et références opaques du compte ; aucun identifiant cloud brut."""
    return web.json_response(
        req.app["printer_registry"].choices(), headers={"Cache-Control": "no-store"}
    )


async def fleet(req):
    """Résume les seuls moteurs déjà suivis sans démarrer de collecte pour une autre machine."""
    return web.json_response(
        req.app["fleet_health"].snapshot(req.app["printer_registry"]),
        headers={"Cache-Control": "no-store"},
    )


async def monitoring(req):
    """Renvoie les métriques locales et l’état des moteurs déjà créés, sans réveiller de cible."""
    monitor = req.app.get(MONITORING_KEY)
    if monitor is None:
        raise web.HTTPServiceUnavailable(text="Supervision locale indisponible.")
    registry = req.app.get("printer_registry")
    primary = getattr(registry, "default", engine)
    return web.json_response(
        monitor.snapshot(primary, registry), headers={"Cache-Control": "no-store"}
    )


async def health(req):
    """Renvoie la disponibilité du service HTTP, indépendamment de celle du cloud."""
    return web.json_response({"service": "ok"})


async def diagnostic(req):
    """Télécharge les informations locales autorisées, même si le Cloud ne répond plus."""
    engine = request_engine(req)
    model = safeget(engine.printer, "machine_name")
    firmware = safeget(engine.printer, "fw_version.firmware_version")
    counters = getattr(engine.api, "mqtt_diagnostics", {})
    features = engine.extras.features() if engine.extras else {}
    payload = {
        "version": APP_VERSION,
        "cloud_available": bool(engine.ok and engine.api),
        "model": model
        if isinstance(model, str)
        and re.fullmatch(
            r"(?:Anycubic )?(?:Kobra|Photon|Mega|Chiron|Vyper)(?:[ A-Za-z0-9+-]{0,44})", model
        )
        else None,
        "firmware": firmware
        if isinstance(firmware, str) and re.fullmatch(r"[vV]?\d+(?:\.\d+){1,5}", firmware)
        else None,
        "capabilities": {
            name: features[name]
            for name in (
                "camera_timelapse_support",
                "fod_support",
                "factory_reset_support",
            )
            if name in features
        },
        "mqtt": {
            name: counters[name]
            for name in (
                "unknown_reports",
                "unknown_types",
                "unhandled_reports",
                "decode_errors",
                "processing_errors",
            )
            if name in counters and type(counters[name]) is int and counters[name] >= 0
        },
    }
    return web.json_response(
        payload,
        headers={"Content-Disposition": 'attachment; filename="diagnostic-anycubic.json"'},
    )


async def files(req):
    """Renvoie les fichiers cloud sous verrou ; lève ValueError sans connexion ou si la page est invalide."""
    engine = request_engine(req)
    if not engine.api:
        raise ValueError("Connexion en cours")
    page = integer(req.query.get("page", 1), 1, 1000)
    folder = req.query.get("folder")
    if folder is not None and not re.fullmatch(r"root|[a-f0-9]{20}", folder):
        raise ValueError("Dossier Cloud invalide")
    async with engine.lock:
        return web.json_response(
            await (
                engine.cloud_files(page) if folder is None else engine.cloud_files(page, folder)
            ),
            headers={"Cache-Control": "no-store"},
        )


async def history(req):
    """Renvoie une page du journal ; lève ValueError sans connexion ou si la page est invalide."""
    engine = request_engine(req)
    if not engine.api:
        raise ValueError("Connexion en cours")
    page = integer(req.query.get("page", 1), 1, 1000)
    source = req.query.get("source")
    if source not in (None, "legacy", "slicer"):
        raise ValueError("Journal de notifications invalide")
    async with engine.lock:
        return web.json_response(
            await (
                engine.print_history(page) if source is None else engine.print_history(page, source)
            ),
            headers={"Cache-Control": "no-store"},
        )


async def history_read(req):
    """Renvoie la confirmation de lecture ; lève ValueError si la clé de notification est invalide."""
    engine = request_engine(req)
    data = await json_object(req)
    if data.get("all") is not True and not re.fullmatch(r"[a-f0-9]{20}", str(data.get("key", ""))):
        raise ValueError("Notification invalide")
    if not engine.api:
        raise ValueError("Connexion en cours")
    async with engine.lock:
        return web.json_response(
            await engine.mark_history_read(data.get("key"), data.get("all") is True),
            headers={"Cache-Control": "no-store"},
        )


async def history_delete(req):
    """Renvoie la confirmation d’effacement ; lève ValueError si la clé de notification est invalide."""
    engine = request_engine(req)
    data = await json_object(req)
    async with audit_command(req, engine, "history-delete", None, {}) as audit:
        if data.get("all") is not True and not re.fullmatch(
            r"[a-f0-9]{20}", str(data.get("key", ""))
        ):
            raise ValueError("Notification invalide")
        async with engine.lock:
            async with cloud_mutation_operation(engine):
                if not engine.api:
                    raise ValueError("Connexion en cours")
                if audit:
                    audit["outcome"] = "inconnue"
                    await save_command_event(req, audit)
                result = await engine.delete_history(data.get("key"), data.get("all") is True)
                if audit:
                    audit["outcome"] = "acceptée"
                return web.json_response(result, headers={"Cache-Control": "no-store"})


async def ai_settings(req):
    """Renvoie les réglages IA en JSON ; lève ValueError sans machine ou connexion disponible."""
    engine = request_engine(req)
    if not engine.api or not engine.printer:
        raise ValueError("Connexion en cours")
    async with engine.lock:
        return web.json_response(
            {"settings": await engine.ai_settings()}, headers={"Cache-Control": "no-store"}
        )


async def local_files(req):
    """Renvoie le dossier machine ; lève HTTPNotFound pour une source autre que local ou usb."""
    engine = request_engine(req)
    source = req.match_info["source"]
    if source not in ["local", "usb"]:
        raise web.HTTPNotFound()
    async with engine.lock:
        return web.json_response(
            await engine.read_files(source, req.query.get("path", "/")),
            headers={"Cache-Control": "no-store"},
        )


@contextlib.asynccontextmanager
async def cloud_mutation_operation(engine):
    """Réserve une mutation Cloud du compte sans immobiliser les ordres machine."""
    transport = getattr(engine, "transport", None)
    lock = getattr(transport, "cloud_mutation_lock", None)
    if lock is None:
        raise ValueError("Verrou partagé du compte Cloud indisponible")
    if lock.locked():
        raise ValueError(
            "Une action Cloud est déjà en cours sur ce compte. Réessayez après sa fin."
        )
    async with lock:
        yield


@contextlib.asynccontextmanager
async def command_operation(req, *, require_model=True, bypass_read_lock=False, cloud_only=False):
    """Réserve une requête et sa lecture ; seules les actions Cloud évitent le verrou machine."""
    engine = request_engine(req)
    if engine.command_lock.locked() or (
        not bypass_read_lock and engine.command_request_lock.locked()
    ):
        raise ValueError("Une opération est en cours. Réessayez après sa fin.")
    async with contextlib.AsyncExitStack() as guards:
        if not bypass_read_lock:
            # Réserver la demande sans empêcher pause ou annulation d’atteindre l’envoi.
            await guards.enter_async_context(engine.command_request_lock)
            try:
                await asyncio.wait_for(engine.lock.acquire(), timeout=COMMAND_READ_WAIT_SECONDS)
            except asyncio.TimeoutError:
                raise CommandWaitExpired(
                    "La consultation Anycubic prend trop de temps. Aucune commande envoyée ; réessayez dans quelques secondes."
                ) from None
            guards.callback(engine.lock.release)
        if cloud_only:
            await guards.enter_async_context(cloud_mutation_operation(engine))
        else:
            await guards.enter_async_context(engine.command_lock)
        if req.transport is None or req.transport.is_closing():
            raise ValueError("La demande a été interrompue. Aucune commande envoyée.")
        verify_printer_target(req, engine, require_model=require_model)
        yield


@contextlib.asynccontextmanager
async def storage_upload_operation(req, engine):
    """Sérialise les transferts de stockage Cloud et vérifie leur cible avant le réseau."""
    if engine.upload_lock.locked():
        raise ValueError("Un envoi de fichier est déjà en cours")
    async with engine.upload_lock:
        try:
            await asyncio.wait_for(engine.lock.acquire(), timeout=COMMAND_READ_WAIT_SECONDS)
        except asyncio.TimeoutError:
            raise CommandWaitExpired(
                "La consultation Anycubic prend trop de temps. Aucun fichier envoyé ; réessayez dans quelques secondes."
            ) from None
        try:
            if req.transport is None or req.transport.is_closing():
                raise ValueError("La demande a été interrompue. Aucun fichier envoyé.")
            verify_printer_target(req, engine)
            if not engine.api:
                raise ValueError("Connexion en cours")
        finally:
            engine.lock.release()
        async with cloud_mutation_operation(engine):
            yield


async def command(req):
    """Renvoie le résultat mémorisé par request_id ; rejette une demande invalide sans répéter une commande connue."""
    engine = request_engine(req)
    d = await json_object(req)
    requestid = str(d.pop("request_id", ""))
    valid_id = re.fullmatch(r"[a-zA-Z0-9-]{16,80}", requestid)
    name = d.pop("action", None)
    if not isinstance(name, str):
        raise ValueError("Action invalide.")
    ticket = d.pop("confirmation", None)
    if requestid in engine.commands:
        previous = engine.commands[requestid]
        return web.json_response(previous, status=200 if previous["ok"] else 409)
    if valid_id and (previous := await recorded_command(req, requestid)) is not None:
        return previous
    async with audit_command(req, engine, name, requestid if valid_id else None, d) as audit:
        if not valid_id:
            raise ValueError("Identifiant de commande manquant")
        async with command_operation(
            req,
            require_model=name != "presets",
            bypass_read_lock=name in {"pause", "cancel"},
            cloud_only=name in CLOUD_ONLY_ACTIONS,
        ):
            if requestid in engine.commands:
                audit.clear()
                previous = engine.commands[requestid]
                return web.json_response(previous, status=200 if previous["ok"] else 409)
            if (
                isinstance(name, str)
                and name in SENSITIVE_ACTIONS
                and not consume_action_ticket(req, name, ticket)
            ):
                return web.json_response(
                    {
                        "ok": False,
                        "message": "Confirmez à nouveau l’action avec votre mot de passe web.",
                    },
                    status=403,
                )
            cloud_action = name in CLOUD_ONLY_ACTIONS
            uncertain = {
                "ok": False,
                "message": (
                    "Résultat Cloud inconnu. Actualisez les données du compte avant tout nouvel essai."
                    if cloud_action
                    else "Résultat de la commande inconnu. Vérifiez l’état de l’imprimante avant tout nouvel envoi."
                ),
            }
            sent = False

            async def before_send():
                nonlocal sent
                if sent:
                    return
                sent = True
                engine.commands[requestid] = uncertain
                while len(engine.commands) > 200:
                    engine.commands.popitem(last=False)
                if audit:
                    audit["outcome"] = "inconnue"
                    await save_command_event(req, audit)

            dispatch = command_dispatch.set(before_send)
            try:
                message = await engine.action(name, d)
            except Exception as error:
                if not sent:
                    raise
                log_event(
                    OPS_LOG,
                    logging.WARNING,
                    "command_uncertain",
                    message=(
                        "Mutation Cloud transmise, résultat non confirmé ; actualisez les données du compte avant tout nouvel essai"
                        if cloud_action
                        else "Commande transmise, résultat non confirmé ; vérifiez l’état de l’imprimante avant tout nouvel envoi"
                    ),
                    action=name,
                    outcome="inconnue",
                    error_type=type(error).__name__,
                    frames=safe_exception_frames(error),
                )
                engine.event(str(name), "Résultat inconnu")
                return web.json_response(uncertain, status=409)
            finally:
                command_dispatch.reset(dispatch)
            if name == "task-delete-many" and "non confirmé" in message:
                uncertain = {"ok": False, "message": message}
                engine.commands[requestid] = uncertain
                return web.json_response(uncertain, status=409)
            if audit and audit["outcome"] != "confirmée":
                if name in (
                    "axis",
                    "axis-off",
                    "ai-settings",
                    "task-reprint",
                    "light",
                    "idle-settings",
                ):
                    audit["outcome"] = "envoyée"
                else:
                    audit["outcome"] = "acceptée"
            engine.event(str(name), "Acceptée")
            result = {"ok": True, "message": message}
            engine.commands[requestid] = result
            while len(engine.commands) > 200:
                engine.commands.popitem(last=False)
            return web.json_response(result)


async def camera(req):
    """Ouvre une session vidéo pour la cible résolue par le serveur."""
    return await camera_sessions.camera(req, request_engine(req), verify_printer_target)


async def camera_presence(req):
    """Renouvelle la présence sur la session de l’imprimante sélectionnée."""
    return await camera_sessions.camera_presence(req, request_engine(req), verify_printer_target)


async def camera_close(req):
    """Retire le spectateur de la session associée à sa cible."""
    return await camera_sessions.camera_close(req, request_engine(req), verify_printer_target)


async def print_preflight(req):
    """Prépare les avertissements de bobines sans envoyer de commande à la machine."""
    engine = request_engine(req)
    data = await json_object(req)
    if not isinstance(data, dict):
        raise ValueError("Métadonnées de filament invalides")
    ensure_firmware_ready(engine.printer)
    if data.get("key"):
        details = await engine.extras.detail(data["key"])
        materials = details.get("materials") or []
        data["materials"] = [row.get("material") or "" for row in materials]
        data["colors"] = (
            [
                [int(row["color"][offset : offset + 2], 16) for offset in (1, 3, 5)]
                for row in materials
                if row.get("color")
            ]
            if materials and all(row.get("color") for row in materials)
            else []
        )
    return web.json_response(
        {"warnings": evaluate_preflight(engine.snapshot().get("printer") or {}, data)}
    )


async def upload(req):
    """Renvoie l’acceptation du transfert dédupliqué ; lève ValueError si invalide, trop gros ou machine indisponible."""
    engine = request_engine(req)
    async with audit_command(req, engine, "upload", None, {}) as audit:
        return await upload_operation(
            req,
            engine,
            audit,
            storage_upload_operation=storage_upload_operation,
            command_operation=command_operation,
        )


async def sample_temperatures(app, selected=None, store=None):
    """Archive seulement les relevés récents ; une mesure de filament exige un nouveau détail Cloud."""
    engine = selected if selected is not None else globals()["engine"]
    history = store if store is not None else app["temperature_history"]
    last_source = None
    last_details = None
    while True:
        try:
            state = engine.snapshot()
            p = state.get("printer") or {}
            source = max(
                (v for v in [state.get("mqtt_updated_at"), state.get("updated_at")] if v),
                default=None,
            )
            if state.get("ok") and p.get("printer_online") and source and source != last_source:
                stamp = datetime.fromisoformat(source).timestamp()
                if abs(time.time() - stamp) < 120:
                    values = {
                        "nozzle": p.get("curr_nozzle_temp"),
                        "bed": p.get("curr_hotbed_temp"),
                        "ace": p.get("ace_current_temperature"),
                        "nozzle_target": p.get("target_nozzle_temp"),
                        "bed_target": p.get("target_hotbed_temp"),
                        "ace_target": p.get("dry_status_target_temperature")
                        if p.get("dry_status_is_drying")
                        else None,
                    }
                    cloud_stamp, mqtt_stamp = state.get("updated_at"), state.get("mqtt_updated_at")
                    if cloud_stamp != mqtt_stamp:
                        values["source"] = "mqtt" if source == mqtt_stamp else "cloud"
                    details = getattr(engine, "details_updated", None)
                    if details and details != last_details:
                        if abs(time.time() - datetime.fromisoformat(details).timestamp()) < 120:
                            values["ace_boxes"] = ace_readings(p.get("boxes") or [])
                        last_details = details
                    history.add(stamp, values)
                    last_source = source
            if history.rows and time.monotonic() - history.saved_at >= 60:
                await history.save_async()
        except Exception as error:
            logging.getLogger(__name__).warning(
                "Relevé de température ignoré (%s)", type(error).__name__
            )
        await asyncio.sleep(10)


async def temperatures(req):
    """Renvoie les points ou leur CSV sur la même fenêtre ; les jours anciens sont agrégés."""
    hours = integer(req.query.get("hours", 1), 1, 720)
    store = (
        req.app["printer_registry"].history(request_engine(req))
        if "printer_registry" in req.app
        else req.app["temperature_history"]
    )
    if req.query.get("format") == "csv":
        return web.json_response(
            {
                "csv": store.export_csv(hours),
                "hours": hours,
                "resolution_seconds": store.resolution_seconds(hours),
            },
            headers={"Cache-Control": "no-store"},
        )
    return web.json_response(
        {
            "readings": store.recent(hours),
            "hours": hours,
            "retention_hours": 720,
            "interval_seconds": 10,
            "resolution_seconds": store.resolution_seconds(hours),
        },
        headers={"Cache-Control": "no-store"},
    )


async def startup(app):
    """Préserve la collecte initiale et initialise le registre des cibles indépendantes."""
    log_event(
        OPS_LOG,
        logging.INFO,
        "application_starting",
        message="Démarrage de l’atelier ; initialisation de la connexion Cloud et des données locales",
        version=APP_VERSION,
    )
    app[MONITORING_KEY] = Monitoring(engine.state_dir)
    try:
        await asyncio.to_thread(purge_abandoned_uploads, engine.state_dir)
    except OSError as error:
        logging.getLogger(__name__).warning(
            "Dossiers d’envoi non inspectés (%s)", type(error).__name__
        )
    with contextlib.suppress(Exception):
        engine.presets = json.loads(pathlib.Path("/appdata/state/presets.json").read_text())
    engine.catalogue_source = True
    app["printer_registry"] = PrinterRegistry(engine, Engine, sample_temperatures, app)
    app["fleet_health"] = FleetHealth()
    app["poll_task"] = asyncio.create_task(engine.poll())
    app["temperature_history"] = TemperatureHistory()
    app[COMMAND_JOURNAL_KEY] = CommandJournal(engine.state_dir / "command-journal.jsonl")
    engine.command_mqtt = app[COMMAND_MQTT_KEY] = await asyncio.to_thread(
        JournalMQTT, app[COMMAND_JOURNAL_KEY], asyncio.get_running_loop()
    )
    app["temperature_task"] = asyncio.create_task(sample_temperatures(app))


async def cleanup(app):
    """Arrête la collecte, sauvegarde les températures et ferme les connexions."""
    log_event(
        OPS_LOG,
        logging.INFO,
        "application_stopping",
        message="Arrêt demandé ; sauvegarde des relevés et fermeture des connexions",
    )
    registry = app["printer_registry"]
    for selected in [engine, *registry.entries.values()]:
        reconnect = selected.mqtt_reconnect_task
        if reconnect and not reconnect.done():
            reconnect.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await reconnect
        for task in (selected.camera_expiry_task, selected.camera_close_task):
            if task and not task.done():
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
    await registry.close()
    app["temperature_task"].cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await app["temperature_task"]
    with contextlib.suppress(OSError):
        await app["temperature_history"].save_async()
    app["poll_task"].cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await app["poll_task"]
    if engine.api:
        engine.api.disconnect_mqtt()
    await app[COMMAND_MQTT_KEY].flush()
    if engine.session:
        await engine.session.close()


async def preview(req):
    """Renvoie une image validée ou None ; lève ValueError si la connexion manque."""
    engine = request_engine(req)
    d = await json_object(req)
    url = None
    async with engine.lock:
        if not engine.api or not engine.printer:
            raise ValueError("Connexion en cours")
        if d.get("source") == "active":
            result = await printer_files.current_preview(engine, d.get("project_key"))
            log_event(
                OPS_LOG,
                logging.DEBUG,
                "active_preview",
                message="Consultation de l’aperçu du projet courant",
                outcome="available" if result.get("image") else "unavailable",
            )
            return web.json_response(result, headers={"Cache-Control": "no-store"})
        if d.get("source") in ["local", "usb"]:
            with contextlib.suppress(ValueError):
                image = await engine.local_preview(
                    d["source"], str(d.get("name", "")), d.get("path", "/")
                )
                if image:
                    return web.json_response(
                        {"image": image}, headers={"Cache-Control": "no-store"}
                    )
        if d.get("source") == "cloud":
            f = engine.cloudfiles.get(str(d.get("handle")))
            if f:
                url = safeget(f, "_thumbnail")
        if not trusted_url(url):
            with contextlib.suppress(TimeoutError):
                projects = await engine.extras.file_preview_projects()
                url = find_project_preview_url(projects, engine.printer.id, str(d.get("name", "")))
    return web.json_response(
        {"image": await download_preview(engine.session, url)},
        headers={"Cache-Control": "no-store"},
    )


app = web.Application(
    middlewares=[operational_requests, access_control, errors, select_printer],
    client_max_size=102 * 1024**2,
)
app.add_routes(
    [
        web.get("/imprimante-api/printers", printers),
        web.get("/imprimante-api/fleet", fleet),
        web.get("/imprimante-api/monitoring", monitoring),
        web.get("/imprimante-api/health", health),
        web.get("/imprimante-api/diagnostic", diagnostic),
        web.get("/imprimante-api/status", status),
        web.get("/imprimante-api/history", history),
        web.post("/imprimante-api/history/read", history_read),
        web.post("/imprimante-api/history/delete", history_delete),
        web.get("/imprimante-api/ai-settings", ai_settings),
        web.get("/imprimante-api/temperatures", temperatures),
        web.get("/imprimante-api/files/cloud", files),
        web.get("/imprimante-api/files/{source}", local_files),
        web.post("/imprimante-api/command", command),
        web.post("/imprimante-api/camera-session", camera),
        web.post("/imprimante-api/camera-presence", camera_presence),
        web.post("/imprimante-api/camera-close", camera_close),
        web.post("/imprimante-api/upload", upload),
        web.post("/imprimante-api/preflight", print_preflight),
        web.post("/imprimante-api/preview", preview),
    ]
)
from cloud_extras import install as install_extras

install_extras(app, engine)
app.router.add_get("/imprimante-api/journal", command_journal)
app.on_startup.append(startup)
app.on_cleanup.append(cleanup)
from web_host import install_static

install_static(app)
if __name__ == "__main__":
    if os.geteuid() == 0:
        raise SystemExit("Le serveur doit être lancé sans privilèges root.")
    if hasattr(time, "tzset"):
        time.tzset()
    try:
        handler = configure_logging()
    except LoggingConfigurationError as error:
        raise SystemExit(str(error)) from None
    log_event(
        OPS_LOG,
        logging.INFO,
        "logging_ready",
        message="Journaux du conteneur configurés",
        version=APP_VERSION,
        log_level=logging.getLevelName(logging.getLogger().level),
        log_format=handler.formatter.output_format,
    )
    web.run_app(
        app,
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "8080")),
        access_log=None,
        print=None,
    )
