"""Vérifie les estimations d’impression avec des relevés fictifs."""

import unittest

class FinishEstimateTests(unittest.TestCase):
    """La correction exige des durées comparables et une vitesse stable."""

    def test_median_excludes_other_printers_and_failed_jobs(self):
        """Une valeur extrême ne déplace pas la médiane des tâches réussies."""
        from print_observations import historical_duration_factor

        rows = [
            {"printer_id": 7, "print_status": 2, "estimated_time_s": 600, "print_time": duration}
            for duration in (10, 11, 12, 13, 90)
        ]
        self.assertIsNone(historical_duration_factor(rows[:4], 7))
        rows += [{**rows[0], "printer_id": 8}, {**rows[0], "print_status": 3}]
        self.assertEqual(historical_duration_factor(rows, 7), (1.2, 5))

    def test_finish_uses_live_remaining_time_and_rejects_speed_change(self):
        """Le relevé de l’imprimante pèse davantage avec la progression."""
        from print_observations import corrected_finish

        job = {
            "job_state": "printing",
            "job_progress": 50,
            "job_time_elapsed": 5,
            "job_time_remaining": 5,
        }
        self.assertEqual(
            corrected_finish(job, 600, (1.2, 5), False, 1000),
            {"finish": 1360, "original": 1300, "samples": 5, "factor": 1.2, "live_weight": 50},
        )
        self.assertIsNone(corrected_finish(job, 600, (1.2, 5), True, 1000))
