"""Disponibilité du parc calculée sans créer de collecteur ni contacter une machine."""

import unittest
from types import SimpleNamespace
from fleet_health import FleetHealth


class FleetHealthTests(unittest.TestCase):
    """Les sources périmées et absentes ne deviennent jamais des machines disponibles."""

    def test_unmonitored_does_not_resolve_or_poll(self):
        registry = SimpleNamespace(
            default_key=lambda: "a",
            catalogue=lambda: {"a": SimpleNamespace(name="A"), "b": SimpleNamespace(name="B")},
            entries={},
            default=SimpleNamespace(
                snapshot=lambda: {
                    "ok": True,
                    "updated_at": 100,
                    "printer": {"printer_online": True},
                }
            ),
        )
        data = FleetHealth().snapshot(registry, now=110, clock=0)
        self.assertEqual([x["state"] for x in data["items"]], ["online", "unmonitored"])
        self.assertEqual(registry.entries, {})

    def test_offline_threshold_dedup_recovery(self):
        tracker = FleetHealth()
        snapshot = {"ok": True, "updated_at": 100, "printer": {"printer_online": False}}
        registry = SimpleNamespace(
            default_key=lambda: "a",
            catalogue=lambda: {"a": SimpleNamespace(name="A")},
            entries={},
            default=SimpleNamespace(snapshot=lambda: snapshot),
        )
        self.assertEqual(tracker.snapshot(registry, now=100, clock=0)["items"][0]["alerts"], [])
        for tick in range(30, 181, 30):
            data = tracker.snapshot(registry, now=100, clock=tick)
        self.assertEqual(len(data["items"][0]["alerts"]), 1)
        tracker.snapshot(registry, now=100, clock=190)
        self.assertEqual(len(tracker.events), 1)
        snapshot["printer"]["printer_online"] = True
        data = tracker.snapshot(registry, now=100, clock=200)
        self.assertEqual(data["items"][0]["alerts"], [])
        self.assertEqual([e["transition"] for e in data["events"]], ["opened", "recovered"])

    def test_stale_future_missing_and_failed_are_explicit(self):
        tracker = FleetHealth()
        for value in (None, 0, 10000, float("nan"), float("inf")):
            with self.subTest(value=value):
                self.assertIsNone(tracker.age({"updated_at": value}, 500))
        self.assertEqual(tracker.age({"updated_at": 100, "mqtt_updated_at": 400}, 500), 100)
        self.assertEqual(tracker.age({"updated_at": "1970-01-01T00:06:40+00:00"}, 500), 100)
        self.assertIsNone(tracker.age({"updated_at": "1970-01-01T00:06:40"}, 500))
        self.assertEqual(
            tracker.state({"ok": True, "printer": {"printer_online": True}}, 121), "stale"
        )
        self.assertEqual(
            tracker.state({"ok": False, "printer": {"printer_online": True}}, 0), "unavailable"
        )

    def test_removed_machine_state_is_pruned_and_events_bounded(self):
        tracker = FleetHealth()
        tracker.pending["retired"] = ("offline", 0)
        registry = SimpleNamespace(
            default_key=lambda: None, catalogue=lambda: {}, entries={}, default=None
        )
        for _i in range(100):
            tracker.events.append({"key": "retired", "transition": "opened"})
        self.assertEqual(tracker.snapshot(registry, now=100, clock=0)["events"], [])
        self.assertEqual(tracker.pending, {})
        self.assertLessEqual(len(tracker.events), 32)

    def test_unknown_and_observation_gaps_restart_pending_timer(self):
        """Une période sans preuve n’est pas assimilée à une déconnexion continue."""
        tracker = FleetHealth()
        data = {"ok": True, "updated_at": 100, "printer": {"printer_online": False}}
        registry = SimpleNamespace(
            default_key=lambda: "a",
            catalogue=lambda: {"a": SimpleNamespace(name="A")},
            entries={},
            default=SimpleNamespace(snapshot=lambda: data),
        )
        for tick in (0, 30, 60, 90):
            tracker.snapshot(registry, now=100, clock=tick)
        data["printer"]["printer_online"] = None
        tracker.snapshot(registry, now=100, clock=120)
        data["printer"]["printer_online"] = False
        self.assertEqual(tracker.snapshot(registry, now=100, clock=150)["items"][0]["alerts"], [])
        self.assertEqual(tracker.pending["a"], ("offline", 150))
        self.assertEqual(tracker.snapshot(registry, now=100, clock=1000)["items"][0]["alerts"], [])
        self.assertEqual(tracker.pending["a"], ("offline", 1000))

    def test_failed_machine_does_not_hide_other_machine(self):
        """Une exception locale reste limitée à sa machine et n’active aucun moteur."""

        def fail():
            raise RuntimeError("fixture")

        registry = SimpleNamespace(
            default_key=lambda: "a",
            catalogue=lambda: {"a": SimpleNamespace(name="A"), "b": SimpleNamespace(name="B")},
            entries={
                "b": SimpleNamespace(
                    snapshot=lambda: {
                        "ok": True,
                        "updated_at": 100,
                        "printer": {"printer_online": True},
                    }
                )
            },
            default=SimpleNamespace(snapshot=fail),
        )
        self.assertEqual(
            [r["state"] for r in FleetHealth().snapshot(registry, now=100, clock=0)["items"]],
            ["unavailable", "online"],
        )
