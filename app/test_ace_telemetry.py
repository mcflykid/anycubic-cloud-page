"""Vérifie la qualification des pourcentages ACE sans réseau ni imprimante."""

import unittest

from ace_telemetry import ace2_pro_telemetry


class AceTelemetryTests(unittest.TestCase):
    """Un pourcentage n’est exploitable que pour une bobine reconnue et chargée."""

    def test_returns_reported_percent_and_source_for_qualified_loaded_spool(self):
        """Les valeurs reconnues restent inchangées, y compris zéro, sans preuve de masse physique."""
        for value in (0, 12.5, 100):
            with self.subTest(value=value):
                self.assertEqual(
                    ace2_pro_telemetry(
                        {"status": 5, "edit_status": 0, "consumables_percent": value}
                    ),
                    {
                        "percent": value,
                        "valid": True,
                        "source": "ace2_pro_consumables_percent",
                    },
                )

    def test_hides_manually_configured_or_unloaded_spool_values(self):
        """Les valeurs par défaut des slots manuels ou vides ne sont pas des mesures."""
        for slot in (
            {"status": 5, "edit_status": 1, "consumables_percent": 100},
            {"status": 4, "edit_status": 0, "consumables_percent": 87},
            {"status": 4, "edit_status": 1, "consumables_percent": 100},
            {"status": 5, "edit_status": 2, "consumables_percent": 42},
        ):
            with self.subTest(slot=slot):
                self.assertEqual(
                    ace2_pro_telemetry(slot),
                    {"percent": None, "valid": False, "source": "unknown"},
                )

    def test_rejects_missing_malformed_and_out_of_range_values(self):
        """Les valeurs inconnues, non numériques, non finies ou hors limites deviennent nulles."""
        for value in (None, True, "50", -1, 101, float("nan"), float("inf")):
            with self.subTest(value=value):
                self.assertIsNone(
                    ace2_pro_telemetry(
                        {"status": 5, "edit_status": 0, "consumables_percent": value}
                    )["percent"]
                )

    def test_rejects_missing_or_invalid_slot_state(self):
        """Un pourcentage seul ne suffit pas si le firmware omet ou altère ses états."""
        for slot in (
            None,
            [],
            {"edit_status": 0, "consumables_percent": 50},
            {"status": 5, "consumables_percent": 50},
            {"status": True, "edit_status": 0, "consumables_percent": 50},
            {"status": 5, "edit_status": False, "consumables_percent": 50},
        ):
            with self.subTest(slot=slot):
                self.assertEqual(
                    ace2_pro_telemetry(slot),
                    {"percent": None, "valid": False, "source": "unknown"},
                )


if __name__ == "__main__":
    unittest.main()
