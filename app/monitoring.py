"""Métriques locales du processus et du serveur HTTP, sans collecte réseau."""

from collections import deque
from datetime import datetime, timezone
import math
import os
import pathlib
import shutil
import time


HISTORY_MAX_POINTS = 120
HTTP_WINDOW_SECONDS = 300
_HTTP_BUCKET_SECONDS = 1


def current_memory_bytes():
    """Lit les octets mémoire courants du cgroup ou du RSS Linux; renvoie None sans source fiable."""
    for candidate in (
        pathlib.Path("/sys/fs/cgroup/memory.current"),
        pathlib.Path("/sys/fs/cgroup/memory/memory.usage_in_bytes"),
    ):
        try:
            value = int(candidate.read_text().strip())
        except (OSError, ValueError):
            continue
        if 0 < value < 2**63:
            return value
    try:
        resident_pages = int(pathlib.Path("/proc/self/statm").read_text().split()[1])
        page_size = os.sysconf("SC_PAGE_SIZE")
    except (OSError, ValueError, IndexError, TypeError, AttributeError):
        return None
    value = resident_pages * page_size
    return value if type(value) is int and 0 < value < 2**63 else None


def data_volume_free_bytes(path):
    """Renvoie l’espace libre en octets sans exposer le chemin du volume."""
    try:
        value = shutil.disk_usage(path).free
    except (OSError, TypeError, ValueError):
        return None
    return value if type(value) is int and value >= 0 else None


