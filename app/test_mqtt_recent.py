"""Régressions de firmwares récents sur rapports synthétiques, sans transport physique."""

import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
from anycubic_cloud_api.data_models.printer import AnycubicPrinter
from anycubic_cloud_api.data_models.project import AnycubicProject
from anycubic_cloud_api.data_models.consumable import AnycubicConsumableData as Data
from anycubic_cloud_api.data_models.printer_properties import (
    AnycubicDryingStatus,
    AnycubicMultiColorBox,
)
from anycubic_cloud_api.exceptions.exceptions import AnycubicAPIError
import server


class RecentReports(unittest.TestCase):
    """Préserve les états machine et ACE malgré les rapports partiels et les phases nouvelles."""

    def setUp(self):
        """Construit un vrai modèle avec transport neutralisé, pas une imprimante connectée."""
        self.p = AnycubicPrinter(
            api_parent=Mock(),
            machine_type=20025,
            machine_name="Anycubic Kobra S1",
            id=1,
            device_status=1,
            ignore_init_errors=True,
        )

    def test_serialized_ace_slots_keep_physical_indices_when_sparse(self):
        """Un rapport réordonné ne doit pas attribuer la fiche RFID à un autre emplacement."""
        self.p._multi_color_box = [
            AnycubicMultiColorBox(
                id=0,
                status=1,
                model_id=1,
                auto_feed=0,
                loaded_slot=0,
                feed_status=None,
                temp=35,
                drying_status=None,
                curr_nozzle_temp=None,
                target_nozzle_temp=None,
                slots=[
                    {
                        "index": 2,
                        "sku": "AHLSMW-101",
                        "type": "PLA Marble",
                        "color": [230, 230, 230],
                        "status": 5,
                        "edit_status": 0,
                    },
                    {
                        "index": 0,
                        "sku": "AHFGBL-101",
                        "type": "PLA Glow",
                        "color": [0, 0, 255],
                        "status": 5,
                        "edit_status": 0,
                    },
                ],
            )
        ]
        engine = server.Engine()
        engine.printer = self.p
        spools = engine.snapshot()["printer"]["boxes"][0]["spools"]
        self.assertEqual(
            [(spool["local_slot"], spool["filament_profile"]) for spool in spools],
            [(1, "PLA Glow"), (3, "PLA Marble")],
        )
        box = self.p._multi_color_box[0]
        material = {"filament_used": 0, "material_type": "PLA Marble", "paint_index": 0}
        self.assertEqual(box.build_mapping_for_material_list([2], [material])[0].spool_index, 2)
        with self.assertRaises(AnycubicAPIError):
            box.build_mapping_for_material_list([1], [material])
        box.update_slots_with_mqtt_data(
            [
                {
                    "index": 2,
                    "sku": "UNKNOWN",
                    "type": "PLA",
                    "color": [0, 0, 0],
                    "status": 5,
                    "edit_status": 0,
                }
            ]
        )
        spools = engine.snapshot()["printer"]["boxes"][0]["spools"]
        self.assertEqual(spools[0]["filament_profile"], "PLA Glow")
        self.assertNotIn("filament_profile", spools[1])
        self.assertEqual([s["filament_recognition"] for s in spools], ["exact", "unknown"])

    def test_preparation_is_busy_and_terminal_project_is_not_revived(self):
        """Toutes les phases connues interdisent une machine libre ; un rapport tardif respecte la fin."""
        phases = [
            "nozzle_purging",
            "nozzle_heating",
            "nozzle_cooling",
            "nozzle_cooling_off",
            "nozzle_wiping",
            "hotbed_heating",
            "hotbed_cooling_off",
            "auto_leveling",
            "z_offset_calibrating",
            "frequency_sweeping",
            "filament_cutting",
            "extfilbox_filament_feeding",
            "extfilbox_filament_unfeeding",
            "ace_filament_feeding",
            "ace_filament_unfeeding",
        ]
        for phase in phases:
            self.p._is_printing = 1
            self.p._process_mqtt_update_print("start", phase, Data({"data": {"taskid": 1}}))
            self.assertTrue(self.p.is_busy, phase)
        self.p._latest_project = SimpleNamespace(id=1, print_complete=True, print_failed=False)
        self.p._is_printing = 1
        self.p._process_mqtt_update_print("start", "nozzle_cooling", Data({"data": {"taskid": 1}}))
        self.assertFalse(self.p.is_busy)

    def test_stop_in_progress_keeps_machine_busy_until_confirmation(self):
        """Une demande d’arrêt n’est pas encore un retour au repos."""
        self.p._latest_project = Mock(id=1)
        self.p._process_mqtt_update_print("stop", "stopping", Data({"data": {"taskid": 1}}))
        self.assertTrue(self.p.is_busy)
        self.p._latest_project.update_with_mqtt_print_status_data.assert_not_called()
        self.p._process_mqtt_update_print("stop", "stoped", Data({"data": {"taskid": 2}}))
        self.assertTrue(self.p.is_busy)
        self.p._process_mqtt_update_print("stop", "stoped", Data({"data": {"taskid": 1}}))
        self.assertTrue(self.p.is_available)

    def test_kobra_x_status_property_reflects_reported_task_phase(self):
        """L’indicateur d’état affiche la phase Kobra X déjà déterminée par les rapports connus."""
        project = SimpleNamespace(print_status="unknown")
        printer = SimpleNamespace(latest_project=project, _kobra_x_project_phase="preheating")
        self.assertEqual(AnycubicPrinter.latest_project_print_status.fget(printer), "preheating")
        printer._kobra_x_project_phase = "printing"
        self.assertEqual(AnycubicPrinter.latest_project_print_status.fget(printer), "printing")

    def test_print_report_consumes_known_metadata_without_temperature_side_effects(self):
        """Les métadonnées de fichier et de routage ne restent pas signalées comme inconnues ni comme mesures."""
        project = AnycubicProject(
            api_parent=Mock(),
            id=1,
            taskid=1,
            gcode_id=2,
            estimate=0,
            progress=0,
            status=1,
            create_time=0,
            gcode_name="fixture.gcode",
        )
        self.p._latest_project = project
        payload = Data(
            {
                "type": "print",
                "action": "update",
                "state": "updated",
                "data": {
                    "taskid": 1,
                    "channel_no": 0,
                    "unit_no": 0,
                    "target_temp": 210,
                    "file_root_path": "/fixture",
                    "filetype": "gcode",
                },
            }
        )
        self.p.process_mqtt_update("fixture_topic", payload)
        self.assertTrue(payload.is_empty)
        self.assertIsNone(project.target_nozzle_temp)
        self.assertIsNone(project.target_hotbed_temp)

    def test_partial_drying_and_feed_reports_preserve_previous_values(self):
        """Omettre temp ou feed_status ne détruit pas les autres états reçus."""
        box = AnycubicMultiColorBox(
            id=0,
            status=1,
            model_id=1,
            curr_nozzle_temp=None,
            target_nozzle_temp=None,
            auto_feed=0,
            loaded_slot=0,
            slots=[],
            temp=35,
            feed_status=None,
            drying_status=None,
        )
        self.p._multi_color_box = [box]
        self.p._process_mqtt_update_multicolorbox(
            "setDry",
            "success",
            Data(
                {
                    "data": {
                        "multi_color_box": [
                            {
                                "id": 0,
                                "drying_status": {
                                    "status": 1,
                                    "target_temp": 45,
                                    "duration": 240,
                                    "remain_time": 120,
                                },
                            }
                        ]
                    }
                }
            ),
        )
        self.assertEqual(box.current_temperature, 35)
        self.assertTrue(box.drying_status.is_drying)
        self.p._process_mqtt_update_multicolorbox(
            "feedFilament",
            "done",
            Data({"data": {"multi_color_box": [{"id": 0, "loaded_slot": 2}]}}),
        )
        self.assertEqual(box.loaded_slot, 2)

    def test_ace_measurements_override_http_independently_until_stale(self):
        """Une actualisation HTTP ne rétablit pas un relevé plus ancien pendant le séchage."""
        box = AnycubicMultiColorBox(
            id=0,
            status=1,
            model_id=1,
            curr_nozzle_temp=None,
            target_nozzle_temp=None,
            auto_feed=0,
            loaded_slot=0,
            slots=[],
            temp=28,
            feed_status=None,
            drying_status=None,
        )
        self.p._multi_color_box = [box]
        engine = server.Engine()
        engine.printer = self.p
        engine.raw_info = {"multi_color_box": [{"id": 0, "humidity": 17}]}
        with patch("anycubic_cloud_api.data_models.printer.monotonic", return_value=10) as clock:
            self.p._process_mqtt_update_multicolorbox(
                "autoUpdateDryStatus",
                "success",
                Data(
                    {
                        "data": {
                            "multi_color_box": [
                                {
                                    "id": 0,
                                    "temp": 39,
                                    "humidity": 18,
                                    "drying_status": None,
                                }
                            ]
                        }
                    }
                ),
            )
            box.set_current_temperature(28)
            clock.return_value = 80
            self.p._process_mqtt_update_multicolorbox(
                "autoUpdateInfo",
                "done",
                Data({"data": {"id": 0, "humidity": 0}}),
            )
            clock.return_value = 100
            fields = engine.snapshot()["printer"]
            self.assertEqual(fields["ace_current_temperature"], 39)
            self.assertEqual(fields["boxes"][0]["humidity"], 0)
            clock.return_value = 131
            fields = engine.snapshot()["printer"]
            self.assertEqual(fields["boxes"][0]["temperature"], 28)
            self.assertEqual(fields["boxes"][0]["humidity"], 0)
            clock.return_value = 201
            self.assertEqual(engine.snapshot()["printer"]["boxes"][0]["humidity"], 17)

    def test_informative_reports_and_fan_query(self):
        """Les formats connus sont consommés sans inventer une bobine ni une erreur de protocole."""
        for typ, action, data in [
            ("extrudeControl", "getInfo", {"current_status": 0, "has_filaments": False}),
            ("properties", "report", {"hardware_settings": {"diameter": 0.4, "material": 0}}),
            ("extfilbox", "auto", {"ext_spool": False, "current_filament": 0}),
            ("extfilbox", "getInfo", {"auto_refill": 0}),
            ("fan", "query", {"fan_speed_pct": 30}),
        ]:
            self.p.process_mqtt_update(
                "", Data({"type": typ, "action": action, "state": "done", "data": data})
            )
        self.assertEqual(self.p._fan_speed, 30)
        self.assertIsNone(self.p.external_shelves)

    def test_camera_failure_is_explicit_and_sanitized(self):
        """Un échec caméra n’est pas un rapport inconnu et ne reflète pas de message fournisseur."""
        with self.assertRaisesRegex(AnycubicAPIError, "Échec de la capture"):
            self.p.process_mqtt_update(
                "",
                Data(
                    {
                        "type": "video",
                        "action": "startCapture",
                        "state": "pushFailed",
                        "code": "fixture-private-code",
                        "data": {},
                    }
                ),
            )
        e = server.Engine()
        e.printer = SimpleNamespace(key="fake-device")
        e.camera_message_id = "fake-msg"
        e.receive_video_reply(
            "anycubic/anycubicCloud/v1/printer/app/20025/fake-device/report",
            {"type": "video", "action": "startCapture", "state": "pushFailed", "msgid": "fake-msg"},
        )
        self.assertEqual(e.camera_diagnostic["stage"], "pushFailed")

    def test_kobra_x_phases_do_not_affect_s1(self):
        """Les codes spécifiques X ne modifient pas l’interprétation des modèles S1."""
        self.p._is_printing = 2
        for phase in [19, 26, 27, 29, 30]:
            self.p._latest_project = SimpleNamespace(
                raw_print_status=phase,
                progress_percentage=0,
                print_current_layer=0,
                print_in_progress=False,
            )
            self.assertFalse(self.p.latest_project_print_in_progress)
            self.p._machine_type = 20030
            self.assertEqual(self.p.latest_project_print_in_progress, phase != 26)
            self.p._machine_type = 20025

    def test_kobra_x_seconds_and_countdown_preserve_s1_minutes(self):
        """Le décompte et la conversion sont activés pour X seulement, sans extrapolation générale."""
        box = AnycubicMultiColorBox(
            id=0,
            status=1,
            model_id=1,
            curr_nozzle_temp=None,
            target_nozzle_temp=None,
            auto_feed=0,
            loaded_slot=0,
            slots=[],
            temp=35,
            feed_status=None,
            drying_status=None,
        )
        data = {"status": 1, "target_temp": 45, "duration": 14400, "remain_time": 240}
        self.p._machine_type = 20030
        self.p._mqtt_drying_statuses[0] = AnycubicDryingStatus(1, 45, 240, 240)
        with patch("anycubic_cloud_api.data_models.printer_properties.monotonic", return_value=100):
            self.p._update_mqtt_drying_status(box, Data(data), "autoUpdateDryStatus")
        with patch("anycubic_cloud_api.data_models.printer_properties.monotonic", return_value=100):
            self.assertEqual(box.drying_status.total_duration, 240)
        with patch("anycubic_cloud_api.data_models.printer_properties.monotonic", return_value=220):
            self.assertEqual(box.drying_status.remaining_time, 238)
        self.p._machine_type = 20025
        self.p._update_mqtt_drying_status(box, Data(data), "autoUpdateDryStatus")
        self.assertEqual(box.drying_status.total_duration, 14400)


