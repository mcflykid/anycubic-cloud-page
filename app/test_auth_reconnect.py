"""Reconnexion après rejet d’authentification avec un fil MQTT simulé et sans réseau."""
import asyncio,unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock,Mock,patch
import server
from anycubic_cloud_api.exceptions.exceptions import AnycubicAuthError

class AuthReconnect(unittest.IsolatedAsyncioTestCase):
 """L’ancien client reste joignable jusqu’à l’arrêt de son suivi MQTT."""
 async def test_auth_failure_disconnects_old_thread_and_next_connect_succeeds(self):
  """Un cycle en erreur ne peut perdre la seule référence capable d’arrêter le fil."""
  e=server.Engine();e.account=SimpleNamespace(token=AsyncMock(return_value='fixture-token'));e.account_token='fixture-token';e.session=SimpleNamespace(cookie_jar=object())
  stopped=__import__('threading').Event();thread=Mock();thread.is_alive.side_effect=lambda:not stopped.is_set()
  old=SimpleNamespace(disconnect_mqtt=Mock(side_effect=stopped.set));e.api=old;e.mqtt_thread=thread;e.printer=SimpleNamespace(update_info_from_api=AsyncMock(side_effect=AnycubicAuthError('fixture-only')))
  e.mqtt_start=Mock()
  with patch.object(server.asyncio,'sleep',side_effect=asyncio.CancelledError):
   with self.assertRaises(asyncio.CancelledError):await e.poll()
  old.disconnect_mqtt.assert_called_once();self.assertIs(e.api,old);self.assertTrue(e.reconnect_required);self.assertTrue(stopped.is_set())
  printer=SimpleNamespace(id=1,update_info_from_api=AsyncMock());new=SimpleNamespace(check_api_tokens=AsyncMock(return_value=True),list_my_printers=AsyncMock(return_value=[printer]),mqtt_add_subscribed_printer=Mock())
  with patch.object(server,'CloudPageAPI',return_value=new):await e.connect()
  self.assertIs(e.api,new);self.assertIs(e.printer,printer);self.assertFalse(e.reconnect_required);self.assertIsNone(e.mqtt_thread);e.mqtt_start.assert_called_once()
 async def test_thread_slow_to_stop_preserves_client_and_prevents_second_connection(self):
  """Une fermeture lente laisse son client récupérable et interdit un nouveau suivi concurrent."""
  e=server.Engine();e.account=SimpleNamespace(token=AsyncMock(return_value='fixture-token'));e.session=SimpleNamespace(cookie_jar=object());old=SimpleNamespace(disconnect_mqtt=Mock());e.api=old;e.mqtt_thread=Mock();e.mqtt_thread.is_alive.return_value=True
  with patch.object(server,'CloudPageAPI') as factory:
   with self.assertRaisesRegex(RuntimeError,'en attente'):await e.connect()
   factory.assert_not_called()
  self.assertIs(e.api,old);old.disconnect_mqtt.assert_called_once();e.mqtt_thread.join.assert_called_once_with(3)
