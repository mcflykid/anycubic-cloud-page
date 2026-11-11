"""Métriques locales bornées, sans connexion Cloud ni état utilisateur."""

import unittest
import warnings
from types import SimpleNamespace

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from monitoring import Monitoring
import server as adapter
from printer_registry import select_printer
from unittest.mock import patch
import web_host


class FakeClock:
    """Fournit trois horloges indépendantes pour vérifier les deltas sans attendre."""

    def __init__(self):
        self.mono = 100.0
        self.wall = 1_800_000_000.0
        self.cpu = 20.0

    def monotonic(self):
        return self.mono

    def time(self):
        return self.wall

    def process_time(self):
        return self.cpu


class MonitoringTests(unittest.TestCase):
    """Le point de supervision ne collecte que le processus et les moteurs déjà présents."""

    def setUp(self):
        """Prépare des mesures locales déterministes, sans socket ni imprimante."""
        self.clock = FakeClock()
        self.monitor = Monitoring(
            "/data/private-state",
            monotonic=self.clock.monotonic,
            wall_time=self.clock.time,
            process_time=self.clock.process_time,
            memory_reader=lambda: 42_000,
            disk_free_reader=lambda path: 900_000,
        )

    def test_cpu_is_unknown_until_two_samples_and_uses_process_delta(self):
        """Le premier relevé ne prétend pas connaître le CPU instantané."""
        self.assertIsNone(self.monitor.snapshot()["system"]["cpu_percent"])
        self.clock.mono += 2
        self.clock.cpu += 1
        result = self.monitor.snapshot()
        self.assertEqual(result["system"]["cpu_percent"], 50.0)

    def test_http_window_counters_latency_and_sample_history_are_bounded(self):
        """Les requêtes et durées sont agrégées dans une fenêtre sans retenir les contenus HTTP."""
        self.monitor.record_http(200, 20)
        self.monitor.record_http(500, 80)
        result = self.monitor.snapshot()
        self.assertEqual(result["http"]["requests_total"], 2)
        self.assertEqual(result["http"]["errors_total"], 1)
        self.assertEqual(result["http"]["requests_window"], 2)
        self.assertEqual(result["http"]["errors_window"], 1)
        self.assertEqual(result["http"]["average_latency_ms"], 50.0)
        for _ in range(130):
            self.clock.mono += 1
            self.clock.wall += 1
            self.monitor.snapshot()
        self.assertEqual(len(self.monitor.snapshot()["history"]), 120)

    def test_old_http_bucket_expires_without_wall_clock_reversal(self):
        """La fenêtre HTTP utilise monotonic pour ne pas dépendre d’un changement d’heure."""
        self.monitor.record_http(200, 10)
        self.clock.mono += 301
        self.clock.wall -= 3600
        self.assertEqual(self.monitor.snapshot()["http"]["requests_window"], 0)
        self.assertEqual(self.monitor.snapshot()["http"]["requests_total"], 1)

    def test_missing_memory_or_volume_measurement_stays_unknown(self):
        """Une lecture système indisponible reste null au lieu d’un zéro trompeur."""
        monitor = Monitoring(
            "/not-present",
            monotonic=self.clock.monotonic,
            wall_time=self.clock.time,
            process_time=self.clock.process_time,
            memory_reader=lambda: None,
            disk_free_reader=lambda path: None,
        )
        system = monitor.snapshot()["system"]
        self.assertIsNone(system["memory_bytes"])
        self.assertIsNone(system["data_free_bytes"])

    def test_service_summary_uses_existing_snapshot_without_identifiers(self):
        """Le résumé ne révèle que des états et des quantités, et ne réveille aucun moteur."""

        class Engine:
            def __init__(self, snapshot):
                self.api = SimpleNamespace(_mqtt_client=SimpleNamespace(is_connected=lambda: True))
                self._snapshot = snapshot
                self.calls = 0

            def snapshot(self):
                self.calls += 1
                return self._snapshot

        first = Engine({"ok": True, "printer": {"printer_online": True}})
        second = Engine({"ok": True, "printer": {"printer_online": False}})
        first.ok = True
        registry = SimpleNamespace(default=first, entries={"private-key": second})
        result = self.monitor.snapshot(first, registry)
        self.assertEqual(result["services"]["cloud"], "connected")
        self.assertEqual(result["services"]["mqtt"], "connected")
        self.assertEqual(result["services"]["printers"]["monitored"], 2)
        self.assertEqual(result["services"]["printers"]["online"], 1)
        self.assertEqual(result["services"]["printers"]["offline"], 1)
        self.assertEqual(first.calls, 1)
        self.assertEqual(second.calls, 1)
        self.assertNotIn("private-key", repr(result))


class MonitoringEndpointTests(unittest.IsolatedAsyncioTestCase):
    """Le point HTTP est privé, sans résolution de cible ni déclenchement de collecte."""

    async def test_endpoint_ignores_printer_selection_and_records_http(self):
        """L’endpoint global ne réveille pas l’imprimante demandée dans l’en-tête."""
        from unittest.mock import AsyncMock

        clock = FakeClock()
        monitor = Monitoring(
            "/path-that-must-not-leak",
            monotonic=clock.monotonic,
            wall_time=clock.time,
            process_time=clock.process_time,
            memory_reader=lambda: None,
            disk_free_reader=lambda path: None,
        )
        engine = SimpleNamespace(
            api=None,
            snapshot=lambda: {"ok": True, "printer": {"printer_online": True}},
        )
        registry = SimpleNamespace(default=engine, entries={}, resolve=AsyncMock())
        app = web.Application(middlewares=[adapter.operational_requests, select_printer])
        app[adapter.MONITORING_KEY] = monitor
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", web.NotAppKeyWarning)
            app["printer_registry"] = registry
        app.router.add_get("/imprimante-api/monitoring", adapter.monitoring)
        async with TestClient(TestServer(app)) as client:
            response = await client.get(
                "/imprimante-api/monitoring",
                headers={"X-Printer-Key": "private-printer-reference"},
            )
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers["Cache-Control"], "no-store")
            body = await response.json()
            self.assertEqual(body["data_mode"], "live_local")
            self.assertNotIn("private-printer-reference", repr(body))
            self.assertNotIn("path-that-must-not-leak", repr(body))
            self.assertEqual(body["http"]["requests_total"], 0)
            self.assertEqual(body["services"]["printers"]["online"], 1)
            registry.resolve.assert_not_awaited()
            response = await client.get("/imprimante-api/monitoring")
            self.assertEqual((await response.json())["http"]["requests_total"], 1)

    async def test_endpoint_uses_the_existing_authenticated_api_boundary(self):
        """Le nouvel endpoint reçoit la même barrière de session que les routes atelier privées."""
        app = web.Application(middlewares=[adapter.access_control])
        app[web_host.ACCESS_KEY] = web_host.AccessState()
        app[web_host.ORIGIN_KEY] = "http://localhost:8080"
        app[web_host.TRUSTED_PROXIES_KEY] = ()
        app.router.add_get("/imprimante-api/monitoring", adapter.monitoring)
        with patch("web_host.credentials", return_value=("admin", "fixture-password", b"x")):
            async with TestClient(TestServer(app)) as client:
                response = await client.get("/imprimante-api/monitoring")
                self.assertEqual(response.status, 401)
