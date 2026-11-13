# SPDX-License-Identifier: GPL-3.0-or-later
"""Lecture des fichiers et aperçus locaux, USB et cloud pour une cible donnée."""

import asyncio
import base64
import contextlib
import hashlib
import re
import time
import uuid

from printer_values import filepath, safeget, serial
from cloud_extras import key, number, download_preview
from anycubic_cloud_api.data_models.files import AnycubicCloudFile
from command_journal import dispatch_command


LOCAL_PREVIEW_TTL = 60


def local_preview_key(source, name, path):
    """Renvoie la même clé source/chemin que la lecture pour invalider un fichier supprimé."""
    return source, "/".join(x for x in [filepath(path).strip("/"), str(name)] if x)


def invalidate_local_preview(target, source, name, path):
    """Supprime l’aperçu après l’acquittement de l’effacement par le transport machine."""
    target.preview_cache.pop(local_preview_key(source, name, path), None)


def invalidate_folder_previews(target, source, folder):
    """Invalide les aperçus du dossier lors d’une nouvelle lecture de ses métadonnées."""
    prefix = folder.strip("/")
    prefix = prefix + "/" if prefix else ""
    stale = [key for key in target.preview_cache if key[0] == source and key[1].startswith(prefix)]
    for stale_key in stale:
        target.preview_cache.pop(stale_key, None)


class MQTTReplies:
    """Corrèle les réponses MQTT sur la boucle de la cible, y compris avant l’acquittement HTTP."""

    def __init__(self):
        """Garde les attentes actives et un tampon précoce borné."""
        self.loop = None
        self.opening = 0
        self.pending = {}
        self.early = {}

    def receive(self, payload):
        """Transfère une réponse du fil MQTT sans modifier les attentes depuis ce fil."""
        identifier = payload.get("msgid")
        valid_id = type(identifier) in (int, str) and 0 < len(str(identifier)) <= 128
        if (
            self.loop
            and valid_id
            and isinstance(payload.get("type"), str)
            and isinstance(payload.get("action"), str)
        ):
            with contextlib.suppress(RuntimeError):
                self.loop.call_soon_threadsafe(self._deliver, payload, time.monotonic())

    def _deliver(self, payload, received):
        key = (payload.get("type"), payload.get("action"), str(payload["msgid"]))
        waiter = self.pending.get(key)
        if waiter is not None and not waiter.done():
            waiter.set_result(payload)
        elif self.opening:
            self.early[key] = (received, payload)
            if len(self.early) > 24:
                self.early.pop(next(iter(self.early)))

    async def ask(self, kind, action, send, timeout):
        """Attend la réponse corrélée ; lève ValueError si le Cloud refuse la demande ou si le délai expire."""
        self.loop = asyncio.get_running_loop()
        started = time.monotonic()
        self.opening += 1
        try:
            identifier = await send()
            if type(identifier) not in (int, str) or identifier == "":
                raise ValueError("La consultation n’a pas été acceptée par Anycubic")
            key = (kind, action, str(identifier))
            cached = self.early.pop(key, None)
            if cached and cached[0] >= started:
                return cached[1]
            if key in self.pending:
                raise ValueError("Une consultation identique est déjà en cours")
            waiter = self.pending[key] = self.loop.create_future()
        finally:
            self.opening -= 1
            if not self.opening:
                self.early.clear()
        try:
            return await asyncio.wait_for(waiter, timeout)
        except TimeoutError:
            raise ValueError("L’imprimante n’a pas confirmé cette demande") from None
        finally:
            self.pending.pop(key, None)


async def direct_request(target, kind, action, data):
    """Renvoie la réponse MQTT corrélée ; lève ValueError sans connexion ou sans réponse sous dix secondes."""
    if not target.api or not target.api._mqtt_client or not target.api._mqtt_client.is_connected():
        raise ValueError("La connexion à l’imprimante n’est pas disponible")
    msgid = str(uuid.uuid4())

    async def publish():
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
        return msgid

    return await target.mqtt_replies.ask(kind, action, publish, 10)


