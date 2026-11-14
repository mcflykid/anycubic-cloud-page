"""Traces bornées des échanges Cloud et MQTT, sans contenu de transport."""

import threading
import time
from collections import deque
from contextvars import ContextVar

stored_trace_context = ContextVar("stored_trace_context", default=None)

_MQTT_TYPES = frozenset(
    "axis box camera device error fan file firmware light machine multi_color_box print printer "
    "progress status temperature timelapse upgrade video".split()
)
_MQTT_ACTIONS = frozenset(
    "auto cancel change close done get notify open pause print query reply report resume set start status "
    "stop update upload workReport".split()
)
_MQTT_PRINT_STATES = frozenset(
    "checking downloading preheating printing pausing paused resuming stopping stoped stopped "
    "failed done free busy auto_leveling z_offset_calibrating frequency_sweeping "
    "nozzle_purging nozzle_heating hotbed_heating ace_filament_feeding".split()
)


class DeveloperSignals:
    """Les rapports MQTT et les requêtes HTTP peuvent arriver sur des fils différents."""

    def __init__(self):
        """Initialise un tampon borné partagé par HTTP et MQTT."""
        self._events = deque(maxlen=240)
        self._lock = threading.Lock()
        self._start = time.monotonic()

    def add(self, transport, phase, **fields):
        """Enregistre uniquement les métadonnées déjà projetées par le transport."""
        with self._lock:
            self._events.append(
                {
                    "ms": round((time.monotonic() - self._start) * 1000),
                    "transport": transport,
                    "phase": phase,
                    **fields,
                }
            )

    def elapsed_ms(self):
        """Positionne le relevé HTTP sur la même horloge que les signaux."""
        return round((time.monotonic() - self._start) * 1000)

    def read(self):
        """Copie les observations pour libérer le verrou avant la réponse HTTP."""
        with self._lock:
            return list(self._events)


def mqtt_summary(payload):
    """Garde les codes connus et la forme générale même pour les rapports futurs."""
    if not isinstance(payload, dict):
        return {"format": "illisible"}
    kind = payload.get("type")
    action = payload.get("action")
    state = payload.get("state")
    data = payload.get("data")
    fans = (
        data.get("settings", data) if isinstance(data, dict) and kind in ("print", "fan") else None
    )
    return {
        # Permet de distinguer un rapport de phase d’un simple état occupé, sans texte arbitraire.
        **(
            {"state": state if isinstance(state, str) and state in _MQTT_PRINT_STATES else "autre"}
            if kind == "print" or (kind == "status" and action == "workReport")
            else {}
        ),
        **(
            {
                "ventilateurs": {
                    key: fans[key]
                    for key in ("fan_speed_pct", "aux_fan_speed_pct", "box_fan_level")
                    if type(fans.get(key)) is int and 0 <= fans[key] <= 100
                }
            }
            if isinstance(fans, dict)
            else {}
        ),
        "type": kind if isinstance(kind, str) and kind in _MQTT_TYPES else "autre",
        "action": action if isinstance(action, str) and action in _MQTT_ACTIONS else "autre",
        "fields": len(payload),
        "data_items": len(data) if isinstance(data, (dict, list)) else None,
    }


def mqtt_clock_delta(timestamp, received_at):
    """Estime l’écart au point de réception, sans confondre secondes et millisecondes."""
    if type(timestamp) not in (float, int) or not 946684800 <= timestamp <= 4102444800000:
        return None
    seconds = timestamp / 1000 if timestamp > 4102444800 else timestamp
    return round(seconds - received_at, 3)