class CloudProjectFans(unittest.TestCase):
    """Les ventilateurs absents du flux MQTT restent lisibles depuis le projet Cloud."""

    def test_fans_fall_back_to_project_settings(self):
        """Le relevé MQTT reste prioritaire ; le projet complète seulement les valeurs absentes."""
        printer = AnycubicPrinter(
            api_parent=Mock(),
            machine_type=20025,
            machine_name="Anycubic Kobra S1",
            id=1,
            device_status=1,
            ignore_init_errors=True,
        )
        self.assertIsNone(printer.latest_project_fan_speed_pct)
        self.assertIsNone(printer.aux_fan_speed_pct)
        printer._latest_project = AnycubicProject(
            api_parent=Mock(),
            id=1,
            taskid=1,
            gcode_id=2,
            estimate=0,
            progress=0,
            status=1,
            create_time=0,
            gcode_name="fixture.gcode",
            settings='{"fan_speed_pct": 100, "aux_fan_speed_pct": 60, "settings": {"box_fan_level": "40"}}',
        )
        self.assertEqual(printer.latest_project_fan_speed_pct, 100)
        self.assertEqual(printer.aux_fan_speed_pct, 60)
        self.assertEqual(printer.box_fan_level, 40)
        printer._process_mqtt_update_fan(
            "auto", "done", {"data": {"fan_speed_pct": 0, "aux_fan_speed_pct": 0}}
        )
        self.assertEqual(printer.latest_project_fan_speed_pct, 0)
        self.assertEqual(printer.aux_fan_speed_pct, 0)
