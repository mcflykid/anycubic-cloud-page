"""Vérifie la navigation et le déplacement Cloud sans requête réelle."""

import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from cloud_extras import key
from printer_files import cloud_files, move_cloud_files


class CloudFolderTests(unittest.IsolatedAsyncioTestCase):
    """Contrôle le contrat Cloud et les références acceptées avant mutation."""

    async def test_move_only_files_from_the_selected_folder_and_page(self):
        """La sélection validée ne peut être réutilisée après un déplacement."""
        api = AsyncMock()
        extras = SimpleNamespace(
            api=AsyncMock(
                side_effect=[
                    [
                        {"id": 10, "parent_folder_id": 0, "name": "Atelier"},
                        {"id": 12, "parent_folder_id": 10, "name": "Pièces"},
                        {"id": 13, "parent_folder_id": 13, "name": "Boucle"},
                        {"id": 14, "parent_folder_id": 0, "name": ".."},
                        {"id": 15, "parent_folder_id": 0, "name": "a/b"},
                    ],
                    [
                        {
                            "id": 42,
                            "folder_id": 0,
                            "is_folder": False,
                            "old_filename": "exemple.gcode",
                            "size": 50,
                        },
                        {
                            "id": 44,
                            "folder_id": 12,
                            "is_folder": False,
                            "old_filename": "autre.gcode",
                            "size": 50,
                        },
                    ],
                    None,
                ]
            ),
            folder_selection=None,
        )
        target = SimpleNamespace(api=api, extras=extras, cloudfiles={})
        api.get_user_cloud_store.return_value = SimpleNamespace(
            total_bytes=100, used_bytes=50, available_bytes=50
        )
        page = await cloud_files(target, 1, "root")
        self.assertEqual(
            [entry["path"] for entry in page["folders"]], ["/", "/Atelier", "/Atelier/Pièces"]
        )
        self.assertEqual([entry["handle"] for entry in page["files"]], [key(42)])
        self.assertFalse(target.cloudfiles)
        self.assertEqual(
            extras.api.await_args_list[0].kwargs,
            {
                "method": "GET",
                "query": {"parent_folder_id": "0", "all": "true"},
            },
        )
        self.assertEqual(extras.api.await_args_list[1].args[0], "/work/index/userFiles")
        self.assertEqual(extras.api.await_args_list[1].args[1]["folder_id"], 0)
        intent = {"source": "root", "destination": key("folder:12"), "handles": [key(42)]}
        with self.assertRaises(ValueError):
            await move_cloud_files(target, {**intent, "handles": [key(44)]})
        self.assertEqual(extras.api.await_count, 2)
        await move_cloud_files(target, intent)
        extras.api.assert_awaited_with(
            "/v5/cloud-file/item/move", {"target_folder_id": 12, "file_ids": [42], "folder_ids": []}
        )
        with self.assertRaises(ValueError):
            await move_cloud_files(target, intent)
        self.assertEqual(extras.api.await_count, 3)

    async def test_transport_timeout_cannot_replay_the_same_selection(self):
        """Une mutation incertaine invalide les références avant toute réponse du fournisseur."""
        api = AsyncMock()
        extras = SimpleNamespace(
            api=AsyncMock(side_effect=TimeoutError),
            folder_selection=(api, float("inf"), "root", {"known": (12, "/Atelier")}, {"file": 42}),
        )
        target = SimpleNamespace(api=api, extras=extras)
        intent = {"source": "root", "destination": "known", "handles": ["file"]}
        with self.assertRaises(TimeoutError):
            await move_cloud_files(target, intent)
        with self.assertRaises(ValueError):
            await move_cloud_files(target, intent)
        extras.api.assert_awaited_once()
