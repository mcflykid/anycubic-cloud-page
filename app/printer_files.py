# SPDX-License-Identifier: GPL-3.0-or-later
"""Lecture des fichiers et aperçus locaux, USB et cloud pour une cible donnée."""

import asyncio
import base64
import contextlib
import hashlib
import time
import uuid

from printer_values import filepath, safeget, serial


async def direct_request(target, kind, action, data):
    """Renvoie la réponse MQTT corrélée ; lève ValueError sans connexion ou sans réponse sous dix secondes."""
    if not target.api or not target.api._mqtt_client or not target.api._mqtt_client.is_connected():
        raise ValueError("La connexion à l’imprimante n’est pas disponible")
    msgid = str(uuid.uuid4())
    target.api._mqtt_publish_to_printer(
        target.printer,
        kind,
        {
            "type": kind,
            "action": action,
            "timestamp": int(time.time() * 1000),
            "msgid": msgid,
            "data": data,
        },
    )
    deadline = time.monotonic() + 10
    while msgid not in target.file_messages:
        if time.monotonic() > deadline:
            raise ValueError("L’imprimante n’a pas confirmé cette demande")
        await asyncio.sleep(0.1)
    return target.file_messages.pop(msgid)


async def local_preview(target, source, name, path):
    """Renvoie une image locale en ligne ou None ; lève ValueError si le chemin ou la réponse est invalide."""
    filename = "/".join(x for x in [filepath(path).strip("/"), str(name)] if x)
    if ".." in filename.split("/") or "\x00" in filename:
        raise ValueError("Nom de fichier invalide")
    cachekey = (source, filename)
    if cachekey in target.preview_cache:
        return target.preview_cache[cachekey]
    # La consultation native Slicer 1239 reçoit son aperçu par MQTT, pas dans la réponse HTTP.
    from anycubic_cloud_api.data_models.orders import AnycubicProjectOrderRequest

    msgid = await target.api._send_anycubic_order(
        AnycubicProjectOrderRequest(
            order_id=1239,
            printer_id=target.printer.id,
            project_id=0,
            order_data={
                "root": "local" if source == "local" else "udisk",
                "filename": filename,
                "plate_index": 0,
            },
        )
    )
    deadline = time.monotonic() + 12
    while str(msgid) not in target.file_messages:
        if time.monotonic() > deadline:
            raise ValueError("L’imprimante n’a pas répondu à la demande d’aperçu")
        await asyncio.sleep(0.1)
    response = target.file_messages.pop(str(msgid))
    data = response.get("data") or {}
    if isinstance(data, dict) and isinstance(data.get("file_details"), dict):
        data = data["file_details"]
    if isinstance(data, dict):
        for key in ["png_image", "thumbnail"]:
            encoded = data.get(key)
            if isinstance(encoded, str) and len(encoded) < 4 * 1024 * 1024:
                with contextlib.suppress(Exception):
                    raw = base64.b64decode(encoded, validate=True)
                    if raw.startswith(b"\x89PNG\r\n\x1a\n") or raw.startswith(b"\xff\xd8"):
                        image = (
                            "data:"
                            + ("image/png" if raw.startswith(b"\x89PNG") else "image/jpeg")
                            + ";base64,"
                            + encoded
                        )
                        target.preview_cache[cachekey] = image
                        while len(target.preview_cache) > 20:
                            target.preview_cache.pop(next(iter(target.preview_cache)))
                        return image
    return None


async def read_files(target, source, path):
    """Renvoie fichiers et chemin de local ou usb ; lève ValueError si la consultation n’est pas confirmée."""
    p = target.printer
    if not p or not target.api:
        raise ValueError("Connexion à l’imprimante en cours")
    if not (target.api._mqtt_client and target.api._mqtt_client.is_connected()):
        raise ValueError(
            "La connexion à l’imprimante se rétablit. Réessayez dans quelques secondes."
        )
    canonical = filepath(path)

    async def fetch_records(folder):
        """Corrèle la réponse au dossier demandé, le firmware pouvant omettre son chemin."""
        wire = folder.strip("/") or "/"
        setattr(
            p,
            "_pending_" + ("local" if source == "local" else "udisk") + "_file_list_path",
            folder,
        )
        method = (
            target.api._send_order_list_local_files
            if source == "local"
            else target.api._send_order_list_udisk_files
        )
        msgid = await method(p, file_path=wire)
        deadline = time.monotonic() + 12
        while str(msgid) not in target.file_messages:
            if time.monotonic() > deadline:
                raise ValueError(
                    "L’imprimante n’a pas répondu à la demande de fichiers. Réessayez."
                )
            await asyncio.sleep(0.1)
        response = target.file_messages.pop(str(msgid))
        if response.get("state") != "done":
            raise ValueError("Ce dossier n’est pas accessible sur l’imprimante")
        data = response.get("data") or {}
        return data.get("records") or []

    records = await fetch_records(canonical)
    if source == "local" and canonical == "/" and p.machine_name == "Anycubic Kobra S1":
        # Le firmware S1 omet les modèles usine de la liste racine ; vérifier leur dossier avant de l’ajouter.
        cached = target.dir_cache.get("test_model")
        if not cached or time.time() - cached[0] > 300:
            try:
                factory = await fetch_records("/test_model")
                target.dir_cache["test_model"] = (time.time(), bool(factory))
            except ValueError:
                target.dir_cache["test_model"] = (time.time(), False)
        if target.dir_cache.get("test_model", (0, False))[1] and not any(
            r.get("filename") == "test_model" for r in records
        ):
            records = [
                {"filename": "test_model", "is_dir": True, "timestamp": 0, "size": 0},
                *records,
            ]
    setter = p._set_local_file_list if source == "local" else p._set_udisk_file_list
    setter(records, file_path=canonical)
    rows = p.local_file_list_object if source == "local" else p.udisk_file_list_object
    return {"files": rows, "path": canonical}


async def cloud_files(target, page):
    """Renvoie une page de fichiers et le quota, avec références opaques pour les actions ultérieures."""
    files = await target.api.get_user_cloud_files(page=page, limit=20)
    rows = []
    for f in files or []:
        handle = hashlib.sha256(str(f.id).encode()).hexdigest()[:20]
        target.cloudfiles[handle] = f
        rows.append(
            {
                "handle": handle,
                "name": f.old_filename,
                "size_mb": f.size_mb,
                "printable": f.gcode_id is not None,
            }
        )
    store = await target.api.get_user_cloud_store()
    return {
        "files": rows,
        "page": page,
        "has_more": len(rows) == 20,
        "store": {
            k: serial(safeget(store, k)) for k in ["total_bytes", "used_bytes", "available_bytes"]
        },
    }
