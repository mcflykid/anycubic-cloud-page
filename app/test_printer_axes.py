"""Contrats de consultation de position en MQTT simulé, sans mouvement réel."""

import asyncio
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

from printer_axes import is_allowed, query_axis_position
from printer_files import MQTTReplies


class PrinterAxesTests(unittest.IsolatedAsyncioTestCase):
    """La requête de position reste corrélée, en lecture seule et bornée à sa cible."""

    def make_target(self, *, model="Anycubic Kobra S1", capabilities=None, connected=True):
        """Construit une imprimante fictive et un transport MQTT sans cloud réel."""
        self.target = SimpleNamespace(
            printer=SimpleNamespace(id=17, machine_name=model, printer_online=True),
            raw_info={"type_function_ids": capabilities or []},
            mqtt_replies=MQTTReplies(),
            sent=[],
        )
        mqtt = SimpleNamespace(is_connected=lambda: connected)
        self.target.api = SimpleNamespace(_mqtt_client=mqtt)
        return self.target

    async def test_query_sends_bare_project_order_and_returns_fresh_position(self):
        """1214 utilise la forme B sans data et valide la réponse MQTT de la cible."""
        target = self.make_target()

        async def send(order):
            target.sent.append(order.order_request_data)
            target.mqtt_replies.receive(
                {
                    "type": "axis",
                    "action": "query",
                    "state": "done",
                    "code": 200,
                    "msgid": "unrelated-axis-reply",
                    "data": {"coordinates": {"x": 0, "y": 0, "z": 0}},
                }
            )
            target.mqtt_replies.receive(
                {
                    "type": "axis",
                    "action": "query",
                    "state": "done",
                    "code": 200,
                    "msgid": "fixture-axis-1",
                    "data": {"coordinates": {"x": 47, "y": 276, "z": 3.815}},
                }
            )
            return "fixture-axis-1"

        target.api._send_anycubic_order = send
        result = await query_axis_position(target)

        self.assertEqual(target.sent, [{"order_id": 1214, "printer_id": 17, "project_id": 0}])
        self.assertEqual(result["position"], {"x": 47.0, "y": 276.0, "z": 3.815})
        stamp = datetime.fromisoformat(result["updated_at"])
        self.assertLess(abs((datetime.now(timezone.utc) - stamp).total_seconds()), 2)

    async def test_only_supported_online_targets_are_allowed(self):
        """Le modèle S1 est établi ; la seule capacité de mouvement ne prouve pas la lecture."""
        self.assertTrue(is_allowed(self.make_target()))
        self.assertFalse(is_allowed(self.make_target(model="Autre", capabilities=[67])))
        self.assertFalse(is_allowed(self.make_target(model="Autre")))
        self.assertFalse(is_allowed(self.make_target(connected=False)))

    async def test_unsupported_target_is_refused_without_sending(self):
        """Une cible inconnue est refusée avant toute commande cloud."""
        target = self.make_target(model="Autre")
        target.api._send_anycubic_order = AsyncMock()

        with self.assertRaisesRegex(ValueError, "pas prise en charge"):
            await query_axis_position(target)

        target.api._send_anycubic_order.assert_not_awaited()

    async def test_disconnected_target_is_refused_before_sending(self):
        """Une connexion MQTT absente ne déclenche aucune requête de position."""
        target = self.make_target(connected=False)
        target.api._send_anycubic_order = AsyncMock()

        with self.assertRaisesRegex(ValueError, "connexion à l’imprimante"):
            await query_axis_position(target)

        target.api._send_anycubic_order.assert_not_awaited()

    async def test_missing_or_nullable_coordinates_never_become_a_fake_position(self):
        """Une réponse vide ou partielle renvoie position None, jamais un zéro inventé."""
        for coordinates in (None, {}, {"x": 1, "y": 2, "z": None}, {"x": 1, "y": 2}):
            target = self.make_target()

            async def send(order, coordinates=coordinates, target=target):
                target.mqtt_replies.receive(
                    {
                        "type": "axis",
                        "action": "query",
                        "state": "done",
                        "code": 200,
                        "msgid": "fixture-axis-2",
                        "data": {"coordinates": coordinates},
                    }
                )
                return "fixture-axis-2"

            target.api._send_anycubic_order = send
            result = await query_axis_position(target)
            self.assertIsNone(result["position"])

    async def test_non_finite_axis_value_is_rejected(self):
        """NaN et les infinis ne peuvent pas devenir des coordonnées affichables."""
        target = self.make_target()

        async def send(order):
            target.mqtt_replies.receive(
                {
                    "type": "axis",
                    "action": "query",
                    "state": "done",
                    "code": 200,
                    "msgid": "fixture-axis-3",
                    "data": {"coordinates": {"x": float("nan"), "y": 2, "z": 3}},
                }
            )
            return "fixture-axis-3"

        target.api._send_anycubic_order = send
        with self.assertRaisesRegex(ValueError, "coordonnées"):
            await query_axis_position(target)

    async def test_refused_or_unexpected_reply_is_rejected(self):
        """Seule une réponse query/done/code 200 peut livrer une position."""
        for state, code in (("failed", 200), ("done", 403)):
            target = self.make_target()

            async def send(order, state=state, code=code, target=target):
                target.mqtt_replies.receive(
                    {
                        "type": "axis",
                        "action": "query",
                        "state": state,
                        "code": code,
                        "msgid": "fixture-axis-4",
                        "data": {"coordinates": {"x": 1, "y": 2, "z": 3}},
                    }
                )
                return "fixture-axis-4"

            target.api._send_anycubic_order = send
            with self.assertRaisesRegex(ValueError, "[Rr]éponse"):
                await query_axis_position(target)

    async def test_target_change_while_waiting_discards_reply(self):
        """La réponse ne s’applique jamais à une autre imprimante sélectionnée ensuite."""
        target = self.make_target()
        release = asyncio.Event()

        async def send(order):
            await release.wait()
            target.mqtt_replies.receive(
                {
                    "type": "axis",
                    "action": "query",
                    "state": "done",
                    "code": 200,
                    "msgid": "fixture-axis-5",
                    "data": {"coordinates": {"x": 1, "y": 2, "z": 3}},
                }
            )
            return "fixture-axis-5"

        target.api._send_anycubic_order = send
        task = asyncio.create_task(query_axis_position(target))
        await asyncio.sleep(0)
        target.printer = SimpleNamespace(id=18, machine_name="Anycubic Kobra S1")
        release.set()
        with self.assertRaisesRegex(ValueError, "cible de l’imprimante a changé"):
            await task

    async def test_timeout_from_existing_reply_helper_is_reported(self):
        """Un délai MQTT reste une erreur explicite au lieu de renvoyer un état ancien."""
        target = self.make_target()

        async def send(order):
            target.sent.append(order.order_request_data)
            return "fixture-timeout"

        target.api._send_anycubic_order = send
        target.mqtt_replies.ask = AsyncMock(
            side_effect=ValueError("L’imprimante n’a pas confirmé cette demande")
        )
        with self.assertRaisesRegex(ValueError, "n’a pas confirmé"):
            await query_axis_position(target)

    async def test_reply_helper_timeout_cleans_its_pending_correlation(self):
        """Le délai réel du corrélateur termine l’attente et libère sa clé msgid."""
        replies = MQTTReplies()

        async def accepted():
            return "fixture-timeout-cleanup"

        with self.assertRaisesRegex(ValueError, "n’a pas confirmé"):
            await replies.ask("axis", "query", accepted, 0.001)

        self.assertEqual(replies.pending, {})


