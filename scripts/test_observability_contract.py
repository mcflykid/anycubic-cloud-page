"""Vérifie le contrat documenté avant toute future exposition métrique."""

import unittest
from pathlib import Path


class ObservabilityContractTests(unittest.TestCase):
    """Les séries restent fixes, sans étiquette portant une identité sensible."""

    def test_metrics_contract_is_explicit_and_bounded(self):
        doc = (Path(__file__).parents[1] / "docs" / "OBSERVABILITY.md").read_text()
        expected = (
            "cloud_page_known_printers",
            "cloud_page_poll_age_seconds",
            "cloud_page_poll_errors_total",
            "cloud_page_mqtt_connected",
            "cloud_page_temperature_sample_age_seconds",
            "cloud_page_cloud_request_duration_seconds",
        )
        for name in expected:
            self.assertIn(name, doc)
        for token in (
            "désactivée par défaut",
            "contrôle d’accès",
            "sans étiquette",
            "16 000 000 octets",
        ):
            self.assertIn(token, doc)
        self.assertIn("aucun port supplémentaire", doc)
        self.assertIn("noms, comptes, adresses, chemins, fichiers", doc)


if __name__ == "__main__":
    unittest.main()
