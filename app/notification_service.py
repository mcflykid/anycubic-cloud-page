"""Historique des notifications partagé entre les imprimantes d’un même compte."""

import asyncio
import hashlib
import json
import time
from datetime import datetime, timezone

from anycubic_cloud_api.exceptions.exceptions import AnycubicAPIError
from anycubic_cloud_api.models.http import AnycubicAPIEndpoint, HTTP_METHODS


def history_entry(row):
    """Renvoie une notification affichable avec référence opaque et libellé français."""
    from cloud_extras import diagnostic_text, key as history_task_key

    code = row.get("print_status")
    labels = {2: "Impression terminée", 3: "Impression arrêtée"}
    title = labels.get(code) or {
        "Print complete": "Impression terminée",
        "Print to terminate": "Impression arrêtée",
        "Print failed": "Échec de l’impression",
        "Print to paused": "Impression en pause",
    }.get(row.get("title"), "Notification d’impression")
    reason = next(
        (
            text
            for value in (row.get("reason_desc"), row.get("reason"))
            if (text := diagnostic_text(value))
        ),
        "",
    )
    reason = {
        "User Initiated": "Pause demandée par l’utilisateur",
        "Abnormal consumables, please reload consumables": "Problème de filament. Rechargez le filament.",
    }.get(reason, reason)
    reason_code = diagnostic_text(row.get("reason_id"))
    printer = row.get("printer_id")
    task = next(
        (
            row[field]
            for field in ("task_id", "taskid", "project_id")
            if isinstance(row.get(field), (str, int)) and row[field] not in ("", "0", 0)
        ),
        None,
    )
    group = printer and task and (reason or reason_code)
    task_id = row.get("task_id") or row.get("taskid")
    return {
        "key": hashlib.sha256(str(row.get("id", "")).encode()).hexdigest()[:20],
        "name": str(row.get("project_name") or "Impression sans nom")[:300],
        "printer": str(row.get("printer_name") or "Imprimante")[:100],
        "time": row.get("create_time"),
        "result": title,
        "kind": "success" if code == 2 else "interrupted" if code == 3 else "info",
        "unread": row.get("read") == 0,
        "reason": reason,
        "reason_code": reason_code,
        "task_key": history_task_key(str(printer) + ":" + str(task_id))
        if printer and isinstance(task_id, (int, str)) and task_id not in ("", "0", 0)
        else None,
        "group": hashlib.sha256(
            json.dumps([str(printer), str(task), title, reason, reason_code]).encode()
        ).hexdigest()[:20]
        if group
        else None,
    }


