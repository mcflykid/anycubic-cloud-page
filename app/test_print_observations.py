"""Vérifie les estimations d’impression avec des relevés fictifs."""

import unittest


class TimelineTests(unittest.TestCase):
    """La chronologie enregistre les transitions observées."""

    def test_preparation_pause_resume_and_finish(self):
        """Un état répété ne crée pas une deuxième entrée."""
        from print_observations import observe_timeline

        events = []
        for stamp, state in enumerate(
            ("preheating", "printing", "printing", "paused", "printing", "finished"), 100
        ):
            events = observe_timeline(events, {"job_state": state}, stamp)
        self.assertEqual(
            [event["kind"] for event in events],
            ["preheating", "printing", "paused", "resumed", "finished"],
        )
        self.assertEqual(observe_timeline([], {"job_state": "finished"}, 100), [])

    def test_shortage_is_recorded_once_per_slot(self):
        """Un risque de manque persistant n’ajoute qu’une ligne par emplacement."""
        from print_observations import observe_timeline

        job = {"job_state": "printing", "filament_shortfalls": [{"slot": 3}]}
        events = observe_timeline([], job, 100)
        events = observe_timeline(events, job, 110)
        self.assertEqual(events[-1]["kind"], "filament_low")
        self.assertEqual(events[-1]["shortages"], [3])
        self.assertIs(observe_timeline(events, job, 120), events)


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

    def test_task_list_estimate_field_is_accepted(self):
        """Les lignes de la liste Cloud portent « estimate » et suffisent au ratio."""
        from print_observations import historical_duration_factor

        rows = [
            {"printer_id": 7, "print_status": 2, "estimate": 600, "print_time": duration}
            for duration in (10, 11, 12, 13, 14)
        ]
        self.assertEqual(historical_duration_factor(rows, 7), (1.2, 5))

    def test_engine_reads_history_without_the_history_tab(self):
        """Le moteur relit la première page au plus toutes les trente minutes."""
        import asyncio
        from unittest.mock import AsyncMock, patch
        from types import SimpleNamespace
        import printer_engine

        engine = printer_engine.Engine()
        engine.printer = SimpleNamespace(id=7)
        engine.extras = SimpleNamespace(task_list=AsyncMock())
        clock = [5000]
        with patch.object(printer_engine.time, "monotonic", side_effect=lambda: clock[0]):
            for moment in (5000, 5100, 7000):
                clock[0] = moment
                asyncio.run(engine.refresh_duration_factor())
        self.assertEqual(engine.extras.task_list.await_count, 2)

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
