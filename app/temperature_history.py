"""Historique local borné des températures, sans identifiants de compte."""

import collections, json, math, os, pathlib, time

KEYS = ("nozzle", "bed", "ace", "nozzle_target", "bed_target", "ace_target")


class TemperatureHistory:
    """Conserve au plus vingt-quatre heures de températures locales, sans identité de compte."""

    def __init__(self, path="/appdata/state/temperatures.json"):
        """Charge les relevés de path en ignorant les données illisibles ; aucun répertoire n’est créé."""
        self.path = pathlib.Path(path)
        self.rows = collections.deque(maxlen=8640)
        self.saved_at = 0
        try:
            for row in json.loads(self.path.read_text()):
                self.add(row["time"], row)
        except (OSError, ValueError, TypeError, KeyError):
            pass

    def add(self, stamp, values):
        """Ajoute un relevé horodaté en secondes ; renvoie False si périmé, dupliqué ou sans température exploitable."""
        if not isinstance(stamp, (int, float)) or not math.isfinite(stamp):
            return False
        if self.rows and stamp <= self.rows[-1]["time"]:
            return False
        row = {"time": int(stamp)}
        for key in KEYS:
            value = values.get(key)
            row[key] = (
                round(value, 1)
                if isinstance(value, (int, float))
                and not isinstance(value, bool)
                and math.isfinite(value)
                and -30 <= value <= 400
                else None
            )
        if all(row[k] is None for k in ("nozzle", "bed", "ace")):
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
        tmp = self.path.with_suffix(".tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as out:
            json.dump(list(self.rows), out, separators=(",", ":"))
        tmp.replace(self.path)
        self.saved_at = time.monotonic()
