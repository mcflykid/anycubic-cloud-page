# SPDX-License-Identifier: GPL-3.0-or-later
"""Adaptateur web autonome de l’API Anycubic avec suivi MQTT et commandes sérialisées."""

import asyncio, collections, contextlib, json, logging, os, pathlib, re, shutil, time, tempfile, uuid
from datetime import datetime
import aiohttp, ssl
from aiohttp import web
from aiofiles import open as aio_open
from vendor_config import load_vendor_config

load_vendor_config()
from file_preview import find_project_preview_url
from cloud_extras import download_preview, trusted_url
from temperature_history import TemperatureHistory, ace_readings
from upload_formats import validate_cloud_model
from filament_catalog import editable_materials
from print_preflight import ensure_firmware_ready, ensure_storage_ready, evaluate_preflight
from notification_service import AccountNotifications
from printer_registry import PrinterRegistry, select_printer, printer_key
from fleet_health import FleetHealth
from monitoring import Monitoring
from cloud_budget import CloudRequestBudget
from idle_controls import idle_limits
from ace_telemetry import ace2_pro_telemetry
from account_transport import AccountTransport
from request_validation import json_object
from printer_values import integer, now, safeget, serial
from printer_commands import execute_command, slot_indices
import printer_files
from account_auth import AccountAuth
from web_host import (
    APP_VERSION,
    SESSION_DIGEST_KEY,
    SENSITIVE_ACTIONS,
    access_control,
    client_address,
    consume_action_ticket,
)
from command_journal import (
    ACTIONS,
    CLOUD_ONLY_ACTIONS,
    MQTT_CONFIRMATIONS,
    CommandJournal,
    JournalMQTT,
    command_dispatch,
    command_mqtt_context,
    filtered_parameters,
    make_entry,
    mqtt_digest,
    request_key,
)
from session_api import CloudSessionAuthError, SessionRecovery
from operational_logging import configure_logging, log_event, request_context, safe_exception_frames
from anycubic_cloud_api.api.base import AnycubicHTTPUnauthorized, AnycubicRateLimited
from anycubic_cloud_api.const.api_endpoints import API_ENDPOINT
from anycubic_cloud_api.models.http import AnycubicAPIEndpoint
from native_controls import task_details, ace_model
from anycubic_cloud_api.api.mqtt import AnycubicMQTTAPI
from anycubic_cloud_api.helpers.helpers import get_part_from_mqtt_topic
from anycubic_cloud_api.const.enums import AnycubicOrderID
from anycubic_cloud_api.data_models.orders import AnycubicBaseOrderRequest
from anycubic_cloud_api.exceptions.exceptions import (
    AnycubicAPIError,
    AnycubicAuthError,
    AnycubicAuthTokensExpired,
    AnycubicCameraSessionError,
)

ROOT = pathlib.Path(__file__).parent
FIELDS = json.loads((ROOT / "fields.json").read_text())
COMMAND_READ_WAIT_SECONDS = 30
UPLOAD_LIMIT = 100 * 1024 * 1024
UPLOAD_STAGING = asyncio.Lock()
CAMERA_VIEWER_TTL = 180
OPS_LOG = logging.getLogger("cloud_page.server")
HTTP_LOG = logging.getLogger("cloud_page.http")
MONITORING_KEY = web.AppKey("monitoring", Monitoring)


