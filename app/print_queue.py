"""File locale par imprimante. La persistance ne lance aucune commande."""

import json
import re

from notification_delivery import private_json


def read_queue(path):
    """Lit la file dans son ordre d’enregistrement."""
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return []


def update_queue(path, action, handle, entry=None, before=None):
    """Ajoute, retire ou déplace une référence connue et remplace le fichier atomiquement."""
    if not isinstance(handle, str) or not re.fullmatch(r"[a-f0-9]{20}", handle):
        raise ValueError("Fichier introuvable")
    rows = read_queue(path)
    position = next((i for i, row in enumerate(rows) if row["handle"] == handle), None)
    if action == "add" and entry and (position is not None or len(rows) < 30):
        item = {
            "handle": handle,
            "name": entry["name"],
            **({"details": entry["details"]} if entry.get("details") else {}),
            **({"slots": entry["slots"]} if entry.get("slots") else {}),
        }
        if position is None:
            rows.append(item)
        elif item.get("slots"):
            rows[position] = item
    elif action == "move" and position is not None and before != handle:
        item = rows.pop(position)
        destination = next((i for i, row in enumerate(rows) if row["handle"] == before), None)
        if destination is None:
            raise ValueError("Entrée de la file indisponible.")
        rows.insert(destination, item)
    elif action == "remove" and position is not None:
        rows.pop(position)
    elif action in ("up", "down") and position is not None:
        target = position + (-1 if action == "up" else 1)
        if 0 <= target < len(rows):
            rows[position], rows[target] = rows[target], rows[position]
    elif action != "add" or position is None:
        raise ValueError("Entrée de la file indisponible.")
    private_json(path, rows)
    return rows
