# SPDX-License-Identifier: GPL-3.0-or-later
"""Consultation en lecture seule de la position des axes via MQTT Anycubic."""

import logging
import math
import re
import uuid

from anycubic_cloud_api.data_models.orders import AnycubicBaseProjectOrderRequest
from operational_logging import log_event, request_context
from printer_values import now


def is_allowed(target):
    """Active la lecture S1 établie par capture ; un support de mouvement seul ne suffit pas."""
    printer = getattr(target, "printer", None)
    api = getattr(target, "api", None)
    mqtt = getattr(api, "_mqtt_client", None)
    if (
        printer is None
        or api is None
        or mqtt is None
        or not getattr(printer, "printer_online", False)
    ):
        return False
    if getattr(printer, "is_busy", False) or getattr(
        printer, "latest_project_print_in_progress", False
    ):
        return False
    try:
        if not mqtt.is_connected():
            return False
    except Exception:
        return False
    model = getattr(printer, "machine_name", "")
    if isinstance(model, str) and re.search(r"(?:^| )kobra s1(?: combo)?$", model.strip(), re.I):
        return True
    return False


def _position_from_reply(response):
    """Valide les trois coordonnées ; renvoie None si le firmware ne donne pas de position complète."""
    data = response.get("data")
    coordinates = data.get("coordinates") if isinstance(data, dict) else None
    if not isinstance(coordinates, dict):
        return None
    values = [coordinates.get(axis) for axis in ("x", "y", "z")]
    if any(value is None for value in values):
        return None
    if any(type(value) not in (int, float) or not math.isfinite(value) for value in values):
        raise ValueError("Les coordonnées de l’imprimante sont invalides")
    return dict(zip(("x", "y", "z"), (float(value) for value in values), strict=True))


async def query_axis_position(target):
    """Consulte sans mouvement ; lève ValueError sur cible invalide et MQTTReplyTimeout sans réponse."""
    printer = getattr(target, "printer", None)
    api = getattr(target, "api", None)
    if printer is None or api is None:
        raise ValueError("Imprimante non connectée")
    mqtt = getattr(api, "_mqtt_client", None)
    try:
        connected = bool(mqtt and mqtt.is_connected())
    except Exception:
        connected = False
    if not connected:
        raise ValueError("La connexion à l’imprimante n’est pas disponible")
    if not is_allowed(target):
        raise ValueError(
            "La consultation de position n’est pas prise en charge par cette imprimante"
        )
    printer_id = getattr(printer, "id", None)
    if type(printer_id) is not int or printer_id <= 0:
        raise ValueError("Identifiant d’imprimante invalide")
    order = AnycubicBaseProjectOrderRequest(
        order_id=1214,
        printer_id=printer_id,
        project_id=0,
    )
    context = request_context.get() or {}
    correlation = context.get("request_id")
    if not isinstance(correlation, str) or not re.fullmatch(r"[a-fA-F0-9]{16,64}", correlation):
        correlation = uuid.uuid4().hex
    logger = logging.getLogger("cloud_page.axes")
    log_event(
        logger,
        logging.INFO,
        "axis_query_started",
        message="Consultation des axes démarrée",
        request_id=correlation,
        duration_ms=0.0,
    )
    phase_events = {
        "cloud_ack": ("axis_query_cloud_ack", "Accusé Cloud reçu pour la consultation des axes"),
        "mqtt_reply": ("axis_query_mqtt_reply", "Réponse MQTT reçue pour la consultation des axes"),
        "mqtt_timeout": (
            "axis_query_mqtt_timeout",
            "Délai de réponse MQTT écoulé pour la consultation des axes",
        ),
    }

    def record_phase(phase, duration_ms):
        """Journalise une phase et son temps écoulé sans identifiant MQTT ni contenu de réponse."""
        event, message = phase_events[phase]
        log_event(
            logger,
            logging.INFO,
            event,
            message=message,
            request_id=correlation,
            duration_ms=round(duration_ms, 1),
        )

    response = await target.mqtt_replies.ask(
        "axis", "query", lambda: api._send_anycubic_order(order), 10, on_phase=record_phase
    )
    if (
        target.printer is not printer
        or target.api is not api
        or getattr(printer, "id", None) != printer_id
    ):
        raise ValueError("La cible de l’imprimante a changé pendant la consultation")
    if not is_allowed(target):
        raise ValueError("La connexion à l’imprimante n’est plus disponible")
    if (
        not isinstance(response, dict)
        or response.get("type") != "axis"
        or response.get("action") != "query"
        or response.get("state") != "done"
        or type(response.get("code")) is not int
        or response.get("code") != 200
    ):
        raise ValueError("Réponse de position de l’imprimante invalide")
    return {"position": _position_from_reply(response), "updated_at": now()}