class CloudPageAPI(SessionRecovery, AnycubicMQTTAPI):
    """Relie les réponses MQTT et le renouvellement de session au moteur web."""

    async def _fetch_api_resp(self, *args, **kwargs):
        """Journalise le résultat du transport sans paramètres, corps ou URL de requête."""
        started = time.monotonic()
        endpoint = args[0] if args else kwargs.get("endpoint")
        endpoint_path = getattr(endpoint, "endpoint", None)
        endpoint_name = "unknown"
        if isinstance(endpoint, AnycubicAPIEndpoint):
            endpoint_name = next(
                (
                    name
                    for name, candidate in vars(API_ENDPOINT).items()
                    if isinstance(candidate, AnycubicAPIEndpoint)
                    and candidate.endpoint == endpoint_path
                ),
                "custom",
            )
        method = getattr(getattr(endpoint, "method", None), "name", None)
        try:
            response = await super()._fetch_api_resp(*args, **kwargs)
        except Exception as error:
            log_event(
                logging.getLogger("cloud_page.cloud"),
                logging.WARNING,
                "cloud_request",
                message="Requête Cloud en échec; consultez le type d’erreur et les repères de pile",
                endpoint=endpoint_name,
                method=method,
                status=401
                if isinstance(error, AnycubicHTTPUnauthorized)
                else 429
                if isinstance(error, AnycubicRateLimited)
                else None,
                duration_ms=round((time.monotonic() - started) * 1000, 1),
                outcome="error",
                error_type=type(error).__name__,
                frames=safe_exception_frames(error),
            )
            raise
        code = response.get("code") if isinstance(response, dict) else None
        api_outcome = (
            "json_success"
            if type(code) is int and code == 1
            else "json_non_success"
            if type(code) is int
            else "json_without_code"
            if isinstance(response, dict)
            else "non_json_returned"
        )
        log_event(
            logging.getLogger("cloud_page.cloud"),
            logging.DEBUG,
            "cloud_request",
            message="Réponse Cloud reçue; le code décrit la réponse et ne confirme pas une action physique",
            endpoint=endpoint_name,
            method=method,
            duration_ms=round((time.monotonic() - started) * 1000, 1),
            outcome=api_outcome,
            cloud_code=code,
        )
        return response

    async def _fetch_ext_resp(self, *args, **kwargs):
        """Cadence les transports du compte et respecte les pauses 429 sans renouveler la session ni rejouer."""
        budget = getattr(self, "_cloud_request_budget", None)
        if budget is None:
            budget = self._cloud_request_budget = CloudRequestBudget()
        await budget.acquire()
        try:
            return await super()._fetch_ext_resp(*args, **kwargs)
        except AnycubicRateLimited as error:
            budget.defer(error.retry_after)
            log_event(
                logging.getLogger("cloud_page.cloud"),
                logging.WARNING,
                "cloud_rate_limited",
                message="Le fournisseur limite les requêtes ; pause partagée du compte, sans nouvel essai automatique",
                outcome="paused",
                status=429,
                count=error.retry_after,
            )
            raise

    async def _send_anycubic_order(self, order_request, raw_data=False):
        """Recontrôle le firmware avant lancement et rattache le msgid à la demande émise."""
        data = order_request.order_request_data
        if data.get("order_id") in (AnycubicOrderID.START_PRINT, AnycubicOrderID.START_PRINT.value):
            owner = getattr(self, "cloud_engine", None)
            registry = getattr(owner, "fleet_registry", None)
            engines = [owner, getattr(registry, "default", None)]
            engines.extend(getattr(registry, "entries", {}).values())
            printer = next(
                (
                    candidate.printer
                    for candidate in engines
                    if candidate is not None
                    and getattr(candidate, "printer", None) is not None
                    and str(candidate.printer.id) == str(data.get("printer_id"))
                ),
                None,
            )
            if printer is None:
                printer = next(
                    (
                        candidate
                        for candidate in getattr(owner, "known_printers", [])
                        if str(candidate.id) == str(data.get("printer_id"))
                    ),
                    None,
                )
            ensure_firmware_ready(printer)
        context = command_mqtt_context.get()
        sent_at = time.time()
        result = await super()._send_anycubic_order(order_request, raw_data=raw_data)
        if context is None:
            return result
        tracker, entry, task = context
        if asyncio.current_task() is not task:
            return result
        data = order_request.order_request_data
        order_id = data["order_id"]
        if (
            order_id in MQTT_CONFIRMATIONS
            and printer_key(data["printer_id"]) == entry["printer"]
            and not raw_data
        ):
            if (digest := mqtt_digest(result)) is not None:
                await tracker.watch(entry, order_id, digest, sent_at)
        return result

    def cloud_printer_updated(self):
        """Le rappel sans argument de la bibliothèque hérite du propriétaire du message actuellement routé."""
        owner = getattr(self, "message_engine", None)
        if owner:
            owner.mqtt_changed()

    def _mqtt_message_router(self, message):
        """Associe rapports et fraîcheur à la bonne machine sur l’unique connexion MQTT du compte."""
        primary = getattr(self, "cloud_engine", None)
        owner = primary
        registry = getattr(primary, "fleet_registry", None)
        if registry:
            owner = registry.owner(get_part_from_mqtt_topic(str(message.topic), 6))
        self.message_engine = owner
        try:
            with contextlib.suppress(Exception):
                payload = json.loads(message.payload)
                kind, action = payload.get("type"), payload.get("action")
                target_matches = (
                    owner
                    and owner.printer
                    and get_part_from_mqtt_topic(str(message.topic), 6) == str(owner.printer.key)
                )
                retained = getattr(message, "retain", False)
                if kind == "axis" and action == "query":
                    # Un rapport de position hérité ne rafraîchit pas les mesures de la machine.
                    return
                if target_matches:
                    tracker = getattr(primary, "command_mqtt", None)
                    if (
                        tracker
                        and str(message.topic).startswith("anycubic/anycubicCloud/v1/printer/app/")
                        and not retained
                    ):
                        tracker.receive(printer_key(owner.printer.id), payload)
                    if not retained:
                        owner.receive_ai_reply(str(message.topic), payload)
                    owner.receive_video_reply(str(message.topic), payload)
                    if not retained and kind in (
                        "file",
                        "light",
                    ):
                        owner.mqtt_replies.receive(payload)
            return super()._mqtt_message_router(message)
        finally:
            self.message_engine = None

    def _mqtt_on_connect(self, client, userdata, flags, rc, properties=None):
        log_event(
            logging.getLogger("cloud_page.mqtt"),
            logging.WARNING if rc else logging.INFO,
            "mqtt_connection",
            message="Réponse du service MQTT à la connexion",
            mqtt_code=rc if isinstance(rc, int) else getattr(rc, "value", None),
            connected=not bool(rc),
        )
        if rc:
            getattr(self, "cloud_engine", engine).event(
                "MQTT", "Connexion refusée, code " + str(rc)
            )
        return super()._mqtt_on_connect(client, userdata, flags, rc, properties)

    def _mqtt_on_disconnect(self, client, userdata, rc, *args):
        log_event(
            logging.getLogger("cloud_page.mqtt"),
            logging.WARNING,
            "mqtt_disconnected",
            message="Le suivi MQTT est déconnecté ; vérifiez la reconnexion avant d’interpréter une mesure comme récente",
            connected=False,
        )
        getattr(self, "cloud_engine", engine).event("MQTT", "Déconnecté, code " + str(rc))
        return super()._mqtt_on_disconnect(client, userdata, rc)