class Monitoring:
    """Agrège des métriques locales bornées; les horloges et lecteurs sont injectables pour les tests."""

    def __init__(
        self,
        data_path,
        *,
        monotonic=time.monotonic,
        wall_time=time.time,
        process_time=time.process_time,
        memory_reader=current_memory_bytes,
        disk_free_reader=data_volume_free_bytes,
    ):
        """Démarre les deltas du processus et garde le chemin de données uniquement côté serveur."""
        self._data_path = pathlib.Path(data_path)
        self._monotonic = monotonic
        self._wall_time = wall_time
        self._process_time = process_time
        self._memory_reader = memory_reader
        self._disk_free_reader = disk_free_reader
        self._started_mono = self._finite_clock(monotonic())
        self._started_wall = self._finite_clock(wall_time())
        self._last_cpu_mono = None
        self._last_cpu = None
        self._requests_total = 0
        self._errors_total = 0
        self._http_buckets = {}
        self._http_clock = self._started_mono
        self._history = deque(maxlen=HISTORY_MAX_POINTS)

    @staticmethod
    def _finite_clock(value):
        """Accepte uniquement des valeurs finies pour éviter des horodatages ou deltas non bornés."""
        return float(value) if type(value) in (int, float) and math.isfinite(value) else 0.0

    @staticmethod
    def _finite_measure(reader):
        """Convertit les échecs de lecture système en absence explicite de mesure."""
        try:
            value = reader()
        except (OSError, RuntimeError, TypeError, ValueError):
            return None
        return value if type(value) is int and 0 <= value < 2**63 else None

    def _elapsed(self, mono):
        """Calcule les secondes depuis le démarrage avec une horloge monotone non négative."""
        return max(0.0, mono - self._started_mono)

    def _http_bucket(self, mono):
        """Renvoie le seau HTTP d’une seconde et retire ceux hors fenêtre de 300 secondes."""
        if mono < self._http_clock:
            self._http_buckets.clear()
        self._http_clock = mono
        bucket = int(mono // _HTTP_BUCKET_SECONDS)
        cutoff = mono - HTTP_WINDOW_SECONDS
        self._http_buckets = {
            minute: values
            for minute, values in self._http_buckets.items()
            if (minute + 1) * _HTTP_BUCKET_SECONDS > cutoff
        }
        return bucket

    def record_http(self, status, duration_ms):
        """Mémorise statut et durée en ms dans les compteurs des 300 dernières secondes."""
        mono = self._finite_clock(self._monotonic())
        bucket = self._http_bucket(mono)
        duration = (
            float(duration_ms)
            if type(duration_ms) in (int, float) and math.isfinite(duration_ms) and duration_ms >= 0
            else 0.0
        )
        is_error = type(status) is int and status >= 400
        self._requests_total += 1
        self._errors_total += int(is_error)
        values = self._http_buckets.setdefault(bucket, [0, 0, 0.0])
        values[0] += 1
        values[1] += int(is_error)
        values[2] += duration

    def _cpu_percent(self, mono):
        """Calcule le pourcentage CPU du processus entre relevés, sans plafonner les multicœurs."""
        try:
            candidate = self._process_time()
            cpu = (
                float(candidate)
                if type(candidate) in (int, float) and math.isfinite(candidate)
                else None
            )
        except (OSError, RuntimeError, TypeError, ValueError):
            cpu = None
        value = None
        if (
            cpu is not None
            and self._last_cpu is not None
            and self._last_cpu_mono is not None
            and mono > self._last_cpu_mono
            and cpu >= self._last_cpu
        ):
            value = round(100 * (cpu - self._last_cpu) / (mono - self._last_cpu_mono), 1)
        self._last_cpu = cpu
        self._last_cpu_mono = mono
        return value

    def _services(self, engine, registry):
        """Résume les moteurs déjà créés sans résoudre de cible ni appeler le Cloud."""
        cloud = "unknown"
        mqtt = "unknown"
        monitored = 0
        online = 0
        offline = 0
        if engine is not None:
            monitored_engines = [engine]
            if registry is not None:
                monitored_engines.extend(
                    item for item in getattr(registry, "entries", {}).values() if item is not engine
                )
            api = getattr(engine, "api", None)
            if api is not None:
                cloud = "connected" if bool(getattr(engine, "ok", False)) else "unavailable"
                client = getattr(api, "_mqtt_client", None)
                try:
                    mqtt = "connected" if client and client.is_connected() else "disconnected"
                except Exception:
                    mqtt = "unknown"
            for selected in monitored_engines:
                try:
                    state = selected.snapshot()
                except Exception:
                    state = None
                printer = state.get("printer") if isinstance(state, dict) else None
                if not isinstance(printer, dict):
                    continue
                monitored += 1
                if printer.get("printer_online") is True:
                    online += 1
                elif printer.get("printer_online") is False:
                    offline += 1
        return {
            "cloud": cloud,
            "mqtt": mqtt,
            "printers": {
                "monitored": monitored,
                "online": online,
                "offline": offline,
                "unknown": monitored - online - offline,
            },
        }

    def snapshot(self, engine=None, registry=None):
        """Renvoie les secondes, pourcentages, octets, durées ms et 120 points max, sans identité ni chemin."""
        mono = self._finite_clock(self._monotonic())
        elapsed = self._elapsed(mono)
        cpu = self._cpu_percent(mono)
        memory = self._finite_measure(self._memory_reader)
        disk_free = self._finite_measure(lambda: self._disk_free_reader(self._data_path))
        window = [
            counts
            for minute, counts in self._http_buckets.items()
            if (minute + 1) * _HTTP_BUCKET_SECONDS > mono - HTTP_WINDOW_SECONDS
        ]
        window_requests = sum(item[0] for item in window)
        window_errors = sum(item[1] for item in window)
        window_duration = sum(item[2] for item in window)
        at = datetime.fromtimestamp(self._started_wall + elapsed, timezone.utc).isoformat(
            timespec="seconds"
        )
        point = {
            "at": at,
            "uptime_seconds": int(elapsed),
            "cpu_percent": cpu,
            "memory_bytes": memory,
            "data_free_bytes": disk_free,
            "requests_total": self._requests_total,
            "errors_total": self._errors_total,
            "average_latency_ms": round(window_duration / window_requests, 1)
            if window_requests
            else None,
        }
        self._history.append(point)
        return {
            "data_mode": "live_local",
            "collected_at": at,
            "system": {
                "uptime_seconds": point["uptime_seconds"],
                "cpu_percent": cpu,
                "memory_bytes": memory,
                "data_free_bytes": disk_free,
            },
            "http": {
                "requests_total": self._requests_total,
                "errors_total": self._errors_total,
                "window_seconds": HTTP_WINDOW_SECONDS,
                "requests_window": window_requests,
                "errors_window": window_errors,
                "average_latency_ms": point["average_latency_ms"],
            },
            "services": self._services(engine, registry),
            "history": list(self._history),
        }
