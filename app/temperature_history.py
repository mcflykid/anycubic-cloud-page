"""Historique local borné des températures et des relevés ACE."""

import asyncio
import collections
import csv
import hashlib
import io
import json
import math
import os
import pathlib
import re
import threading
import time

KEYS = ("nozzle", "bed", "ace", "nozzle_target", "bed_target", "ace_target")
RAW_MAX_ROWS = 8640
ROLLUP_MAX_HOURS = 30 * 24
MAX_STORAGE_BYTES = 16_000_000
RAW_RETENTION_SECONDS = 24 * 3600
ROLLUP_RETENTION_SECONDS = ROLLUP_MAX_HOURS * 3600
_write_locks = {}
_write_locks_guard = threading.Lock()


def bounded_number(value, minimum, maximum):
    """Garde un nombre fini et borné sans assimiler un booléen à une mesure."""
    if type(value) in (int, float) and math.isfinite(value) and minimum <= value <= maximum:
        return round(value, 1)
    return None


def ace_readings(boxes):
    """Projette les mesures ACE sans conserver les noms de matériaux."""
    return {
        str(box["box_id"]): {
            "humidity": box.get("humidity"),
            "slots": {
                str(slot["local_slot"]): {
                    "remaining": slot.get("remaining_percent"),
                    "material": hashlib.sha256(
                        json.dumps([slot.get("material_type"), slot.get("color")]).encode()
                    ).hexdigest()[:16],
                }
                for slot in box.get("spools") or []
                if slot.get("local_slot") is not None
            },
        }
        for box in boxes
        if box.get("box_id") is not None
    }


def normalize_ace_readings(boxes):
    """Valide les relevés ACE, y compris ceux relus depuis un fichier d’état."""
    result = {}
    if not isinstance(boxes, dict):
        return result
    for box_id, box in boxes.items():
        if (
            not isinstance(box_id, str)
            or not re.fullmatch(r"[0-9]{1,2}", box_id)
            or not isinstance(box, dict)
        ):
            continue
        slots = box.get("slots")
        result[box_id] = {"humidity": bounded_number(box.get("humidity"), 0, 100), "slots": {}}
        if not isinstance(slots, dict):
            continue
        for slot_id, slot in slots.items():
            if (
                not isinstance(slot_id, str)
                or not re.fullmatch(r"[1-9][0-9]?", slot_id)
                or not isinstance(slot, dict)
            ):
                continue
            material = slot.get("material")
            result[box_id]["slots"][slot_id] = {
                "remaining": bounded_number(slot.get("remaining"), 0, 100),
                "material": material
                if isinstance(material, str) and re.fullmatch(r"[a-f0-9]{16}", material)
                else None,
            }
    return result


