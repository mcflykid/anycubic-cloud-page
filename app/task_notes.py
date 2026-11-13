"""Notes d’impression privées, conservées séparément des tâches Anycubic."""

import json
import re

from notification_delivery import private_json


def read_task_notes(path):
    """Renvoie les notes locales, ou un registre vide avant la première écriture."""
    try:
        rows = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    if not isinstance(rows, dict):
        raise ValueError("Le registre des notes est illisible.")
    return rows


def save_task_note(path, key, data):
    """Valide et remplace la note atomiquement ; un contenu vide la supprime."""
    if not isinstance(key, str) or not re.fullmatch(r"[a-f0-9]{20}", key):
        raise ValueError("Tâche inconnue")
    text, tags = data.get("text"), data.get("tags")
    if (
        not isinstance(text, str)
        or len(text) > 2000
        or "\x00" in text
        or not isinstance(tags, list)
        or len(tags) > 12
        or any(
            not isinstance(tag, str) or len(tag.strip()) > 40 or not tag.strip().isprintable()
            for tag in tags
        )
    ):
        raise ValueError("Note ou étiquettes invalides.")
    note = {"text": text.strip(), "tags": list(dict.fromkeys(tag.strip() for tag in tags))}
    rows = read_task_notes(path)
    if note["text"] or note["tags"]:
        rows[key] = note
    else:
        rows.pop(key, None)
    private_json(path, rows)
    return note
