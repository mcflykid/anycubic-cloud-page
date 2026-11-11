# SPDX-License-Identifier: GPL-3.0-or-later
"""Journaux opérationnels structurés, UTC et filtrés avant leur sortie vers stderr."""

from __future__ import annotations

from contextvars import ContextVar
from datetime import datetime, timezone
import json
import logging
import math
import os
from pathlib import Path
import re
import sys


request_context: ContextVar[dict | None] = ContextVar("request_context", default=None)

_FIELD_NAMES = frozenset(
    {
        "action",
        "outcome",
        "request_id",
        "command_id",
        "printer",
        "status",
        "mqtt_code",
        "method",
        "route",
        "duration_ms",
        "error_type",
        "version",
        "attempt",
        "count",
        "connected",
        "frames",
        "file_format",
        "storage",
        "nested",
        "endpoint",
        "cloud_code",
    }
)
_TOKEN = re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+")
_SECRET = re.compile(
    r"(?i)([\"']?(?:access[_-]?token|refresh[_-]?token|token|password|passwd|secret|authorization|cookie|email|signature|api[_-]?key)[\"']?\s*[:=]\s*)[^\s,;}]+"
)
_EMAIL = re.compile(r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b")
_SIGNED_URL = re.compile(r"(?i)(https?://[^\s?#]+)\?[^\s#]*")
_PRIVATE_PATH = re.compile(
    r"(?i)(?:"
    + re.escape("/" + "Users/")
    + r"[^\s,;]+|"
    + re.escape("/" + "home/")
    + r"[^\s,;]+|/appdata(?:/[^\s,;]*)?|[A-Z]:\\"
    + "Users"
    + r"\\[^\s,;]+)"
)
_OPAQUE = re.compile(r"\b(?:[A-Fa-f0-9]{24,}|[A-Za-z0-9_-]{32,})\b")
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
_FORMAT_ARG = re.compile(r"%(?:\([^)]+\))?[#0 +\-]?(?:\d+|\*)?(?:\.\d+)?[diouxXeEfFgGcrsa%]")
_CLIENT_LOGGERS = ("anycubic_cloud_api", "aiohttp", "paho", "urllib3", "httpx")
_LEGACY_MESSAGES = {
    "Structure de requête invalide (%s)",
    "Écriture du journal des commandes impossible",
    "Lecture du journal des commandes impossible",
    "Mise à jour MQTT du journal impossible",
    "Retrait de fiche non confirmé (%s)",
    "Relevé de température ignoré (%s)",
    "Dossiers d’envoi non inspectés (%s)",
    "Nettoyage d’un envoi abandonné impossible (%s)",
}


def _safe_component(value):
    """Nettoie un nom de logger qui représente uniquement un composant logiciel."""
    candidate = re.sub(r"[^A-Za-z0-9_.-]", "_", str(value))[:80]
    return candidate or "application"


def _safe_text(value, limit=300):
    """Masque les formes courantes de secret et borne un texte non structuré."""
    text = str(value)
    text = _TOKEN.sub("Bearer [masqué]", text)
    text = _SECRET.sub(r"\1[masqué]", text)
    text = _EMAIL.sub("[courriel masqué]", text)
    text = _SIGNED_URL.sub(r"\1?[paramètres masqués]", text)
    text = _PRIVATE_PATH.sub("[chemin masqué]", text)
    text = _OPAQUE.sub("[identifiant masqué]", text)
    text = _CONTROL.sub(" ", text)
    return text[:limit]


def _safe_value(name, value):
    """Valide un champ de diagnostic selon son type et sa forme autorisés."""
    if name not in _FIELD_NAMES:
        return None
    if name in ("request_id", "command_id", "printer"):
        return (
            value if isinstance(value, str) and re.fullmatch(r"[a-fA-F0-9]{16,64}", value) else None
        )
    if name == "route":
        return (
            value
            if isinstance(value, str)
            and len(value) <= 120
            and re.fullmatch(r"/[A-Za-z0-9_./{}-]*", value)
            and not re.search(r"\d{3,}", value)
            else None
        )
    if name == "method":
        return (
            value
            if isinstance(value, str) and value in {"GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"}
            else None
        )
    if name == "status":
        return value if type(value) is int and 100 <= value <= 599 else None
    if name == "mqtt_code":
        return value if type(value) is int and 0 <= value <= 255 else None
    if name == "cloud_code":
        return value if type(value) is int and 0 <= value <= 999999 else None
    if name == "endpoint":
        allowed = {
            "auth_sig_token",
            "delete_cloud_file",
            "lock_storage_space",
            "new_file_upload",
            "oauth_token_url",
            "print_history",
            "printer_all",
            "printer_firmware_update",
            "printer_functions",
            "printer_get_printers",
            "printer_info",
            "printer_multi_color_box_firmware_update",
            "printer_status",
            "printer_tool",
            "printer_update_name",
            "printers_status",
            "project_gcode_info_fdm",
            "project_get_projects",
            "project_info",
            "project_monitor",
            "send_order",
            "unlock_storage_space",
            "user_files",
            "user_info",
            "user_store",
            "custom",
            "unknown",
        }
        return value if isinstance(value, str) and value in allowed else None
    if name == "duration_ms":
        return (
            round(value, 1)
            if type(value) in {int, float} and math.isfinite(value) and 0 <= value <= 2**31 - 1
            else None
        )
    if name in {"attempt", "count"}:
        return value if type(value) is int and 0 <= value <= 2**31 - 1 else None
    if name == "connected":
        return value if type(value) is bool else None
    if name == "nested":
        return value if type(value) is bool else None
    if name == "file_format":
        return (
            value
            if isinstance(value, str) and value in {"gcode", "gcode_3mf", "3mf", "other"}
            else None
        )
    if name == "storage":
        return value if isinstance(value, str) and value in {"local", "usb", "cloud"} else None
    if name == "error_type":
        return (
            value
            if isinstance(value, str) and re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", value)
            else None
        )
    if name == "version":
        return (
            value
            if isinstance(value, str)
            and re.fullmatch(r"\d{1,3}\.\d{1,3}\.\d{1,3}(?:[-+][A-Za-z0-9.-]{1,20})?", value)
            else None
        )
    if name == "frames":
        if not isinstance(value, (tuple, list)):
            return None
        frames = [
            frame
            for frame in value[:8]
            if isinstance(frame, str)
            and re.fullmatch(r"[A-Za-z0-9_.-]{1,80}:\d{1,7}:[A-Za-z0-9_.<>-]{1,80}", frame)
        ]
        return frames or None
    if name in {"action", "outcome"}:
        return (
            value
            if isinstance(value, str)
            and len(value) <= 48
            and re.fullmatch(r"[A-Za-zÀ-ÿ0-9_-]+", value)
            else None
        )
    return None


def log_event(logger, level, event, *, message, **fields):
    """Écrit un événement statique avec contexte HTTP et champs explicitement autorisés."""
    if not isinstance(event, str) or not re.fullmatch(r"[a-z][a-z0-9_]{0,63}", event):
        raise ValueError("Nom d’événement invalide")
    context = request_context.get() or {}
    safe_fields = {}
    for name in ("request_id", "route", "method"):
        if name not in fields and name in context:
            fields[name] = context[name]
    for name, value in fields.items():
        safe = _safe_value(name, value)
        if safe is not None:
            safe_fields[name] = safe
    logger.log(
        level,
        str(message),
        extra={"_operational_event": event, "_operational_fields": safe_fields},
    )


def safe_exception_frames(error, limit=8):
    """Renvoie des repères de pile sans chemins complets, variables locales ni texte source."""
    extracted = []
    tb = error.__traceback__
    while tb is not None:
        frame = tb.tb_frame
        extracted.append((frame.f_code.co_filename, tb.tb_lineno, frame.f_code.co_name))
        tb = tb.tb_next
    frames = []
    for source, line, function in extracted[-limit:]:
        filename = os.path.basename(source)
        if re.fullmatch(r"[A-Za-z0-9_.-]{1,80}", filename):
            frames.append(f"{filename}:{line}:{function}")
    return frames


class PrivacyFilter(logging.Filter):
    """Retire les dumps tiers, les traceback et les valeurs sensibles avant tout formatage."""

    def filter(self, record):
        """Filtre les valeurs avant le formatage pour empêcher les dumps privés de contourner la sortie structurée."""
        if record.name.startswith(_CLIENT_LOGGERS) and not hasattr(record, "_operational_event"):
            return False
        if not hasattr(record, "_operational_event"):
            if not isinstance(record.msg, str) or record.msg not in _LEGACY_MESSAGES:
                return False
        record.exc_info = None
        record.exc_text = None
        record.stack_info = None
        if hasattr(record, "_operational_event"):
            record.safe_event = record._operational_event
            record.safe_fields = {
                name: safe
                for name, value in record._operational_fields.items()
                if (safe := _safe_value(name, value)) is not None
            }
            record.safe_message = _safe_text(record.getMessage())
        else:
            template = record.msg if isinstance(record.msg, str) else "Message non structuré masqué"
            if record.args:
                template = _FORMAT_ARG.sub("[valeur masquée]", template)
            record.safe_event = "legacy_log"
            record.safe_fields = {}
            record.safe_message = _safe_text(template)
        record.safe_component = _safe_component(record.name)
        return True


class OperationalFormatter(logging.Formatter):
    """Formate les mêmes événements en texte lisible ou en JSON machine."""

    def __init__(self, output_format="text"):
        """Choisit un rendu texte ou JSON pour les événements déjà filtrés."""
        super().__init__()
        self.output_format = output_format
        try:
            candidate = json.loads(
                (Path(__file__).resolve().parents[1] / "package.json").read_text()
            ).get("version")
            self.version = _safe_value("version", candidate) or "unknown"
        except (OSError, ValueError, TypeError, AttributeError):
            self.version = "unknown"

    def format(self, record):
        """Produit une ligne UTC avec les champs sûrs dans un ordre stable."""
        timestamp = (
            datetime.fromtimestamp(record.created, timezone.utc)
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z")
        )
        # La métadonnée embarquée prime sur tout champ fourni par un appelant.
        fields = {**record.safe_fields, "version": self.version}
        if self.output_format == "json":
            value = {
                "timestamp": timestamp,
                "level": record.levelname,
                "component": record.safe_component,
                "event": record.safe_event,
                "message": record.safe_message,
            }
            value.update(fields)
            return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        context = " ".join(f"{name}={fields[name]}" for name in sorted(fields))
        suffix = f" {context}" if context else ""
        return f"{timestamp} {record.levelname} {record.safe_component} {record.safe_event} — {record.safe_message}{suffix}"


def configure_logging(stream=None):
    """Configure stderr UTC, niveau INFO et format texte par défaut; lève ValueError si mal configuré."""
    level_name = os.environ.get("LOG_LEVEL", "INFO").strip().upper() or "INFO"
    output_format = os.environ.get("LOG_FORMAT", "text").strip().lower() or "text"
    if level_name not in {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}:
        raise ValueError("LOG_LEVEL doit être DEBUG, INFO, WARNING, ERROR ou CRITICAL")
    if output_format not in {"text", "json"}:
        raise ValueError("LOG_FORMAT doit être text ou json")
    handler = logging.StreamHandler(stream or sys.stderr)
    handler.setFormatter(OperationalFormatter(output_format))
    handler.addFilter(PrivacyFilter())
    logging.basicConfig(level=getattr(logging, level_name), handlers=[handler], force=True)
    return handler