class Engine:
    """Coordonne l’état cloud, le suivi MQTT et les commandes de l’interface."""

    def __init__(self):
        """Initialise le modèle et ses données locales depuis les paramètres fournis."""
        self.selected_id = os.environ.get("PRINTER_ID") or None
        self.known_printers = []
        self.state_dir = pathlib.Path("/appdata/state")
        self.catalogue_source = False
        self.transport_only = False
        self.camera_message_id = None
        self.camera_diagnostic = None
        self.camera_stage = -1
        self.transport = AccountTransport()
        self.camera_viewers = set()
        self.camera_viewer_expiries = {}
        self.camera_expiry_task = None
        self.camera_departures = collections.OrderedDict()
        self.camera_owner = None
        self.camera_close_task = None
        self.command_lock = asyncio.Lock()
        self.command_request_lock = asyncio.Lock()
        self.upload_lock = asyncio.Lock()
        self.mqtt_reconnect_task = None
        self.notifications = AccountNotifications()
        self.extras = None
        self.notifications_error = None
        self.fleet_registry = None
        self.pinned_id = None
        self.temperature_history = None
        self.account = AccountAuth()
        self.printer = None
        self.ok = False
        self.updated = None
        self.mqtt_update = None
        self.error = "Connexion en cours"
        self._last_poll_error = None
        self.lock = asyncio.Lock()
        self.events = collections.deque(maxlen=40)
        self.cloudfiles = {}
        self.commands = collections.OrderedDict()
        self.preview_cache = {}
        self.mqtt_replies = printer_files.MQTTReplies()
        self.dir_cache = {}
        self.raw_info = {}
        self.details_updated = None
        self.lifetime_count = None
        self.last_session = 0
        self.camera = None
        self.ai_query_started = None
        self.ai_query_waiter = None
        self.ai_cache = None
        self.presets = [
            {"name": "PLA", "temperature": 45, "hours": 4},
            {"name": "PETG", "temperature": 55, "hours": 6},
            {"name": "ABS / ASA", "temperature": 60, "hours": 4},
            {"name": "PA", "temperature": 65, "hours": 8},
        ]

    @property
    def api(self):
        """Retourne le client courant, masqué aux cibles pendant une reconnexion du compte."""
        if (
            self.transport.reconnect_required
            and self.fleet_registry
            and self.fleet_registry.default is not self
        ):
            return None
        return self.transport.api

    @api.setter
    def api(self, value):
        self.transport.api = value

    @property
    def session(self):
        """Utilise la même session HTTP sur toutes les cibles du compte."""
        return self.transport.session

    @session.setter
    def session(self, value):
        self.transport.session = value

    @property
    def account_token(self):
        """Donne au moteur principal le jeton associé au client actif."""
        return self.transport.token

    @account_token.setter
    def account_token(self, value):
        self.transport.token = value

    @property
    def reconnect_required(self):
        """Partage l’état de reconnexion avec les cibles secondaires."""
        return self.transport.reconnect_required

    @reconnect_required.setter
    def reconnect_required(self, value):
        self.transport.reconnect_required = value

    def event(self, action, state):
        """Ajoute un événement horodaté au journal local borné."""
        self.events.appendleft({"time": now(), "action": action, "state": state})
        known_action = (
            action
            if action in ACTIONS or action in {"MQTT", "Cloud", "Caméra", "Fichier", "Erreur"}
            else "service"
        )
        log_event(
            OPS_LOG,
            logging.ERROR if action == "Erreur" else logging.INFO,
            "engine_state",
            message="Évolution de l’état du service",
            action=known_action,
            outcome={
                "Connecté": "connected",
                "Acceptée": "accepted",
                "Résultat inconnu": "uncertain",
                "Session renouvelée automatiquement": "renewed",
            }.get(state, "changed"),
            connected=state == "Connecté" if action == "MQTT" else None,
        )

    def receive_video_reply(self, topic, payload):
        """Ne retient que l’étape connue de la session vidéo courante et de cette machine, sans payload privé."""
        if (
            not self.printer
            or get_part_from_mqtt_topic(topic, 6) != str(self.printer.key)
            or payload.get("type") != "video"
            or payload.get("action") != "startCapture"
        ):
            return
        if self.camera_message_id is None or str(payload.get("msgid")) != str(
            self.camera_message_id
        ):
            return
        stages = {
            "done": (0, "Demande vidéo acquittée"),
            "initSuccess": (1, "Initialisation vidéo confirmée"),
            "joinSuccess": (2, "Jonction au canal vidéo confirmée"),
            "pushStarted": (3, "Envoi de la vidéo démarré"),
            "pushStoped": (4, "Envoi de la vidéo arrêté"),
            "pushFailed": (5, "La capture vidéo a échoué côté imprimante"),
        }
        stage = stages.get(payload.get("state"))
        if stage and stage[0] >= self.camera_stage:
            self.camera_stage = stage[0]
            self.camera_diagnostic = {"stage": payload["state"], "message": stage[1]}

    def mqtt_changed(self):
        """Marque la fraîcheur des données lors d’une notification MQTT."""
        self.mqtt_update = now()

    def mqtt_connected(self):
        """Consigne l’établissement du suivi MQTT dans le journal affichable."""
        self.event("MQTT", "Connecté")

    def mqtt_start(self):
        """Réabonne les cibles connues avant de démarrer le suivi du compte."""
        if self.fleet_registry and self is not self.fleet_registry.default:
            return
        restore = self.fleet_registry.restore_subscriptions if self.fleet_registry else None
        self.transport.start(self.event, restore)

    def session_renewed(self, api):
        """Programme la reconnexion MQTT pour employer la nouvelle session HTTP."""
        self.event("Cloud", "Session renouvelée automatiquement")
        if self.api is api and self.printer and not self.reconnect_required:
            self.transport.mqtt_auth_pending = True
            previous = self.mqtt_reconnect_task
            if previous is None or previous.done():
                self.mqtt_reconnect_task = asyncio.create_task(self.restart_mqtt_auth(api))

    async def restart_mqtt_auth(self, api):
        """Relance le suivi du compte après le renouvellement de session."""
        try:
            restarted = await self.transport.restart(api, self.mqtt_start)
            if not restarted and self.api is api and self.transport.mqtt_auth_pending:
                self.event("MQTT", "Reconnexion différée, le suivi précédent reste actif")
                log_event(
                    OPS_LOG,
                    logging.WARNING,
                    "mqtt_reconnect_deferred",
                    message="Le suivi MQTT précédent ne s’est pas arrêté avant la reconnexion",
                    reason="previous_thread_active",
                )
        except asyncio.CancelledError:
            raise
        except Exception as error:
            self.event("MQTT", "Reconnexion indisponible (" + type(error).__name__ + ")")
            log_event(
                OPS_LOG,
                logging.WARNING,
                "mqtt_reconnect_failed",
                message="La reconnexion MQTT après renouvellement a échoué",
                error_type=type(error).__name__,
            )
        finally:
            if self.mqtt_reconnect_task is asyncio.current_task():
                self.mqtt_reconnect_task = None

    async def refresh_printer_details(self):
        """Partage un relevé HTTP entre le modèle et les capacités pour éviter deux états divergents."""
        self.raw_info = (
            await self.printer.update_info_from_api(include_details=True) if self.printer else {}
        )
        self.details_updated = now() if self.raw_info else None

    async def refresh_lifetime_count(self):
        """Relève le compteur cumulé sans bloquer le suivi quand le Cloud ne le fournit pas."""
        printer = self.printer
        count = None
        if self.extras is None or printer is None:
            self.lifetime_count = None
            return
        with contextlib.suppress(AnycubicAPIError, TimeoutError, ValueError):
            async with asyncio.timeout(5):
                count = await self.extras.lifetime_print_count(printer.id)
        self.lifetime_count = (
            (printer.id, count) if count is not None and self.printer is printer else None
        )

    async def connect(self):
        """Connecte la cible du moteur ; le défaut facultatif se replie sur la première machine, jamais une cible secondaire explicite."""
        if self.fleet_registry and self is not self.fleet_registry.default:
            await self.fleet_registry.connect_secondary(self)
            return
        printers = await self.transport.connect(
            self.account,
            CloudPageAPI,
            self,
            self.session_renewed,
            self.mqtt_changed,
            self.mqtt_connected,
        )
        self.known_printers = printers
        if self.fleet_registry:
            await self.fleet_registry.retire_missing()
        selected = self.pinned_id or self.selected_id
        candidates = [p for p in printers if str(p.id) == selected] if selected else printers[:1]
        if not candidates and not self.pinned_id:
            candidates = printers[:1]
        if (
            self.selected_id
            and (not candidates or str(candidates[0].id) != str(self.selected_id))
            and not self.catalogue_source
        ):
            raise RuntimeError("Imprimante sélectionnée absente du compte")
        self.printer = candidates[0] if candidates else None
        if self.printer:
            self.pinned_id = str(self.printer.id)
        if self.printer is None:
            self.raw_info = {}
            if self.catalogue_source and self.fleet_registry:
                self.transport_only = True
                self.reconnect_required = False
                self.fleet_registry.restore_subscriptions()
                self.mqtt_start()
                return
            raise RuntimeError("Imprimante absente")
        await self.refresh_printer_details()
        self.reconnect_required = False
        self.api.mqtt_add_subscribed_printer(self.printer)
        if self.fleet_registry:
            self.fleet_registry.restore_subscriptions()
        self.mqtt_start()

    async def refresh_catalogue(self):
        """Le retrait du défaut libère son modèle, pas le transport partagé ; son identité n’est jamais réaffectée."""
        if not self.catalogue_source or self.api is None:
            return
        self.known_printers = await self.api.list_my_printers()
        rows = {str(p.id): p for p in self.known_printers}
        if self.printer and str(self.printer.id) not in rows:
            self.api.mqtt_unsubscribe_printer_status(self.printer)
            self.printer = None
            self.transport_only = True
        if self.transport_only and self.pinned_id in rows:
            self.printer = rows[self.pinned_id]
            self.transport_only = False
        if self.fleet_registry:
            await self.fleet_registry.retire_missing()
            self.fleet_registry.restore_subscriptions()

    async def poll(self):
        """Actualise chaque cible et le catalogue du compte, sans changer l’identité d’un moteur existant."""
        while True:
            poll_started = time.monotonic()
            try:
                async with self.lock:
                    primary = not self.fleet_registry or self is self.fleet_registry.default
                    if self.catalogue_source and self.api and not self.reconnect_required:
                        await self.refresh_catalogue()
                    reconnect = (
                        self.reconnect_required
                        or not self.api
                        or (not self.printer and not self.transport_only)
                        or primary
                        and await self.account.token(self.session) != self.account_token
                    )
                    if reconnect:
                        await self.connect()
                    else:
                        await self.refresh_printer_details()
                    await self.refresh_lifetime_count()
                    if self._last_poll_error is not None:
                        log_event(
                            OPS_LOG,
                            logging.INFO,
                            "cloud_recovered",
                            message="La connexion Cloud fonctionne de nouveau",
                            connected=True,
                        )
                    self._last_poll_error = None
                    log_event(
                        OPS_LOG,
                        logging.DEBUG,
                        "cloud_poll",
                        message="État Cloud actualisé",
                        duration_ms=round((time.monotonic() - poll_started) * 1000, 1),
                        count=len(self.known_printers or []),
                    )
                    self.updated = now()
                    self.ok = bool(self.printer)
                    self.error = (
                        None
                        if self.printer
                        else "Choisissez une imprimante disponible dans le compte."
                    )
                    if self.transport.mqtt_auth_pending:
                        await self.restart_mqtt_auth(self.api)
                    self.mqtt_start()
                    try:
                        await self.print_history(1)
                        self.notifications_error = None
                    except Exception as error:
                        if self.notifications_error is None:
                            log_event(
                                OPS_LOG,
                                logging.WARNING,
                                "notifications_unavailable",
                                message="Les messages Cloud sont indisponibles ; le suivi de l’imprimante continue",
                                error_type=type(error).__name__,
                            )
                        self.notifications_error = "Messages temporairement indisponibles"
            except Exception as e:
                error_type = type(e).__name__
                log_event(
                    OPS_LOG,
                    logging.WARNING if self._last_poll_error != error_type else logging.DEBUG,
                    "cloud_poll_failed",
                    message="Lecture Cloud impossible ; vérifiez le réseau et l’état de connexion, une nouvelle lecture sera tentée au prochain cycle",
                    error_type=error_type,
                    frames=safe_exception_frames(e),
                    duration_ms=round((time.monotonic() - poll_started) * 1000, 1),
                    connected=False,
                )
                self._last_poll_error = error_type
                self.ok = False
                self.error = (
                    getattr(self.account, "notice", None)
                    or "Connexion Anycubic indisponible (" + type(e).__name__ + ")."
                )
                if isinstance(e, (AnycubicAuthError, AnycubicAuthTokensExpired)) and not isinstance(
                    e, CloudSessionAuthError
                ):
                    owner = self.fleet_registry.default if self.fleet_registry else self
                    owner.reconnect_required = True
                    # Conserver le client jusqu’à la fin du fil permet de réessayer sa fermeture au cycle suivant.
                    if owner.api:
                        with contextlib.suppress(Exception):
                            owner.api.disconnect_mqtt()
                    self.printer = None
            await asyncio.sleep(60)

    def command_project_key(self):
        """Renvoie une référence opaque du projet affiché, liée à la machine ; None si le contexte manque."""
        p = self.printer
        project = getattr(p, "latest_project", None)
        identifier = getattr(project, "id", None)
        attempt = [
            getattr(project, name, None) for name in ("_taskid", "created_timestamp", "_start_time")
        ]
        return (
            printer_key(json.dumps([p.id, identifier, *attempt]))
            if p and identifier is not None
            else None
        )

    async def verify_active_project(self, name, expected):
        """Relit le projet sous le verrou de commande ; ValueError refuse une identité ou un état devenus différents."""
        p = self.printer
        if not expected or expected != self.command_project_key():
            raise ValueError(
                "Le projet a changé ou sa référence manque. Actualisez ; aucune commande envoyée."
            )
        try:
            await asyncio.wait_for(p.update_info_from_api(), timeout=10)
        except Exception:
            raise ValueError(
                "État récent de l’impression indisponible. Aucune commande envoyée."
            ) from None
        if self.printer is not p or expected != self.command_project_key():
            raise ValueError("Le projet a changé pendant la vérification. Aucune commande envoyée.")
        if not p.printer_online or not p.latest_project or not p.latest_project_print_in_progress:
            raise ValueError("Aucune impression active confirmée. Aucune commande envoyée.")
        paused = p.latest_project_print_is_paused
        if name in ("pause", "resume") and (
            not isinstance(paused, bool) or paused != (name == "resume")
        ):
            raise ValueError("L’état de pause a changé. Actualisez ; aucune commande envoyée.")
        self.updated = now()
        return p.latest_project

    def snapshot(self):
        """Renvoie l’état sérialisé et filtré pour le navigateur, sans identifiants de compte."""
        p = self.printer
        shared = self.fleet_registry is not None and self.fleet_registry.default is not self
        api = self.api
        disconnected = shared and api is None
        mqtt = getattr(api, "_mqtt_client", None)
        base = {
            "ok": self.ok and not disconnected,
            "message": "Connexion en cours" if disconnected else self.error,
            "updated_at": self.updated,
            "mqtt_updated_at": self.mqtt_update,
            "mqtt_connected": bool(mqtt and mqtt.is_connected()),
            "public_commands": False,
            "upstream": "hass-anycubic_cloud_v3",
            "events": list(self.events),
            "presets": self.presets,
        }
        base["account_message"] = getattr(self.account, "notice", None)
        token_expiry = getattr(self.account, "token_expiry", None)
        base["token_expires_at"] = token_expiry(self.account_token) if token_expiry else None
        base["notifications"] = self.notifications.cache.get(1, (None, None))[1]
        base["notifications_error"] = self.notifications_error
        base["camera_diagnostic"] = self.camera_diagnostic
        base["mqtt_diagnostics"] = getattr(api, "mqtt_diagnostics", {})
        if not p:
            return {**base, "printer": None}
        fields = {k: serial(safeget(p, v)) for k, v in FIELDS.items()}
        # Le schéma de champs affichables écarte les identifiants privés ; l’aperçu brut doit aussi rester côté serveur.
        fields.pop("job_image_url", None)
        fields["command_project"] = self.command_project_key()
        fields["firmware"] = safeget(p, "fw_version.firmware_version")
        fields["firmware_available"] = safeget(p, "fw_version.available_version")
        fields["ace_available"] = [
            safeget(p, "primary_multi_color_box_fw_available_version"),
            safeget(p, "secondary_multi_color_box_fw_available_version"),
        ]
        fields["editable_materials"] = editable_materials()
        fields["firmware_updating"] = safeget(p, "fw_version.is_updating")
        fields["firmware_update_required"] = None
        fields["firmware_update_available"] = safeget(p, "fw_version.update_available")
        fields["ace_updates"] = [
            {
                "current": safeget(fw, "firmware_version"),
                "target": safeget(fw, "available_version"),
                "available": safeget(fw, "update_available"),
                "progress": safeget(fw, "total_progress"),
                "updating": safeget(fw, "is_updating"),
            }
            for fw in (safeget(p, "multi_color_box_fw_version") or [])
        ]
        fields["supported_functions"] = safeget(p, "supported_function_strings")
        fields["camera_light"] = safeget(p, "camera_light_on")
        fields["speed_modes"] = safeget(p, "latest_project_available_print_speed_modes_data_object")
        fields["local_files"] = safeget(p, "local_file_list_object")
        fields["usb_files"] = safeget(p, "udisk_file_list_object")
        fields["local_path"] = safeget(p, "local_file_list_path")
        fields["usb_path"] = safeget(p, "udisk_file_list_path")
        boxes = []
        # Le support interne Kobra X est livré dans la même liste que les ACE.
        rack = safeget(p, "kobra_x_internal_material_rack")
        for idx, box in enumerate(box for box in p.multi_color_box or [] if box is not rack):
            boxes.append(
                {
                    "box_id": safeget(box, "box_id", idx),
                    "index": idx,
                    "spools": safeget(
                        p,
                        ("primary" if idx == 0 else "secondary")
                        + "_multi_color_box_spool_info_object",
                        [],
                    ),
                    "auto_feed": safeget(box, "auto_feed"),
                    "temperature": safeget(box, "current_temperature"),
                    "humidity": safeget(box, "humidity"),
                    "loaded_slot": safeget(box, "loaded_slot"),
                    "drying": {
                        name: safeget(
                            p, ("primary" if idx == 0 else "secondary") + "_drying_status_" + name
                        )
                        for name in [
                            "is_drying",
                            "target_temperature",
                            "total_duration",
                            "remaining_time",
                        ]
                    },
                }
            )

        rawboxes = self.raw_info.get("multi_color_box") or []
        if isinstance(rawboxes, dict):
            rawboxes = [rawboxes]
        rawboxes = (
            [box for box in rawboxes if isinstance(box, dict)] if isinstance(rawboxes, list) else []
        )
        recent = getattr(p, "recent_ace_measurements", None)
        for b in boxes:
            matches = [box for box in rawboxes if str(box.get("id")) == str(b["box_id"])]
            if len(matches) == 1:
                raw_box = matches[0]
            elif len(boxes) == len(rawboxes) == 1 and "id" not in rawboxes[0] and rack is None:
                raw_box = rawboxes[0]
            else:
                raw_box = None
            model = ace_model(b["box_id"], self.raw_info.get("multi_color_box_version"), raw_box)
            if model:
                b["model"] = model
            if raw_box is not None and raw_box.get("humidity") is not None:
                b["humidity"] = raw_box["humidity"]
            if recent:
                b.update(recent(b["box_id"]))
            if isinstance(raw_box, dict):
                rawslots = raw_box.get("slots")
                if not isinstance(rawslots, list):
                    continue
                for j, spool in enumerate(b["spools"] or []):
                    if j < len(rawslots):
                        rawslot = rawslots[j]
                        if not isinstance(rawslot, dict):
                            continue
                        edit = rawslot.get("edit_status")
                        if spool.get("rfid") is None:
                            spool["rfid"] = (
                                edit == 0 if type(edit) is int and edit in (0, 1) else None
                            )
                        percent = rawslot.get("consumables_percent")
                        if b.get("model") == "ACE 2 Pro":
                            quality = ace2_pro_telemetry(rawslot)
                            spool["remaining_percent"] = quality["percent"]
                            spool["remaining_percent_qualified"] = quality["valid"]
                            spool["remaining_percent_source"] = quality["source"]
                            continue
                        # Le zéro est aussi utilisé par les boîtiers qui ne mesurent pas la quantité.
                        spool["remaining_percent"] = (
                            percent
                            if edit != 2 and type(percent) in (int, float) and 0 < percent <= 100
                            else None
                        )
        fields["task_details"] = task_details(safeget(p, "latest_project"))
        fields["axes_supported"] = 67 in (self.raw_info.get("type_function_ids") or [])
        fields["idle_limits"] = idle_limits(self)
        features = {
            r.get("name"): r.get("value")
            for r in self.raw_info.get("features") or []
            if isinstance(r, dict)
        }
        fields["foreign_detection_supported"] = bool(features.get("fod_support"))
        fields["boxes"] = boxes
        if boxes and boxes[0]["temperature"] is not None:
            fields["ace_current_temperature"] = boxes[0]["temperature"]
        fields["material_rack"] = safeget(p, "material_rack_spool_info_object", [])
        # Le détail constructeur donne une durée en minutes que le modèle arrondit en heures entières.
        duration = (
            safeget(p, "total_print_time_delta")
            if safeget(p, "total_print_time") is not None
            else None
        )
        count = safeget(p, "print_count")
        count_source = "device_detail" if count is not None else None
        if self.lifetime_count is not None and self.lifetime_count[0] == p.id:
            count = self.lifetime_count[1]
            count_source = "cloud_summary"
        fields["statistics"] = {
            "material": safeget(p, "material_used"),
            "hours": duration.total_seconds() / 3600 if duration is not None else None,
            "print_count": count,
            "print_count_source": count_source,
        }
        return serial({**base, "printer": fields})

    async def direct_request(self, kind, action, data):
        """Renvoie la réponse MQTT corrélée ; lève ValueError sans connexion ou sans réponse sous dix secondes."""
        return await printer_files.direct_request(self, kind, action, data)

    async def local_preview(self, source, name, path):
        """Renvoie une image locale en ligne ou None ; lève ValueError si le chemin ou la réponse est invalide."""
        return await printer_files.local_preview(self, source, name, path)

    async def read_files(self, source, path):
        """Renvoie fichiers et chemin de local ou usb ; lève ValueError si la consultation n’est pas confirmée."""
        return await printer_files.read_files(self, source, path)

    async def cloud_files(self, page, folder=None):
        """Renvoie une page de fichiers et le quota, avec références opaques pour les actions ultérieures."""
        return await printer_files.cloud_files(self, page, folder)

    async def print_history(self, page, source=None):
        """Délègue la lecture au service du compte avec le transport courant."""
        return await self.notifications.page(self.api, page, source)

    async def mark_history_read(self, key=None, all_items=False):
        """Délègue le changement d’état au même service que la lecture."""
        return await self.notifications.mark_read(self.api, key, all_items)

    async def delete_history(self, key=None, all_items=False):
        """Efface depuis le compte qui possède les références de notification."""
        return await self.notifications.delete(self.api, key, all_items)

    def receive_ai_reply(self, topic, payload):
        """Transfère seulement la réponse IA non corrélable par msgid de la consultation active."""
        started = self.ai_query_started
        waiter = self.ai_query_waiter
        if waiter is None or started is None or time.monotonic() - started > 30:
            return
        if not self.printer or get_part_from_mqtt_topic(topic, 6) != str(self.printer.key):
            return
        if (
            payload.get("type") != "aiSettings"
            or payload.get("action") != "query"
            or payload.get("state") != "done"
        ):
            return
        data = payload.get("data")
        if isinstance(data, dict) and isinstance(data.get("ai_settings"), dict):

            def deliver():
                if self.ai_query_waiter is waiter and not waiter.done():
                    waiter.set_result(data)

            with contextlib.suppress(RuntimeError):
                waiter.get_loop().call_soon_threadsafe(deliver)

    async def cloud_query(self, order):
        """Renvoie les réglages IA ; lève ValueError en cas de refus ou d’absence de réponse MQTT."""
        if order != 1242 or self.ai_query_waiter is not None:
            raise ValueError("Consultation Anycubic indisponible")
        self.ai_query_started = time.monotonic()
        waiter = self.ai_query_waiter = asyncio.get_running_loop().create_future()
        try:
            mid = await self.api._send_anycubic_order(
                AnycubicBaseOrderRequest(order_id=order, printer_id=self.printer.id)
            )
            if not mid:
                raise ValueError("La consultation n’a pas été acceptée par Anycubic")
            try:
                return await asyncio.wait_for(waiter, 30)
            except TimeoutError:
                raise ValueError("L’imprimante n’a pas répondu à cette consultation") from None
        finally:
            waiter.cancel()
            self.ai_query_waiter = None
            self.ai_query_started = None

    async def ai_settings(self):
        """Renvoie les réglages IA filtrés ; lève ValueError si la machine est occupée ou la réponse absente."""
        if not self.printer.is_available or self.printer.latest_project_print_in_progress:
            raise ValueError("Les réglages IA sont disponibles lorsque l’imprimante est libre")
        cache = self.ai_cache
        if cache and time.monotonic() - cache[0] < 5:
            return cache[1]
        result = await self.cloud_query(1242)
        settings = result.get("ai_settings")
        if not isinstance(settings, dict):
            raise ValueError("Les réglages IA ne sont pas fournis par l’imprimante")
        clean = {k: settings.get(k) for k in ["status", "sensitivity_level", "notice_type"]}
        self.ai_cache = (time.monotonic(), clean)
        return clean

    def slots(self, data):
        """Convertit les numéros de bobines en indices ; renvoie None sans sélection, ValueError si invalide."""
        return slot_indices(self, data)

    async def action(self, name, d):
        """Renvoie le résultat textuel d’une commande validée ; lève ValueError si interdite ou non acceptée."""
        return await execute_command(self, name, d)


