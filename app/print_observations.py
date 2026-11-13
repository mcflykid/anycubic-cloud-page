"""Calcule des estimations d’impression à partir des relevés disponibles."""

import math
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
