# SPDX-License-Identifier: GPL-3.0-or-later
"""Qualification en lecture seule des pourcentages remontés par l’ACE 2 Pro."""

import math


def ace2_pro_telemetry(raw_slot):
    """Renvoie la valeur ACE 2 Pro qualifiée, sa validité et la source sans inférer marque ou masse."""
    percent = None
    if not isinstance(raw_slot, dict):
        return {"percent": None, "valid": False, "source": "unknown"}
    status = raw_slot.get("status")
    edit_status = raw_slot.get("edit_status")
    candidate = raw_slot.get("consumables_percent")
    if (
        type(status) is int
        and status == 5
        and type(edit_status) is int
        and edit_status == 0
        and type(candidate) in (int, float)
        and math.isfinite(candidate)
        and 0 <= candidate <= 100
    ):
        percent = candidate
    return {
        "percent": percent,
        "valid": percent is not None,
        "source": "ace2_pro_consumables_percent" if percent is not None else "unknown",
    }