engine = Engine()


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


COMMAND_JOURNAL_KEY = web.AppKey("command_journal", CommandJournal)
COMMAND_MQTT_KEY = web.AppKey("command_mqtt", JournalMQTT)


class CommandWaitExpired(ValueError):
    """Signale une attente expirée avant l’envoi d’une commande."""


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


def camera_transport_failure(error):
    """Reconnaît une panne de connexion ou un délai, même enveloppé ; refuse les erreurs TLS, d’authentification et de format."""
    chain = []
    seen = set()
    while error is not None and id(error) not in seen:
        seen.add(id(error))
        chain.append(error)
        error = error.__cause__ if error.__cause__ is not None else error.__context__
    # Le client embarqué enveloppe les erreurs : leur type reste exploitable sans lire de message sensible.
    if any(
        isinstance(
            item,
            (
                AnycubicAuthError,
                AnycubicAuthTokensExpired,
                AnycubicCameraSessionError,
                ValueError,
                ssl.SSLError,
                aiohttp.ClientSSLError,
                aiohttp.ServerFingerprintMismatch,
            ),
        )
        for item in chain
    ):
        return False
    return any(
        isinstance(item, (aiohttp.ClientConnectionError, asyncio.TimeoutError)) for item in chain
    )


async def camera(req):
    """Renvoie une session en cache cinq secondes ; retente une seule panne de transport, propage les autres erreurs."""
    engine = request_engine(req)
    viewer = req.headers.get("X-Camera-Viewer")
    if viewer and not re.fullmatch(r"[a-f0-9-]{36}", viewer):
        raise ValueError("Session vidéo invalide")
    if not engine.printer:
        raise ValueError("Connexion en cours")
    async with engine.lock:
        async with engine.command_lock:
            verify_printer_target(req, engine)
            prune_camera_viewers(engine)
            if viewer and engine.camera_departures.get(viewer, 0) > time.monotonic():
                raise ValueError("Cet onglet a déjà fermé sa session vidéo")
            if viewer and len(engine.camera_viewers) >= 32 and viewer not in engine.camera_viewers:
                raise ValueError("Trop de sessions vidéo ouvertes")
            if (
                not engine.camera
                or time.time() - engine.last_session > 5
                or (viewer and engine.camera_owner != viewer)
            ):
                engine.camera_message_id = None
                engine.camera_diagnostic = None
                engine.camera_stage = -1
                try:
                    session = await engine.printer.get_camera_session()
                except Exception as error:
                    # Aucun délai de déduplication cloud n’est établi ; une erreur durable ne justifie pas une seconde demande.
                    if not camera_transport_failure(error):
                        raise
                    session = await engine.printer.get_camera_session()
                if session is None:
                    raise ValueError("Caméra indisponible")
                engine.camera = session.data
                engine.camera_message_id = getattr(session, "msg_id", None)
                engine.last_session = time.time()
            if viewer:
                engine.camera_owner = viewer
                engine.camera_viewers.add(viewer)
            elif hasattr(engine, "camera_viewers"):
                # L’échéance évite qu’une interface ancienne garde la caméra réservée après sa déconnexion.
                engine.camera_viewers.add("legacy")
                viewer = "legacy"
            engine.camera_viewer_expiries[viewer] = camera_viewer_deadline(req)
            schedule_camera_expiry(engine)
            if engine.camera_close_task and not engine.camera_close_task.done():
                engine.camera_close_task.cancel()
            return web.json_response(engine.camera, headers={"Cache-Control": "no-store"})


