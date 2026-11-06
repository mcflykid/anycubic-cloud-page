"""Vérifie les messages de séchage sans utiliser de transport ni de véritable imprimante."""

import types, unittest
from unittest.mock import AsyncMock
from anycubic_cloud_api.api.functions import AnycubicAPIFunctions


class DryingTarget(unittest.IsolatedAsyncioTestCase):
    """Le boîtier demandé doit être celui du message final, y compris avec plusieurs ACE."""

    async def payload(self, units, box):
        """Renvoie la commande sérialisée vers une doublure, pour le nombre de boîtiers demandé."""
        api = types.SimpleNamespace(_send_anycubic_order=AsyncMock(return_value="fixture-message"))
        api._send_order_multi_color_box_dry = types.MethodType(
            AnycubicAPIFunctions._send_order_multi_color_box_dry, api
        )
        printer = types.SimpleNamespace(
            primary_multi_color_box=True, connected_ace_units=units, id=1
        )
        result = await AnycubicAPIFunctions.multi_color_box_drying_stop(api, printer, box_id=box)
        self.assertEqual(result, "fixture-message")
        return api._send_anycubic_order.call_args.kwargs["order_request"].order_request_data

    async def test_second_ace_is_targeted(self):
        """Un arrêt du second ACE ne doit jamais être redirigé vers le premier."""
        data = await self.payload(2, 1)
        self.assertEqual(
            data["data"]["multi_color_box"],
            [
                {
                    "id": 1,
                    "drying_status": {
                        "duration": 0,
                        "remain_time": None,
                        "status": 0,
                        "target_temp": 40,
                    },
                }
            ],
        )

    async def test_first_and_single_ace_keep_original_payload(self):
        """L’identifiant zéro et les valeurs de séchage par défaut sont inchangés pour un seul ACE."""
        for units in [1, 2]:
            data = await self.payload(units, 0)
            self.assertEqual(
                data["data"]["multi_color_box"],
                [
                    {
                        "id": 0,
                        "drying_status": {
                            "duration": 0,
                            "remain_time": None,
                            "status": 0,
                            "target_temp": 40,
                        },
                    }
                ],
            )

    async def test_global_stop_keeps_one_entry_per_ace(self):
        """L’arrêt global conserve la numérotation et le nombre d’ordres pour un ou plusieurs ACE."""
        for units in [1, 2]:
            data = await self.payload(units, -1)
            self.assertEqual(
                data["data"]["multi_color_box"],
                [
                    {
                        "id": box,
                        "drying_status": {
                            "duration": 0,
                            "remain_time": None,
                            "status": 0,
                            "target_temp": 40,
                        },
                    }
                    for box in range(units)
                ],
            )

    async def test_missing_ace_sends_nothing(self):
        """L’absence de boîtier ne doit pas produire une commande adressée au boîtier zéro."""
        api = types.SimpleNamespace(_send_order_multi_color_box_dry=AsyncMock())
        result = await AnycubicAPIFunctions.multi_color_box_drying_stop(
            api, types.SimpleNamespace(primary_multi_color_box=None), 1
        )
        self.assertIsNone(result)
        api._send_order_multi_color_box_dry.assert_not_called()
