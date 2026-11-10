"""Garde de lancement fondée uniquement sur un état de micrologiciel confirmé."""

from printer_values import safeget


def ensure_firmware_ready(printer):
    """Lève ValueError si l’imprimante ou un ACE confirme une mise à jour en cours."""
    updating = safeget(printer, "fw_version.is_updating") is True or any(
        safeget(firmware, "is_updating") is True
        for firmware in (safeget(printer, "multi_color_box_fw_version") or [])
    )
    if updating:
        raise ValueError("Mise à jour en cours. Attendez sa fin avant de lancer une impression.")


def evaluate_preflight(snapshot, data):
    """Compare les métadonnées disponibles aux emplacements globaux ; renvoie des avis non bloquants."""
    from filament_catalog import material_warnings

    materials, colors, slots = (data.get(key, []) for key in ("materials", "colors", "slots"))
    if (
        not isinstance(materials, list)
        or len(materials) > 16
        or any(not isinstance(value, str) or len(value) > 48 for value in materials)
        or not isinstance(colors, list)
        or len(colors) > 16
        or any(
            not isinstance(color, list)
            or len(color) != 3
            or any(type(value) is not int or not 0 <= value <= 255 for value in color)
            for color in colors
        )
        or not isinstance(slots, list)
        or len(slots) > 16
        or any(type(value) is not int or not 1 <= value <= 8 for value in slots)
    ):
        raise ValueError("Métadonnées de filament invalides")
    by_slot = {
        spool.get("display_slot", index * 4 + spool.get("local_slot", spool.get("slot", 1))): spool
        for index, box in enumerate(snapshot.get("boxes") or [])
        for spool in box.get("spools") or []
    }
    return material_warnings(
        materials,
        [by_slot.get(slot, {}) for slot in slots],
        colors,
        model=snapshot.get("machine_name"),
    )


def ensure_storage_ready(available, size):
    """Lève ValueError pour un quota insuffisant connu ; une valeur absente ne prouve aucun refus."""
    import math

    if type(available) in (int, float) and math.isfinite(available) and 0 <= available < size:
        raise ValueError("Le quota Cloud disponible est insuffisant pour ce fichier.")
