"""Gardes et références de suivi pour le lancement d’une impression."""

import hashlib
import math
from printer_values import safeget

STORED_PRINT_OPTIONS = {
    "auto_leveling": ("auto_leveling_support", "supports_function_auto_leveler"),
    "vibration_compensation": (
        "vibration_compensation_support",
        "supports_function_vibration_compensation",
    ),
    "ai_detect": ("ai_detect_support", "supports_function_ai_detection"),
    "camera_timelapse": ("camera_timelapse_support", "supports_function_time_lapse"),
    "flow_calibration": ("flow_calibration_support", None),
}


def stored_print_options(target):
    """Renvoie les capacités annoncées pour le lancement mémoire qualifié de la S1."""
    printer = target.printer
    if safeget(printer, "machine_name") != "Anycubic Kobra S1":
        return []
    extras = getattr(target, "extras", None)
    features = extras.features() if extras else {}
    ai_probe = getattr(target, "stored_print_ai_printer", None) is printer
    return [
        key
        for key, (feature, attribute) in STORED_PRINT_OPTIONS.items()
        if features.get(
            feature,
            safeget(printer, attribute) is True or (key == "ai_detect" and ai_probe),
        )
        is True
    ]


def validate_stored_print_options(target, choices):
    """Revalide les choix à l’envoi et encode les valeurs désactivées à zéro."""
    available = stored_print_options(target)
    if (
        not isinstance(choices, dict)
        or not choices
        or any(name not in available or type(value) is not bool for name, value in choices.items())
    ):
        raise ValueError("Réglages de lancement non disponibles pour cette imprimante.")
    return {name: int(value) for name, value in choices.items()}


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


def filament_shortfalls(snapshot, slots, grams):
    """Estime les manques par bobine à partir des seules mesures qualifiées et d’une masse nominale connue."""
    if (
        not isinstance(grams, list)
        or not slots
        or len(grams) != len(slots)
        or any(type(value) not in (int, float) or not 0 <= value <= 100_000 for value in grams)
    ):
        return []
    needs = {}
    for slot, needed in zip(slots, grams, strict=True):
        needs[slot] = needs.get(slot, 0) + needed

    def remaining(spool):
        """Renvoie la quantité qualifiée, avec la valeur nominale par défaut du parcours."""
        percent = spool.get("remaining_percent")
        nominal = spool.get("nominal_grams", 1000)
        if (
            spool.get("spool_loaded") is True
            and spool.get("remaining_percent_qualified") is True
            and type(percent) in (int, float)
            and 0 <= percent <= 100
            and type(nominal) in (int, float)
            and 0 < nominal <= 5000
        ):
            return percent * nominal / 100
        return None

    warnings = []
    for box in snapshot.get("boxes") or []:
        spools = {spool.get("display_slot"): spool for spool in box.get("spools") or []}
        used_relays = set()
        for slot, spool in spools.items():
            measured = remaining(spool)
            if slot not in needs or measured is None or measured >= needs[slot]:
                continue
            material, color = spool.get("material_type"), spool.get("color")
            relays = []
            if box.get("auto_feed") == 1 and material and color:
                for other, candidate in spools.items():
                    if other in needs or other in used_relays:
                        continue
                    if (
                        candidate.get("material_type") == material
                        and candidate.get("color") == color
                    ):
                        quantity = remaining(candidate)
                        if quantity is not None:
                            relays.append(other)
                            used_relays.add(other)
                            measured += quantity
            if measured < needs[slot]:
                warnings.append(
                    {
                        "slot": slot,
                        "grams": math.floor(measured),
                        "needed": round(needs[slot], 1),
                        "relay": relays,
                    }
                )
    return warnings


def running_filament_shortfall(snapshot, materials):
    """Estime le besoin restant d’une tâche monofilament avec une seule bobine engagée identifiable."""
    from filament_catalog import material_family

    if (
        snapshot.get("job_state") != "printing"
        or snapshot.get("printer_online") is not True
        or not isinstance(materials, list)
        or len(materials) != 1
        or not isinstance(materials[0], dict)
    ):
        return []
    progress, total = snapshot.get("job_progress"), materials[0].get("filament_used")
    if type(progress) not in (int, float) or not 0 <= progress < 100:
        return []
    if type(total) not in (int, float) or not 0 < total <= 100_000:
        return []
    model = snapshot.get("machine_name")
    family = material_family(materials[0].get("material_type"), model)
    if not family:
        return []
    active = [
        spool
        for box in snapshot.get("boxes") or []
        for spool in box.get("spools") or []
        if spool.get("spool_loaded") is True
        and type(box.get("loaded_slot")) is int
        and type(spool.get("local_slot")) is int
        and spool["local_slot"] == box["loaded_slot"] + 1
        and material_family(spool.get("material_type"), model) == family
        and type(spool.get("display_slot")) is int
    ]
    if len(active) != 1:
        return []
    return filament_shortfalls(
        snapshot, [active[0]["display_slot"]], [total * (1 - progress / 100)]
    )


def ensure_storage_ready(available, size):
    """Lève ValueError pour un quota insuffisant connu ; une valeur absente ne prouve aucun refus."""
    import math

    if type(available) in (int, float) and math.isfinite(available) and 0 <= available < size:
        raise ValueError("Le quota Cloud disponible est insuffisant pour ce fichier.")
