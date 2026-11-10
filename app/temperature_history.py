"""Historique local borné des températures et des relevés ACE."""

import asyncio, collections, hashlib, json, math, os, pathlib, re, threading, time

KEYS = ("nozzle", "bed", "ace", "nozzle_target", "bed_target", "ace_target")
_write_locks = {}
_write_locks_guard = threading.Lock()


def bounded_number(value, minimum, maximum):
    """Garde un nombre fini et borné sans assimiler un booléen à une mesure."""
    if type(value) in (int, float) and minimum <= value <= maximum:
        return round(value, 1)
    return None


def ace_readings(boxes):
    """Projette uniquement les mesures, les emplacements et une empreinte de matériau."""
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
    for box_id, box in boxes.items():
        if not re.fullmatch(r"[0-9]{1,2}", box_id) or not isinstance(box, dict):
            continue
        slots = box.get("slots")
        result[box_id] = {"humidity": bounded_number(box.get("humidity"), 0, 100), "slots": {}}
        if not isinstance(slots, dict):
            continue
        for slot_id, slot in slots.items():
            if not re.fullmatch(r"[1-9][0-9]?", slot_id) or not isinstance(slot, dict):
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
    """Conserve au plus vingt-quatre heures de mesures locales, sans identité de compte."""

    def __init__(self, path="/appdata/state/temperatures.json"):
        """Charge les relevés de path en ignorant les données illisibles ; aucun répertoire n’est créé."""
        self.path = pathlib.Path(path)
        self.rows = collections.deque(maxlen=8640)
        self.saved_at = 0
        self._async_save_lock = asyncio.Lock()
        try:
            for row in json.loads(self.path.read_text()):
                self.add(row["time"], row)
        except (OSError, ValueError, TypeError, KeyError):
            pass

    def add(self, stamp, values):
        """Ajoute un relevé horodaté en secondes ; renvoie False si périmé, dupliqué ou vide."""
        if not isinstance(stamp, (int, float)) or not math.isfinite(stamp):
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
        self.rows.append(row)
        while self.rows and self.rows[0]["time"] < stamp - 86400:
            self.rows.popleft()
        return True

    def recent(self, hours=1, at=None):
        """Renvoie les relevés des hours dernières heures, relativement à at ou à l’heure courante."""
        cutoff = (at if at is not None else time.time()) - hours * 3600
        return [r for r in self.rows if r["time"] >= cutoff]

    def save(self):
        """Persiste les relevés par remplacement atomique ; propage OSError si le stockage n’est pas accessible."""
        self._save_snapshot(list(self.rows))

    def _save_snapshot(self, snapshot):
        """Remplace le fichier depuis un instantané déjà cohérent, sous verrou du chemin."""
        with _write_locks_guard:
            lock = _write_locks.setdefault(str(self.path.resolve()), threading.Lock())
        with lock:
            tmp = self.path.with_suffix(".tmp")
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w") as out:
                json.dump(snapshot, out, separators=(",", ":"))
            tmp.replace(self.path)
        self.saved_at = time.monotonic()

    async def save_async(self):
        """Écrit un instantané hors boucle asyncio pour ne pas bloquer les autres requêtes."""
        async with self._async_save_lock:
            snapshot = list(self.rows)
            await asyncio.to_thread(self._save_snapshot, snapshot)
