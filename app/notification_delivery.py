"""Rapproche les résultats Cloud et gère une file de notification durable et bornée."""

import asyncio
from collections import deque
from dataclasses import asdict, dataclass
from datetime import datetime
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import stat
import tempfile
import time

from notification_discord import DiscordConfig, DiscordResult
from notification_service import normalize_error_code
from operational_logging import log_event

_LOG = logging.getLogger("cloud_page.notifications")
_RETENTION = 30 * 86400
_MAX_ROWS = 4096
_MAX_QUEUE = 64
_TTL = 600


@dataclass(frozen=True)
class PrintEvent:
    """Résultat terminal associé à une impression identifiée et horodatée."""

    key: str
    timestamp: int
    result: str
    printer: str
    filename: str
    code: str
    slot: int | None = None


def row_key(scope, row):
    """Identifie une tâche à partir de son compte et de sa machine, indépendamment du nom."""
    printer = row.get("printer_id")
    task = row.get("task_id") or row.get("taskid")
    if not all(
        type(value) in (str, int) and 0 < len(str(value)) <= 128 and str(value) != "0"
        for value in (scope, printer, task)
    ):
        return None
    return hashlib.sha256(json.dumps([str(scope), str(printer), str(task)]).encode()).hexdigest()


def event_time(value):
    """Convertit une date Cloud fiable en secondes UTC, ou renvoie zéro."""
    if isinstance(value, str):
        if re.fullmatch(r"[0-9]{1,10}", value):
            value = int(value)
        elif len(value) <= 40:
            try:
                parsed = datetime.fromisoformat(value)
                value = int(parsed.timestamp()) if parsed.tzinfo is not None else 0
            except (ValueError, OverflowError, OSError):
                value = 0
    return value if type(value) is int and 0 < value <= 4102444800 else 0


def cloud_events(scope, slicer_rows, legacy_rows):
    """Agrège les preuves par tâche et ignore les arrêts génériques et les sources contradictoires."""
    evidence = {}
    for source, rows in (("slicer", slicer_rows), ("legacy", legacy_rows)):
        for row in rows:
            if not isinstance(row, dict) or not (key := row_key(scope, row)):
                continue
            record = evidence.setdefault(
                key, {"states": set(), "events": [], "codes": set(), "explicit_codes": set()}
            )
            alarm = normalize_error_code(row.get("alarm_code"))
            code = alarm or normalize_error_code(row.get("reason_id"))
            if code and code != "200":
                record["codes"].add(code)
            states = record["states"]
            if source == "slicer":
                if alarm != "200":
                    continue
                outcome = "completed"
            else:
                title = row.get("title")
                if (
                    title == "Print to terminate"
                    or row.get("reason") == "User Initiated"
                    or row.get("reason_desc") == "User Initiated"
                ):
                    states.add("cancelled")
                    continue
                if title == "Print to paused":
                    continue
                if title == "Print failed":
                    outcome = "failed"
                    if code and code != "200":
                        record["explicit_codes"].add(code)
                    if row.get("print_status") in (2, "2"):
                        states.add("completed")
                elif row.get("print_status") in (2, "2") or title == "Print complete":
                    outcome = "completed"
                else:
                    continue
            states.add(outcome)
            timestamp = event_time(row.get("create_time"))
            if timestamp:
                record["events"].append((timestamp, row))
    items = []
    for key, record in evidence.items():
        if record["states"] not in ({"completed"}, {"failed"}) or not record["events"]:
            continue
        outcome = next(iter(record["states"]))
        timestamp, row = max(record["events"], key=lambda item: item[0])
        printer, filename = row.get("printer_name"), row.get("project_name")
        codes = record["explicit_codes"] or record["codes"]
        items.append(
            PrintEvent(
                key,
                timestamp,
                outcome,
                printer[:100] if isinstance(printer, str) else "",
                filename[:200] if isinstance(filename, str) else "",
                next(iter(codes)) if outcome == "failed" and len(codes) == 1 else "",
            )
        )
    return items


