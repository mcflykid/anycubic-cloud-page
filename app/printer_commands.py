# SPDX-License-Identifier: GPL-3.0-or-later
"""Validation et exécution des commandes d’une imprimante sélectionnée."""

import json
import logging
import os
import re
import tempfile

from anycubic_cloud_api.data_models.printer_properties import AnycubicMaterialColor
from anycubic_cloud_api.data_models.printing_settings import AnycubicPrintingSettings

from command_journal import dispatch_command
from native_controls import ai_payload, axis_payload
from idle_controls import set_idle
from filament_catalog import editable_materials
from print_preflight import ensure_firmware_ready
from printer_values import filepath, integer, now, safeget
from printer_files import invalidate_local_preview
from operational_logging import log_event


def slot_indices(target, data):
    """Convertit les numéros de bobines en indices ; renvoie None sans sélection, ValueError si invalide."""
    values = data.get("slots")
    if not values:
        return None
    if not isinstance(values, list) or len(values) > 8:
        raise ValueError("Liste de bobines invalide")
    return target.printer.print_slot_numbers_to_indices([integer(v, 1, 8) for v in values])


async def execute_command(target, name, d):
    """Renvoie le résultat textuel d’une commande validée ; lève ValueError si interdite ou non acceptée."""
    if name == "presets":
        presets = d.get("presets")
        if not isinstance(presets, list) or len(presets) != 4:
            raise ValueError("Quatre préréglages attendus")
        validated = [
            {
                "name": str(row["name"])[:25],
                "temperature": integer(row["temperature"], 35, 70),
                "hours": integer(row["hours"], 1, 24),
            }
            for row in presets
        ]
        target.state_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        path = target.state_dir / "presets.json"
        fd, temporary = tempfile.mkstemp(prefix=".presets-", dir=path.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as output:
                json.dump(validated, output)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        target.presets = validated
        return "Préréglages enregistrés"
    p = target.printer
    a = target.api
    if not p or not a:
        raise ValueError("Imprimante non connectée")
    if name in [
        "cloud-rename",
        "cloud-move",
        "cloud-delete-many",
        "task-delete-many",
        "task-reprint",
        "calibrate",
        "hardware",
        "assist",
        "screen",
        "factory-reset",
        "task-rate",
        "timelapse",
    ]:
        return await target.extras.action(name, d)
    if name == "idle-settings":
        return await set_idle(target, d)
    if name in {"print-local", "print-usb", "print-cloud"}:
        ensure_firmware_ready(p)
    box = integer(d.get("box", 0), 0, max(0, p.connected_ace_units - 1))
    slot = integer(d.get("slot", 1), 1, 4) - 1
    if name in ["axis", "axis-off", "ai-settings"]:
        if not p.is_available or p.latest_project_print_in_progress:
            raise ValueError("Commande indisponible pendant une impression ou une opération")
        from anycubic_cloud_api.data_models.orders import AnycubicProjectOrderRequest

        if name == "axis":
            if 67 not in (target.raw_info.get("type_function_ids") or []):
                raise ValueError("Contrôle des axes non annoncé par l’imprimante")
            payload = axis_payload(d.get("axis"), d.get("direction"), d.get("distance"))
            order = 201
        elif name == "axis-off":
            payload = {}
            order = 1213
        else:
            previous = await target.ai_settings()
            payload = ai_payload(d, previous)
            order = 1243
            target.ai_cache = None
        await dispatch_command(
            a._send_anycubic_order(
                AnycubicProjectOrderRequest(
                    order_id=order, printer_id=p.id, project_id=0, order_data=payload
                )
            )
        )
        return "Commande transmise à Anycubic ; vérifiez son application sur la machine"
    if name in ["pause", "resume", "cancel"]:
        project = await target.verify_active_project(name, d.get("project_key"))
        result = await dispatch_command(getattr(p, name + "_print")(project=project))
    elif name == "light":
        enabled = bool(d["enabled"])
        channel = 2 if p.machine_name == "Anycubic Kobra S1" else p.camera_light_type
        result = await dispatch_command(
            a._send_order_set_light_status(p, enabled, light_type=channel)
        )
        if result is None:
            raise ValueError("La commande d’éclairage n’a pas été acceptée")
        try:
            response = await target.mqtt_replies.ask(
                "light", "query", p.query_camera_light_status, 6
            )
        except ValueError:
            response = {}
        data = response.get("data")
        value = data.get("status", data.get("light")) if isinstance(data, dict) else None
        if (
            response.get("state") == "done"
            and value in (0, 1, "0", "1")
            and bool(int(value)) == enabled
        ):
            return (
                "Éclairage "
                + ("allumé" if enabled else "éteint")
                + " : état confirmé par l’imprimante"
            )
        return "Demande d’éclairage envoyée. Vérifiez son état dans la vidéo."
    elif name == "dry-start":
        result = await dispatch_command(
            p.multi_color_box_drying_start(
                duration=integer(d["hours"], 1, 24) * 60,
                target_temp=integer(d["temperature"], 35, 70),
                box_id=box,
            )
        )
    elif name == "dry-stop":
        result = await dispatch_command(p.multi_color_box_drying_stop(box_id=box))
    elif name == "auto-feed":
        result = await dispatch_command(
            p.multi_color_box_set_auto_feed(bool(d["enabled"]), box_id=box)
        )
    elif name == "feed":
        result = await dispatch_command(
            p.multi_color_box_feed_filament(
                slot_index=slot, box_id=box, finish=bool(d.get("finish", False))
            )
        )
    elif name == "retract":
        result = await dispatch_command(p.multi_color_box_retract_filament(box_id=box))
    elif name == "slot":
        # L’état MQTT du boîtier peut déjà avoir changé depuis l’ouverture du formulaire.
        for ace in safeget(p, "multi_color_box") or []:
            if ace.box_id == box and any(
                spool.index == slot and spool.rfid is True for spool in ace.slots
            ):
                raise ValueError("Les matériaux identifiés par RFID ne peuvent pas être modifiés.")
        color = str(d["color"])
        if not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
            raise ValueError("Couleur invalide")
        material = str(d["material"])
        if material not in editable_materials():
            raise ValueError("Matériau non pris en charge par la commande du dépôt")
        c = AnycubicMaterialColor(*[int(color[i : i + 2], 16) for i in (1, 3, 5)])
        result = await dispatch_command(
            p.multi_color_box_set_slot(slot, slot_color=c, slot_material_type=material, box_id=box)
        )
    elif name == "settings":
        ranges = {
            "print_speed_mode": (0, 10),
            "target_nozzle_temp": (0, 320),
            "target_hotbed_temp": (0, 120),
            "fan_speed_pct": (0, 100),
            "aux_fan_speed_pct": (0, 100),
            "box_fan_level": (0, 3),
            "bottom_layers": (0, 1000),
            "bottom_time": (0, 1000),
            "off_time": (0, 1000),
            "on_time": (0, 1000),
        }
        values = {
            k: integer(v, *ranges[k]) for k, v in d.items() if k in ranges and v not in ["", None]
        }
        if not values:
            raise ValueError("Aucun réglage fourni")
        if not p.latest_project or not p.latest_project_print_in_progress:
            raise ValueError("Ces réglages nécessitent une impression active")
        result = await dispatch_command(
            a._send_order_change_print_settings(p, AnycubicPrintingSettings(**values))
        )
    elif name in ["files-local", "files-usb"]:
        await target.read_files("local" if name == "files-local" else "usb", d.get("path"))
        return "Liste reçue de l’imprimante"
    elif name in ["delete-local", "delete-usb", "print-local", "print-usb"]:
        source = "local" if name.endswith("local") else "udisk"
        filename = str(d["name"])
        if not filename or "/" in filename or "\x00" in filename or len(filename) > 255:
            raise ValueError("Nom de fichier invalide")
        kw = {"file_name": filename, "file_path": filepath(d.get("path")).strip("/") or "/"}
        if name.startswith("print"):
            if not filename.casefold().endswith(".gcode"):
                raise ValueError(
                    "Le lancement direct de ce format n’est pas encore validé. Utilisez un fichier .gcode tranché pour cette imprimante."
                )
            file_format = (
                "gcode_3mf"
                if filename.casefold().endswith(".gcode.3mf")
                else "gcode"
                if filename.casefold().endswith(".gcode")
                else "3mf"
                if filename.casefold().endswith(".3mf")
                else "other"
            )
            log_event(
                logging.getLogger("cloud_page.commands"),
                logging.INFO,
                "stored_print_prepared",
                message="Préparation d’une impression depuis le stockage de la machine ; le nom du fichier reste privé",
                action=name,
                storage="local" if source == "local" else "usb",
                file_format=file_format,
                nested=kw["file_path"] != "/",
            )
            if not p.is_available:
                raise ValueError("Imprimante non disponible")
            kw["slot_index_list"] = target.slots(d)
        result = await dispatch_command(
            getattr(p, ("delete_" if name.startswith("delete") else "print_") + source + "_file")(
                **kw
            )
        )
    elif name in ["delete-cloud", "print-cloud"]:
        f = target.cloudfiles.get(str(d.get("handle")))
        if f is None:
            raise ValueError("Actualisez la liste des fichiers cloud")
        if name == "delete-cloud":
            result = await dispatch_command(a.delete_file_from_cloud(f.id))
        else:
            if not p.is_available:
                raise ValueError("Imprimante non disponible")
            if f.gcode_id is None or f.gcode_id <= 0:
                raise ValueError("Ce fichier ne dispose pas de G-code cloud")
            result = await dispatch_command(
                p.print_with_cloud_gcode_id(f.gcode_id, target.slots(d))
            )
            if not result or not result.order_msg_id:
                raise ValueError("Anycubic n’a pas confirmé le lancement de l’impression")
    elif name == "rename":
        value = str(d.get("name", "")).strip()
        if not 1 <= len(value) <= 64:
            raise ValueError("Nom entre 1 et 64 caractères")
        result = await dispatch_command(a.set_printer_name(p, value))
    elif name == "firmware":
        if not p.is_available:
            raise ValueError("Imprimante non disponible")
        if safeget(p, "fw_version.update_available") is not True:
            raise ValueError("Aucune mise à jour de l’imprimante n’est proposée par Anycubic")
        result = await dispatch_command(p.update_printer_firmware())
    elif name == "ace-firmware":
        if not p.is_available:
            raise ValueError("Imprimante non disponible")
        versions = safeget(p, "multi_color_box_fw_version") or []
        if box >= len(versions):
            raise ValueError("Version de l’ACE non reçue. Actualisez les informations.")
        fw = versions[box]
        if safeget(fw, "update_available") is not True:
            raise ValueError("Aucune mise à jour de cet ACE n’est proposée par Anycubic")
        result = await dispatch_command(p.update_printer_multi_color_box_firmware(box_id=box))
    elif name == "query":
        await target.refresh_printer_details()
        target.updated = now()
        target.ok = True
        target.error = None
        result = True
    elif name == "mqtt-on":
        owner = target.fleet_registry.default if getattr(target, "fleet_registry", None) else target
        owner.transport.mqtt_enabled = True
        owner.mqtt_start()
        return "Connexion MQTT du compte demandée"
    elif name == "mqtt-off":
        owner = target.fleet_registry.default if getattr(target, "fleet_registry", None) else target
        owner.transport.mqtt_enabled = False
        a.disconnect_mqtt()
        return "Déconnexion MQTT du compte demandée"
    else:
        raise ValueError("Commande inconnue")
    if result is None or result is False:
        raise ValueError("Aucune commande acceptée par le moteur Anycubic")
    if name in {"delete-local", "delete-usb"}:
        invalidate_local_preview(
            target,
            "local" if name == "delete-local" else "usb",
            filename,
            kw["file_path"],
        )
    return "Commande acceptée par Anycubic ; confirmation machine en attente"
