"""Gardes et références de suivi pour le lancement d’une impression."""

import hashlib
from printer_values import safeget


def print_file_references(gcode_id, cloud_file_id):
    """Renvoie les références opaques des fichiers Cloud, dans leurs espaces respectifs."""
    return [
        hashlib.sha256(f"{kind}:{value}".encode()).hexdigest()[:20]
        for kind, value in (("gcode", gcode_id), ("cloud", cloud_file_id))
        if str(value).isdigit() and int(value) > 0
    ]


def launch_tracking(previous_project, response):
    """Renvoie de quoi corréler un futur relevé, ou None sans identifiant de fichier."""
    event = safeget(response, "event_dict") or {}
    files = print_file_references(event.get("gcode_id"), event.get("cloud_file_id"))
    return {"previous_project": previous_project, "files": files} if files else None


def launch_tracking_for_gcode(previous_project, gcode_id):
    """Réutilise la référence du G-code déjà identifié par le parcours de lancement."""
    files = print_file_references(gcode_id, None)
    return {"previous_project": previous_project, "files": files} if files else None


def validate_print_indices(printer, indices):
    """Lève ValueError si une bobine sélectionnée est absente, vide ou réservée par l’ACE."""
    if not indices:
        return
    spools = [
        spool
        for source in (
            "primary_multi_color_box_spool_info_object",
            "secondary_multi_color_box_spool_info_object",
            "kobra_x_internal_material_rack_spool_info_object",
        )
        for spool in (safeget(printer, source) or [])
        if not spool.get("reserved_by_ace")
    ]
    available = printer.print_slot_numbers_to_indices(
        [spool["display_slot"] for spool in spools if spool.get("spool_loaded") is True]
    )
    for index in indices:
        if index not in available:
            raise ValueError("Une bobine sélectionnée est indisponible.")


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
