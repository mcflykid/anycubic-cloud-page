"""Contrat local de sérialisation des demandes d’impression depuis la mémoire."""

import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from anycubic_cloud_api.api.functions import AnycubicAPIFunctions
from anycubic_cloud_api.const.enums import AnycubicOrderID
from anycubic_cloud_api.data_models.orders import (
    AnycubicProjectCtrlOrderRequest,
    AnycubicStartPrintRequestLocal,
)
from anycubic_cloud_api.data_models.printer import AnycubicPrinter
from anycubic_cloud_api.data_models.printer_properties import AnycubicMultiColorBox


class LocalPrintPayloadTests(unittest.TestCase):
    """Fige le contrat de sérialisation établi sans prétendre prouver son acceptation par le firmware."""

    def test_local_file_payload_uses_rooted_path_and_filetype_one(self):
        """Le nom et le dossier natifs doivent rester distincts dans une demande de fichier mémoire."""
        request = AnycubicStartPrintRequestLocal(
            filename="piece.gcode",
            filepath="/jobs/ready/",
        )

        self.assertEqual(
            request.data,
            {
                "filetype": 1,
                "file_key": "",
                "file_name": "",
                "task_settings": {"ai_detect": 0, "camera_timelapse": 0},
                "filename": "piece.gcode",
                "filepath": "/jobs/ready",
            },
        )

    def test_local_file_payload_uses_root_for_empty_path(self):
        """Un dossier vide conserve la sémantique de la racine attendue par le protocole."""
        request = AnycubicStartPrintRequestLocal(filename="piece.gcode")

        self.assertEqual(request.filepath, "/")
        self.assertEqual(request.data["filetype"], 1)

    def test_start_print_envelope_wraps_local_payload_without_plate_fields(self):
        """Aucun champ de plateau ou de mode non établi ne doit être ajouté au lancement local."""
        payload = AnycubicStartPrintRequestLocal(
            filename="piece.gcode",
            filepath="jobs/ready",
        )
        request = AnycubicProjectCtrlOrderRequest(
            order_id=AnycubicOrderID.START_PRINT,
            printer_id=7,
            project_id=0,
            order_data=payload.data,
            ams_box_mapping=None,
            print_settings=None,
        )

        self.assertEqual(
            request.order_request_data,
            {
                "order_id": int(AnycubicOrderID.START_PRINT),
                "printer_id": 7,
                "project_id": 0,
                "data": {
                    "filetype": 1,
                    "file_key": "",
                    "file_name": "",
                    "task_settings": {"ai_detect": 0, "camera_timelapse": 0},
                    "filename": "piece.gcode",
                    "filepath": "/jobs/ready",
                },
                "ams_info": None,
                "settings": None,
            },
        )
        self.assertNotIn("plate_index", request.order_request_data["data"])


class StoredPrintSpoolTests(unittest.IsolatedAsyncioTestCase):
    """Vérifie l’ordre mémoire à la sortie de Cloud Page, avant transmission."""

    async def test_selected_slot_is_independent_of_loaded_filament(self):
        """Le filament présent dans la tête ne doit pas remplacer le choix affiché."""
        from printer_commands import slot_indices

        send = AsyncMock()
        api = SimpleNamespace(_send_anycubic_order=send)
        api._send_order_start_print = AnycubicAPIFunctions._send_order_start_print.__get__(api)
        api._send_order_print_local_file = (
            AnycubicAPIFunctions._send_order_print_local_file.__get__(api)
        )
        printer = AnycubicPrinter(api, 1, "Anycubic Kobra S1", id=7)
        printer._multi_color_box = [
            AnycubicMultiColorBox(
                id=0,
                status=1,
                model_id=1,
                auto_feed=0,
                loaded_slot=2,
                feed_status=None,
                temp=25,
                drying_status=None,
                curr_nozzle_temp=None,
                target_nozzle_temp=None,
                slots=[
                    {
                        "index": index,
                        "sku": "",
                        "type": "PLA",
                        "color": [50 * index, 10, 10],
                        "edit_status": 0,
                        "status": 5,
                    }
                    for index in range(4)
                ],
            )
        ]
        target = SimpleNamespace(printer=printer)

        for selection, expected in (([], None), ([1], (0, 0)), ([3], (0, 2))):
            with self.subTest(selection=selection):
                indices = slot_indices(target, {"slots": selection})
                await printer.print_local_file("piece.gcode", slot_index_list=indices)
                order = send.await_args.kwargs["order_request"].order_request_data
                if expected is None:
                    self.assertIsNone(order["ams_info"])
                else:
                    self.assertTrue(order["ams_info"]["use_ams"])
                    (row,) = order["ams_info"]["ams_box_mapping"]
                    self.assertEqual((row["paint_index"], row["ams_index"]), expected)


class StoredFormatSafetyTests(unittest.IsolatedAsyncioTestCase):
    """Un modèle non qualifié ne doit jamais parvenir à l’ordre physique de lancement."""

    async def test_unverified_formats_are_rejected_before_any_send(self):
        """Les paquets tranchés restent distincts des G-code simples tant que leur contrat est inconnu."""
        from printer_commands import execute_command

        for filename in ("piece.3mf", "piece.gcode.3mf", "piece.stl", "piece.bin"):
            printer = SimpleNamespace(
                id=7,
                connected_ace_units=0,
                is_available=True,
                print_local_file=AsyncMock(),
                fw_version=None,
            )
            target = SimpleNamespace(
                printer=printer, api=SimpleNamespace(), slots=lambda data: None
            )
            with self.subTest(filename=filename), self.assertRaises(ValueError):
                await execute_command(target, "print-local", {"name": filename, "path": "/"})
            printer.print_local_file.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
