# SPDX-License-Identifier: GPL-3.0-or-later
"""Planifie les bilans et résume les données vérifiables de l’historique Cloud."""

import asyncio
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, time as wall_time, timedelta
import hashlib
import logging
import time

from cloud_extras import history_minutes, notification_timestamp, number
from notification_delivery import Delivery
from notification_service import normalize_error_code
from operational_logging import log_event

_WINDOW_GRACE = 600
_LOG = logging.getLogger("cloud_page.notifications")
_LABELS = {
    "fr": (
        "Bilan d’impression",
        "Test du canal des bilans d’impression.",
        "Aucune impression terminée ou arrêtée sur cette période.",
        "Collecte incomplète ou indisponible.",
        "Terminées : {done} · Arrêtées : {stopped}",
        "Durée renseignée : {total:g} min ({known}/{count})",
        "Filament renseigné : {total:g} g ({known}/{count})",
        "Codes d’arrêt confirmés",
    ),
    "en": (
        "Print report",
        "Print report channel test.",
        "No completed or stopped prints in this period.",
        "History is incomplete or unavailable.",
        "Completed: {done} · Stopped: {stopped}",
        "Reported duration: {total:g} min ({known}/{count})",
        "Reported filament: {total:g} g ({known}/{count})",
        "Confirmed stop codes",
    ),
    "es": (
        "Informe de impresión",
        "Prueba del canal de informes de impresión.",
        "No hubo impresiones terminadas o detenidas en este período.",
        "El historial está incompleto o no disponible.",
        "Terminadas: {done} · Detenidas: {stopped}",
        "Duración registrada: {total:g} min ({known}/{count})",
        "Filamento registrado: {total:g} g ({known}/{count})",
        "Códigos de parada confirmados",
    ),
    "de": (
        "Druckbericht",
        "Test des Druckberichtskanals.",
        "In diesem Zeitraum wurden keine Drucke abgeschlossen oder gestoppt.",
        "Der Verlauf ist unvollständig oder nicht verfügbar.",
        "Abgeschlossen: {done} · Gestoppt: {stopped}",
        "Gemeldete Dauer: {total:g} min ({known}/{count})",
        "Gemeldetes Filament: {total:g} g ({known}/{count})",
        "Bestätigte Abbruchcodes",
    ),
    "it": (
        "Rapporto di stampa",
        "Prova del canale dei rapporti di stampa.",
        "Nessuna stampa completata o interrotta in questo periodo.",
        "Cronologia incompleta o non disponibile.",
        "Completate: {done} · Interrotte: {stopped}",
        "Durata riportata: {total:g} min ({known}/{count})",
        "Filamento riportato: {total:g} g ({known}/{count})",
        "Codici di arresto confermati",
    ),
}


@dataclass(frozen=True)
class PrintReport:
    """Conserve uniquement les mesures agrégées nécessaires à l’envoi."""

    key: str
    timestamp: int
    period: str
    complete: bool
    completed: int
    stopped: int
    durations: tuple[float, ...]
    filament: tuple[float, ...]
    codes: tuple[tuple[str, int], ...]


def report_window(now, zone):
    """Renvoie les bornes Unix du dernier créneau pendant les dix minutes d’envoi."""
    today = datetime.fromtimestamp(now, zone).date()
    morning = datetime.combine(today, wall_time(8), zone).timestamp()
    evening = datetime.combine(today, wall_time(21), zone).timestamp()
    if evening <= now < evening + _WINDOW_GRACE:
        return morning, evening
    if morning <= now < morning + _WINDOW_GRACE:
        previous = datetime.combine(today - timedelta(days=1), wall_time(21), zone)
        return previous.timestamp(), morning
    return None


def next_report_time(now, zone):
    """Renvoie le prochain créneau de 08 h ou 21 h, en heure locale de l’atelier."""
    today = datetime.fromtimestamp(now, zone).date()
    for day in (today, today + timedelta(days=1)):
        for hour in (8, 21):
            moment = datetime.combine(day, wall_time(hour), zone)
            if moment.timestamp() > now:
                return moment
    raise AssertionError("Un créneau existe toujours dans les deux jours suivants.")


