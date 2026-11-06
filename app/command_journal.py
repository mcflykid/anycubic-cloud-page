"""Journal privé et borné des demandes susceptibles de modifier une machine ou un fichier."""

from collections import OrderedDict
from contextvars import ContextVar
import hashlib
import ipaddress
import json
import logging
import os
import re
import tempfile
import time
import uuid
from pathlib import Path

ACTIONS = frozenset(
    (
        "pause",
        "resume",
        "cancel",
        "light",
        "dry-start",
        "dry-stop",
        "auto-feed",
        "feed",
        "retract",
        "slot",
        "settings",
        "axis",
        "axis-off",
        "ai-settings",
        "delete-local",
        "delete-usb",
        "delete-cloud",
        "cloud-delete-many",
        "task-delete-many",
        "task-reprint",
        "cloud-rename",
        "print-local",
        "print-usb",
        "print-cloud",
        "rename",
        "firmware",
        "ace-firmware",
        "calibrate",
        "hardware",
        "assist",
        "screen",
        "factory-reset",
        "upload",
        "save-print",
        "temp-print",
        "history-delete",
    )
)
OUTCOMES = frozenset(("refusée", "expirée", "inconnue", "envoyée", "acceptée", "confirmée"))
PRIVATE_TEXT = re.compile(
    r"[@/\\]|[\x00-\x1f\x7f]|(?:[a-f0-9]{16,}|[A-Za-z0-9_-]{28,})", re.IGNORECASE
)


def label(value):
    """Écarte les chaînes qui ressemblent à des identifiants, à des URL ou à des chemins."""
    if not isinstance(value, str) or not value or len(value) > 255 or PRIVATE_TEXT.search(value):
        return None
    return value


def request_key(value):
    """Préserve les UUID clients et masque les autres références d’anciens clients."""
    if not value:
        return None
    try:
        return str(uuid.UUID(value))
    except (ValueError, TypeError):
        return hashlib.sha256(value.encode()).hexdigest()[:24]


def filtered_parameters(action, data):
    """N’autorise que les mesures bornées, les emplacements et certains noms de fichiers."""
    result = {}
    if action in (
        "print-local",
        "print-usb",
        "print-cloud",
        "delete-local",
        "delete-usb",
        "delete-cloud",
        "cloud-rename",
        "upload",
        "save-print",
        "temp-print",
    ):
        if name := label(data.get("name")):
            result["name"] = name
    for name in (
        "box",
        "slot",
        "temperature",
        "hours",
        "distance",
        "minutes",
        "target_nozzle_temp",
        "target_hotbed_temp",
    ):
        value = data.get(name)
        if type(value) in (int, float) and -1000 <= value <= 1000:
            result[name] = value
    slots = data.get("slots")
    if (
        isinstance(slots, list)
        and len(slots) <= 8
        and all(type(slot) is int and 1 <= slot <= 8 for slot in slots)
    ):
        result["slots"] = slots
    for name in ("enabled", "finish"):
        if type(data.get(name)) is bool:
            result[name] = data[name]
    return result


class CommandJournal:
    """Conserve des entrées JSON Lines privées, en remplaçant atomiquement le fichier borné."""

    def __init__(self, path, max_bytes=512 * 1024, max_age=30 * 86400):
        """Choisit la destination du journal et ses limites de taille et d’âge."""
        self.path = Path(path)
        self.max_bytes = max_bytes
        self.max_age = max_age

    def rows(self):
        """Relit les lignes récentes, de la plus ancienne à la plus récente."""
        try:
            with self.path.open("rb") as stream:
                raw = stream.read(self.max_bytes + 1)
        except FileNotFoundError:
            return []
        if len(raw) > self.max_bytes:
            raise OSError("Journal de commandes trop volumineux")
        result = []
        now = time.time()
        for line in raw.splitlines():
            try:
                row = json.loads(line)
            except (ValueError, UnicodeError):
                continue
            if not isinstance(row, dict) or type(row.get("time")) not in (float, int):
                continue
            if not now - self.max_age <= row["time"] <= now:
                continue
            if not isinstance(row.get("action"), str) or row["action"] not in ACTIONS:
                continue
            if not isinstance(row.get("outcome"), str) or row["outcome"] not in OUTCOMES:
                continue
            if row.get("printer") is not None and not isinstance(row["printer"], str):
                continue
            result.append(row)
        return result

    def record(self, entry):
        """Garde une entrée par imprimante et identifiant, en éliminant les plus anciennes."""
        rows = self.rows()
        if entry["request_id"]:
            key = (entry["printer"], entry["request_id"])
            rows = [row for row in rows if (row.get("printer"), row.get("request_id")) != key]
        rows.append(entry)
        chunks = []
        size = 0
        for row in reversed(rows):
            chunk = (json.dumps(row, ensure_ascii=True, separators=(",", ":")) + "\n").encode()
            size += len(chunk)
            if size > self.max_bytes:
                break
            chunks.append(chunk)
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            dir=self.path.parent, prefix=".command-journal-", delete=False
        ) as stream:
            pending = Path(stream.name)
            try:
                stream.writelines(reversed(chunks))
                stream.flush()
                os.fsync(stream.fileno())
                os.replace(pending, self.path)
            finally:
                pending.unlink(missing_ok=True)


