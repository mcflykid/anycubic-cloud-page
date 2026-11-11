"""Refus explicites de lancement pendant une mise à jour confirmée."""

import unittest
from unittest.mock import patch
from types import SimpleNamespace
from print_preflight import ensure_firmware_ready
from printer_commands import execute_command


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
                    {"target_nozzle_temp": 200},
                )
                self.assertIn("acceptée", result)
                api._send_order_change_print_settings.assert_awaited_once()
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
