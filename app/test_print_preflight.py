"""Refus explicites de lancement pendant une mise à jour confirmée."""

import unittest
from unittest.mock import patch
from types import SimpleNamespace
from print_preflight import ensure_firmware_ready
from printer_commands import execute_command


class LaunchTrackingTests(unittest.TestCase):
    """Le suivi ne doit jamais confondre une tâche précédente avec le lancement demandé."""

    def test_tracking_uses_cloud_file_reference_and_previous_project(self):
        """Un accusé sans référence de fichier ne permet pas de corréler le démarrage."""
        from print_preflight import launch_tracking, print_file_references

        previous = "fixture-previous"
        response = SimpleNamespace(event_dict={"gcode_id": 42, "cloud_file_id": 52})
        tracking = launch_tracking(previous, response)
        self.assertEqual(tracking["previous_project"], previous)
        self.assertEqual(tracking["files"], print_file_references(42, 52))
        self.assertEqual(len(tracking["files"]), 2)
        self.assertIsNone(launch_tracking(previous, SimpleNamespace(event_dict={})))

    def test_selected_spool_must_still_be_present(self):
        """Un emplacement retiré ou vide doit être refusé avant la conversion d’indices."""
        from print_preflight import validate_print_indices

        box = [
            {"display_slot": 1, "spool_loaded": True},
            {"display_slot": 2, "spool_loaded": False},
        ]
        printer = SimpleNamespace(
            primary_multi_color_box_spool_info_object=box,
            print_slot_numbers_to_indices=lambda slots: [slot - 1 for slot in slots],
        )
        validate_print_indices(printer, [0])
        for selected in ([1], [2]):
            with self.assertRaisesRegex(ValueError, "bobine sélectionnée"):
                validate_print_indices(printer, selected)


class FirmwarePreflightTests(unittest.IsolatedAsyncioTestCase):
    """Une proposition de mise à jour ne vaut pas mise à jour en cours."""

    async def test_task_settings_require_an_active_project(self):
        """Un projet historique terminé ne suffit pas pour envoyer des réglages de tâche."""
        from unittest.mock import AsyncMock

        for active in (False, True):
            printer = SimpleNamespace(
                connected_ace_units=0,
                latest_project=SimpleNamespace(id=10),
                latest_project_print_in_progress=active,
            )
            api = SimpleNamespace(
                _send_order_change_print_settings=AsyncMock(return_value="accepted")
            )
            if active:
                result = await execute_command(
                    SimpleNamespace(printer=printer, api=api),
                    "settings",
                    {"box_fan_level": "33"},
                )
                self.assertIn("acceptée", result)
                api._send_order_change_print_settings.assert_awaited_once()
                _, settings = api._send_order_change_print_settings.await_args.args
                self.assertEqual(settings.settings_data, {"box_fan_level": 33})
            else:
                with self.assertRaisesRegex(ValueError, "impression active"):
                    await execute_command(
                        SimpleNamespace(printer=printer, api=api),
                        "settings",
                        {"target_nozzle_temp": 200},
                    )
                api._send_order_change_print_settings.assert_not_awaited()

    async def test_updating_printer_sends_no_start_command(self):
        """Les parcours Cloud et supports locaux refusent avant tout appel de lancement."""
        printer = SimpleNamespace(fw_version=SimpleNamespace(is_updating=True), id=1)
        api = SimpleNamespace()
        target = SimpleNamespace(printer=printer, api=api)
        for action in ["print-local", "print-usb", "print-cloud"]:
            with (
                self.subTest(action=action),
                self.assertRaisesRegex(ValueError, "Mise à jour en cours"),
            ):
                await execute_command(target, action, {})

    async def test_proposed_and_missing_update_do_not_block(self):
        """Une donnée absente reste inconnue et une mise à jour proposée reste facultative."""
        for printer in [
            SimpleNamespace(),
            SimpleNamespace(fw_version=SimpleNamespace(is_updating=False, update_available=True)),
        ]:
            self.assertIsNone(ensure_firmware_ready(printer))

    async def test_advisory_preflight_resolves_slots_per_box(self):
        """Les emplacements globaux 5–8 lisent les bobines du second ACE."""
        from print_preflight import evaluate_preflight

        snapshot = {
            "boxes": [
                {
                    "box_id": 0,
                    "spools": [{"display_slot": 1, "material_type": "PLA", "color": [255, 0, 0]}],
                },
                {
                    "box_id": 1,
                    "spools": [{"display_slot": 5, "material_type": "ABS", "color": [0, 0, 0]}],
                },
            ]
        }
        warnings = evaluate_preflight(
            snapshot, {"materials": ["PLA"], "slots": [5], "colors": [[255, 0, 0]]}
        )
        self.assertIn("material-mismatch", warnings)
        self.assertIn("color-mismatch", warnings)
        self.assertIn("mixed-temperatures", warnings)
        self.assertIn("metadata-missing", evaluate_preflight(snapshot, {"slots": [2]}))
        with self.assertRaises(ValueError):
            evaluate_preflight(snapshot, {"materials": "PLA", "slots": [1]})

    async def test_storage_refusal_is_checked_before_upload(self):
        """Une insuffisance de quota explicite n’est pas un résultat de lancement ambigu."""
        from print_preflight import ensure_storage_ready

        for available in (None, True, -1, "unknown"):
            self.assertIsNone(ensure_storage_ready(available, 100))
        self.assertIsNone(ensure_storage_ready(100, 100))
        with self.assertRaisesRegex(ValueError, "quota Cloud"):
            ensure_storage_ready(99, 100)

    async def test_update_starting_during_transfer_is_caught_before_final_print_order(self):
        """Le dernier envoi contrôle à nouveau le firmware, même si le transfert a déjà fini."""
        from server import CloudPageAPI
        from anycubic_cloud_api.const.enums import AnycubicOrderID
        from anycubic_cloud_api.data_models.orders import AnycubicProjectOrderRequest
        from anycubic_cloud_api.api.mqtt import AnycubicMQTTAPI
        from unittest.mock import AsyncMock

        printer = SimpleNamespace(id=7, fw_version=SimpleNamespace(is_updating=True))
        api = object.__new__(CloudPageAPI)
        api.cloud_engine = SimpleNamespace(
            printer=printer, fleet_registry=None, known_printers=[printer]
        )
        order = AnycubicProjectOrderRequest(
            order_id=AnycubicOrderID.START_PRINT, printer_id=7, project_id=0, order_data={}
        )
        with patch.object(
            AnycubicMQTTAPI, "_send_anycubic_order", new=AsyncMock(return_value="fixture")
        ) as send:
            with self.assertRaisesRegex(ValueError, "Mise à jour en cours"):
                await api._send_anycubic_order(order)
            send.assert_not_awaited()
