"""Calcule des estimations d’impression à partir des relevés disponibles."""

import math
import json
from statistics import median


def historical_duration_factor(rows, printer_id):
    """Calcule le ratio médian des vingt dernières réussites de cette machine, si cinq sont exploitables."""
    completed = [
        row
        for row in rows
        if str(row.get("printer_id")) == str(printer_id) and str(row.get("print_status")) == "2"
    ][:20]
    ratios = []
    for row in completed:
        try:
            estimated = float(row["estimated_time_s"])
            actual = float(row["print_time"]) * 60
        except (KeyError, ValueError, TypeError):
            continue
        if math.isfinite(estimated) and math.isfinite(actual) and estimated > 0 and actual > 0:
            ratios.append(actual / estimated)
    return (median(ratios), len(ratios)) if len(ratios) >= 5 else None


def corrected_finish(job, estimated_seconds, history, speed_changed, at):
    """Renvoie les fins estimées en secondes Unix pour une tâche en cours à vitesse stable."""
    if speed_changed or not history or job.get("job_state") != "printing":
        return None
    progress, elapsed, remaining = (
        job.get(key)
        for key in (
            "job_progress",
            "job_time_elapsed",
            "job_time_remaining",
        )
    )
    if any(
        type(value) not in (int, float) or not math.isfinite(value) or value < 0
        for value in (estimated_seconds, progress, elapsed, remaining)
    ):
        return None
    if not estimated_seconds or progress >= 100:
        return None
    factor, count = history
    weight = progress / 100
    original = max(0, estimated_seconds - elapsed * 60)
    corrected = max(0, estimated_seconds * factor - elapsed * 60)
    return {
        "finish": round(at + corrected * (1 - weight) + remaining * 60 * weight),
        "original": round(at + original),
        "samples": count,
        "factor": round(factor, 3),
        "live_weight": round(progress),
    }


def observe_timeline(events, job, stamp):
    """Ajoute une transition de phase ou de bobine seulement si elle apparaît dans les relevés."""
    state = job.get("job_state")
    active = ("downloading", "checking", "preheating", "leveling", "printing", "paused")
    if state not in (*active, "finished", "failed") or (not events and state not in active):
        return events
    previous = events[-1] if events else {}
    if previous.get("state") in ("finished", "failed") or stamp <= previous.get("time", 0):
        return events
    slots = (
        [
            [box.get("box_id"), box["loaded_slot"] + 1]
            for box in job.get("boxes") or []
            if type(box.get("loaded_slot")) is int and box["loaded_slot"] >= 0
        ]
        if state == "printing"
        else []
    )
    shortages = sorted(
        {
            item["slot"]
            for item in job.get("filament_shortfalls") or []
            if type(item.get("slot")) is int and item["slot"] > 0
        }
    )
    known_shortages = {
        slot
        for event in events
        if event.get("kind") == "filament_low"
        for slot in event.get("shortages", [])
    }
    new_shortages = [slot for slot in shortages if slot not in known_shortages]
    if previous.get("state") != state:
        kind = "resumed" if previous.get("state") == "paused" and state == "printing" else state
    elif state == "printing" and slots and previous.get("slots") and slots != previous["slots"]:
        kind = "spool"
    elif state == "printing" and new_shortages:
        kind = "filament_low"
    else:
        return events
    entry = {"kind": kind, "state": state, "time": stamp, "slots": slots}
    if kind == "filament_low":
        entry["shortages"] = new_shortages
    return [*events, entry][-200:]


def read_timelines(path):
    """Charge le registre local, vide à la première utilisation."""
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    return value if isinstance(value, dict) else {}