async def collect_history(extras, start, end):
    """Réutilise la lecture paginée habituelle avec un budget borné et signale toute couverture partielle."""
    rows = {}
    identifiers = list(dict.fromkeys(str(printer.id) for printer in extras.account_printers()))
    complete = bool(identifiers) and len(identifiers) <= 4
    try:
        async with asyncio.timeout(15):
            for identifier in identifiers[:4]:
                try:
                    for page in range(1, 4):
                        items, more = await extras.task_rows(identifier, page)
                        for row in items:
                            status = row.get("print_status")
                            if status not in (2, 3):
                                complete &= status in (0, 1)
                                continue
                            finished = notification_timestamp(row.get("end_time"))
                            task = row.get("task_id") or row.get("taskid") or row.get("id")
                            if finished is None:
                                created = notification_timestamp(
                                    row.get("start_time") or row.get("create_time")
                                )
                                complete &= created is not None and created > end
                            elif start < finished <= end:
                                if task:
                                    rows.setdefault((identifier, str(task)), row)
                                else:
                                    complete = False
                        if not more:
                            break
                    else:
                        complete = False
                except Exception as error:
                    _log_history_failure(error)
                    complete = False
    except TimeoutError as error:
        _log_history_failure(error)
        complete = False
    return list(rows.values()), complete


def _log_history_failure(error):
    log_event(
        _LOG,
        logging.WARNING,
        "discord_report_history_unavailable",
        message="Collecte de l’historique interrompue pour le bilan Discord",
        error_type=type(error).__name__,
    )


def _make_report(key, start, end, zone, rows, complete):
    dates = [datetime.fromtimestamp(stamp, zone) for stamp in (start, end)]
    period = " → ".join(date.strftime("%Y-%m-%d %H:%M") for date in dates) + f" ({zone.key})"
    completed = sum(row.get("print_status") == 2 for row in rows)
    durations = []
    filament = []
    codes = Counter()
    for row in rows:
        duration_row = {
            **row,
            "start_time": notification_timestamp(row.get("start_time") or row.get("create_time")),
            "create_time": None,
            "end_time": notification_timestamp(row.get("end_time")),
        }
        duration = history_minutes(duration_row)
        if duration is not None and 0 <= duration <= 525_600:
            durations.append(duration)
        grams = number(row.get("total_filament_used"))
        if grams is not None and 0 <= grams <= 100_000:
            filament.append(grams)
        if row.get("print_status") == 3:
            code = normalize_error_code(row.get("reason_id"))
            if code and code != "200":
                codes[code] += 1
    return PrintReport(
        key,
        int(end),
        period,
        complete,
        completed,
        len(rows) - completed,
        tuple(durations),
        tuple(filament),
        tuple(codes.most_common(10)),
    )


def format_report(report, config):
    """Formate le bilan ou un test fixe, sans nom de fichier ni texte brut du fournisseur."""
    title, test, empty, partial, counts, duration, filament, reasons = _LABELS[config.language]
    if report is None:
        return test
    lines = [f"**{title}**", report.period]
    count = report.completed + report.stopped
    if not report.complete:
        lines.append(partial)
    if not count:
        if report.complete:
            lines.append(empty)
        return "\n".join(lines)
    lines.append(counts.format(done=report.completed, stopped=report.stopped))
    for values, template in ((report.durations, duration), (report.filament, filament)):
        if values:
            lines.append(
                template.format(total=round(sum(values), 1), known=len(values), count=count)
            )
    if report.codes:
        lines.append(
            f"{reasons} : " + ", ".join(f"{code} × {total}" for code, total in report.codes)
        )
    return "\n".join(lines)


class ReportSchedule:
    """Admet un seul bilan par créneau local et délègue l’envoi à la file durable."""

    def __init__(self, state_dir, sender, zone, reader, *, clock=time.time):
        """Accepte une lecture et une horloge injectables pour la démonstration et les tests."""
        self.delivery = Delivery(state_dir, sender, clock=clock, channel="discord_report")
        if self.delivery.last_outcome is None and self.delivery.rows:
            outcome, _ = max(self.delivery.rows.values(), key=lambda entry: entry[1])
            self.delivery.last_outcome = outcome if outcome != "suppressed" else "uncertain"
        self.zone = zone
        self.reader = reader

    async def tick(self):
        """Lit uniquement à l’heure prévue et réserve le créneau avant toute transmission."""
        delivery = self.delivery
        now = delivery.clock()
        window = report_window(now, self.zone)
        if not window or not delivery.config.enabled or delivery.last_outcome == "unavailable":
            return
        start, end = window
        local_slot = datetime.fromtimestamp(end, self.zone).strftime("%Y-%m-%dT%H")
        key = hashlib.sha256(local_slot.encode()).hexdigest()
        async with delivery.observe_lock:
            if key in delivery.rows or not delivery.config.enabled:
                return
            revision = delivery.revision
            try:
                rows, complete = await self.reader(start, end)
            except Exception as error:
                _log_history_failure(error)
                rows, complete = [], False
            if revision != delivery.revision or delivery.clock() >= end + _WINDOW_GRACE:
                return
            report = _make_report(key, start, end, self.zone, rows, complete)
            await delivery.enqueue(revision, [report], int(now))

    async def run(self):
        """Attend le prochain sondage local sans ajouter de requête hors créneau."""
        while True:
            await asyncio.sleep(15)
            await self.tick()
