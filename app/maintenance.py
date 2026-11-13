"""Entretien local par imprimante, fondé sur les compteurs observés et le calendrier."""

import json
import math
import re
import time
import uuid

from notification_delivery import private_json

# Unités d’échéance : heures d’impression cumulées, jours depuis l’intervention, kg de filament consommés.
UNITS = ("hours", "days", "kg")

# Points d’entretien du wiki Kobra S1 (« Maintenance Recommendations »). Le wiki donne des durées
# calendaires et des bobines ; la buse et la plaque, « à vérifier régulièrement », gardent 50 h.
DEFAULT_OPERATIONS = (
    ("z-screw", "Nettoyer et graisser la vis de l’axe Z", 90, "days"),
    ("y-rods", "Nettoyer et graisser les tiges de l’axe Y", 30, "days"),
    ("x-rods", "Nettoyer les tiges de l’axe X à l’alcool, sans graisse", 30, "days"),
    ("fans", "Dépoussiérer les ventilateurs de la tête et l’auxiliaire", 30, "days"),
    ("cutter", "Contrôler l’usure du coupe-filament", 3, "kg"),
    ("nozzle", "Nettoyer la buse et contrôler la chaussette silicone", 50, "hours"),
    ("bed", "Nettoyer la plaque en acier", 50, "hours"),
)

# Ancien défaut : « graisser les axes » contredit le wiki pour l’axe X (bagues en graphène).
LEGACY_NAMES = {"Graisser les axes et tiges": "Graisser la vis Z et les tiges Y, jamais l’axe X"}


def filament_kg(value):
    """Convertit le filament cumulé du constructeur (« 3.24 kg », « 850 g » ou nombre en kg) ; None sinon."""
    if type(value) in (int, float):
        return float(value) if math.isfinite(value) and value >= 0 else None
    if not isinstance(value, str):
        return None
    match = re.fullmatch(r"\s*(\d+(?:[.,]\d+)?)\s*(kg|g)?\s*", value, re.I)
    if not match:
        return None
    amount = float(match[1].replace(",", "."))
    return amount / 1000 if (match[2] or "").lower() == "g" else amount


def _counter(unit, hours, kg, now):
    """Renvoie le compteur courant de l’unité, ou None s’il est inconnu ou incohérent."""
    value = {"hours": hours, "kg": kg, "days": now / 86400 if now is not None else None}[unit]
    return value if type(value) in (int, float) and math.isfinite(value) and value >= 0 else None


def _last(row, unit):
    """Position du compteur à la dernière intervention, dans l’unité de l’opération."""
    if unit == "days":
        return row["last_time"] / 86400 if type(row.get("last_time")) in (int, float) else None
    return row.get("last_kg" if unit == "kg" else "last_hours")


def maintenance_rows(path, hours, *, defaults=False, material=None, now=None):
    """Renvoie les opérations enregistrées et calcule l’échéance si le compteur est cohérent."""
    now = time.time() if now is None else now
    kg = filament_kg(material)
    try:
        rows = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        rows = (
            [
                {
                    "id": key,
                    "name": name,
                    "interval": interval,
                    "unit": unit,
                    "enabled": True,
                    "history": [],
                }
                for key, name, interval, unit in DEFAULT_OPERATIONS
            ]
            if defaults
            else []
        )
    result = []
    for row in rows:
        unit = row.get("unit") if row.get("unit") in UNITS else "hours"
        current, previous = _counter(unit, hours, kg, now), _last(row, unit)
        elapsed = (
            current - previous
            if current is not None and type(previous) in (int, float) and current >= previous
            else None
        )
        name = (
            LEGACY_NAMES.get(row.get("name"), row.get("name"))
            if row.get("id") == "axes"
            else row.get("name")
        )
        result.append({**row, "name": name, "unit": unit, "elapsed": elapsed})
    return result


def update_maintenance(path, data, hours, now, *, defaults=False, material=None):
    """Ajoute, modifie, retire ou enregistre une opération et persiste l’historique local."""
    rows = maintenance_rows(path, None, defaults=defaults, now=now)
    for row in rows:
        row.pop("elapsed", None)
    action = data.get("action")
    existing = next((row for row in rows if row["id"] == data.get("id")), None)
    if action == "save":
        title, interval = data.get("name"), data.get("interval")
        unit = data.get("unit", existing["unit"] if existing else "hours")
        if not isinstance(title, str) or not title.strip() or len(title) > 100:
            raise ValueError("Nom de l’opération invalide.")
        if type(interval) is not int or not 1 <= interval <= 10000:
            raise ValueError("Intervalle d’entretien invalide.")
        if unit not in UNITS:
            raise ValueError("Unité d’entretien invalide.")
        if existing is None:
            if data.get("id") or len(rows) >= 40:
                raise ValueError("Opération d’entretien indisponible.")
            existing = {"id": uuid.uuid4().hex, "history": []}
            rows.append(existing)
        existing.update(
            name=title.strip(),
            interval=interval,
            unit=unit,
            enabled=data.get("enabled") is not False,
        )
    elif existing is None:
        raise ValueError("Opération d’entretien indisponible.")
    elif action == "delete":
        rows.remove(existing)
    elif action == "done":
        note = data.get("note", "")
        if not isinstance(note, str) or len(note) > 500:
            raise ValueError("Note ou étiquettes invalides.")
        valid_hours = type(hours) in (int, float) and math.isfinite(hours) and hours >= 0
        # Une opération calendaire reste datable sans compteur ; les autres exigent leur compteur.
        if existing["unit"] == "hours" and not valid_hours:
            raise ValueError("Compteur d’heures indisponible.")
        kg = filament_kg(material)
        if existing["unit"] == "kg" and kg is None:
            raise ValueError("Compteur de filament indisponible.")
        recorded = hours if valid_hours else None
        if data.get("last_hours") is not None:
            recorded = data["last_hours"]
            if not valid_hours or type(recorded) not in (int, float) or not 0 <= recorded <= hours:
                raise ValueError("Compteur d’heures indisponible.")
        existing.update(last_hours=recorded, last_time=now, last_kg=kg)
        existing["history"] = [
            *existing["history"],
            {"hours": recorded, "time": now, "note": note.strip()},
        ][-50:]
    else:
        raise ValueError("Opération d’entretien indisponible.")
    private_json(path, rows)
    return maintenance_rows(path, hours, material=material, now=now)
