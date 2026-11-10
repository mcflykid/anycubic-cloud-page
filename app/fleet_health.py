"""Résumés de parc et transitions de connexion, dérivés des moteurs déjà suivis."""

import math
import time
from collections import deque
from datetime import datetime


class FleetHealth:
    """Borne la mémoire et distingue indisponibilité, données périmées et absence de suivi."""

    STALE_SECONDS = 120
    ALERT_SECONDS = 180

    def __init__(self):
        """Les transitions sont locales au processus et ne lancent aucune collecte supplémentaire."""
        self.pending = {}
        self.active = {}
        self.events = deque(maxlen=32)
        self.last_observed = None

    @staticmethod
    def age(snapshot, now):
        """Ignore les dates futures ou invalides plutôt que de déclarer une fraîcheur fictive."""
        stamps = []
        for name in ("updated_at", "mqtt_updated_at"):
            value = snapshot.get(name)
            if isinstance(value, str):
                try:
                    parsed = datetime.fromisoformat(value)
                    value = parsed.timestamp() if parsed.tzinfo is not None else None
                except (ValueError, OverflowError, OSError):
                    value = None
            if type(value) in (int, float) and math.isfinite(value) and 0 < value <= now:
                stamps.append(value)
        return max(0, now - max(stamps)) if stamps else None

    @classmethod
    def state(cls, snapshot, age):
        """Un défaut Cloud ne constitue pas une preuve que l’imprimante est éteinte."""
        if not snapshot.get("ok"):
            return "unavailable"
        if age is None or age > cls.STALE_SECONDS:
            return "stale"
        printer = snapshot.get("printer") or {}
        if printer.get("printer_online") is False:
            return "offline"
        return "online" if printer.get("printer_online") is True else "unknown"

    def snapshot(self, registry, *, now=None, clock=None):
        """Lit uniquement les moteurs existants ; ne résout ni n’active de nouvelle cible."""
        now = time.time() if now is None else now
        clock = time.monotonic() if clock is None else clock
        if self.last_observed is not None and clock - self.last_observed > 60:
            self.pending.clear()
        self.last_observed = clock
        catalogue = registry.catalogue()
        for key in self.pending.keys() - catalogue.keys():
            self.pending.pop(key, None)
            self.active.pop(key, None)
        rows = []
        for key, printer in catalogue.items():
            selected = (
                registry.default if key == registry.default_key() else registry.entries.get(key)
            )
            try:
                data = selected.snapshot() if selected else None
            except Exception:
                data = {"ok": False}
            age = self.age(data, now) if data else None
            state = self.state(data, age) if data else "unmonitored"
            problem = state in {"offline", "unavailable", "stale"}
            previous = self.pending.get(key)
            if problem:
                if not previous or previous[0] != state:
                    self.pending[key] = (state, clock)
                if clock - self.pending[key][1] >= self.ALERT_SECONDS:
                    if self.active.get(key) != state:
                        if key in self.active:
                            self.events.append(
                                {
                                    "key": key,
                                    "state": self.active[key],
                                    "transition": "changed",
                                    "time": now,
                                }
                            )
                        self.active[key] = state
                        self.events.append(
                            {"key": key, "state": state, "transition": "opened", "time": now}
                        )
            else:
                self.pending.pop(key, None)
                if state == "online" and key in self.active:
                    old = self.active.pop(key)
                    self.events.append(
                        {"key": key, "state": old, "transition": "recovered", "time": now}
                    )
            fields = (data or {}).get("printer") or {}
            rows.append(
                {
                    "key": key,
                    "name": str(getattr(printer, "name", "Imprimante"))[:100],
                    "state": state,
                    "age_seconds": round(age) if age is not None else None,
                    "job_in_progress": fields.get("job_in_progress") if state == "online" else None,
                    "alerts": [self.active[key]] if key in self.active else [],
                }
            )
        return {
            "items": rows,
            "events": [e for e in self.events if e["key"] in catalogue],
            "stale_seconds": self.STALE_SECONDS,
            "alert_seconds": self.ALERT_SECONDS,
            "observation": "on_request",
            "collected_at": now,
        }
