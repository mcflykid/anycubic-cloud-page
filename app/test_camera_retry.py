"""Tests des demandes caméra simulées, sans caméra, cloud ni commande physique."""

import asyncio, importlib.util, json, pathlib, ssl, types, unittest
from unittest.mock import AsyncMock, patch
import aiohttp
from anycubic_cloud_api.exceptions.exceptions import AnycubicAPIParsingError, AnycubicAuthError

spec = importlib.util.spec_from_file_location(
    "camera_adapter", pathlib.Path(__file__).with_name("server.py")
)
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


class CameraRetry(unittest.IsolatedAsyncioTestCase):
    """Seule une panne transitoire structurée peut renouveler la demande, sans attente spéculative."""

    async def asyncSetUp(self):
        """Remplace le moteur par une doublure locale et le temps par une valeur déterministe."""
        self.printer = types.SimpleNamespace(
            get_camera_session=AsyncMock(return_value=types.SimpleNamespace(data={"fixture": True}))
        )
        self.engine = types.SimpleNamespace(
            printer=self.printer,
            camera=None,
            last_session=0,
            lock=asyncio.Lock(),
            command_lock=asyncio.Lock(),
            camera_viewers=set(),
            camera_viewer_expiries={},
            camera_expiry_task=None,
            camera_close_task=None,
        )
        self.request = types.SimpleNamespace(headers={"Origin": "http://localhost:8080"})
        self.patch_engine = patch.object(adapter, "engine", self.engine)
        self.patch_engine.start()
        self.addCleanup(self.patch_engine.stop)

    async def asyncTearDown(self):
        """Annule les délais caméra de test pour ne laisser aucune tâche différée."""
        for task in (
            getattr(self.engine, "camera_expiry_task", None),
            getattr(self.engine, "camera_close_task", None),
        ):
            if task and not task.done():
                task.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await task

    async def test_connection_failure_retries_once_without_delay(self):
        """Une coupure de transport autorise une seconde lecture, sans temporisation cloud inventée."""
        self.printer.get_camera_session.side_effect = [
            aiohttp.ClientConnectionError("fixture"),
            types.SimpleNamespace(data={"fixture": True}),
        ]
        with patch.object(adapter.asyncio, "sleep", new_callable=AsyncMock) as sleep:
            response = await adapter.camera(self.request)
            sleep.assert_not_awaited()
        self.assertEqual(self.printer.get_camera_session.await_count, 2)
        self.assertTrue(json.loads(response.body)["fixture"])

    async def test_camera_open_waits_for_physical_command_guard(self):
        """L’ouverture Cloud de la caméra ne chevauche pas une autre commande machine."""
        await self.engine.command_lock.acquire()
        task = asyncio.create_task(adapter.camera(self.request))
        await asyncio.sleep(0)
        self.printer.get_camera_session.assert_not_awaited()
        self.engine.command_lock.release()
        await task
        self.printer.get_camera_session.assert_awaited_once()

    async def test_new_session_deadline_replaces_a_later_expiry_timer(self):
        """Un nouveau viewer à échéance courte réveille le minuteur déjà endormi."""
        engine = adapter.Engine()
        engine.camera_viewers.update(("a" * 36, "b" * 36))
        engine.camera_viewer_expiries = {"a" * 36: 1000}
        adapter.schedule_camera_expiry(engine)
        previous = engine.camera_expiry_task
        engine.camera_viewer_expiries["b" * 36] = 800
        adapter.schedule_camera_expiry(engine)
        current = engine.camera_expiry_task
        self.assertIsNot(previous, current)
        await asyncio.sleep(0)
        self.assertTrue(previous.cancelled())
        current.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await current
        engine.camera_expiry_task = None

    async def test_wrapped_transport_timeout_is_recognized(self):
        """L’erreur de parsing générique du client conserve le contexte d’un délai de transport."""
        error = AnycubicAPIParsingError("fixture")
        error.__context__ = asyncio.TimeoutError()
        self.printer.get_camera_session.side_effect = [
            error,
            types.SimpleNamespace(data={"fixture": True}),
        ]
        await adapter.camera(self.request)
        self.assertEqual(self.printer.get_camera_session.await_count, 2)

    async def test_permanent_errors_are_not_retried_or_cached(self):
        """Une erreur d’authentification, TLS, de format ou métier n’est jamais rejouée aveuglément."""
        errors = [
            AnycubicAuthError("fixture"),
            AnycubicAPIParsingError("fixture"),
            ValueError("fixture"),
            ssl.SSLError("fixture"),
        ]
        for error in errors:
            with self.subTest(kind=type(error).__name__):
                self.printer.get_camera_session.reset_mock()
                self.printer.get_camera_session.side_effect = error
                with self.assertRaises(type(error)):
                    await adapter.camera(self.request)
                self.printer.get_camera_session.assert_awaited_once()
                self.assertIsNone(self.engine.camera)

    async def test_second_transport_failure_propagates_without_third_request(self):
        """Une panne persistante ne doit pas boucler ni fabriquer une session valide."""
        self.printer.get_camera_session.side_effect = aiohttp.ClientConnectionError("fixture")
        with self.assertRaises(aiohttp.ClientConnectionError):
            await adapter.camera(self.request)
        self.assertEqual(self.printer.get_camera_session.await_count, 2)
        self.assertIsNone(self.engine.camera)

    async def test_valid_cache_is_reused_and_expired_cache_is_refreshed(self):
        """Le cache de cinq secondes reste indépendant de la politique de nouvelle tentative."""
        self.engine.camera = {"cached": True}
        self.engine.last_session = 100
        with patch.object(adapter.time, "time", return_value=104):
            response = await adapter.camera(self.request)
        self.assertTrue(json.loads(response.body)["cached"])
        self.printer.get_camera_session.assert_not_awaited()
        self.printer.get_camera_session.return_value = types.SimpleNamespace(data={"fresh": True})
        with patch.object(adapter.time, "time", return_value=106):
            await adapter.camera(self.request)
        self.printer.get_camera_session.assert_awaited_once()
        self.assertEqual(self.engine.last_session, 106)

    async def test_cancellation_is_not_retried(self):
        """L’annulation du client ne doit pas déclencher une nouvelle ouverture caméra."""
        self.printer.get_camera_session.side_effect = asyncio.CancelledError()
        with self.assertRaises(asyncio.CancelledError):
            await adapter.camera(self.request)
        self.printer.get_camera_session.assert_awaited_once()

    async def test_missing_session_is_not_retried(self):
        """Une réponse sans session n’est pas traitée comme une coupure de transport."""
        self.printer.get_camera_session.return_value = None
        with self.assertRaises(ValueError):
            await adapter.camera(self.request)
        self.printer.get_camera_session.assert_awaited_once()
        self.assertIsNone(self.engine.camera)

    async def test_last_viewer_closes_only_its_printer(self):
        """Le départ d’un onglet ne coupe pas un autre spectateur suivi par l’atelier."""
        engine = adapter.Engine()
        engine.printer = types.SimpleNamespace(id=42)
        engine.api = types.SimpleNamespace(_send_anycubic_order=AsyncMock())
        first = "a" * 36
        second = "b" * 36
        engine.camera_viewers.update((first, second))
        with (
            patch.object(adapter, "engine", engine),
            patch.object(adapter.asyncio, "sleep", new_callable=AsyncMock),
        ):
            await adapter.camera_close(types.SimpleNamespace(headers={"X-Camera-Viewer": first}))
            self.assertIsNone(engine.camera_close_task)
            await adapter.camera_close(types.SimpleNamespace(headers={"X-Camera-Viewer": second}))
            engine.camera_viewers.add(first)
            await engine.camera_close_task
            engine.api._send_anycubic_order.assert_not_awaited()
            await adapter.camera_close(types.SimpleNamespace(headers={"X-Camera-Viewer": first}))
            await engine.camera_close_task
        engine.api._send_anycubic_order.assert_awaited_once()
        order = engine.api._send_anycubic_order.call_args.kwargs["order_request"]
        self.assertEqual(order.order_request_data, {"order_id": 1002, "printer_id": 42})

    async def test_departure_before_open_prevents_an_orphaned_stream(self):
        """Un départ arrivé avant la requête d’ouverture bloque cette ouverture tardive."""
        engine = adapter.Engine()
        engine.printer = types.SimpleNamespace(id=42, get_camera_session=AsyncMock())
        request = types.SimpleNamespace(
            headers={"Origin": "http://localhost:8080", "X-Camera-Viewer": "a" * 36}
        )
        with patch.object(adapter, "engine", engine):
            await adapter.camera_close(request)
            with self.assertRaisesRegex(ValueError, "déjà fermé"):
                await adapter.camera(request)
        engine.printer.get_camera_session.assert_not_awaited()
        self.assertIsNone(engine.camera_close_task)

    def test_viewer_deadline_uses_the_authenticated_web_session_expiry(self):
        """Le renouvellement court ne dépasse jamais l’expiration de la session web."""
        request = types.SimpleNamespace(
            get=lambda key, default=None: 10_000 if key == "session_expires" else default
        )
        with patch.object(adapter.time, "monotonic", return_value=100):
            self.assertEqual(
                adapter.camera_viewer_deadline(request), 100 + adapter.CAMERA_VIEWER_TTL
            )
        near_expiry = types.SimpleNamespace(
            get=lambda key, default=None: 110 if key == "session_expires" else default
        )
        with patch.object(adapter.time, "monotonic", return_value=100):
            self.assertEqual(adapter.camera_viewer_deadline(near_expiry), 110)
            self.assertEqual(
                adapter.camera_viewer_deadline(types.SimpleNamespace()),
                100 + adapter.CAMERA_VIEWER_TTL,
            )

    async def test_camera_presence_renews_active_viewer_without_cloud_or_printer_order(self):
        """La présence prolonge localement un onglet existant sans rouvrir ni fermer la caméra."""
        viewer = "a" * 36
        self.engine.printer = types.SimpleNamespace(id=42, get_camera_session=AsyncMock())
        self.engine.api = types.SimpleNamespace(_send_anycubic_order=AsyncMock())
        self.engine.camera_viewers.add(viewer)
        self.engine.camera_viewer_expiries[viewer] = 150
        request = types.SimpleNamespace(
            headers={"X-Camera-Viewer": viewer},
            get=lambda key, default=None: 10_000 if key == "session_expires" else default,
        )
        with patch.object(adapter.time, "monotonic", return_value=100):
            response = await adapter.camera_presence(request)
        self.assertEqual(
            self.engine.camera_viewer_expiries[viewer], 100 + adapter.CAMERA_VIEWER_TTL
        )
        self.assertTrue(json.loads(response.body)["ok"])
        self.engine.printer.get_camera_session.assert_not_awaited()
        self.engine.api._send_anycubic_order.assert_not_awaited()
        self.assertIsNotNone(self.engine.camera_expiry_task)

    async def test_legacy_camera_viewer_uses_the_short_deadline(self):
        """Un appel ancien sans identifiant ne reçoit pas la durée complète de la session web."""
        request = types.SimpleNamespace(
            headers={"Origin": "http://localhost:8080"},
            get=lambda key, default=None: 10_000 if key == "session_expires" else default,
        )
        with (
            patch.object(adapter.time, "monotonic", return_value=100),
            patch.object(adapter.time, "time", return_value=100),
            patch.object(adapter, "schedule_camera_expiry") as schedule,
        ):
            await adapter.camera(request)
            schedule.assert_called_once_with(self.engine)
        self.assertIn("legacy", self.engine.camera_viewers)
        self.assertEqual(
            self.engine.camera_viewer_expiries["legacy"],
            100 + adapter.CAMERA_VIEWER_TTL,
        )

    async def test_expired_legacy_viewer_cannot_be_revived_by_presence(self):
        """Un ancien spectateur expiré ne revient pas à la vie via un signal tardif."""
        self.engine.printer = types.SimpleNamespace(id=42)
        self.engine.camera_viewers.add("legacy")
        self.engine.camera_viewer_expiries["legacy"] = 99
        with patch.object(adapter.time, "monotonic", return_value=100):
            with self.assertRaisesRegex(ValueError, "Session vidéo expirée"):
                await adapter.camera_presence(types.SimpleNamespace(headers={}))
        self.assertNotIn("legacy", self.engine.camera_viewers)
        self.assertNotIn("legacy", self.engine.camera_viewer_expiries)
        self.assertIsNotNone(self.engine.camera_close_task)

    async def test_abandoned_legacy_and_expired_viewers_are_pruned(self):
        """L’ancien client et un onglet abandonné cessent de compter à leur échéance."""
        engine = adapter.Engine()
        engine.camera_viewers.update(("legacy", "a" * 36, "b" * 36))
        engine.camera_viewer_expiries = {
            "legacy": 9,
            "a" * 36: 11,
            "b" * 36: 20,
        }
        with patch.object(adapter.time, "monotonic", return_value=12):
            adapter.prune_camera_viewers(engine)
        self.assertEqual(engine.camera_viewers, {"b" * 36})
        self.assertEqual(engine.camera_viewer_expiries, {"b" * 36: 20})

    async def test_expiry_schedules_close_when_no_viewer_renews(self):
        """La tâche d’échéance ferme le flux si aucun identifiant ne renouvelle sa session."""
        engine = adapter.Engine()
        engine.printer = types.SimpleNamespace(id=42)
        engine.api = types.SimpleNamespace(_send_anycubic_order=AsyncMock())
        viewer = "a" * 36
        engine.camera_viewers.add(viewer)
        engine.camera_viewer_expiries[viewer] = 9
        with (
            patch.object(adapter.time, "monotonic", return_value=10),
            patch.object(adapter.asyncio, "sleep", new_callable=AsyncMock),
        ):
            await adapter.expire_camera_viewers(engine)
            await asyncio.sleep(0)
        self.assertNotIn(viewer, engine.camera_viewers)
        self.assertIsNotNone(engine.camera_close_task)
        await engine.camera_close_task
        engine.api._send_anycubic_order.assert_awaited_once()

    def test_tls_error_takes_precedence_over_transport_context(self):
        """Une panne TLS ne devient pas réessayable parce qu’elle comporte une cause de connexion."""
        error = ssl.SSLError("fixture")
        error.__context__ = aiohttp.ClientConnectionError("fixture")
        self.assertFalse(adapter.camera_transport_failure(error))