def camera_viewer_deadline(request):
    """Renouvelle le spectateur pour trois minutes, sans dépasser sa session web."""
    now_monotonic = time.monotonic()
    expires = request.get("session_expires") if hasattr(request, "get") else None
    if isinstance(expires, (int, float)) and not isinstance(expires, bool):
        return min(now_monotonic + CAMERA_VIEWER_TTL, expires)
    return now_monotonic + CAMERA_VIEWER_TTL


async def camera_presence(req):
    """Renouvelle localement un viewer actif sans demander de session ni envoyer d’ordre caméra."""
    engine = request_engine(req)
    viewer = req.headers.get("X-Camera-Viewer") or "legacy"
    if viewer != "legacy" and not re.fullmatch(r"[a-f0-9-]{36}", viewer):
        raise ValueError("Session vidéo invalide")
    # La fermeture différée doit voir ce renouvellement avant de décider d’envoyer sa commande.
    async with engine.lock:
        verify_printer_target(req, engine)
        deadline = engine.camera_viewer_expiries.get(viewer)
        if viewer not in engine.camera_viewers or deadline is None:
            raise ValueError("Session vidéo expirée")
        if deadline <= time.monotonic():
            engine.camera_viewers.discard(viewer)
            engine.camera_viewer_expiries.pop(viewer, None)
            expiry = engine.camera_expiry_task
            if expiry and not expiry.done():
                expiry.cancel()
            engine.camera_expiry_task = None
            if engine.camera_viewer_expiries:
                schedule_camera_expiry(engine)
            elif engine.printer:
                previous = engine.camera_close_task
                if previous and not previous.done():
                    previous.cancel()
                engine.camera_close_task = asyncio.create_task(
                    close_idle_camera(engine, str(engine.printer.id))
                )
            raise ValueError("Session vidéo expirée")
        engine.camera_viewer_expiries[viewer] = camera_viewer_deadline(req)
        schedule_camera_expiry(engine)
    return web.json_response({"ok": True})