if __name__ == "__main__":
    unittest.main()


class AxisRouterTests(unittest.TestCase):
    """Une consultation consommée ne rafraîchit pas les mesures et ne devient pas un type inconnu."""

    def test_axis_query_is_consumed_without_generic_reprocessing(self):
        """Le corrélateur de la cible reçoit la réponse une seule fois, sans effet de statut."""
        import json
        from unittest.mock import Mock, patch
        from server import CloudPageAPI
        from anycubic_cloud_api.api.mqtt import AnycubicMQTTAPI

        owner = SimpleNamespace(
            printer=SimpleNamespace(key="fixture-device"),
            fleet_registry=None,
            command_mqtt=None,
            receive_ai_reply=Mock(),
            receive_video_reply=Mock(),
            mqtt_replies=SimpleNamespace(receive=Mock()),
            mqtt_changed=Mock(),
        )
        api = object.__new__(CloudPageAPI)
        api.cloud_engine = owner
        payload = {
            "type": "axis",
            "action": "query",
            "state": "done",
            "code": 200,
            "msgid": "fixture-query",
            "data": {"coordinates": {"x": 0, "y": 0, "z": 0}},
        }
        message = SimpleNamespace(
            topic="anycubic/anycubicCloud/v1/printer/app/20025/fixture-device/axis",
            payload=json.dumps(payload).encode(),
            retain=False,
        )
        with patch.object(AnycubicMQTTAPI, "_mqtt_message_router") as generic:
            api._mqtt_message_router(message)
        owner.mqtt_replies.receive.assert_called_once_with(payload)
        generic.assert_not_called()
        owner.mqtt_changed.assert_not_called()