def make_entry(action, request_id, printer, printer_name, session, client, parameters):
    """Crée une entrée sans paramètres libres, identifiant cloud brut ni jeton."""
    try:
        address = str(ipaddress.ip_address(client))
    except ValueError:
        address = None
    return {
        "time": time.time(),
        "printer": printer,
        "printer_name": label(printer_name),
        "action": action,
        "request_id": request_key(request_id),
        "session": session.hex()[:16] if session else None,
        "client": address,
        "parameters": filtered_parameters(action, parameters),
        "outcome": "refusée",
    }


# Les états intermédiaires et les réponses de consultation ne prouvent pas l’application d’un ordre.
MQTT_CONFIRMATIONS = {
    1: {("print", "start", "printing"), ("print", "start", "finished")},
    2: {("print", "pause", "paused")},
    3: {("print", "resume", "resumed")},
    4: {("print", "stop", "stoped")},
    102: {("file", "deleteUdisk", "success")},
    104: {("file", "deleteLocal", "success")},
    1207: {("multiColorBox", "setDry", "success")},
    1208: {("multiColorBox", "feedFilament", "done")},
    1211: {("multiColorBox", "setInfo", "success")},
    1212: {("multiColorBox", "setAutoFeed", "done")},
    1233: {("light", "control", "done")},
}
MQTT_SIGNATURES = frozenset().union(*MQTT_CONFIRMATIONS.values())
MQTT_WINDOW = 300


def mqtt_digest(value):
    """Accepte les références filaires texte ou numériques sans en conserver la valeur brute."""
    if type(value) not in (str, int):
        return None
    value = str(value)
    if not value or len(value) > 128 or not value.isascii():
        return None
    return hashlib.sha256(value.encode()).hexdigest()


command_mqtt_context = ContextVar("command_mqtt_context", default=None)


class JournalMQTT:
    """Rapproche les rapports terminaux sur la boucle applicative, même si le rapport arrive avant HTTP."""

    def __init__(self, journal, loop):
        """Recharge les ordres récents du fichier privé après un redémarrage."""
        self.journal = journal
        self.loop = loop
        self.pending = {}
        self.early = OrderedDict()
        try:
            rows = journal.rows()
        except OSError:
            rows = []
        for row in rows:
            order = row.get("mqtt")
            if not isinstance(order, dict):
                continue
            digest = order.get("digest")
            expires = order.get("expires")
            order_id = order.get("order")
            if (
                isinstance(digest, str)
                and re.fullmatch(r"[a-f0-9]{64}", digest)
                and type(expires) in (int, float)
                and type(order_id) is int
                and order_id in MQTT_CONFIRMATIONS
                and time.time() < expires <= time.time() + MQTT_WINDOW
                and row.get("printer")
            ):
                self.pending[(row["printer"], digest)] = row

    def _save(self, entry):
        try:
            self.journal.record(entry)
        except OSError:
            logging.getLogger(__name__).error("Mise à jour MQTT du journal impossible")

    def watch(self, entry, order_id, digest, sent_at):
        """Persiste uniquement l’empreinte de l’ordre physique retourné par le Cloud."""
        key = (entry["printer"], digest)
        entry["mqtt"] = {"digest": digest, "order": order_id, "expires": sent_at + MQTT_WINDOW}
        self.pending[key] = entry
        now = time.time()
        self.pending = {
            key: row for key, row in self.pending.items() if row["mqtt"]["expires"] > now
        }
        self._save(entry)
        if (report := self.early.pop(key, None)) is not None:
            signature, received_at = report
            if received_at >= sent_at:
                self.apply_report(key, signature, received_at)

    def receive(self, printer, payload):
        """Transfère seulement une signature connue et une empreinte depuis le fil MQTT."""
        signature = tuple(payload.get(key) for key in ("type", "action", "state"))
        if (
            not all(isinstance(value, str) for value in signature)
            or signature not in MQTT_SIGNATURES
        ):
            return
        if (digest := mqtt_digest(payload.get("msgid"))) is not None:
            self.loop.call_soon_threadsafe(
                self.apply_report, (printer, digest), signature, time.time()
            )

    def apply_report(self, key, signature, received_at):
        """Confirme uniquement l’ordre attendu et ignore les doublons et les retours périmés."""
        entry = self.pending.get(key)
        if entry is None:
            self.early[key] = (signature, received_at)
            self.early.move_to_end(key)
            while len(self.early) > 128:
                self.early.popitem(last=False)
            return
        order = entry["mqtt"]
        if not order["expires"] - MQTT_WINDOW <= received_at <= order["expires"]:
            return
        if signature not in MQTT_CONFIRMATIONS.get(order["order"], ()):
            return
        self.pending.pop(key)
        entry.pop("mqtt")
        entry["outcome"] = "confirmée"
        self._save(entry)
