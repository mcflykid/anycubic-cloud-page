"""Rapprochement des compteurs MQTT et des instantanés REST d’un projet, sur données fictives (#444)."""

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from anycubic_cloud_api.const.enums import AnycubicPrintStatus
from anycubic_cloud_api.data_models import project as project_module
from anycubic_cloud_api.data_models.consumable import AnycubicConsumableData as Data
from anycubic_cloud_api.data_models.project import AnycubicProject


def make_project(
    project_id=42, progress=0, remain_time=None, status=AnycubicPrintStatus.Printing, settings=None
):
    """Projet fictif minimal, sans parent API réel."""
    return AnycubicProject(
        api_parent=SimpleNamespace(),
        id=project_id,
        taskid=project_id + 1,
        gcode_id=7,
        estimate=0,
        progress=progress,
        status=1,
        create_time=1,
        gcode_name="fixture.gcode",
        remain_time=remain_time,
        print_status=int(status),
        settings=settings,
    )


def live_report(project, **fields):
    """Applique un rapport MQTT d’impression fictif."""
    project.update_with_mqtt_print_status_data(AnycubicPrintStatus.Printing, Data(fields))


class UnknownCountersTest(unittest.TestCase):
    def test_minus_one_is_unknown_and_keeps_last_value(self):
        project = make_project()
        live_report(project, progress=40, curr_layer=12, total_layers=100, remain_time=30)
        live_report(project, curr_layer=-1, total_layers=-1, remain_time=-1)
        self.assertEqual(project.print_current_layer, 12)
        self.assertEqual(project.print_total_layers, 100)
        self.assertEqual(project.print_time_remaining_minutes, 30)

    def test_minus_one_from_rest_is_unknown(self):
        project = make_project(remain_time=-1, settings={"curr_layer": -1, "total_layers": -1})
        self.assertIsNone(project.print_time_remaining_minutes)
        self.assertIsNone(project.print_current_layer)
        self.assertIsNone(project.print_total_layers)
        self.assertIsNone(project.print_approximate_completion_time)


class RestSnapshotTest(unittest.TestCase):
    def test_older_rest_snapshot_does_not_rewind_live_counters(self):
        project = make_project()
        live_report(project, progress=42, curr_layer=20, total_layers=100, remain_time=25)
        stale = make_project(
            progress=38, remain_time=31, settings={"curr_layer": 17, "total_layers": 100}
        )
        self.assertTrue(project.update_with_project(stale))
        self.assertEqual(project.progress_percentage, 42)
        self.assertEqual(project.print_current_layer, 20)
        self.assertEqual(project.print_time_remaining_minutes, 25)

    def test_rest_takes_over_when_mqtt_is_silent_but_never_rewinds(self):
        project = make_project()
        with patch.object(project_module.time, "monotonic", return_value=1000.0):
            live_report(project, progress=42, curr_layer=20, remain_time=25)
        later = 1000.0 + project_module.LIVE_COUNTERS_TTL_SECONDS + 1
        with patch.object(project_module.time, "monotonic", return_value=later):
            self.assertTrue(
                project.update_with_project(
                    make_project(progress=50, remain_time=18, settings={"curr_layer": 24})
                )
            )
            self.assertEqual(project.progress_percentage, 50)
            self.assertEqual(project.print_current_layer, 24)
            self.assertEqual(project.print_time_remaining_minutes, 18)
            project.update_with_project(make_project(progress=45, remain_time=20))
            self.assertEqual(project.progress_percentage, 50)

    def test_end_of_print_replaces_live_counters(self):
        project = make_project()
        live_report(project, progress=97, curr_layer=99, remain_time=2)
        done = make_project(
            progress=100,
            remain_time=0,
            status=AnycubicPrintStatus.Complete,
            settings={"curr_layer": 100},
        )
        self.assertTrue(project.update_with_project(done))
        self.assertTrue(project.print_complete)
        self.assertEqual(project.progress_percentage, 100)
        self.assertEqual(project.print_current_layer, 100)
        self.assertEqual(project.print_time_remaining_minutes, 0)

    def test_new_project_is_not_merged(self):
        project = make_project()
        live_report(project, progress=42)
        self.assertFalse(project.update_with_project(make_project(project_id=99, progress=3)))


if __name__ == "__main__":
    unittest.main()
