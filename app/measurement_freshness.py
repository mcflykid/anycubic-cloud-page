"""Conserve la provenance des mesures sans rafraîchir celles omises d’un rapport."""

import time


PRINTER_FIELDS = {
    "curr_nozzle_temp": (-40, 500),
    "curr_hotbed_temp": (-40, 200),
    "target_nozzle_temp": (0, 500),
    "target_hotbed_temp": (0, 200),
    "fan_speed_pct": (0, 100),
    "aux_fan_speed_pct": (0, 100),
    "box_fan_level": (0, 100),
}
TTL_SECONDS = 120


class Measurements:
    """Conserve un tableau borné des mesures reçues par machine."""

    def __init__(self, clock=time.monotonic):
        self._clock = clock
        self._rows = {}
        self._drying = {}
        self._drying_reports = {}

    def _remember(self, key, value, bounds, source, epoch):
        if type(value) in (int, float) and bounds[0] <= value <= bounds[1]:
            self._rows[key] = (value, self._clock(), source, epoch)

    def _boxes(self, rows, source, epoch, *, drying=True):
        if isinstance(rows, dict):
            rows = [rows]
        if not isinstance(rows, list):
            return
        by_id, duplicates = {}, set()
        for box in rows:
            if not isinstance(box, dict):
                continue
            identifier = str(box.get("id", ""))
            if identifier in by_id:
                duplicates.add(identifier)
            if identifier in {"0", "1", "2", "3"}:
                by_id[identifier] = box
        for identifier, box in by_id.items():
            # Un identifiant répété rend le rapport impropre à une confirmation.
            if identifier in duplicates:
                continue
            for field, name, limits in (
                ("temp", "temperature", (-40, 150)),
                ("humidity", "humidity", (0, 100)),
            ):
                self._remember(f"ace:{identifier}:{name}", box.get(field), limits, source, epoch)
            status = box.get("drying_status")
            if drying and isinstance(status, dict):
                self._remember(
                    f"ace:{identifier}:drying", status.get("status"), (0, 1), source, epoch
                )
                if (
                    source == "mqtt"
                    and type(status.get("status")) is int
                    and status["status"] in (0, 1)
                ):
                    self._drying_reports[identifier] = (self._clock(), epoch, status.copy())

    def cloud(self, data):
        """Enregistre uniquement les champs présents dans le détail Cloud."""
        if not isinstance(data, dict):
            return
        parameter = data.get("parameter")
        if isinstance(parameter, dict):
            for key in ("curr_nozzle_temp", "curr_hotbed_temp"):
                self._remember(key, parameter.get(key), PRINTER_FIELDS[key], "cloud", None)
        self._boxes(data.get("multi_color_box"), "cloud", None)

    def mqtt(self, report, epoch):
        """Prend les mesures des types reconnus et ignore les acquittements de séchage."""
        data = report.get("data")
        if not isinstance(data, dict):
            return
        kind, action, state = (report.get(k) for k in ("type", "action", "state"))
        if (kind, action, state) in {
            ("tempature", "auto", "done"),
            ("print", "update", "updated"),
            ("print", "start", "updated"),
            ("fan", "auto", "done"),
            ("fan", "query", "done"),
        }:
            for key, bounds in PRINTER_FIELDS.items():
                settings = data.get("settings") if kind == "print" else None
                value = (
                    settings.get(key, data.get(key))
                    if isinstance(settings, dict)
                    else data.get(key)
                )
                self._remember(key, value, bounds, "mqtt", epoch)
        if kind == "multiColorBox":
            if (action, state) == ("autoUpdateInfo", "done"):
                self._boxes(data, "mqtt", epoch, drying=False)
            elif (action, state) in {("getInfo", "success"), ("autoUpdateDryStatus", "success")}:
                self._boxes(data.get("multi_color_box"), "mqtt", epoch)

    def start_drying_observation(self, box, epoch, *, temperature=None, minutes=None):
        """Mémorise l’ordre avant son envoi, pour accepter aussi un retour MQTT rapide."""
        self._drying[str(box)] = (self._clock(), epoch, temperature, minutes)

    def clear_drying_observation(self, box):
        """Retire le suivi si l’ordre a été explicitement refusé."""
        self._drying.pop(str(box), None)

    def drying_observation(self, box, epoch):
        """Confirme exclusivement un relevé spontané du même module et de la même connexion."""
        identifier = str(box)
        intent = self._drying.get(identifier)
        if not intent:
            return None
        sent, sent_epoch, temperature, minutes = intent
        since = self._clock() - sent
        report = self._drying_reports.get(identifier)
        if (
            report
            and epoch is not None
            and epoch is sent_epoch is report[1]
            and 0 < report[0] - sent <= 30
        ):
            row = report[2]
            matches = row["status"] == (temperature is not None)
            if temperature is not None:
                matches = (
                    matches
                    and row.get("target_temp") == temperature
                    and row.get("duration") in (minutes, minutes * 60)
                )
            if matches and since <= TTL_SECONDS:
                return "confirmed"
        if epoch is not sent_epoch or since > 30:
            return "unconfirmed" if since <= TTL_SECONDS else None
        return "pending"

    def view(self, key, epoch, *, online=True, displayed=None):
        """Renvoie l’âge et la provenance du relevé courant, jamais une référence privée."""
        row = self._rows.get(key)
        if row is None:
            return {"state": "missing"}
        value, stamp, source, received_epoch = row
        age = max(0, self._clock() - stamp)
        current = (
            online
            and age <= TTL_SECONDS
            and (source == "cloud" or received_epoch == epoch)
            and (displayed is None or value == displayed)
        )
        return {"state": "fresh" if current else "stale", "age_s": int(age), "source": source}
