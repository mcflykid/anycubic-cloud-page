# SPDX-License-Identifier: GPL-3.0-or-later
"""Moteur d’état par imprimante, transport Cloud du compte et rapports MQTT."""

import asyncio
import collections
import contextlib
from functools import partial
import json
import logging
import os
import pathlib
import time

from account_auth import AccountAuth, claims
from account_transport import AccountTransport
from ace_telemetry import ace2_pro_telemetry
from anycubic_cloud_api.api.base import AnycubicHTTPUnauthorized, AnycubicRateLimited
from anycubic_cloud_api.api.mqtt import AnycubicMQTTAPI
from anycubic_cloud_api.const.api_endpoints import API_ENDPOINT
from anycubic_cloud_api.const.enums import AnycubicOrderID
from anycubic_cloud_api.data_models.orders import AnycubicBaseOrderRequest
from anycubic_cloud_api.exceptions.exceptions import (
    AnycubicAPIError,
    AnycubicAuthError,
    AnycubicAuthTokensExpired,
)
from anycubic_cloud_api.helpers.helpers import get_part_from_mqtt_topic
from anycubic_cloud_api.models.http import AnycubicAPIEndpoint
from cloud_budget import CloudRequestBudget
from ace_alerts import AceAlerts
from maintenance import maintenance_rows
from print_queue import read_queue
from command_journal import ACTIONS, MQTT_CONFIRMATIONS, command_mqtt_context, mqtt_digest
from filament_catalog import editable_materials, filament_profile_for_sku
from idle_controls import idle_limits, print_limits
from native_controls import ace_model, task_details
from notification_service import AccountNotifications
from operational_logging import log_event, safe_exception_frames
from printer_commands import execute_command, slot_indices
from printer_registry import printer_key
from cloud_extras import key as task_key
from printer_values import now, safeget, serial
import printer_files
from print_preflight import (
    ensure_firmware_ready,
    print_file_references,
    running_filament_shortfall,
    validate_print_indices,
)
from print_observations import corrected_finish
from session_api import CloudSessionAuthError, SessionRecovery

