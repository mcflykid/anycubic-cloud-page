"""Réception des fichiers et transfert Anycubic, avec reprise du journal local."""

import asyncio
import json
import logging
import pathlib
import re
import shutil
import tempfile
import time

from aiofiles import open as aio_open
from aiohttp import web

from command_journal import filtered_parameters, request_key
from command_journal_web import recorded_command, save_command_event
from operational_logging import log_event, safe_exception_frames
from print_preflight import ensure_firmware_ready, ensure_storage_ready, launch_tracking
from printer_values import safeget
from upload_formats import validate_cloud_model

UPLOAD_LIMIT = 100 * 1024 * 1024
UPLOAD_STAGING = asyncio.Lock()
OPS_LOG = logging.getLogger("cloud_page.server")


async def upload_operation(req, engine, audit, *, storage_upload_operation, command_operation):
    """Inscrit le mode et les paramètres validés avant de solliciter le transport Anycubic."""
    if not engine.printer:
        raise ValueError("Connexion en cours")
    if engine.command_lock.locked() or engine.command_request_lock.locked():
        raise ValueError("Une opération est déjà en cours")
    if UPLOAD_STAGING.locked():
        raise ValueError("Un envoi de fichier est déjà en cours")
    # Le dossier d’état est sur le volume persistant, contrairement au /tmp en mémoire du conteneur.
    async with UPLOAD_STAGING:
        staging_started = time.monotonic()
        with tempfile.TemporaryDirectory(prefix="upload-", dir=engine.state_dir) as directory:
            reader = await req.multipart()
            data = {}
            filename = None
            size = 0
            async for part in reader:
                if part.name == "file":
                    if filename is not None:
                        raise ValueError("Un seul fichier est accepté")
                    filename = pathlib.PurePath(part.filename or "").name
                    extension = pathlib.PurePath(filename).suffix.lower()
                    if extension not in (".gcode", ".stl", ".3mf"):
                        raise ValueError("Choisissez un fichier G-code, STL ou 3MF.")
                    path = pathlib.Path(directory) / ("payload" + extension)
                    async with aio_open(path, "wb") as output:
                        while chunk := await part.read_chunk(256 * 1024):
                            size += len(chunk)
                            if size > UPLOAD_LIMIT:
                                raise ValueError("Fichier limité à 100 Mo")
                            await output.write(chunk)
                elif part.name in ("mode", "request_id", "slots") and part.name not in data:
                    value = bytearray()
                    while chunk := await part.read_chunk(8192):
                        value.extend(chunk)
                        if len(value) > 8192:
                            raise ValueError("Paramètre d’envoi trop long")
                    data[part.name] = value.decode("utf-8")
                else:
                    raise ValueError("Paramètre d’envoi invalide")
            if not size or not filename:
                raise ValueError("Fichier manquant")
            mode = data.get("mode", "upload")
            rid = data.get("request_id", "")
            if not re.fullmatch(r"[a-zA-Z0-9-]{16,80}", rid):
                raise ValueError("Identifiant de commande manquant")
            if mode not in ("upload", "save-print", "temp-print"):
                raise ValueError("Mode invalide")
            if extension != ".gcode":
                if mode != "upload":
                    raise ValueError("Seul un fichier .gcode peut être envoyé à l’impression.")
                await asyncio.to_thread(validate_cloud_model, path, extension, size)
            file_format = extension[1:]
            log_event(
                OPS_LOG,
                logging.DEBUG,
                "upload_staged",
                message="Fichier reçu et contrôlé localement ; aucun transfert Cloud à ce stade",
                action=mode,
                file_format=file_format,
                duration_ms=(time.monotonic() - staging_started) * 1000,
            )
            if audit:
                audit["action"] = mode
                audit["request_id"] = request_key(rid)
                audit["parameters"] = filtered_parameters(mode, {"name": filename})
            if rid in engine.commands:
                audit.clear()
                previous = engine.commands[rid]
                return web.json_response(previous, status=200 if previous["ok"] else 409)
            if (previous := await recorded_command(req, rid)) is not None:
                audit.clear()
                return previous
            operation = (
                storage_upload_operation(req, engine)
                if mode == "upload"
                else command_operation(req)
            )
            async with operation:
                if rid in engine.commands:
                    audit.clear()
                    previous = engine.commands[rid]
                    return web.json_response(previous, status=200 if previous["ok"] else 409)
                if not engine.api:
                    raise ValueError("Connexion en cours")
                if mode != "upload":
                    ensure_firmware_ready(engine.printer)
                    if not engine.printer.is_available:
                        raise ValueError("Imprimante non disponible")
                    requested_slots = json.loads(data.get("slots", "[]"))
                    slots = engine.slots({"slots": requested_slots})
                    if audit:
                        audit["parameters"] = filtered_parameters(
                            mode, {"name": filename, "slots": requested_slots}
                        )
                if mode != "temp-print" and callable(
                    getattr(engine.api, "get_user_cloud_store", None)
                ):
                    store = await engine.api.get_user_cloud_store()
                    ensure_storage_ready(safeget(store, "available_bytes"), size)
                engine.commands[rid] = {
                    "ok": False,
                    "message": "Envoi déjà demandé ; résultat en attente",
                }
                if audit:
                    audit["outcome"] = "inconnue"
                    await save_command_event(req, audit)
                transfer_started = time.monotonic()
                log_event(
                    OPS_LOG,
                    logging.INFO,
                    "upload_started",
                    message="Transfert Cloud engagé après validation ; un résultat inconnu ne déclenche pas de nouvel envoi",
                    action=mode,
                    file_format=file_format,
                )
                try:
                    if mode == "upload":
                        await engine.api.upload_file_to_cloud(
                            full_file_path=str(path), file_name=filename
                        )
                    else:
                        previous_project = engine.command_project_key()
                        func = (
                            engine.printer.print_and_upload_save_in_cloud
                            if mode == "save-print"
                            else engine.printer.print_and_upload_no_cloud_save
                        )
                        response = await func(
                            full_file_path=str(path), file_name=filename, slot_index_list=slots
                        )
                        if not response or not response.order_msg_id:
                            log_event(
                                OPS_LOG,
                                logging.WARNING,
                                "upload_uncertain",
                                message="Demande sans accusé de réception ; vérifiez le Cloud et l’imprimante avant tout nouvel essai",
                                action=mode,
                                file_format=file_format,
                                outcome="missing_ack",
                                duration_ms=(time.monotonic() - transfer_started) * 1000,
                            )
                            return web.json_response(engine.commands[rid], status=409)
                except Exception as error:
                    # Après le transfert ou la demande d’impression, une erreur locale ne prouve aucun refus.
                    log_event(
                        OPS_LOG,
                        logging.WARNING,
                        "upload_uncertain",
                        message="Résultat du transfert ou du lancement non confirmé ; vérifiez les fichiers Cloud et l’imprimante avant tout nouvel essai",
                        action=mode,
                        file_format=file_format,
                        outcome="transport_error",
                        error_type=type(error).__name__,
                        frames=safe_exception_frames(error),
                        duration_ms=round((time.monotonic() - transfer_started) * 1000, 1),
                    )
                    return web.json_response(engine.commands[rid], status=409)
                if getattr(engine, "extras", None):
                    engine.extras.invalidate_task_pages()
                log_event(
                    OPS_LOG,
                    logging.INFO,
                    "upload_accepted",
                    message="Transfert accepté par le Cloud",
                    action=mode,
                    file_format=file_format,
                    duration_ms=round((time.monotonic() - transfer_started) * 1000, 1),
                )
                engine.event("Fichier", "Envoi accepté")
                if audit and audit["outcome"] != "confirmée":
                    audit["outcome"] = "acceptée"
                result = {"ok": True, "message": "Envoi accepté par Anycubic"}
                if mode != "upload" and audit.get("request_id"):
                    result["print_reference"] = audit["request_id"]
                if mode != "upload" and (tracking := launch_tracking(previous_project, response)):
                    result["print_tracking"] = tracking
                engine.commands[rid] = result
                return web.json_response(result)


