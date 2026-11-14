"""Conserve le sens et la provenance des durées historiques avant toute fusion Cloud."""

import math


def duration_number(value):
    """Renvoie un nombre fini positif ou nul ; les sentinelles et booléens sont inconnus."""
    if value is None or isinstance(value, bool):
        return None
    try:
        result = float(value)
    except (ValueError, TypeError, OverflowError):
        return None
    return result if math.isfinite(result) and result >= 0 else None


def history_duration(row, supplement=None):
    """Normalise la source principale ; le complément ne décide jamais la durée de liste."""
    reported = duration_number(row.get("print_time"))
    start = duration_number(row.get("start_time") or row.get("create_time"))
    end = duration_number(row.get("end_time"))
    interval = None
    # Les dates de fin peuvent persister dans un projet actif : seules les fins connues comptent.
    if row.get("print_status") in (2, 3) and start and end is not None and end >= start:
        interval = (end - start) / 60
    extra = duration_number((supplement or {}).get("print_time"))
    values = [v for v in (interval, reported, extra) if v is not None]
    return {
        "minutes": interval if interval is not None else reported,
        "kind": "interval"
        if interval is not None
        else "reported"
        if reported is not None
        else "unknown",
        "source": "history_v2",
        "interval_minutes": interval,
        "reported_minutes": reported,
        "supplement_reported_minutes": extra,
        # Les compteurs sont en minutes entières ; une différence sous une minute peut être un arrondi.
        "conflict": bool(values and max(values) - min(values) >= 1),
    }


def detail_duration(duration, detail, source):
    """Ajoute le compteur du détail et sa route sans réinterpréter son champ estimé."""
    result = dict(duration)
    reported = duration_number(detail.get("print_time"))
    result.update(detail_reported_minutes=reported, detail_source=source)
    values = [
        result.get(k)
        for k in (
            "interval_minutes",
            "reported_minutes",
            "supplement_reported_minutes",
            "detail_reported_minutes",
        )
    ]
    values = [v for v in values if v is not None]
    result["conflict"] = bool(values and max(values) - min(values) >= 1)
    return result