class TemperatureHistory:
    """Conserve des points sur 24 h et des moyennes horaires sur 30 jours."""

    RAW_MAX_ROWS = RAW_MAX_ROWS
    ROLLUP_MAX_HOURS = ROLLUP_MAX_HOURS
    MAX_STORAGE_BYTES = MAX_STORAGE_BYTES

    def __init__(self, path="/appdata/state/temperatures.json"):
        """Charge le format historique ou v2, sans créer de répertoire."""
        self.path = pathlib.Path(path)
        self.rows = collections.deque(maxlen=RAW_MAX_ROWS)
        self._hourly = {}
        self.saved_at = 0
        self._async_save_lock = asyncio.Lock()
        self._generation = 0
        try:
            payload = json.loads(self.path.read_text())
            if isinstance(payload, list):
                for row in payload:
                    self._load_raw(row)
            elif isinstance(payload, dict) and payload.get("version") == 2:
                for row in payload.get("raw", []):
                    if isinstance(row, dict):
                        self.add(row.get("time"), row, aggregate=False)
                self._load_rollups(payload.get("hourly", []))
            self._prune(time.time())
        except (OSError, ValueError, TypeError, KeyError):
            pass

    def _load_raw(self, row):
        if isinstance(row, dict):
            self.add(row.get("time"), row, aggregate=True)

    def _load_rollups(self, rows):
        for row in rows if isinstance(rows, list) else []:
            if not isinstance(row, dict) or not isinstance(row.get("time"), int):
                continue
            bucket = row["time"]
            if bucket % 3600:
                continue
            metrics = row.get("metrics")
            if not isinstance(metrics, dict):
                continue
            target = self._hourly.setdefault(bucket, {})
            source_counts = row.get("source_counts")
            if isinstance(source_counts, dict):
                for source, count in source_counts.items():
                    if (
                        source in ("cloud", "mqtt")
                        and type(count) is int
                        and 0 < count <= RAW_MAX_ROWS
                    ):
                        target.setdefault("__source_counts", {}).setdefault(source, 0)
                        target["__source_counts"][source] += count
            for key in KEYS:
                value = metrics.get(key)
                if isinstance(value, dict):
                    self._merge_metric(target, key, value.get("average"), value.get("count"))
            boxes = metrics.get("ace_boxes")
            if isinstance(boxes, dict):
                for box_id, box in boxes.items():
                    if (
                        not isinstance(box_id, str)
                        or not re.fullmatch(r"[0-9]{1,2}", box_id)
                        or not isinstance(box, dict)
                    ):
                        continue
                    humidity = box.get("humidity")
                    if isinstance(humidity, dict):
                        self._merge_metric(
                            target,
                            f"ace:{box_id}:humidity",
                            humidity.get("average"),
                            humidity.get("count"),
                        )
                    slots = box.get("slots")
                    if not isinstance(slots, dict):
                        continue
                    for slot_id, slot in slots.items():
                        if (
                            not isinstance(slot_id, str)
                            or not re.fullmatch(r"[1-9][0-9]?", slot_id)
                            or not isinstance(slot, dict)
                        ):
                            continue
                        remaining = slot.get("remaining")
                        if isinstance(remaining, dict):
                            self._merge_metric(
                                target,
                                f"ace:{box_id}:slot:{slot_id}:remaining",
                                remaining.get("average"),
                                remaining.get("count"),
                            )

    @staticmethod
    def _merge_metric(target, key, value, count=1):
        value = bounded_number(value, -30, 400)
        if value is None or type(count) is not int or count < 1 or count > RAW_MAX_ROWS:
            return
        item = target.setdefault(key, [0.0, 0])
        item[0] += value * count
        item[1] += count

    def add(self, stamp, values, aggregate=True):
        """Ajoute un relevé ; renvoie False si son horodatage ou son contenu est invalide."""
        if (
            type(stamp) not in (int, float)
            or not math.isfinite(stamp)
            or stamp > time.time() + 120
            or not isinstance(values, dict)
        ):
            return False
        if self.rows and stamp <= self.rows[-1]["time"]:
            return False
        row = {"time": int(stamp)}
        for key in KEYS:
            row[key] = bounded_number(values.get(key), -30, 400)
        boxes = values.get("ace_boxes")
        if isinstance(boxes, dict):
            row["ace_boxes"] = normalize_ace_readings(boxes)
        if "ace_boxes" not in row and all(row[k] is None for k in ("nozzle", "bed", "ace")):
            return False
        source = values.get("source")
        if source in ("cloud", "mqtt"):
            row["source"] = source
        if aggregate:
            bucket = row["time"] // 3600 * 3600
            target = self._hourly.setdefault(bucket, {})
            if "source" in row:
                target.setdefault("__source_counts", {}).setdefault(row["source"], 0)
                target["__source_counts"][row["source"]] += 1
            for key in KEYS:
                self._merge_metric(target, key, row[key])
            for box_id, box in row.get("ace_boxes", {}).items():
                self._merge_metric(target, f"ace:{box_id}:humidity", box["humidity"])
                for slot_id, slot in box["slots"].items():
                    self._merge_metric(
                        target, f"ace:{box_id}:slot:{slot_id}:remaining", slot["remaining"]
                    )
        self.rows.append(row)
        self._prune(stamp)
        return True

    def _prune(self, now):
        while self.rows and self.rows[0]["time"] < now - RAW_RETENTION_SECONDS:
            self.rows.popleft()
        cutoff = int(now // 3600) * 3600 - (ROLLUP_MAX_HOURS - 1) * 3600
        self._hourly = {stamp: values for stamp, values in self._hourly.items() if stamp >= cutoff}

    def resolution_seconds(self, hours=1):
        """Renvoie la résolution effective des courbes pour la période demandée."""
        return 10 if hours <= 24 else 3600

    def recent(self, hours=1, at=None):
        """Renvoie les points bruts ou les moyennes horaires correspondant à la fenêtre."""
        at = at if at is not None else time.time()
        cutoff = at - hours * 3600
        if hours <= 24:
            return [dict(row) for row in self.rows if row["time"] >= cutoff]
        rows = []
        for stamp, metrics in sorted(self._hourly.items()):
            if stamp + 3600 <= cutoff or stamp > at:
                continue
            row = {"time": stamp}
            sources = metrics.get("__source_counts", {})
            row["source"] = (
                next(iter(sources)) if len(sources) == 1 else ("mixed" if sources else None)
            )
            for key in KEYS:
                row[key] = self._average(metrics.get(key))
            boxes = {}
            for metric, pair in metrics.items():
                match = re.fullmatch(
                    r"ace:([0-9]{1,2}):(humidity|slot:([1-9][0-9]?):remaining)", metric
                )
                if not match:
                    continue
                box_id = match.group(1)
                box = boxes.setdefault(box_id, {"humidity": None, "slots": {}})
                if match.group(2) == "humidity":
                    box["humidity"] = self._average(pair)
                else:
                    box["slots"].setdefault(match.group(3), {})["remaining"] = self._average(pair)
            if boxes:
                row["ace_boxes"] = boxes
            rows.append(row)
        return rows

    @staticmethod
    def _average(pair):
        return round(pair[0] / pair[1], 1) if pair and pair[1] else None

    def _payload(self):
        hourly = []
        for stamp, values in sorted(self._hourly.items()):
            metrics = {
                key: {
                    "average": self._average(values.get(key)),
                    "count": values.get(key, [0, 0])[1],
                }
                for key in KEYS
            }
            boxes = {}
            for metric, pair in values.items():
                match = re.fullmatch(
                    r"ace:([0-9]{1,2}):(humidity|slot:([1-9][0-9]?):remaining)", metric
                )
                if not match:
                    continue
                box = boxes.setdefault(
                    match.group(1), {"humidity": {"average": None, "count": 0}, "slots": {}}
                )
                item = {"average": self._average(pair), "count": pair[1]}
                if match.group(2) == "humidity":
                    box["humidity"] = item
                else:
                    box["slots"][match.group(3)] = {"remaining": item}
            if boxes:
                metrics["ace_boxes"] = boxes
            hourly.append(
                {
                    "time": stamp,
                    "source_counts": values.get("__source_counts", {}),
                    "metrics": metrics,
                }
            )
        return {"version": 2, "raw": list(self.rows), "hourly": hourly}

    def export_csv(self, hours=1, at=None):
        """Produit un CSV UTF-8 générique fidèle à la fenêtre affichée."""
        rows = self.recent(hours, at)
        fields = ["time_utc", "resolution_seconds", "source", *[f"{key}_c" for key in KEYS]]
        for box_id in sorted({box for row in rows for box in row.get("ace_boxes", {})}, key=int):
            fields.append(f"ace_box_{box_id}_humidity_pct")
            slots = sorted(
                {
                    slot
                    for row in rows
                    for slot in row.get("ace_boxes", {}).get(box_id, {}).get("slots", {})
                },
                key=int,
            )
            fields.extend(f"ace_box_{box_id}_slot_{slot}_remaining_pct" for slot in slots)
        out = io.StringIO(newline="")
        writer = csv.DictWriter(out, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            record = {
                "time_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(row["time"])),
                "resolution_seconds": self.resolution_seconds(hours),
                "source": row.get("source") or "",
            }
            record.update(
                {f"{key}_c": "" if row.get(key) is None else f"{row[key]:.1f}" for key in KEYS}
            )
            for box_id, box in row.get("ace_boxes", {}).items():
                record[f"ace_box_{box_id}_humidity_pct"] = (
                    "" if box.get("humidity") is None else f"{box['humidity']:.1f}"
                )
                for slot_id, slot in box.get("slots", {}).items():
                    value = slot.get("remaining")
                    record[f"ace_box_{box_id}_slot_{slot_id}_remaining_pct"] = (
                        "" if value is None else f"{value:.1f}"
                    )
            writer.writerow(record)
        return out.getvalue()

    def clear(self):
        """Efface explicitement les données brutes, agrégées et leur fichier local."""
        self.rows.clear()
        self._hourly.clear()
        self._generation += 1
        with _write_locks_guard:
            lock = _write_locks.setdefault(str(self.path.resolve()), threading.Lock())
        with lock:
            self._unlink_file()

    async def clear_async(self):
        """Sérialise l’effacement avec les sauvegardes asynchrones de cette instance."""
        async with self._async_save_lock:
            await asyncio.to_thread(self.clear)

    def _unlink_file(self):
        try:
            self.path.unlink()
        except FileNotFoundError:
            pass

    def save(self):
        """Persiste atomiquement le format v2 ; propage les erreurs de stockage."""
        self._save_snapshot(self._payload(), self._generation)

    def _save_snapshot(self, payload, generation=None):
        """Remplace le fichier depuis un instantané cohérent, sous verrou du chemin."""
        with _write_locks_guard:
            lock = _write_locks.setdefault(str(self.path.resolve()), threading.Lock())
        with lock:
            if generation is not None and generation != self._generation:
                return
            encoded = json.dumps(payload, separators=(",", ":"))
            if len(encoded.encode()) > MAX_STORAGE_BYTES:
                raise OSError("historique thermique au plafond de stockage")
            tmp = self.path.with_suffix(".tmp")
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w") as out:
                out.write(encoded)
            tmp.replace(self.path)
        self.saved_at = time.monotonic()

    async def save_async(self):
        """Sérialise les sauvegardes, capture l’instantané sur la boucle puis écrit en fil."""
        async with self._async_save_lock:
            payload = self._payload()
            generation = self._generation
            await asyncio.to_thread(self._save_snapshot, payload, generation)
