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
CLOUD_POLL_SECONDS = 60
DRYING_CONFIRM_SECONDS = 30


class Measurements:
    """Conserve un tableau borné des mesures reçues par machine."""

    def __init__(self, clock=time.monotonic, *, cloud_interval=CLOUD_POLL_SECONDS):
        """Prévoit une marge de 30 secondes au-delà du cycle Cloud."""
        self._clock = clock
        self._rows = {}
        self._drying = {}
        self._confirmed = set()
        self._cloud_ttl = cloud_interval + 30

    def _remember(self, key, value, bounds, source, epoch, stamp):
        if type(value) in (int, float) and bounds[0] <= value <= bounds[1]:
            self._rows.setdefault(key, {})[source] = (value, stamp, source, epoch)

    def _boxes(self, rows, source, epoch, stamp, *, drying=True):
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
                self._remember(
                    f"ace:{identifier}:{name}", box.get(field), limits, source, epoch, stamp
                )
            status = box.get("drying_status")
            if drying and isinstance(status, dict):
                self._remember(
                    f"ace:{identifier}:drying", status.get("status"), (0, 1), source, epoch, stamp
                )
                if (
                    source == "mqtt"
                    and type(status.get("status")) is int
                    and status["status"] in (0, 1)
                ):
                    self._confirm_drying(identifier, epoch, status, stamp)

    def cloud(self, data):
        """Enregistre uniquement les champs présents dans le détail Cloud."""
        if not isinstance(data, dict):
            return
        stamp = self._clock()
        parameter = data.get("parameter")
        if isinstance(parameter, dict):
            for key in ("curr_nozzle_temp", "curr_hotbed_temp"):
                self._remember(key, parameter.get(key), PRINTER_FIELDS[key], "cloud", None, stamp)
        self._boxes(data.get("multi_color_box"), "cloud", None, stamp)

    def mqtt(self, report, epoch, received=None):
        """Prend les mesures des types reconnus et ignore les acquittements de séchage."""
        stamp = self._clock() if received is None else received
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
                self._remember(key, value, bounds, "mqtt", epoch, stamp)
        if kind == "multiColorBox":
            if (action, state) == ("autoUpdateInfo", "done"):
                self._boxes(data, "mqtt", epoch, stamp, drying=False)
            elif (action, state) in {("getInfo", "success"), ("autoUpdateDryStatus", "success")}:
                self._boxes(data.get("multi_color_box"), "mqtt", epoch, stamp)

    def start_drying_observation(self, box, epoch, *, temperature=None, minutes=None):
        """Mémorise l’ordre avant son envoi, pour accepter aussi un retour MQTT rapide."""
        identifier = str(box)
        self._confirmed.discard(identifier)
        self._drying[identifier] = (self._clock(), epoch, temperature, minutes)

    def clear_drying_observation(self, box):
        """Retire le suivi si la demande échoue."""
        self._drying.pop(str(box), None)
        self._confirmed.discard(str(box))

    def _confirm_drying(self, identifier, epoch, status, stamp):
        intent = self._drying.get(identifier)
        if not intent or epoch is None:
            return
        sent, sent_epoch, temperature, minutes = intent
        if epoch is not sent_epoch or not 0 < stamp - sent <= DRYING_CONFIRM_SECONDS:
            return
        if status["status"] != (temperature is not None):
            return
        if temperature is not None and (
            status.get("target_temp") != temperature
            or status.get("duration") not in (minutes, minutes * 60)
        ):
            return
        self._confirmed.add(identifier)

    def drying_action(self, box):
        """Indique le sens de la demande pour distinguer démarrage et arrêt."""
        intent = self._drying.get(str(box))
        return ("stop" if intent[2] is None else "start") if intent else None

    def drying_observation(self, box, epoch):
        """Conserve la preuve du rapport concordant jusqu’à expiration ou changement de connexion."""
        identifier = str(box)
        intent = self._drying.get(identifier)
        if not intent:
            return None
        sent, sent_epoch, _, _ = intent
        since = self._clock() - sent
        if since > TTL_SECONDS:
            return None
        if epoch is not sent_epoch:
            return "unconfirmed"
        if identifier in self._confirmed:
            return "confirmed"
        return "unconfirmed" if since > DRYING_CONFIRM_SECONDS else "pending"

    def view(self, key, epoch, *, online=True, displayed=None):
        """Renvoie l’âge de la valeur affichée ; une autre mesure ne peut justifier sa provenance."""
        candidates = [
            (stamp, source, received_epoch)
            for value, stamp, source, received_epoch in self._rows.get(key, {}).values()
            if displayed is None or value == displayed
        ]
        if not candidates:
            return {"state": "missing"}

        def freshness(row):
            stamp, source, received_epoch = row
            ttl = self._cloud_ttl if source == "cloud" else TTL_SECONDS
            return (
                online
                and self._clock() - stamp <= ttl
                and (source == "cloud" or (epoch is not None and received_epoch is epoch))
            )

        stamp, source, received_epoch = max(candidates, key=lambda row: (freshness(row), row[0]))
        age = max(0, self._clock() - stamp)
        return {
            "state": "fresh" if freshness((stamp, source, received_epoch)) else "stale",
            "age_s": int(age),
            "source": source,
        }
