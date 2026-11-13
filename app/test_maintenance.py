"""Vérifie la persistance et la lecture prudente du compteur d’entretien."""

import tempfile
import unittest
from pathlib import Path

from maintenance import maintenance_rows, update_maintenance


class MaintenanceTests(unittest.TestCase):
    """Une intervention reste enregistrée si le compteur disparaît ou recule."""

    def test_custom_operation_and_counter_reset(self):
        """Enregistre une opération, un relevé et une note, puis relit le fichier."""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "maintenance.json"
            data = {"action": "save", "name": "Nettoyer le plateau", "interval": 50}
            (item,) = update_maintenance(path, data, 200, 100)
            self.assertIsNone(item["elapsed"])
            done = {"action": "done", "id": item["id"], "note": "Plateau nettoyé"}
            (item,) = update_maintenance(path, done, 200, 200)
            self.assertEqual(item["elapsed"], 0)
            (item,) = maintenance_rows(path, 249)
            self.assertEqual(item["elapsed"], 49)
            self.assertEqual(item["history"][0]["note"], "Plateau nettoyé")
            self.assertIsNone(maintenance_rows(path, 1)[0]["elapsed"])
            self.assertIsNone(maintenance_rows(path, None)[0]["elapsed"])
            with self.assertRaises(ValueError):
                update_maintenance(path, done, None, 300)
