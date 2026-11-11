"""Réglages au repos sur doublures : aucun transport Cloud ni matériel."""

import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock
from idle_controls import idle_limits, idle_request, set_idle


class IdleControlsTests(unittest.IsolatedAsyncioTestCase):
    """Une requête native est bornée et ne dépend jamais d’un ancien projet."""

    def target(self):
        """Prépare une S1 libre avec des limites explicitement annoncées."""
        p = SimpleNamespace(
            id=7,
            machine_name="Anycubic Kobra S1",
            printer_online=True,
            is_available=True,
            is_busy=False,
            latest_project_print_in_progress=False,
            fw_version=None,
        )
        return SimpleNamespace(
            printer=p,
            raw_info={
                "free_temp_limit": {"nozzle_temp_limit": [0, 320], "hotbed_temp_limit": [0, 110]}
            },
            refresh_printer_details=AsyncMock(),
            api=SimpleNamespace(_send_anycubic_order=AsyncMock(return_value="fixture-msg")),
        )

    def test_exact_envelope_and_unused_target(self):
        """La forme imprimante utilise un ordre texte et aucun project_id."""
        target = self.target()
        for values, kind, nozzle, bed in [
            ({"target_nozzle_temp": 200}, 0, 200, 0),
            ({"target_hotbed_temp": 60}, 1, 0, 60),
            ({"target_nozzle_temp": 0, "target_hotbed_temp": 0}, 2, 0, 0),
        ]:
            self.assertEqual(
                idle_request(target, values).order_request_data,
                {
                    "order_id": "1216",
                    "printer_id": 7,
                    "data": {"type": kind, "target_nozzle_temp": nozzle, "target_hotbed_temp": bed},
                },
            )
        self.assertEqual(
            idle_request(target, {"fan_speed_pct": 20}).order_request_data,
            {"order_id": "1221", "printer_id": 7, "data": {"fan_speed_pct": 20}},
        )

    def test_unknown_limits_model_and_invalid_values_never_send(self):
        """Pas de bornes par défaut, de conversion booléenne ni de requête ambiguë."""
        for values in (
            {},
            {"target_hotbed_temp": 111},
            {"target_nozzle_temp": True},
            {"fan_speed_pct": 101},
            {"fan_speed_pct": 20, "target_hotbed_temp": 30},
            {"fan_speed_pct": 20, "aux_fan_speed_pct": 30},
            {"task_settings": {}},
            {"target_nozzle_temp": "nan"},
        ):
            with self.subTest(values=values), self.assertRaises(ValueError):
                idle_request(self.target(), values)
        target = self.target()
        target.raw_info = {}
        self.assertEqual(idle_limits(target), {})

    def test_limits_encoded_as_json_text_are_validated(self):
        """Le détail Cloud S1 peut encoder les limites dans une chaîne JSON."""
        target = self.target()
        target.raw_info["free_temp_limit"] = json.dumps(target.raw_info["free_temp_limit"])
        self.assertEqual(idle_limits(target)["target_hotbed_temp"], [0, 110])
        for value in (
            "[]",
            "{",
            '{"hotbed_temp_limit":[0,400]}',
            '{"hotbed_temp_limit":[false,120]}',
        ):
            target.raw_info["free_temp_limit"] = value
            self.assertEqual(idle_limits(target), {})
        with self.assertRaises(ValueError):
            idle_request(target, {"target_hotbed_temp": 30})
        target = self.target()
        target.printer.machine_name = "Unknown"
        self.assertEqual(idle_limits(target), {})

    async def test_refresh_busy_and_changed_target_block_before_send(self):
        """La disponibilité et l’identité sont recontrôlées après l’attente réseau."""
        target = self.target()

        async def busy():
            "Rend la machine fictive occupée pendant la vérification de pré-envoi."
            target.printer.is_busy = True

        target.refresh_printer_details.side_effect = busy
        with self.assertRaises(ValueError):
            await set_idle(target, {"target_hotbed_temp": 30, "confirmed": True})
        target.api._send_anycubic_order.assert_not_awaited()
        target = self.target()

        async def changed():
            "Change l’identité de la cible fictive pendant la vérification réseau."
            target.printer.id = 8

        target.refresh_printer_details.side_effect = changed
        with self.assertRaises(ValueError):
            await set_idle(target, {"target_hotbed_temp": 30, "confirmed": True})
        target.api._send_anycubic_order.assert_not_awaited()

    async def test_single_send_and_no_retry_after_uncertain_result(self):
        """Un délai ne déclenche aucun second ordre matériel."""
        target = self.target()
        target.api._send_anycubic_order.side_effect = TimeoutError
        with self.assertRaises(TimeoutError):
            await set_idle(target, {"fan_speed_pct": 10, "confirmed": True})
        self.assertEqual(target.api._send_anycubic_order.await_count, 1)

    async def test_missing_confirmation_never_refreshes_or_sends(self):
        """Le serveur ne confond pas une saisie ou une chaîne avec une confirmation explicite."""
        for confirmed in (None, False, "true", 1):
            target = self.target()
            with self.assertRaises(ValueError):
                await set_idle(target, {"target_hotbed_temp": 30, "confirmed": confirmed})
            target.refresh_printer_details.assert_not_awaited()
            target.api._send_anycubic_order.assert_not_awaited()