def prune_camera_viewers(engine):
    """Retire les onglets dont la session web n’a pas renouvelé son échéance."""
    now_monotonic = time.monotonic()
    expired = [
        viewer
        for viewer, deadline in engine.camera_viewer_expiries.items()
        if deadline <= now_monotonic
    ]
    for viewer in expired:
        engine.camera_viewer_expiries.pop(viewer, None)
        engine.camera_viewers.discard(viewer)


def schedule_camera_expiry(engine):
    """Recalcule l’échéance la plus proche quand un onglet rejoint une autre session web."""
    task = engine.camera_expiry_task
    if task and not task.done():
        task.cancel()
    engine.camera_expiry_task = asyncio.create_task(expire_camera_viewers(engine))


async def expire_camera_viewers(engine):
    """Attend l’échéance la plus proche et programme la fermeture si aucun onglet ne revient."""
    try:
        while engine.camera_viewer_expiries:
            deadline = min(engine.camera_viewer_expiries.values())
            await asyncio.sleep(max(0, deadline - time.monotonic()))
            async with engine.lock:
                prune_camera_viewers(engine)
                if not engine.camera_viewer_expiries:
                    if engine.printer:
                        previous = engine.camera_close_task
                        if previous and not previous.done():
                            previous.cancel()
                        engine.camera_close_task = asyncio.create_task(
                            close_idle_camera(engine, str(engine.printer.id))
                        )
                    return
    finally:
        if engine.camera_expiry_task is asyncio.current_task():
            engine.camera_expiry_task = None


