# SPDX-License-Identifier: GPL-3.0-or-later
"""Normalisation des valeurs reçues du cloud ou saisies dans l’atelier."""

from datetime import datetime, timezone


def now():
    """Renvoie un horodatage ISO en UTC pour comparer les mises à jour HTTP et MQTT."""
    return datetime.now(timezone.utc).isoformat()


def safeget(obj, key, default=None):
    """Renvoie un attribut imbriqué, ou default si le modèle cloud ne le fournit pas."""
    try:
        for part in key.split("."):
            obj = getattr(obj, part)
        return obj
    except Exception:
        return default


def stored_print_name(value):
    """Compare l’affichage Cloud au paquet mémoire quand une extension a été retirée."""
    return (
        value.casefold().removesuffix(".3mf").removesuffix(".gcode")
        if isinstance(value, str)
        else ""
    )


def serial(obj):
    """Renvoie une structure JSON compatible, avec conversion ISO des dates."""
    if obj is None or isinstance(obj, (str, bool, int, float)):
        return obj
    if isinstance(obj, dict):
        return {str(k): serial(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [serial(v) for v in obj]
    if hasattr(obj, "isoformat"):
        return obj.isoformat()
    return str(obj)


def integer(value, lo, hi):
    """Renvoie un entier entre lo et hi ; lève ValueError pour un booléen ou une valeur invalide."""
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise ValueError("Nombre invalide")
    try:
        n = int(value)
    except (ValueError, OverflowError):
        raise ValueError("Nombre invalide") from None
    if isinstance(value, float) and value != n:
        raise ValueError("Nombre entier requis")
    if not lo <= n <= hi:
        raise ValueError(f"Valeur attendue entre {lo} et {hi}")
    return n


def filepath(value):
    """Renvoie un chemin absolu canonique ; lève ValueError en cas de traversée ou de caractère nul."""
    value = str(value or "/")
    if len(value) > 500 or "\x00" in value or ".." in value.split("/"):
        raise ValueError("Chemin invalide")
    return "/" + value.strip("/")
