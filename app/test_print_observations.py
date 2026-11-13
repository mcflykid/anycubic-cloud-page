"""Vérifie les estimations d’impression avec des relevés fictifs."""

import unittest

from print_observations import heat_alerts


class DryingAdviceTests(unittest.TestCase):
    """Le conseil exige une série récente, cohérente et un préréglage de la matière."""

    def test_durable_humidity_prefills_a_known_preset(self):
        """Une mesure isolée ou une impression active ne déclenche pas de conseil."""
        from print_observations import drying_advice

        printer = {
            "printer_online": True,
            "job_in_progress": False,
            "boxes": [
                {
                    "box_id": 0,
                    "model": "ACE 2 Pro",
                    "drying": {"is_drying": False},
                    "spools": [{"material_type": "PETG", "spool_loaded": True}],
                }
            ],
        }
        presets = [{"name": "PETG", "temperature": 55, "hours": 6}]
        samples = [
            {"time": stamp, "ace_boxes": {"0": {"humidity": 48}}} for stamp in range(100, 1001, 60)
        ]
        self.assertEqual(
            drying_advice(printer, presets, samples, 1000),
            {"0": {"humidity": 48, "material": "PETG", "temperature": 55, "hours": 6}},
        )
        self.assertEqual(drying_advice(printer, presets, samples[-1:], 1000), {})
        self.assertEqual(
            drying_advice({**printer, "job_in_progress": True}, presets, samples, 1000), {}
        )


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


class FirmwareObservationTests(unittest.TestCase):
    """Protège la restitution des notes constructeur."""

    def test_firmware_notes_preserve_text_and_remove_active_content(self):
        """Une description constructeur reste bornée et aucun bloc actif n’est exposé."""
        from types import SimpleNamespace
        from native_controls import firmware_release_notes

        note = firmware_release_notes(
            SimpleNamespace(
                _update_desc="<p>Corrections &amp; stabilité</p><script>privé</script><ul><li>Amélioration</li></ul>",
                _update_date=1794000000000,
                _force_update="1",
            )
        )
        self.assertEqual(
            note,
            {
                "text": "Corrections & stabilité\n• Amélioration",
                "published": 1794000000,
                "required": True,
            },
        )
        self.assertEqual(firmware_release_notes(None)["text"], "")


class HeatObservationTests(unittest.TestCase):
    """Les mesures partielles ou périmées ne doivent pas produire d’alerte."""

    def test_stable_drop_and_target_change(self):
        """Le plateau doit rester sous la même cible pendant toute la fenêtre."""
        printer = {"printer_online": True, "job_state": "printing", "target_hotbed_temp": 60}
        samples = [{"time": stamp, "bed": 48, "bed_target": 60} for stamp in range(100, 171, 10)]
        stable = {"time": 90, "bed": 59, "bed_target": 60}
        self.assertEqual(heat_alerts(printer, [stable, *samples], 170)[0]["part"], "bed")
        samples[-2]["bed_target"] = 65
        self.assertEqual(heat_alerts(printer, [stable, *samples], 170), [])
        self.assertEqual(heat_alerts(printer, [stable, *samples], 1000), [])

    def test_rise_after_new_target_is_not_a_drop(self):
        """La chauffe après changement de consigne ne doit pas déclencher une alerte de chute."""
        printer = {"printer_online": True, "job_state": "printing", "target_nozzle_temp": 215}
        samples = [{"time": 90, "nozzle": 140, "nozzle_target": 140}]
        samples.extend(
            {"time": stamp, "nozzle": 160 + (stamp - 100) / 2, "nozzle_target": 215}
            for stamp in range(100, 181, 10)
        )
        self.assertEqual(heat_alerts(printer, samples, 180), [])

    def test_slow_heating_requires_full_window(self):
        """Une montée en température de quelques secondes reste un état normal."""
        printer = {"printer_online": True, "job_state": "preheating", "target_nozzle_temp": 210}
        samples = [
            {"time": stamp, "nozzle": 180, "nozzle_target": 210} for stamp in range(100, 401, 10)
        ]
        self.assertEqual(heat_alerts(printer, samples[1:], 400), [])
        self.assertEqual(heat_alerts(printer, samples, 400)[0]["seconds"], 300)