async def close_idle_camera(engine, target):
    """Envoie une fermeture unique après le départ du dernier spectateur de l’atelier."""
    await asyncio.sleep(3)
    async with engine.lock:
        async with engine.command_lock:
            if (
                engine.camera_viewers
                or not engine.api
                or not engine.printer
                or str(engine.printer.id) != target
            ):
                return
            registry = getattr(engine, "fleet_registry", None)
            if registry and printer_key(target) not in registry.catalogue():
                return
            engine.camera = None
            engine.camera_owner = None
            try:
                request = AnycubicBaseOrderRequest(
                    order_id=AnycubicOrderID.CAMERA_CLOSE, printer_id=target
                )
                await engine.api._send_anycubic_order(order_request=request)
            except Exception as error:
                engine.event("Caméra", "Fermeture non confirmée (" + type(error).__name__ + ")")


async def camera_close(req):
    """Libère la session vidéo du navigateur et programme la fermeture si le flux est inutilisé."""
    engine = request_engine(req)
    viewer = req.headers.get("X-Camera-Viewer")
    if not viewer or not re.fullmatch(r"[a-f0-9-]{36}", viewer):
        raise ValueError("Session vidéo invalide")
    async with engine.lock:
        verify_printer_target(req, engine)
        # Un départ peut parvenir avant l’ouverture lorsque le navigateur ferme l’onglet.
        now_monotonic = time.monotonic()
        while (
            engine.camera_departures
            and next(iter(engine.camera_departures.values())) <= now_monotonic
        ):
            engine.camera_departures.popitem(last=False)
        engine.camera_departures.pop(viewer, None)
        engine.camera_departures[viewer] = now_monotonic + 120
        while len(engine.camera_departures) > 128:
            engine.camera_departures.popitem(last=False)
        if viewer in engine.camera_viewers:
            engine.camera_viewers.remove(viewer)
            engine.camera_viewer_expiries.pop(viewer, None)
            if not engine.camera_viewers:
                expiry = engine.camera_expiry_task
                if expiry and not expiry.done():
                    expiry.cancel()
                engine.camera_expiry_task = None
            if not engine.camera_viewers and engine.printer:
                previous = engine.camera_close_task
                if previous and not previous.done():
                    previous.cancel()
                engine.camera_close_task = asyncio.create_task(
                    close_idle_camera(engine, str(engine.printer.id))
                )
    return web.json_response({"ok": True}, status=202)


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
        return await upload_operation(req, engine, audit)