async def local_preview(target, source, name, path):
    """Renvoie une image locale en ligne ou None ; lève ValueError si le chemin ou la réponse est invalide."""
    cachekey = local_preview_key(source, name, path)
    filename = cachekey[1]
    if ".." in filename.split("/") or "\x00" in filename:
        raise ValueError("Nom de fichier invalide")
    cached = target.preview_cache.get(cachekey)
    if cached:
        created, image = cached
        if time.monotonic() - created < LOCAL_PREVIEW_TTL:
            target.preview_cache.pop(cachekey)
            target.preview_cache[cachekey] = cached
            return image
        target.preview_cache.pop(cachekey)
    # La consultation native Slicer 1239 reçoit son aperçu par MQTT, pas dans la réponse HTTP.
    from anycubic_cloud_api.data_models.orders import AnycubicProjectOrderRequest

    order = AnycubicProjectOrderRequest(
        order_id=1239,
        printer_id=target.printer.id,
        project_id=0,
        order_data={
            "root": "local" if source == "local" else "udisk",
            "filename": filename,
            "plate_index": 0,
        },
    )
    response = await target.mqtt_replies.ask(
        "file", "fileDetails", lambda: target.api._send_anycubic_order(order), 12
    )
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
                        target.preview_cache[cachekey] = (time.monotonic(), image)
                        while len(target.preview_cache) > 20:
                            target.preview_cache.pop(next(iter(target.preview_cache)))
                        return image
    return None


async def current_preview(target, project_key):
    """Renvoie l’image du projet courant, liée à sa référence ; aucune recherche approchée par nom."""
    printer = target.printer
    project = safeget(printer, "latest_project")
    if not project_key or project is None or target.command_project_key() != project_key:
        return {"image": None}
    image = await download_preview(target.session, safeget(printer, "latest_project_image_url"))
    if printer is not target.printer or target.command_project_key() != project_key:
        return {"image": None}
    if image is None:
        task_id = safeget(project, "_taskid")
        if task_id not in (None, "", 0, "0"):
            result = await target.extras.preview_row(
                "active:" + project_key,
                {"taskid": task_id, "id": safeget(project, "id"), "printer_id": printer.id},
            )
            image = result.get("image")
            if printer is not target.printer or target.command_project_key() != project_key:
                return {"image": None}
    if image is None:
        source = safeget(project, "_source")
        filename = safeget(project, "preview_filename")
        if source in ("local", "udisk", "usb") and isinstance(filename, str) and filename:
            with contextlib.suppress(ValueError):
                image = await target.local_preview(
                    "local" if source == "local" else "usb", filename, "/"
                )
    if printer is not target.printer or target.command_project_key() != project_key:
        return {"image": None}
    return {"image": image}


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
        response = await target.mqtt_replies.ask(
            "file",
            "listLocal" if source == "local" else "listUdisk",
            lambda: method(p, file_path=wire),
            12,
        )
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
    invalidate_folder_previews(target, source, canonical)
    rows = p.local_file_list_object if source == "local" else p.udisk_file_list_object
    return {"files": rows, "path": canonical}


