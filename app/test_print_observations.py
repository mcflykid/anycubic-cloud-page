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
        custom = [{**row, "humidity_threshold": 50} for row in presets]
        self.assertEqual(drying_advice(printer, custom, samples, 1000), {})
        self.assertEqual(
            drying_advice({**printer, "job_in_progress": True}, presets, samples, 1000), {}
        )
        # Un état transitoire peut être occupé avant que le Cloud ne rapporte un projet actif.
        self.assertEqual(drying_advice({**printer, "is_busy": True}, presets, samples, 1000), {})


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

    def test_firmware_notes_limit_constructor_text(self):
        """Une note très longue reste consultable sans transmettre toute la réponse cloud."""
        from types import SimpleNamespace
        from native_controls import firmware_release_notes

        note = firmware_release_notes(SimpleNamespace(_update_desc="x" * 20_000))
        self.assertEqual(len(note["text"]), 4000)


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
        warning = heat_alerts(printer, samples, 400)[0]
        self.assertEqual(warning["seconds"], 300)
        self.assertEqual(
            heat_alerts({**printer, "curr_nozzle_temp": 180}, samples, 400)[0]["kind"], "stalled"
        )
        self.assertEqual(
            warning["readings"][-1], {"time": 400, "nozzle": 180, "nozzle_target": 210}
        )

    def test_impossible_temperature_is_distinct_from_a_heating_delay(self):
        """Une lecture impossible ne doit pas attendre la durée maximale du préchauffage."""
        printer = {
            "printer_online": True,
            "job_state": "preheating",
            "target_nozzle_temp": 210,
            "curr_nozzle_temp": -80,
        }
        self.assertEqual(heat_alerts(printer, [], 100)[0]["kind"], "sensor")


class HeatDeliveryTests(unittest.IsolatedAsyncioTestCase):
    """Le suivi de chauffe émet un seul événement Discord par épisode réel ou fictif."""

    async def test_persistent_warning_is_sent_once_until_recovery(self):
        """Un second épisode émet une nouvelle alerte après une lecture redevenue plausible."""
        from unittest.mock import AsyncMock, Mock
        from server import deliver_heat_episodes

        delivery = Mock(scope="fixture", observe=AsyncMock())
        printer = dict(
            printer_online=True,
            job_state="preheating",
            target_nozzle_temp=210,
            curr_nozzle_temp=-80,
        )
        state = await deliver_heat_episodes(delivery, printer, [], 100, 1, 1, set())
        await deliver_heat_episodes(delivery, printer, [], 110, 1, 1, state)
        delivery.observe.assert_awaited_once()
        recovered = await deliver_heat_episodes(
            delivery, {**printer, "curr_nozzle_temp": 210}, [], 120, 1, 1, state
        )
        await deliver_heat_episodes(delivery, printer, [], 130, 1, 1, recovered)
        self.assertEqual(delivery.observe.await_count, 2)
        events = [call.args[0][0] for call in delivery.observe.await_args_list]
        self.assertEqual([event.result for event in events], ["heat_anomaly", "heat_anomaly"])
        self.assertNotEqual(events[0].key, events[1].key)