def private_json(path, value):
    """Remplace le fichier sous des droits privés avant de confirmer l’écriture."""
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=path.parent, delete=False
    ) as stream:
        temporary = Path(stream.name)
        try:
            os.fchmod(stream.fileno(), 0o600)
            json.dump(value, stream, ensure_ascii=False, separators=(",", ":"))
            stream.flush()
            os.fsync(stream.fileno())
            os.replace(temporary, path)
            descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        finally:
            temporary.unlink(missing_ok=True)


def read_private_json(path, max_size):
    """Ouvre un fichier privé ordinaire, sans suivre de lien ni dépasser la taille prévue."""
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, encoding="utf-8") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600:
            raise ValueError("Le fichier de notifications doit rester privé.")
        value = stream.read(max_size + 1)
        if len(value) > max_size:
            raise ValueError("Fichier de notifications trop volumineux.")
        return json.loads(value)


def read_config(path):
    """Charge le réglage privé et le valide à nouveau avant de démarrer le canal."""
    try:
        value = read_private_json(path, 4096)
    except FileNotFoundError:
        return DiscordConfig()
    return DiscordConfig.parse(value)


async def finish_transaction(operation):
    """Attend la fin du remplacement même si la requête qui l’a déclenché disparaît."""
    transaction = asyncio.create_task(operation)
    try:
        return await asyncio.shield(transaction)
    except asyncio.CancelledError:
        await asyncio.gather(transaction, return_exceptions=True)
        raise


