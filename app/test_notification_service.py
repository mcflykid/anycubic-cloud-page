"""Vérifie les contrats fictifs des deux journaux de notifications."""

import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from notification_service import AccountNotifications


class NotificationSourceTests(unittest.IsolatedAsyncioTestCase):
    """Reproduit la divergence de journaux sans accès à un compte réel."""

    async def test_slicer_completion_uses_its_own_count_and_cannot_mutate_legacy(self):
        """Affiche la fin d’impression et interdit les mutations avec sa référence."""
        service = AccountNotifications()
        api = SimpleNamespace(
            _fetch_api_resp=AsyncMock(
                side_effect=[
                    {
                        "code": 1,
                        "pageData": {"page": 1, "page_count": 2, "total": 23},
                        "data": [
                            {
                                "id": 18,
                                "task_id": 24,
                                "task_name": "Cube de contrôle",
                                "alarm_code": 200,
                                "status": 0,
                                "latest_time": 1762340000,
                                "printer_list": [
                                    {"printer_id": 42, "name": "Kobra de démonstration"}
                                ],
                                "thumbnail": "https://example.invalid/private.jpg?signature=fixture",
                            }
                        ],
                    },
                    {"code": 1, "data": {"total": 23, "unread_total": 5}},
                    {"code": 1, "data": [{"id": 18, "project_name": "Ancienne tâche"}]},
                    {"code": 1, "data": [{"type": 1, "count": 1, "newcount": 0}]},
                ]
            )
        )
        slicer = await service.page(api, 1)
        self.assertEqual(slicer["source"], "slicer")
        self.assertEqual(slicer["unread"], 5)
        self.assertTrue(slicer["has_more"])
        (row,) = slicer["items"]
        self.assertEqual(row["name"], "Cube de contrôle")
        self.assertEqual(row["result"], "Impression terminée")
        self.assertEqual(row["printer"], "Kobra de démonstration")
        self.assertTrue(row["unread"])
        self.assertNotIn("signature", repr(slicer))
        calls = api._fetch_api_resp.await_args_list
        self.assertEqual(
            [call.args[0].endpoint for call in calls],
            [
                "/farm/message/list",
                "/farm/message/statistics",
            ],
        )
        self.assertEqual(
            calls[0].kwargs["params"],
            {
                "page": 1,
                "limit": 20,
                "status": -1,
                "aggregate_mode": 0,
                "update_status": 0,
                "keyword": "",
            },
        )
        self.assertEqual(calls[1].kwargs["params"], {"aggregate_mode": 0})
        legacy = await service.page(api, 1, "legacy")
        self.assertNotEqual(legacy["items"][0]["key"], row["key"])
        self.assertEqual((await service.page(api, 1))["source"], "slicer")
        with self.assertRaises(ValueError):
            await service.mark_read(api, row["key"])
        with self.assertRaises(ValueError):
            await service.delete(api, row["key"])
        self.assertEqual(api._fetch_api_resp.await_count, 4)

    async def test_legacy_remains_available_if_slicer_is_refused(self):
        """Préserve la liste historique quand la route du slicer refuse le compte."""
        service = AccountNotifications()
        api = SimpleNamespace(
            _fetch_api_resp=AsyncMock(
                side_effect=[
                    {"code": 0},
                    {"code": 1, "data": [{"id": 10, "project_name": "Tâche historique"}]},
                    {"code": 1, "data": [{"type": 1, "count": 1, "newcount": 0}]},
                    {"code": 0},
                ]
            )
        )
        result = await service.page(api, 1)
        self.assertEqual(result["source"], "legacy")
        self.assertEqual(result["items"][0]["name"], "Tâche historique")
        with self.assertRaisesRegex(ValueError, "journal du slicer"):
            await service.page(api, 2, "slicer")
        self.assertEqual(api._fetch_api_resp.await_count, 4)