FIELDS = json.loads(pathlib.Path(__file__).with_name("fields.json").read_text())
OPS_LOG = logging.getLogger("cloud_page.server")


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
            if printer is None or not printer.printer_online or not printer.is_available:
                raise ValueError("Imprimante non disponible")
            mapping = (data.get("ams_info") or {}).get("ams_box_mapping") or []
            validate_print_indices(printer, [row["ams_index"] for row in mapping])
        context = command_mqtt_context.get()
        sent_at = time.time()
        if context and data["order_id"] == AnycubicOrderID.START_PRINT.value:
            tracker, entry, task = context
            if (
                asyncio.current_task() is task
                and printer_key(data["printer_id"]) == entry["printer"]
            ):
                tracker.mark_print_send(entry, sent_at)
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
        self.notification_delivery = None
        self.ace_alerts = AceAlerts()
        self.ace_alert_scope = None
        self.queue_observed = None
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
        self.duration_factor = None
        self.estimate_project = None
        self.estimate_speed = None
        self.estimate_speed_changed = False
        self.print_timeline = (None, [])
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
        """Partage le client remplacé avec les cibles du compte."""
        self.transport.api = value

    @property
    def session(self):
        """Utilise la même session HTTP sur toutes les cibles du compte."""
        return self.transport.session

    @session.setter
    def session(self, value):
        """Rattache la session HTTP au transport commun."""
        self.transport.session = value

    @property
    def account_token(self):
        """Donne au moteur principal le jeton associé au client actif."""
        return self.transport.token

    @account_token.setter
    def account_token(self, value):
        """Associe le jeton au client qui l’a établi."""
        self.transport.token = value

    @property
    def reconnect_required(self):
        """Partage l’état de reconnexion avec les cibles secondaires."""
        return self.transport.reconnect_required

    @reconnect_required.setter
    def reconnect_required(self, value):
        """Transmet la demande de reconnexion aux cibles."""
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

    async def observe_ace_alerts(self, scope, delivery):
        """Évalue les états déjà reçus sans interroger à nouveau le Cloud."""
        if not scope or delivery.scope != scope or not delivery.config.ace_events:
            return
        targets = [self, *self.fleet_registry.entries.values()] if self.fleet_registry else [self]
        for target in targets:
            if target.ace_alert_scope != scope:
                if target.ace_alert_scope is not None:
                    target.ace_alerts = AceAlerts()
                target.ace_alert_scope = scope
                target.queue_observed = None
                target.ace_alerts.path = target.state_dir / "ace-alerts.json"
                await asyncio.to_thread(target.ace_alerts.restore, scope)
            previous = (target.ace_alerts.drying.copy(), target.ace_alerts.stops.copy())
            printer = target.snapshot().get("printer") or {}
            events = (
                target.ace_alerts.sample(
                    printer, (scope, printer_key(target.printer.id)), int(time.time())
                )
                if target.printer
                else []
            )
            if target.printer and printer.get("printer_online") is True:
                stamp = int(time.time())
                machine_scope = (scope, printer_key(target.printer.id))
                if "maintenance_due" in delivery.config.ace_events:
                    hours = (printer.get("statistics") or {}).get("hours")
                    rows = await asyncio.to_thread(
                        maintenance_rows, target.state_dir / "maintenance.json", hours
                    )
                    events.extend(
                        AceAlerts.event(
                            printer,
                            machine_scope,
                            None,
                            stamp,
                            (row["id"], row.get("last_time")),
                            "maintenance_due",
                            detail=row["name"],
                        )
                        for row in rows
                        if row["enabled"]
                        and row["elapsed"] is not None
                        and row["elapsed"] >= row["interval"]
                    )
                project = printer.get("command_project")
                previous_job = target.queue_observed
                target.queue_observed = (project, printer.get("job_in_progress") is True)
                if (
                    "queue_next" in delivery.config.ace_events
                    and project
                    and previous_job == (project, True)
                    and printer.get("job_complete") is True
                ):
                    rows = await asyncio.to_thread(
                        read_queue, target.state_dir / "print-queue.json"
                    )
                    next_file = next(
                        (
                            row
                            for row in rows
                            if safeget(target.cloudfiles.get(row["handle"]), "gcode_id")
                        ),
                        None,
                    )
                    if next_file:
                        events.append(
                            AceAlerts.event(
                                printer,
                                machine_scope,
                                None,
                                stamp,
                                project,
                                "queue_next",
                                detail=next_file["name"],
                            )
                        )
            await delivery.observe(
                [event for event in events if event.result in delivery.config.ace_events]
            )
            if previous != (target.ace_alerts.drying, target.ace_alerts.stops):
                await asyncio.to_thread(target.ace_alerts.save, scope)

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
            observation = None
            connection = "unavailable"
            primary = not self.fleet_registry or self is self.fleet_registry.default
            try:
                async with self.lock:
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
                        message="Relevé Cloud actualisé avant la consultation du journal des notifications",
                        outcome="reconnected" if reconnect else "refreshed",
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
                    connection = "available"
                    try:
                        history_page = await self.print_history(1)
                        self.notifications_error = None
                        delivery = self.notification_delivery
                        if primary and delivery and delivery.config.enabled:
                            observation = (
                                claims(self.account_token).get("sub"),
                                history_page["source"],
                                self.notifications.observed_rows(history_page),
                                self.api,
                            )
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
            delivery = self.notification_delivery
            if primary and delivery and delivery.config.enabled:
                # L’alerte de connexion reste indépendante de l’historique et du verrou de l’imprimante.
                try:
                    if getattr(self.account, "login_blocked", False):
                        connection = "reconnect"
                    await delivery.observe_connection(connection)
                    if observation is not None:
                        scope, source, rows, api = observation
                        await delivery.observe_cloud(
                            scope,
                            source,
                            rows,
                            partial(self.notifications.terminal_legacy_rows, api),
                        )
                        await self.observe_ace_alerts(scope, delivery)
                except Exception as error:
                    log_event(
                        OPS_LOG,
                        logging.WARNING,
                        "notification_observation_failed",
                        message="Observation Discord interrompue ; le suivi Cloud continue",
                        error_type=type(error).__name__,
                    )
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
        task = safeget(p, "latest_project._taskid")
        timeline_key, timeline = self.print_timeline
        fields["print_timeline"] = (
            timeline if task and timeline_key == task_key(f"{p.id}:{task}") else []
        )
        project = fields["command_project"]
        speed = fields.get("job_speed_mode")
        if self.estimate_project != project:
            self.estimate_project, self.estimate_speed = project, speed
            self.estimate_speed_changed = False
        elif speed is not None:
            if self.estimate_speed is not None and self.estimate_speed != speed:
                self.estimate_speed_changed = True
            self.estimate_speed = speed
        fields["corrected_finish"] = corrected_finish(
            fields,
            safeget(p, "latest_project._estimate"),
            self.duration_factor,
            self.estimate_speed_changed,
            time.time(),
        )
        fields["job_file_references"] = print_file_references(
            safeget(p, "latest_project.gcode_id"), None
        )
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
            spools = safeget(
                p,
                ("primary" if idx == 0 else "secondary") + "_multi_color_box_spool_info_object",
                [],
            )
            # Le modèle associe déjà le SKU à la bobine courante après chaque mise à jour MQTT.
            slots = {slot.index + 1: slot for slot in (safeget(box, "slots") or [])}
            if spools is not None:
                spools = [spool.copy() for spool in spools]
            for spool in spools or []:
                slot = slots.get(spool.get("local_slot"))
                if slot and slot.rfid is True and slot.spool_loaded is True:
                    profile = filament_profile_for_sku(slot.sku)
                    if profile:
                        spool["filament_profile"] = profile
            boxes.append(
                {
                    "box_id": safeget(box, "box_id", idx),
                    "index": idx,
                    "spools": spools,
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
                # Les anciens relevés sans index gardent leur ordre physique et leurs cases vides.
                indexed = any(isinstance(row, dict) and "index" in row for row in rawslots)
                by_slot = {}
                duplicates = set()
                for offset, row in enumerate(rawslots):
                    if not isinstance(row, dict):
                        continue
                    index = row.get("index") if indexed else offset
                    if type(index) is not int or not 0 <= index < 4:
                        continue
                    if index + 1 in by_slot:
                        duplicates.add(index + 1)
                    by_slot[index + 1] = row
                for spool in b["spools"] or []:
                    slot_number = spool.get("local_slot")
                    rawslot = by_slot.get(slot_number)
                    if rawslot is not None and slot_number not in duplicates:
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
        fields["print_limits"] = print_limits(safeget(p, "latest_project"))
        features = {
            r.get("name"): r.get("value")
            for r in self.raw_info.get("features") or []
            if isinstance(r, dict)
        }
        fields["foreign_detection_supported"] = bool(features.get("fod_support"))
        fields["boxes"] = boxes
        fields["filament_shortfalls"] = running_filament_shortfall(
            fields, safeget(p, "latest_project.slice_material_info_list")
        )
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
