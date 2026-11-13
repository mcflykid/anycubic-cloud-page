"""Entretien local par imprimante, fondé sur le compteur d’heures observé."""

import json
import math
import uuid

from notification_delivery import private_json


def maintenance_rows(path, hours):
    """Renvoie les opérations enregistrées et calcule l’échéance si le compteur est cohérent."""
    try:
        rows = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return []
    result = []
    for row in rows:
        previous = row.get("last_hours")
        elapsed = (
            hours - previous
            if type(hours) in (int, float)
            and math.isfinite(hours)
            and type(previous) in (int, float)
            and hours >= previous
            else None
        )
        result.append({**row, "elapsed": elapsed})
    return result


def update_maintenance(path, data, hours, now):
    """Ajoute, modifie, retire ou enregistre une opération et persiste l’historique local."""
    rows = maintenance_rows(path, None)
    for row in rows:
        row.pop("elapsed", None)
    action = data.get("action")
    existing = next((row for row in rows if row["id"] == data.get("id")), None)
    if action == "save":
        title, interval = data.get("name"), data.get("interval")
        if not isinstance(title, str) or not title.strip() or len(title) > 100:
            raise ValueError("Nom de l’opération invalide.")
        if type(interval) is not int or not 1 <= interval <= 10000:
            raise ValueError("Intervalle d’entretien invalide.")
        if existing is None:
            if data.get("id") or len(rows) >= 40:
                raise ValueError("Opération d’entretien indisponible.")
            existing = {"id": uuid.uuid4().hex, "history": []}
            rows.append(existing)
        existing.update(
            name=title.strip(), interval=interval, enabled=data.get("enabled") is not False
        )
    elif existing is None:
        raise ValueError("Opération d’entretien indisponible.")
    elif action == "delete":
        rows.remove(existing)
    elif action == "done":
        note = data.get("note", "")
        if type(hours) not in (int, float) or not math.isfinite(hours) or hours < 0:
            raise ValueError("Compteur d’heures indisponible.")
        if not isinstance(note, str) or len(note) > 500:
            raise ValueError("Note ou étiquettes invalides.")
        existing.update(last_hours=hours, last_time=now)
        existing["history"] = [
            *existing["history"],
            {"hours": hours, "time": now, "note": note.strip()},
        ][-50:]
    else:
        raise ValueError("Opération d’entretien indisponible.")
    private_json(path, rows)
    return maintenance_rows(path, hours)
