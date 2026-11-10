"""Commandes de température et ventilation au repos, bornées par le profil annoncé."""

import asyncio
import json

from anycubic_cloud_api.data_models.orders import AnycubicBaseOrderRequest
from command_journal import dispatch_command
from printer_values import integer
from print_preflight import ensure_firmware_ready


class IdleOrder(AnycubicBaseOrderRequest):
    """La forme imprimante native exige un ordre texte et l’absence de project_id."""

    def __init__(self, order, printer_id, data):
        """Conserve uniquement les valeurs validées avant l’envoi, sans projet courant implicite."""
        super().__init__(order_id=order, printer_id=printer_id)
        self.data = data

    @property
    def order_request_data(self):
        """Sérialise la forme P observée dans le client Slicer, distincte des réglages de projet."""
        return {"order_id": str(self._order_id), "printer_id": self._printer_id, "data": self.data}


def idle_limits(target):
    """Expose seulement les limites de préchauffage valides d’une S1 identifiée."""
    if getattr(target.printer, "machine_name", None) != "Anycubic Kobra S1":
        return {}
    profile = target.raw_info.get("free_temp_limit")
    if isinstance(profile, str) and len(profile) <= 2048:
        try:
            profile = json.loads(profile)
        except ValueError:
            return {}
    if not isinstance(profile, dict):
        return {}
    result = {}
    for name, field in (
        ("target_nozzle_temp", "nozzle_temp_limit"),
        ("target_hotbed_temp", "hotbed_temp_limit"),
    ):
        pair = profile.get(field)
        if (
            isinstance(pair, list)
            and len(pair) == 2
            and all(type(value) is int for value in pair)
            and 0 <= pair[0] <= pair[1] <= (320 if name == "target_nozzle_temp" else 120)
        ):
            result[name] = pair
    return result


def idle_request(target, values):
    """Valide une seule famille de réglages ; refuse toute limite inconnue ou donnée ambiguë."""
    limits = idle_limits(target)
    if not limits or not isinstance(values, dict):
        raise ValueError("Préchauffage non annoncé pour cette imprimante")
    clean = {key: value for key, value in values.items() if value not in ("", None)}
    temperatures = {"target_nozzle_temp", "target_hotbed_temp"}
    fans = {"fan_speed_pct", "aux_fan_speed_pct"}
    if clean and clean.keys() <= temperatures:
        parsed = {}
        for key, value in clean.items():
            if key not in limits:
                raise ValueError("Limites de préchauffage indisponibles")
            parsed[key] = integer(value, *limits[key])
        kind = 2 if len(parsed) == 2 else 0 if "target_nozzle_temp" in parsed else 1
        data = {
            "type": kind,
            "target_nozzle_temp": parsed.get("target_nozzle_temp", 0),
            "target_hotbed_temp": parsed.get("target_hotbed_temp", 0),
        }
        return IdleOrder(1216, target.printer.id, data)
    if len(clean) == 1 and clean.keys() <= fans:
        return IdleOrder(
            1221, target.printer.id, {key: integer(value, 0, 100) for key, value in clean.items()}
        )
    # L’unité du troisième ventilateur diffère entre clients : ne pas ajouter une échelle supposée.
    raise ValueError("Choisissez les températures ou un seul ventilateur")


async def set_idle(target, values):
    """Relit la machine sous le verrou appelant et émet au maximum un ordre, sans rejeu."""
    values = dict(values)
    if values.pop("confirmed", None) is not True:
        raise ValueError("Confirmez le réglage au repos avant son envoi")
    original = target.printer
    identifier = getattr(original, "id", None)
    # Une saisie invalide est refusée avant même de consulter le fournisseur.
    idle_request(target, values)
    await asyncio.wait_for(target.refresh_printer_details(), timeout=10)
    printer = target.printer
    if (
        printer is not original
        or getattr(printer, "id", None) != identifier
        or not printer.printer_online
        or not printer.is_available
        or printer.is_busy
        or printer.latest_project_print_in_progress
    ):
        raise ValueError("Cette action nécessite la même imprimante en ligne et libre")
    ensure_firmware_ready(printer)
    request = idle_request(target, values)
    result = await dispatch_command(target.api._send_anycubic_order(request))
    if not result:
        raise ValueError("Anycubic n’a pas accepté ce réglage")
    return "Réglage transmis à Anycubic ; vérifiez son application sur la machine"
