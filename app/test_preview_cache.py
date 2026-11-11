"""Les miniatures locales expirent et les suppressions confirmées les invalident."""

import base64
import time
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from printer_commands import execute_command
from printer_files import local_preview, read_files


class PreviewCacheTests(unittest.IsolatedAsyncioTestCase):
    """Vérifie le cache avec réponses MQTT fictives et suppressions simulées."""

    async def test_preview_is_reloaded_after_bounded_expiration(self):
        """Un nom inchangé ne peut garder une miniature ancienne au-delà de sa durée bornée."""
        image = base64.b64encode(b"\x89PNG\r\n\x1a\nfixture").decode()
        target = SimpleNamespace(
            preview_cache={},
            printer=SimpleNamespace(id=42),
            mqtt_replies=AsyncMock(ask=AsyncMock(return_value={"data": {"thumbnail": image}})),
            api=SimpleNamespace(_send_anycubic_order=AsyncMock()),
        )
        with patch("printer_files.time.monotonic", side_effect=(10, 69, 71, 72)):
            first = await local_preview(target, "local", "model.gcode", "/folder")
            cached = await local_preview(target, "local", "model.gcode", "/folder")
            refreshed = await local_preview(target, "local", "model.gcode", "/folder")
        self.assertEqual(first, cached)
        self.assertEqual(first, refreshed)
        self.assertEqual(target.mqtt_replies.ask.await_count, 2)

    async def test_refreshed_folder_invalidates_replaced_file_metadata(self):
        """Une actualisation voit le remplacement d’un même nom et force une nouvelle miniature."""
        printer = SimpleNamespace(
            machine_name="Fixture S1",
            _set_local_file_list=lambda records, file_path: setattr(
                printer, "local_file_list_object", records
            ),
        )
        target = SimpleNamespace(
            printer=printer,
            api=SimpleNamespace(
                _mqtt_client=SimpleNamespace(is_connected=lambda: True),
                _send_order_list_local_files=AsyncMock(),
            ),
            mqtt_replies=AsyncMock(
                ask=AsyncMock(
                    return_value={
                        "state": "done",
                        "data": {
                            "records": [
                                {
                                    "filename": "model.gcode",
                                    "timestamp": 200,
                                    "size": 20,
                                    "is_dir": False,
                                }
                            ]
                        },
                    }
                )
            ),
            preview_cache={
                ("local", "folder/model.gcode"): (10, "old-image"),
                ("local", "other/model.gcode"): (10, "other-image"),
                ("usb", "folder/model.gcode"): (10, "usb-image"),
            },
        )
        result = await read_files(target, "local", "/folder")
        self.assertEqual(result["files"][0]["timestamp"], 200)
        self.assertNotIn(("local", "folder/model.gcode"), target.preview_cache)
        self.assertIn(("local", "other/model.gcode"), target.preview_cache)
        self.assertIn(("usb", "folder/model.gcode"), target.preview_cache)

    async def test_confirmed_local_and_usb_deletions_invalidate_only_their_preview(self):
        """Un effacement accepté retire l’aperçu correspondant, sans toucher l’autre source."""
        for action, source, method in (
            ("delete-local", "local", "delete_local_file"),
            ("delete-usb", "usb", "delete_udisk_file"),
        ):
            printer = SimpleNamespace(
                connected_ace_units=0,
                **{method: AsyncMock(return_value="accepted")},
            )
            target = SimpleNamespace(
                printer=printer,
                api=SimpleNamespace(),
                preview_cache={
                    (source, "folder/model.gcode"): (time.monotonic(), "fixture-image"),
                    ("other", "folder/model.gcode"): (time.monotonic(), "keep-image"),
                },
            )
            await execute_command(target, action, {"name": "model.gcode", "path": "/folder/"})
            self.assertNotIn((source, "folder/model.gcode"), target.preview_cache)
            self.assertIn(("other", "folder/model.gcode"), target.preview_cache)

    async def test_unconfirmed_delete_keeps_existing_preview(self):
        """Une réponse de suppression refusée ne détruit pas un cache encore potentiellement valide."""
        target = SimpleNamespace(
            printer=SimpleNamespace(
                connected_ace_units=0, delete_local_file=AsyncMock(return_value=None)
            ),
            api=SimpleNamespace(),
            preview_cache={("local", "model.gcode"): (10, "fixture-image")},
        )
        with self.assertRaisesRegex(ValueError, "Aucune commande acceptée"):
            await execute_command(target, "delete-local", {"name": "model.gcode"})
        self.assertEqual(target.preview_cache[("local", "model.gcode")][1], "fixture-image")
