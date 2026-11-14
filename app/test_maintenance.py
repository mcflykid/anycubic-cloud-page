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

    def test_declared_counter_keeps_current_elapsed(self):
        """Un compteur antérieur déclaré laisse visibles les heures écoulées depuis."""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "maintenance.json"
            data = {"action": "save", "name": "Graisser les axes", "interval": 200}
            (item,) = update_maintenance(path, data, 305.6, 100)
            done = {"action": "done", "id": item["id"], "note": "", "last_hours": 255}
            (item,) = update_maintenance(path, done, 305.6, 200)
            self.assertAlmostEqual(item["elapsed"], 50.6)
            self.assertEqual(item["history"][0]["hours"], 255)
            with self.assertRaises(ValueError):
                update_maintenance(path, {**done, "last_hours": 400}, 305.6, 300)

    def test_calendar_and_filament_units(self):
        """Les jours suivent la date d’intervention ; les kg suivent le filament cumulé."""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "maintenance.json"
            day = 86400
            rows = maintenance_rows(path, 10, defaults=True, material="1.5 kg", now=100 * day)
            self.assertEqual({row["unit"] for row in rows}, {"hours", "days", "kg"})
            self.assertTrue(all(row["elapsed"] is None for row in rows))
            cutter = {"action": "done", "id": "cutter", "note": ""}
            update_maintenance(path, cutter, 10, 100 * day, defaults=True, material="1500 g")
            screw = {"action": "done", "id": "z-screw", "note": ""}
            update_maintenance(path, screw, None, 100 * day, material="1,5 kg")
            rows = {
                r["id"]: r for r in maintenance_rows(path, 12, material="4.6 kg", now=130 * day)
            }
            self.assertAlmostEqual(rows["cutter"]["elapsed"], 3.1)
            self.assertEqual(rows["z-screw"]["elapsed"], 30)
            unknown = {r["id"]: r for r in maintenance_rows(path, 12, material="?")}
            self.assertIsNone(unknown["cutter"]["elapsed"])

    def test_legacy_axes_operation_no_longer_greases_x(self):
        """L’ancien défaut reste en place mais n’invite plus à graisser l’axe X."""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "maintenance.json"
            path.write_text(
                '[{"id": "axes", "name": "Graisser les axes et tiges", "interval": 200,'
                ' "enabled": true, "history": []}]',
                encoding="utf-8",
            )
            (row,) = maintenance_rows(path, 10)
            self.assertIn("jamais l’axe X", row["name"])
            self.assertEqual(row["unit"], "hours")

    def test_filament_counter_parsing(self):
        """Les formats inattendus restent inconnus plutôt que d’inventer une échéance."""
        from maintenance import filament_kg

        self.assertEqual(filament_kg("3.24 kg"), 3.24)
        self.assertEqual(filament_kg("850g"), 0.85)
        self.assertEqual(filament_kg(2), 2.0)
        for value in (None, "beaucoup", -1, float("nan"), True):
            self.assertIsNone(filament_kg(value))
