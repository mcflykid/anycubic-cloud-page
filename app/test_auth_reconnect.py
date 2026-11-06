"""Reconnexion après rejet d’authentification avec un fil MQTT simulé et sans réseau."""

import threading
import asyncio, unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch
import server
from anycubic_cloud_api.exceptions.exceptions import AnycubicAuthError


class AuthReconnect(unittest.IsolatedAsyncioTestCase):
    """L’ancien client reste joignable jusqu’à l’arrêt de son suivi MQTT."""

    async def test_auth_failure_disconnects_old_thread_and_next_connect_succeeds(self):
        """Un cycle en erreur ne peut perdre la seule référence capable d’arrêter le fil."""
        e = server.Engine()
        e.account = SimpleNamespace(token=AsyncMock(return_value="fixture-token"))
        e.account_token = "fixture-token"
        e.session = SimpleNamespace(cookie_jar=object())
        stopped = threading.Event()
        thread = Mock()
        thread.is_alive.side_effect = lambda: not stopped.is_set()
        old = SimpleNamespace(disconnect_mqtt=Mock(side_effect=stopped.set))
        e.api = old
        e.transport.mqtt_thread = thread
        e.printer = SimpleNamespace(
            update_info_from_api=AsyncMock(side_effect=AnycubicAuthError("fixture-only"))
        )
        e.mqtt_start = Mock()
        with patch.object(server.asyncio, "sleep", side_effect=asyncio.CancelledError):
            with self.assertRaises(asyncio.CancelledError):
                await e.poll()
        old.disconnect_mqtt.assert_called_once()
        self.assertIs(e.api, old)
        self.assertTrue(e.reconnect_required)
        self.assertTrue(stopped.is_set())
        printer = SimpleNamespace(id=1, update_info_from_api=AsyncMock())
        new = SimpleNamespace(
            check_api_tokens=AsyncMock(return_value=True),
            list_my_printers=AsyncMock(return_value=[printer]),
            mqtt_add_subscribed_printer=Mock(),
        )
        with patch.object(server, "CloudPageAPI", return_value=new):
            await e.connect()
        self.assertIs(e.api, new)
        self.assertIs(e.printer, printer)
        self.assertFalse(e.reconnect_required)
        self.assertIsNone(e.transport.mqtt_thread)
        e.mqtt_start.assert_called_once()

    async def test_thread_slow_to_stop_preserves_client_and_prevents_second_connection(self):
        """Une fermeture lente laisse son client récupérable et interdit un nouveau suivi concurrent."""
        e = server.Engine()
        e.account = SimpleNamespace(token=AsyncMock(return_value="fixture-token"))
        e.session = SimpleNamespace(cookie_jar=object())
        old = SimpleNamespace(disconnect_mqtt=Mock())
        e.api = old
        e.transport.mqtt_thread = Mock()
        e.transport.mqtt_thread.is_alive.return_value = True
        with patch.object(server, "CloudPageAPI") as factory:
            with self.assertRaisesRegex(RuntimeError, "en attente"):
                await e.connect()
            factory.assert_not_called()
        self.assertIs(e.api, old)
        old.disconnect_mqtt.assert_called_once()
        e.transport.mqtt_thread.join.assert_called_once_with(3)

    async def test_failed_catalogue_does_not_prevent_required_reconnect(self):
        """Un catalogue servi par l’ancien client ne doit pas précéder la reconnexion exigée."""
        e = server.Engine()
        e.catalogue_source = True
        e.reconnect_required = True
        e.printer = None
        e.api = SimpleNamespace(printer_info_for_id=AsyncMock(return_value={"data": {}}))
        e.refresh_catalogue = AsyncMock(side_effect=AnycubicAuthError("fixture-only"))
        e.print_history = AsyncMock()
        e.mqtt_start = Mock()

        async def connect():
            """Remplace la connexion sans réseau pour vérifier l’ordre du cycle suivant."""
            e.printer = SimpleNamespace(id=1)
            e.reconnect_required = False

        e.connect = AsyncMock(side_effect=connect)
        with patch.object(server.asyncio, "sleep", side_effect=asyncio.CancelledError):
            with self.assertRaises(asyncio.CancelledError):
                await e.poll()
        e.connect.assert_awaited_once()
        e.refresh_catalogue.assert_not_awaited()
        self.assertTrue(e.ok)
