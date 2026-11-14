"""Vérifie les mesures partielles sans solliciter le Cloud."""

import unittest

from measurement_freshness import Measurements


class MeasurementTests(unittest.TestCase):
    """Les horodatages restent propres à chaque mesure et à chaque boîtier."""

    def test_zero_and_partial_updates_survive_reconnection(self):
        """Un rapport partiel ou une nouvelle connexion ne rafraîchit pas l’ancien zéro."""
        clock = [10]
        store = Measurements(clock=lambda: clock[0])
        store.cloud({"multi_color_box": [{"id": 0, "humidity": 0}, {"id": 1, "humidity": 25}]})
        clock[0] = 20
        store.mqtt(
            {
                "type": "multiColorBox",
                "action": "autoUpdateInfo",
                "state": "done",
                "data": {"id": 0, "temp": 40},
            },
            1,
        )
        self.assertEqual(store.view("ace:0:humidity", 1)["age_s"], 10)
        self.assertEqual(store.view("ace:0:temperature", 1)["state"], "fresh")
        self.assertEqual(store.view("ace:0:temperature", 2)["state"], "stale")
        self.assertEqual(store.view("ace:1:temperature", 1)["state"], "missing")

    def test_drying_requires_a_new_matching_box_report(self):
        """Un accusé, un autre boîtier et une reconnexion ne prouvent pas un séchage."""
        clock = [1]
        store = Measurements(clock=lambda: clock[0])
        epoch = object()
        store.start_drying_observation(0, epoch, temperature=50, minutes=240)
        clock[0] = 2
        box = {"id": 0, "drying_status": {"status": 1, "target_temp": 50, "duration": 240}}
        report = {
            "type": "multiColorBox",
            "action": "setDry",
            "state": "success",
            "data": {"multi_color_box": [box]},
        }
        store.mqtt(report, epoch)
        self.assertEqual(store.drying_observation(0, epoch), "pending")
        report["action"] = "autoUpdateDryStatus"
        report["data"]["multi_color_box"] = [dict(box, id=1)]
        store.mqtt(report, epoch)
        self.assertEqual(store.drying_observation(0, epoch), "pending")
        report["data"]["multi_color_box"] = [box]
        store.mqtt(report, epoch)
        self.assertEqual(store.drying_observation(0, epoch), "confirmed")
        self.assertEqual(store.drying_observation(0, object()), "unconfirmed")

    def test_provenance_follows_displayed_value_and_cloud_interval(self):
        """Un relevé d’une autre valeur ou d’une ancienne connexion ne change pas la provenance."""
        clock = [10]
        epoch = object()
        store = Measurements(clock=lambda: clock[0], cloud_interval=300)
        store.cloud({"multi_color_box": [{"id": 0, "humidity": 32}]})
        clock[0] = 15
        store.mqtt(
            {
                "type": "multiColorBox",
                "action": "autoUpdateInfo",
                "state": "done",
                "data": {"id": 0, "humidity": 30},
            },
            epoch,
        )
        clock[0] = 250
        self.assertEqual(
            store.view("ace:0:humidity", epoch, displayed=32),
            {"state": "fresh", "age_s": 240, "source": "cloud"},
        )
        self.assertEqual(store.view("ace:0:humidity", epoch, displayed=31), {"state": "missing"})
        clock[0] = 341
        self.assertEqual(store.view("ace:0:humidity", epoch, displayed=32)["state"], "stale")

    def test_a_confirmed_stop_survives_the_next_observation(self):
        """Un rapport périodique ne peut effacer la preuve d’un arrêt antérieur."""
        clock = [10]
        epoch = object()
        store = Measurements(clock=lambda: clock[0])
        store.start_drying_observation(0, epoch)
        self.assertEqual(store.drying_action(0), "stop")
        report = {
            "type": "multiColorBox",
            "action": "getInfo",
            "state": "success",
            "data": {"multi_color_box": [{"id": 0, "drying_status": {"status": 0}}]},
        }
        clock[0] = 15
        store.mqtt(report, epoch)
        clock[0] = 50
        report["data"]["multi_color_box"][0]["drying_status"]["status"] = 1
        store.mqtt(report, epoch)
        self.assertEqual(store.drying_observation(0, epoch), "confirmed")