async def cloud_files(target, page, folder=None):
    """Renvoie une page de fichiers et le quota, avec références opaques pour les actions ultérieures."""
    folder_result = {}
    if folder is None:
        files = await target.api.get_user_cloud_files(page=page, limit=20)
        count = len(files or [])
    else:
        files, count, folder_result = await folder_files(target, page, folder)
    rows = []
    for f in files or []:
        handle = hashlib.sha256(str(f.id).encode()).hexdigest()[:20]
        # La liste native possède ses propres références, réservées au déplacement.
        if folder is None:
            target.cloudfiles[handle] = f
        details = {}
        for name, attribute, upper in (
            ("seconds", "_estimate", 30 * 86400),
            ("layer_mm", "_layer_height", 10),
            ("x", "_size_x", 2000),
            ("y", "_size_y", 2000),
            ("z", "_size_z", 2000),
        ):
            raw = safeget(f, attribute)
            value = number(raw) if not isinstance(raw, bool) else None
            if value is not None and 0 < value <= upper:
                details[name] = value
        material = safeget(f, "_material_name")
        from filament_catalog import recognized_material

        material = recognized_material(material, safeget(target, "printer.machine_name"))
        if material is not None:
            details["material"] = material
        params = safeget(f, "_slice_param")
        paints = params.get("paint_infos") if isinstance(params, dict) else None
        if (
            isinstance(paints, list)
            and 1 <= len(paints) <= 16
            and all(isinstance(row, dict) for row in paints)
        ):
            details["colors"] = len(paints)
            filaments = []
            for paint in paints:
                family = recognized_material(
                    paint.get("material_type"), safeget(target, "printer.machine_name")
                )
                color = paint.get("color")
                rgb = (
                    [int(color[index : index + 2], 16) for index in (1, 3, 5)]
                    if isinstance(color, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", color)
                    else None
                )
                grams = number(paint.get("filament_used"))
                filaments.append(
                    {
                        "material": family or "",
                        "color": rgb,
                        "grams": grams if grams is not None and 0 <= grams <= 100_000 else None,
                    }
                )
            if any(row["material"] or row["color"] for row in filaments):
                details["filaments"] = filaments
        rows.append(
            {
                "handle": handle,
                "name": f.old_filename,
                "size_mb": f.size_mb,
                "printable": f.gcode_id is not None and f.gcode_id > 0,
                **({"details": details} if details else {}),
            }
        )
    store = await target.api.get_user_cloud_store()
    return {
        "files": rows,
        "page": page,
        "has_more": count == 20,
        **folder_result,
        "store": {
            k: serial(safeget(store, k)) for k in ["total_bytes", "used_bytes", "available_bytes"]
        },
    }


async def folder_files(target, page, reference):
    """Liste le dossier natif et conserve les références nécessaires à un déplacement confirmé."""
    extras = target.extras
    api = target.api
    extras.folder_selection = None
    response = await extras.api(
        "/v5/cloud-file/folder/list", query={"parent_folder_id": "0", "all": "true"}, method="GET"
    )
    if not isinstance(response, list) or len(response) > 1000:
        raise ValueError("Arborescence Cloud indisponible")
    folders = {0: ("root", "/")}
    children = {}
    for row in response:
        if not isinstance(row, dict):
            continue
        identifier, parent, name = row.get("id"), row.get("parent_folder_id"), row.get("name")
        if (
            type(identifier) is int
            and 0 < identifier <= 2**31 - 1
            and type(parent) is int
            and 0 <= parent <= 2**31 - 1
            and isinstance(name, str)
            and re.fullmatch(r"[^/\\\x00-\x1f]{1,100}", name)
            and name.strip() not in ("", ".", "..")
        ):
            children.setdefault(parent, []).append((identifier, name))
    queue = [(0, 0)]
    for parent, depth in queue:
        for identifier, name in children.get(parent, ()):
            if identifier in folders or depth >= 20:
                continue
            path = folders[parent][1].rstrip("/") + "/" + name
            folders[identifier] = (key(f"folder:{identifier}"), path)
            queue.append((identifier, depth + 1))
    by_ref = {ref: (identifier, path) for identifier, (ref, path) in folders.items()}
    if reference not in by_ref:
        raise ValueError("Dossier Cloud introuvable. Actualisez l’arborescence.")
    source, _ = by_ref[reference]
    records = await extras.api(
        "/work/index/userFiles",
        {
            "page": page,
            "limit": 20,
            "file_type": 0,
            "orderby": 1,
            "machine_type": 0,
            "folder_id": source,
            "filename": "",
            "file_extension_type": 0,
        },
    )
    if target.api is not api or not isinstance(records, list) or len(records) > 20:
        raise ValueError("Liste du dossier Cloud indisponible")
    files = []
    for row in records:
        if (
            not isinstance(row, dict)
            or type(row.get("id")) is not int
            or not 0 < row["id"] <= 2**31 - 1
            or type(row.get("folder_id")) is not int
            or row["folder_id"] != source
            or type(row.get("is_folder")) not in (bool, int)
            or row["is_folder"] != 0
            or not isinstance(row.get("old_filename"), str)
            or not row["old_filename"]
        ):
            continue
        with contextlib.suppress(ValueError, TypeError, OverflowError):
            files.append(AnycubicCloudFile.from_json(row))
    extras.folder_selection = (
        api,
        time.monotonic() + 300,
        reference,
        by_ref,
        {key(file.id): file.id for file in files},
    )
    return (
        files,
        len(records),
        {"folders": [{"reference": ref, "path": path} for ref, (_, path) in by_ref.items()]},
    )


async def move_cloud_files(target, data):
    """Déplace une sélection de la dernière page consultée vers un dossier connu du même compte."""
    selection = target.extras.folder_selection
    source, destination, handles = data.get("source"), data.get("destination"), data.get("handles")
    if (
        not selection
        or selection[0] is not target.api
        or selection[1] <= time.monotonic()
        or source != selection[2]
        or not isinstance(destination, str)
        or destination in ("root", source)
        or destination not in selection[3]
        or not isinstance(handles, list)
        or not 1 <= len(handles) <= 20
        or any(not isinstance(handle, str) or handle not in selection[4] for handle in handles)
        or len(set(handles)) != len(handles)
    ):
        raise ValueError("Sélection ou dossier périmé. Actualisez les fichiers Cloud.")
    target.extras.folder_selection = None
    await dispatch_command(
        target.extras.api(
            "/v5/cloud-file/item/move",
            {
                "target_folder_id": selection[3][destination][0],
                "file_ids": [selection[4][handle] for handle in handles],
                "folder_ids": [],
            },
        )
    )
    return "Fichiers déplacés dans le Cloud"