class Delivery:
    """Admet uniquement des événements nouveaux et envoie au plus un résultat certain par tâche."""

    def __init__(
        self,
        state_dir,
        send,
        clock=time.time,
        wait=asyncio.sleep,
        *,
        channel="discord",
    ):
        """Charge les traces d’envoi sans rejouer le travail interrompu lors du redémarrage."""
        self.channel = channel
        self.path = Path(state_dir) / (
            "discord-reports.json" if channel == "discord_report" else "notification-delivery.json"
        )
        self.clock, self.wait, self.send = clock, wait, send
        self.config = DiscordConfig()
        self.ready = False
        self.baseline = 0
        self.baseline_reason = "startup"
        self.last_cloud_at = None
        self.scope = None
        self.lookup_after = 0
        self.revision = 0
        self.last_outcome = None
        self.blocked_until = 0
        self.last_test = float("-inf")
        self.queue = deque()
        self.worker = None
        self.send_lock = asyncio.Lock()
        self.observe_lock = asyncio.Lock()
        self.storage_lock = asyncio.Lock()
        self.settings_lock = asyncio.Lock()
        self.rows = {}
        try:
            self.restore()
        except (OSError, ValueError, TypeError):
            self.last_outcome = "unavailable"

    def restore(self):
        """Reclassifie les envois interrompus et refuse un état illisible plutôt que doubler."""
        try:
            rows = read_private_json(self.path, 1_048_576)
        except FileNotFoundError:
            return
        if not isinstance(rows, dict) or len(rows) > _MAX_ROWS:
            raise ValueError("État de livraison invalide.")
        interrupted = 0
        for key, row in rows.items():
            if (
                not re.fullmatch("[0-9a-f]{64}", key)
                or not isinstance(row, list)
                or len(row) != 2
                or row[0] not in ("pending", "sending", "sent", "failed", "uncertain", "suppressed")
                or type(row[1]) is not int
            ):
                raise ValueError("État de livraison invalide.")
            status, stamp = row
            interrupted += status in {"pending", "sending"}
            self.rows[key] = [
                "uncertain"
                if status == "sending"
                else "suppressed"
                if status == "pending"
                else status,
                stamp,
            ]
        if interrupted:
            self.note_gap("interrupted", interrupted)

    def configure(self, config):
        """Écarte les livraisons de la destination précédente et attend une référence fraîche."""
        if config != self.config:
            if self.revision:
                self.baseline_reason = "settings"
                self.note_gap("settings_discarded", len(self.queue))
            self.config = config
            self.revision += 1
            self.ready = False
            self.last_cloud_at = None
            self.queue.clear()

    def note_gap(self, outcome, count=None):
        """Expose une fenêtre sans livraison garantie sans publier de donnée de compte."""
        log_event(
            _LOG,
            logging.INFO,
            "notification_observation_gap",
            message="Discord : période ou résultats sans notification garantie",
            outcome=outcome,
            count=count,
        )

    async def save_config(self, path, config):
        """Sérialise le remplacement privé et son application en mémoire."""

        async def commit():
            async with self.settings_lock:
                try:
                    await asyncio.to_thread(private_json, path, asdict(config))
                except OSError:
                    # Le remplacement peut précéder une erreur de synchronisation.
                    self.configure(DiscordConfig())
                    raise
                self.configure(config)

        await finish_transaction(commit())

    async def persist(self, changes):
        """Écrit l’état hors de la boucle tout en sérialisant les transactions de livraison."""

        async def commit():
            async with self.storage_lock:
                if self.last_outcome == "unavailable":
                    return False
                cutoff = self.clock() - _RETENTION
                rows = {key: row for key, row in self.rows.items() if row[1] >= cutoff}
                rows.update(changes)
                try:
                    if len(rows) > _MAX_ROWS:
                        raise OSError("État de livraison saturé.")
                    await asyncio.to_thread(private_json, self.path, rows)
                except OSError:
                    self.last_outcome = "unavailable"
                    log_event(
                        _LOG,
                        logging.ERROR,
                        "notification_storage_unavailable",
                        message="État de livraison Discord indisponible",
                    )
                    return False
                self.rows = rows
                return True

        return await finish_transaction(commit())

    async def observe_cloud(self, scope, page, rows, read_legacy):
        """Établit une référence par compte avant d’admettre les résultats nouveaux.

        Une alarme ambiguë nécessite une preuve terminale issue du journal historique.
        """
        if not self.config.enabled or not scope or self.last_outcome == "unavailable":
            return
        if self.scope != scope:
            if self.scope is not None:
                self.baseline_reason = "account"
            self.scope = scope
            self.revision += 1
            self.ready = False
            self.last_cloud_at = None
            self.queue.clear()
        now = self.clock()
        if self.last_cloud_at is not None and now - self.last_cloud_at >= _TTL:
            self.note_gap("cloud_gap")
        self.last_cloud_at = now
        revision = self.revision
        if page == "legacy":
            await self.observe(cloud_events(scope, [], rows), revision)
            return
        legacy = []
        if (
            self.ready
            and now >= self.lookup_after
            and any(
                (key := row_key(scope, row))
                and key not in self.rows
                and self.baseline < event_time(row.get("create_time")) <= now + 60
                and now - event_time(row.get("create_time")) < _TTL
                and normalize_error_code(row.get("alarm_code")) not in ("", "200")
                for row in rows
            )
        ):
            self.lookup_after = now + 60
            try:
                legacy = (await read_legacy())[:20]
            except Exception as error:
                log_event(
                    _LOG,
                    logging.DEBUG,
                    "notification_evidence_unavailable",
                    message="Preuve Cloud d’échec indisponible, aucun envoi pour cette alarme",
                    error_type=type(error).__name__,
                )
        if self.revision == revision:
            await self.observe(cloud_events(scope, rows, legacy), revision)

    async def observe(self, events, revision=None):
        """Établit le point de départ et sérialise l’admission pour éviter les doublons."""
        if revision is None:
            revision = self.revision
        async with self.observe_lock:
            if (
                revision != self.revision
                or not self.config.enabled
                or self.last_outcome == "unavailable"
            ):
                return
            now = int(self.clock())
            if not self.ready:
                self.baseline = max(
                    (event.timestamp for event in events if event.timestamp <= now + 60),
                    default=now,
                )
                self.baseline = max(now, self.baseline)
                self.ready = True
                self.note_gap(
                    self.baseline_reason,
                    sum(now - _TTL < event.timestamp <= now + 60 for event in events),
                )
                seen = {
                    event.key: ["suppressed", now] for event in events if event.key not in self.rows
                }
                if seen:
                    await self.persist(seen)
                return
            expired = {
                event.key: ["suppressed", now]
                for event in events
                if event.key not in self.rows and self.baseline < event.timestamp <= now - _TTL
            }
            if expired:
                self.note_gap("expired", len(expired))
                if not await self.persist(expired) or revision != self.revision:
                    return
            entries = [
                event
                for event in events
                if event.key not in self.rows
                and self.baseline < event.timestamp <= now + 60
                and now - event.timestamp < _TTL
            ][: max(0, _MAX_QUEUE - len(self.queue))]
            await self.enqueue(revision, entries, now)

    async def enqueue(self, revision, entries, now):
        """Réserve les résultats sous le verrou d’observation avant de démarrer leur envoi."""
        if not entries or not await self.persist(
            {event.key: ["pending", now] for event in entries}
        ):
            return
        if revision != self.revision:
            return
        self.queue.extend((revision, event) for event in entries)
        if self.worker is None or self.worker.done():
            self.worker = asyncio.create_task(self.run())

    async def run(self):
        """Dépile les événements sans bloquer le suivi Cloud ni rejouer un résultat ambigu."""
        while self.queue:
            revision, event = self.queue.popleft()
            if (
                not self.config.enabled
                or revision != self.revision
                or self.last_outcome == "unavailable"
            ):
                continue
            config = self.config
            expires = event.timestamp + _TTL
            result = DiscordResult("failed")
            for attempt in range(1, 4):
                next_result = await self.transmit(config, event, revision, expires, attempt)
                if next_result is None:
                    break
                result = next_result
                if result.outcome != "retry":
                    break
            if self.last_outcome == "unavailable":
                return
            outcome = "failed" if result.outcome == "retry" else result.outcome
            if not await self.persist({event.key: [outcome, int(self.clock())]}):
                return
            self.last_outcome = outcome

    async def transmit(self, config, event, revision, expires, attempt):
        """Vérifie à nouveau l’échéance et la limite Discord sous le verrou d’envoi."""
        while True:
            async with self.send_lock:
                if (
                    revision != self.revision
                    or not self.config.enabled
                    or self.last_outcome == "unavailable"
                ):
                    return None
                now = self.clock()
                delay = max(0, self.blocked_until - now)
                if now + delay >= expires:
                    return None
                if not delay:
                    if not await self.persist({event.key: ["sending", int(now)]}):
                        return None
                    # Un réglage peut changer pendant l’écriture du témoin d’envoi.
                    if revision != self.revision or self.clock() >= expires:
                        return None
                    result = await self.send(config, event)
                    self.note(result, attempt)
                    return result
            await self.wait(delay)

    def note(self, result, attempt):
        """Journalise des valeurs bornées et applique le délai du fournisseur au canal."""
        if result.retry_after:
            self.blocked_until = max(self.blocked_until, self.clock() + result.retry_after)
        log_event(
            _LOG,
            logging.INFO if result.outcome == "sent" else logging.WARNING,
            "notification_delivery",
            message="Résultat d’un envoi Discord",
            action=self.channel,
            outcome=result.outcome,
            status=result.status,
            attempt=attempt,
        )

    async def test(self, config):
        """Envoie un message fixe, avec le même canal et un essai par minute."""
        async with self.send_lock:
            now = self.clock()
            if now < self.last_test + 60 or now < self.blocked_until:
                return DiscordResult("retry", 429)
            self.last_test = now
            result = await self.send(config, None)
            self.note(result, 1)
            return result

    async def join(self):
        """Attend la file courante, principalement pour vérifier la livraison en démonstration."""
        if self.worker:
            await self.worker

    async def close(self):
        """Laisse la preuve durable « sending » quand le processus s’arrête pendant un appel."""
        if self.worker and not self.worker.done():
            self.worker.cancel()
            await asyncio.gather(self.worker, return_exceptions=True)
