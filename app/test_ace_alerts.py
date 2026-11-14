"""Vérifie les alertes ACE avec des relevés et commandes fictifs."""

import unittest

from ace_alerts import AceAlerts


class AceAlertTests(unittest.TestCase):
    """Vérifie l’émission unique et l’absence d’alerte sur un état inconnu."""

    def setUp(self):
        """Prépare un boîtier dont le premier relevé rapporte deux minutes restantes."""
        self.alerts = AceAlerts()
        self.box = {"box_id": 0, "drying": {"is_drying": True, "remaining_time": 2}}
        self.printer = {"printer_online": True, "boxes": [self.box]}

    def events(self, stamp):
        """Renvoie les types d’alerte du relevé fictif."""
        return [event.result for event in self.alerts.sample(self.printer, "fixture", stamp)]

    def test_drying_finish_and_interruption(self):
        """Distingue fin naturelle, interruption et état inconnu."""
        self.assertEqual(self.events(100), [])
        self.box["drying"] = {}
        self.assertEqual(self.events(160), [])
        self.box["drying"] = {"is_drying": False}
        self.assertEqual(self.events(220), ["ace_drying_done"])
        self.assertEqual(self.events(221), [])
        self.box["drying"] = {"is_drying": True, "remaining_time": 3}
        self.assertEqual(self.events(250), [])
        self.box["drying"] = {"is_drying": False}
        self.assertEqual(self.events(280), ["ace_drying_interrupted"])

    def test_requested_stop_and_restarted_observer(self):
        """Un arrêt demandé et un premier relevé inactif ne déclenchent rien."""
        self.assertEqual(self.events(100), [])
        self.alerts.command("dry-stop", 0, None, 110)
        self.box["drying"] = {"is_drying": False}
        self.assertEqual(self.events(120), [])
        self.alerts = AceAlerts()
        self.assertEqual(self.events(120), [])

    def test_load_confirmation_and_timeout(self):
        """Attend l’emplacement demandé et signale une confirmation manquante une fois."""
        self.alerts.command("feed", 0, 2, 100)
        self.box["loaded_slot"] = 1
        self.assertEqual(self.events(120), [])
        self.box["loaded_slot"] = 2
        self.assertEqual(self.events(150), ["ace_feed_done"])
        self.assertEqual(self.events(160), [])
        self.alerts.command("retract", 0, None, 170)
        self.assertEqual(self.events(500), ["ace_load_failed"])
        self.assertEqual(self.events(510), [])

    def test_restart_preserves_an_observed_drying_cycle(self):
        """Un cycle commencé avant le redémarrage peut se terminer une seule fois."""
        from pathlib import Path
        from tempfile import TemporaryDirectory

        with TemporaryDirectory() as directory:
            path = Path(directory) / "alerts.json"
            self.alerts = AceAlerts(path)
            self.assertEqual(self.events(100), [])
            self.alerts.save("fixture")
            self.alerts = AceAlerts(path)
            self.alerts.restore("fixture")
            self.box["drying"] = {"is_drying": False}
            self.assertEqual(self.events(220), ["ace_drying_done"])
            self.alerts.save("fixture")
            self.alerts = AceAlerts(path)
            self.alerts.restore("fixture")
            self.assertEqual(self.events(221), [])