class AccountNotifications:
    """Sérialise les lectures et mutations d’un même historique de compte."""

    def __init__(self):
        """Déclare les caches partagés et leur verrou, indépendamment du transport courant."""
        self.lock = asyncio.Lock()
        self.cache = {}
        self.keys = {}
        self.rows = {}

    async def page(self, api, page, source=None):
        """Renvoie une page du journal choisi, avec repli sur le journal historique à l’ouverture."""
        async with self.lock:
            cache_key = page if source is None else (source, page)
            cached = self.cache.get(cache_key)
            if cached and time.monotonic() - cached[0] < 30:
                return cached[1]
            slicer = None
            if source != "legacy":
                try:
                    slicer = await self._slicer_page(api, page)
                except (AnycubicAPIError, TimeoutError, ValueError):
                    if source == "slicer":
                        raise ValueError(
                            "Le journal du slicer est temporairement indisponible"
                        ) from None
            if slicer is not None and (slicer["items"] or source == "slicer"):
                result = slicer
            else:
                result = await self._legacy_page(api, page)
            result["updated_at"] = datetime.now(timezone.utc).isoformat()
            self.cache[cache_key] = (time.monotonic(), result)
            for entries, limit in ((self.cache, 10), (self.keys, 1000), (self.rows, 1000)):
                while len(entries) > limit:
                    entries.pop(next(iter(entries)))
            return result

    async def _slicer_page(self, api, page):
        # Le mode normal du slicer lit tous les statuts sans modifier leur état.
        response = await api._fetch_api_resp(
            AnycubicAPIEndpoint(HTTP_METHODS.POST, "/farm/message/list"),
            params={
                "page": page,
                "limit": 20,
                "status": -1,
                "aggregate_mode": 0,
                "update_status": 0,
                "keyword": "",
            },
        )
        if (
            not isinstance(response, dict)
            or response.get("code") != 1
            or not isinstance(response.get("data"), list)
        ):
            raise ValueError("Le journal du slicer est temporairement indisponible")
        rows = []
        for item in response["data"][:20]:
            if not isinstance(item, dict) or type(item.get("id")) is not int or item["id"] <= 0:
                continue
            printers = item.get("printer_list")
            printer = printers[0] if isinstance(printers, list) and len(printers) == 1 else None
            printer = printer if isinstance(printer, dict) else {}
            timestamp = item.get("latest_time")
            if type(timestamp) is not int or not 0 < timestamp <= 4102444800:
                timestamp = item.get("created_time")
            raw = {
                "project_name": item.get("task_name"),
                "printer_name": printer.get("name") or item.get("device_type"),
                "printer_id": printer.get("printer_id"),
                "task_id": item.get("task_id"),
                "create_time": timestamp
                if type(timestamp) is int and 0 < timestamp <= 4102444800
                else None,
                "print_status": 2 if item.get("alarm_code") == 200 else None,
                "read": item.get("status"),
                "reason_desc": item.get("reason_desc"),
                "img": item.get("img"),
                "thumbnail": item.get("thumbnail"),
            }
            entry = history_entry(raw)
            # Les deux API ont des identifiants indépendants et les actions historiques ne doivent jamais les résoudre.
            key = hashlib.sha256(f"slicer:{item['id']}".encode()).hexdigest()[:20]
            self.rows[key] = raw
            rows.append({**entry, "key": key})

        if response["data"] and not rows:
            raise ValueError("Le journal du slicer est temporairement indisponible")
        pagination = response.get("pageData")
        total = pagination.get("total") if isinstance(pagination, dict) else None
        unread = None
        if rows or (type(total) is int and total > 0):
            try:
                counts = await api._fetch_api_resp(
                    AnycubicAPIEndpoint(HTTP_METHODS.POST, "/farm/message/statistics"),
                    params={"aggregate_mode": 0},
                )
            except (AnycubicAPIError, TimeoutError, ValueError):
                counts = None
            data = (
                counts.get("data") if isinstance(counts, dict) and counts.get("code") == 1 else None
            )
            if (
                isinstance(data, dict)
                and type(data.get("unread_total")) is int
                and data["unread_total"] >= 0
            ):
                unread = data["unread_total"]
        return {
            "items": rows,
            "page": page,
            "source": "slicer",
            "unread": unread,
            "has_more": page * 20 < total if type(total) is int else len(rows) == 20,
        }

    async def _legacy_page(self, api, page):
        response = await api._fetch_api_resp(
            AnycubicAPIEndpoint(HTTP_METHODS.POST, "/v2/message/getMessages"),
            params={"type": 1, "page": page, "limit": 20},
        )
        if (
            not isinstance(response, dict)
            or response.get("code") != 1
            or not isinstance(response.get("data"), list)
        ):
            raise ValueError("Le journal Anycubic est temporairement indisponible")
        counts = await api._fetch_api_resp(
            AnycubicAPIEndpoint(HTTP_METHODS.POST, "/v2/message/getMessageCount"), params={}
        )
        rows = []
        for raw in response["data"]:
            if not isinstance(raw, dict) or type(raw.get("id")) is not int:
                continue
            entry = history_entry(raw)
            self.keys[entry["key"]] = raw["id"]
            self.rows[entry["key"]] = raw
            rows.append(entry)
        count = next((r for r in counts.get("data") or [] if r.get("type") == 1), {})
        return {
            "items": rows,
            "page": page,
            "source": "legacy",
            "total": int(count.get("count", len(rows))),
            "unread": int(count.get("newcount", 0)),
            "has_more": page * 20 < int(count.get("count", 0)),
        }

    async def mark_read(self, api, key=None, all_items=False):
        """Marque une clé connue ou toutes les notifications ; lève ValueError sans confirmation cloud."""
        async with self.lock:
            if all_items:
                endpoint = "/v2/message/setRead"
                params = {}
            else:
                mid = self.keys.get(str(key))
                if mid is None:
                    raise ValueError(
                        "Actualisez l’historique avant de marquer cette notification comme lue"
                    )
                endpoint = "/v2/message/setReadById"
                params = {"id": mid}
            result = await api._fetch_api_resp(
                AnycubicAPIEndpoint(HTTP_METHODS.POST, endpoint),
                params=params,
                query=params or None,
            )
            if result.get("code") != 1:
                raise ValueError("Anycubic n’a pas confirmé la mise à jour de lecture")
            self.cache = {}
            return {
                "ok": True,
                "message": "Notifications marquées comme lues"
                if all_items
                else "Notification marquée comme lue",
            }

    async def delete(self, api, key=None, all_items=False):
        """Efface une clé connue ou les identifiants collectés ; lève ValueError si la collecte est incomplète."""
        async with self.lock:
            if all_items:
                ids = []
                for page in range(1, 251):
                    result = await api._fetch_api_resp(
                        AnycubicAPIEndpoint(HTTP_METHODS.POST, "/v2/message/getMessages"),
                        params={"type": 1, "page": page, "limit": 20},
                    )
                    if result.get("code") != 1 or not isinstance(result.get("data"), list):
                        raise ValueError(
                            "Lecture de l’historique impossible ; aucun effacement envoyé"
                        )
                    rows = result["data"]
                    ids.extend(
                        r["id"]
                        for r in rows
                        if isinstance(r, dict) and isinstance(r.get("id"), int)
                    )
                    if len(rows) < 20:
                        break
                else:
                    raise ValueError("Trop de notifications pour un effacement unique")
            else:
                mid = self.keys.get(str(key))
                if mid is None:
                    raise ValueError("Actualisez l’historique avant d’effacer cette notification")
                ids = [mid]
            if ids:
                result = await api._fetch_api_resp(
                    AnycubicAPIEndpoint(HTTP_METHODS.POST, "/v2/message/delete"),
                    params={"ids": ids},
                )
                if result.get("code") != 1:
                    raise ValueError("Anycubic n’a pas confirmé l’effacement")
            self.cache = {}
            self.keys = {}
            self.rows = {}
            return {
                "ok": True,
                "message": "Notifications effacées" if all_items else "Notification effacée",
            }