def purge_abandoned_uploads(state_dir):
    """Retire les répertoires temporaires d’envoi âgés d’au moins 24 h dans les seuls dossiers d’état."""
    if state_dir.is_symlink() or not state_dir.is_dir():
        return
    roots = [state_dir]
    printers = state_dir / "printers"
    if printers.is_dir() and not printers.is_symlink():
        roots.extend(
            path
            for path in printers.iterdir()
            if re.fullmatch(r"[0-9a-f]{20}", path.name) and path.is_dir() and not path.is_symlink()
        )
    cutoff = time.time() - 86400
    for root in roots:
        for path in root.iterdir():
            if not re.fullmatch(r"upload-[a-z0-9_]{8}", path.name) or path.is_symlink():
                continue
            try:
                if not path.is_dir() or path.stat().st_mtime > cutoff:
                    continue
                if any(
                    child.name not in {"payload.gcode", "payload.stl", "payload.3mf"}
                    or child.is_symlink()
                    or not child.is_file()
                    or child.stat().st_mtime > cutoff
                    for child in path.iterdir()
                ):
                    continue
                shutil.rmtree(path)
            except OSError as error:
                logging.getLogger(__name__).warning(
                    "Nettoyage d’un envoi abandonné impossible (%s)", type(error).__name__
                )