async def upload_operation(req, engine, audit):
    """Inscrit le mode et les paramètres validés avant de solliciter le transport Anycubic."""
    if not engine.printer:
        raise ValueError("Connexion en cours")
    if engine.command_lock.locked() or engine.command_request_lock.locked():
        raise ValueError("Une opération est déjà en cours")
    if UPLOAD_STAGING.locked():
        raise ValueError("Un envoi de fichier est déjà en cours")
    # Le dossier d’état est sur le volume persistant, contrairement au /tmp en mémoire du conteneur.
    async with UPLOAD_STAGING:
        with tempfile.TemporaryDirectory(prefix="upload-", dir=engine.state_dir) as directory:
            reader = await req.multipart()
            data = {}
            filename = None
            size = 0
            async for part in reader:
                if part.name == "file":
                    if filename is not None:
                        raise ValueError("Un seul fichier est accepté")
                    filename = pathlib.PurePath(part.filename or "").name
                    extension = pathlib.PurePath(filename).suffix.lower()
                    if extension not in (".gcode", ".stl", ".3mf"):
                        raise ValueError("Choisissez un fichier G-code, STL ou 3MF.")
                    path = pathlib.Path(directory) / ("payload" + extension)
                    async with aio_open(path, "wb") as output:
                        while chunk := await part.read_chunk(256 * 1024):
                            size += len(chunk)
                            if size > UPLOAD_LIMIT:
                                raise ValueError("Fichier limité à 100 Mo")
                            await output.write(chunk)
                elif part.name in ("mode", "request_id", "slots") and part.name not in data:
                    value = bytearray()
                    while chunk := await part.read_chunk(8192):
                        value.extend(chunk)
                        if len(value) > 8192:
                            raise ValueError("Paramètre d’envoi trop long")
                    data[part.name] = value.decode("utf-8")
                else:
                    raise ValueError("Paramètre d’envoi invalide")
            if not size or not filename:
                raise ValueError("Fichier manquant")
            mode = data.get("mode", "upload")
            rid = data.get("request_id", "")
            if not re.fullmatch(r"[a-zA-Z0-9-]{16,80}", rid):
                raise ValueError("Identifiant de commande manquant")
            if mode not in ("upload", "save-print", "temp-print"):
                raise ValueError("Mode invalide")
            if extension != ".gcode":
                if mode != "upload":
                    raise ValueError("Seul un fichier .gcode peut être envoyé à l’impression.")
                await asyncio.to_thread(validate_cloud_model, path, extension, size)
            if audit:
                audit["action"] = mode
                audit["request_id"] = request_key(rid)
                audit["parameters"] = filtered_parameters(mode, {"name": filename})
            if rid in engine.commands:
                audit.clear()
                previous = engine.commands[rid]
                return web.json_response(previous, status=200 if previous["ok"] else 409)
            if (previous := await recorded_command(req, rid)) is not None:
                audit.clear()
                return previous
            operation = (
                storage_upload_operation(req, engine)
                if mode == "upload"
                else command_operation(req)
            )
            async with operation:
                if rid in engine.commands:
                    audit.clear()
                    previous = engine.commands[rid]
                    return web.json_response(previous, status=200 if previous["ok"] else 409)
                if not engine.api:
                    raise ValueError("Connexion en cours")
                if mode != "upload":
                    ensure_firmware_ready(engine.printer)
                    if not engine.printer.is_available:
                        raise ValueError("Imprimante non disponible")
                    requested_slots = json.loads(data.get("slots", "[]"))
                    slots = engine.slots({"slots": requested_slots})
                    if audit:
                        audit["parameters"] = filtered_parameters(
                            mode, {"name": filename, "slots": requested_slots}
                        )
                if mode != "temp-print" and callable(
                    getattr(engine.api, "get_user_cloud_store", None)
                ):
                    store = await engine.api.get_user_cloud_store()
                    ensure_storage_ready(safeget(store, "available_bytes"), size)
                engine.commands[rid] = {
                    "ok": False,
                    "message": "Envoi déjà demandé ; résultat en attente",
                }
                if audit:
                    audit["outcome"] = "inconnue"
                    await save_command_event(req, audit)
                transfer_started = time.monotonic()
                log_event(
                    OPS_LOG,
                    logging.INFO,
                    "upload_started",
                    message="Transfert Cloud engagé après validation ; un résultat inconnu ne déclenche pas de nouvel envoi",
                    action=mode,
                )
                try:
                    if mode == "upload":
                        await engine.api.upload_file_to_cloud(
                            full_file_path=str(path), file_name=filename
                        )
                    else:
                        func = (
                            engine.printer.print_and_upload_save_in_cloud
                            if mode == "save-print"
                            else engine.printer.print_and_upload_no_cloud_save
                        )
                        response = await func(
                            full_file_path=str(path), file_name=filename, slot_index_list=slots
                        )
                        if not response or not response.order_msg_id:
                            return web.json_response(engine.commands[rid], status=409)
                except Exception as error:
                    # Après le transfert ou la demande d’impression, une erreur locale ne prouve aucun refus.
                    log_event(
                        OPS_LOG,
                        logging.WARNING,
                        "upload_uncertain",
                        message="Résultat du transfert ou du lancement non confirmé ; vérifiez les fichiers Cloud et l’imprimante avant tout nouvel essai",
                        action=mode,
                        error_type=type(error).__name__,
                        frames=safe_exception_frames(error),
                        duration_ms=round((time.monotonic() - transfer_started) * 1000, 1),
                    )
                    return web.json_response(engine.commands[rid], status=409)
                if getattr(engine, "extras", None):
                    engine.extras.invalidate_task_pages()
                log_event(
                    OPS_LOG,
                    logging.INFO,
                    "upload_accepted",
                    message="Transfert accepté par le Cloud ; cela ne prouve pas la fin d’une impression",
                    action=mode,
                    duration_ms=round((time.monotonic() - transfer_started) * 1000, 1),
                )
                engine.event("Fichier", "Envoi accepté")
                if audit and audit["outcome"] != "confirmée":
                    audit["outcome"] = "acceptée"
                result = {"ok": True, "message": "Envoi accepté par Anycubic"}
                engine.commands[rid] = result
                return web.json_response(result)


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


def purge_abandoned_uploads(state_dir):
    """Retire les répertoires temporaires d’envoi âgés d’au moins 24 h dans les seuls dossiers d’état."""
    if state_dir.is_symlink() or not state_dir.is_dir():
        return
    roots = [state_dir]
    printers = state_dir / "printers"
    if printers.is_dir() and not printers.is_symlink():
        roots.extend(
            path
            for path in printers.iterdir()
            if re.fullmatch(r"[0-9a-f]{20}", path.name) and path.is_dir() and not path.is_symlink()
        )
    cutoff = time.time() - 86400
    for root in roots:
        for path in root.iterdir():
            if not re.fullmatch(r"upload-[a-z0-9_]{8}", path.name) or path.is_symlink():
                continue
            try:
                if not path.is_dir() or path.stat().st_mtime > cutoff:
                    continue
                if any(
                    child.name not in {"payload.gcode", "payload.stl", "payload.3mf"}
                    or child.is_symlink()
                    or not child.is_file()
                    or child.stat().st_mtime > cutoff
                    for child in path.iterdir()
                ):
                    continue
                shutil.rmtree(path)
            except OSError as error:
                logging.getLogger(__name__).warning(
                    "Nettoyage d’un envoi abandonné impossible (%s)", type(error).__name__
                )


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
    configure_logging()
    log_event(
        OPS_LOG,
        logging.INFO,
        "logging_ready",
        message="Journaux du conteneur actifs ; le mode DEBUG ajoute les étapes sans exposer les échanges privés",
        version=APP_VERSION,
    )
    web.run_app(
        app,
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "8080")),
        access_log=None,
        print=None,
    )
