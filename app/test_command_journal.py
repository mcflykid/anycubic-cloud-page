"""Vérifie la rétention du journal et le filtrage des données hors transport Anycubic."""

import json
import asyncio
import tempfile
import time
import unittest
from pathlib import Path
from command_journal import CommandJournal, make_entry


class CommandJournalTests(unittest.TestCase):
    """Construit des traces fictives pour tester les limites du fichier persistant."""

    def test_rotates_by_age_and_size(self):
        """Les entrées trop anciennes ou trop volumineuses cèdent la place à la dernière."""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "journal.jsonl"
            journal = CommandJournal(path, max_bytes=550, max_age=60)
            row = make_entry(
                "print-local",
                "fixture-request-old",
                "printer-test",
                "Imprimante",
                b"test",
                "127.0.0.1",
                {},
            )
            old_id = row["request_id"]
            row["time"] = time.time() - 61
            path.write_text(json.dumps(row) + "\n")
            for index in range(10):
                row = make_entry(
                    "print-local",
                    f"fixture-request-{index}",
                    "printer-test",
                    "Imprimante",
                    b"test",
                    "127.0.0.1",
                    {"name": f"Pièce {index}.gcode"},
                )
                journal.record(row)
            rows = journal.rows()
            self.assertLessEqual(path.stat().st_size, 550)
            self.assertLess(len(rows), 10)
            self.assertEqual(rows[-1]["parameters"]["name"], "Pièce 9.gcode")
            self.assertNotIn(old_id, path.read_text())

    def test_fields_with_sensitive_values_are_not_recorded(self):
        """Seuls les paramètres autorisés entrent dans une trace."""
        data = {
            "name": "fixture@example.test",
            "temperature": 215,
            "slots": [1, 3],
            "ticket": "private-ticket",
            "id": 1234,
            "password": "fixture-secret",
            "url": "https://example.test/fixture",
        }
        row = make_entry(
            "print-local",
            "opaque-reference-test",
            "printer-test",
            "https://example.test/account",
            None,
            "unknown",
            data,
        )
        self.assertEqual(row["parameters"], {"temperature": 215, "slots": [1, 3]})
        self.assertIsNone(row["printer_name"])
        self.assertIsNone(row["client"])
        self.assertNotEqual(row["request_id"], "opaque-reference-test")


class JournalMQTTTests(unittest.IsolatedAsyncioTestCase):
    """Rejoue les retours du protocole sans transport cloud ni imprimante."""

    async def test_concurrent_writes_keep_recent_rows_of_oversized_journal(self):
        """Une rotation après un excès conserve les lignes lisibles et les écritures concurrentes."""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "journal.jsonl"
            journal = CommandJournal(path, max_bytes=4096)
            seed = make_entry("pause", "fixture-seed", "printer", None, None, "unknown", {})
            path.write_text("invalide\n" * 1000 + json.dumps(seed) + "\n")
            self.assertEqual(journal.rows(), [seed])
            rows = [
                make_entry("pause", f"fixture-{index}", "printer", None, None, "unknown", {})
                for index in range(8)
            ]
            await asyncio.gather(*(journal.record_async(row) for row in rows))
            self.assertEqual(
                {row["request_id"] for row in journal.rows()},
                {row["request_id"] for row in [seed, *rows]},
            )
            self.assertLessEqual(path.stat().st_size, journal.max_bytes)

    async def test_early_report_does_not_need_another_mqtt_delivery(self):
        """Un retour reçu avant HTTP est conservé et exige la bonne imprimante et le bon état."""
        import asyncio
        from command_journal import JournalMQTT, mqtt_digest

        with tempfile.TemporaryDirectory() as directory:
            journal = CommandJournal(Path(directory) / "journal.jsonl")
            tracker = JournalMQTT(journal, asyncio.get_running_loop())
            entry = make_entry(
                "pause",
                "fixture-request-pause",
                "fixture-printer",
                "Imprimante",
                None,
                "unknown",
                {},
            )
            entry["outcome"] = "envoyée"
            sent_at = time.time()
            payload = {
                "type": "print",
                "action": "pause",
                "state": "paused",
                "msgid": "fixture-cloud-reference",
            }
            tracker.receive("other-printer", payload)
            tracker.receive("fixture-printer", {**payload, "state": "pausing"})
            await asyncio.sleep(0)
            digest = mqtt_digest(payload["msgid"])
            await tracker.watch(entry, 2, digest, sent_at)
            self.assertEqual(journal.rows()[0]["outcome"], "envoyée")
            tracker.receive("fixture-printer", {**payload, "action": "resume", "state": "resumed"})
            await asyncio.sleep(0)
            self.assertEqual(journal.rows()[0]["outcome"], "envoyée")
            tracker.receive("fixture-printer", payload)
            await asyncio.sleep(0)
            self.assertEqual(entry["outcome"], "confirmée")
            await tracker.flush()
            self.assertNotIn("mqtt", journal.rows()[0])
            self.assertNotIn(payload["msgid"], journal.path.read_text())
            early = make_entry(
                "pause",
                "fixture-request-early",
                "fixture-printer",
                "Imprimante",
                None,
                "unknown",
                {},
            )
            payload["msgid"] = "fixture-early"
            sent_at = time.time()
            tracker.receive("fixture-printer", payload)
            await asyncio.sleep(0)
            await tracker.watch(early, 2, mqtt_digest(payload["msgid"]), sent_at)
            self.assertEqual(early["outcome"], "confirmée")

    async def test_restarts_and_expired_reports(self):
        """La référence est rechargée depuis le disque et un ancien retour reste sans effet."""
        import asyncio
        from command_journal import JournalMQTT, MQTT_WINDOW, mqtt_digest

        with tempfile.TemporaryDirectory() as directory:
            journal = CommandJournal(Path(directory) / "journal.jsonl")
            tracker = JournalMQTT(journal, asyncio.get_running_loop())
            entry = make_entry(
                "delete-local",
                "fixture-delete-local",
                "fixture-printer",
                "Imprimante",
                None,
                "unknown",
                {},
            )
            entry["outcome"] = "acceptée"
            sent_at = time.time()
            payload = {"type": "file", "action": "deleteLocal", "state": "success", "msgid": 12345}
            digest = mqtt_digest(payload["msgid"])
            await tracker.watch(entry, 104, digest, sent_at)
            restart = JournalMQTT(journal, asyncio.get_running_loop())
            restart.apply_report(
                ("fixture-printer", digest),
                ("file", "deleteLocal", "success"),
                sent_at + MQTT_WINDOW + 1,
            )
            self.assertEqual(journal.rows()[0]["outcome"], "acceptée")
            restart.receive("fixture-printer", payload)
            await asyncio.sleep(0)
            await restart.flush()
            self.assertEqual(journal.rows()[0]["outcome"], "confirmée")

    async def test_cloud_order_and_router_correlate_the_same_request(self):
        """Rejoue l’envoi HTTP et le routeur MQTT, sans broker ni commande physique."""
        import asyncio
        from types import SimpleNamespace
        from unittest.mock import AsyncMock, patch

        from command_journal import JournalMQTT, command_mqtt_context
        from printer_registry import printer_key
        from server import AnycubicBaseOrderRequest, AnycubicMQTTAPI, CloudPageAPI, Engine

        with tempfile.TemporaryDirectory() as directory:
            journal = CommandJournal(Path(directory) / "journal.jsonl")
            engine = Engine()
            engine.printer = SimpleNamespace(id=7, key="fixture-machine")
            engine.command_mqtt = JournalMQTT(journal, asyncio.get_running_loop())
            api = object.__new__(CloudPageAPI)
            api.cloud_engine = engine
            entry = make_entry(
                "pause", "fixture-request-pause", printer_key(7), "Imprimante", None, "unknown", {}
            )
            entry["outcome"] = "inconnue"
            report = {
                "type": "print",
                "action": "pause",
                "state": "paused",
                "msgid": "fixture-order",
            }
            topic = "anycubic/anycubicCloud/v1/printer/app/20025/fixture-machine/print/report"
            message = SimpleNamespace(topic=topic, payload=json.dumps(report).encode(), retain=True)
            context = command_mqtt_context.set((engine.command_mqtt, entry, asyncio.current_task()))
            try:
                with patch.object(
                    AnycubicMQTTAPI, "_send_anycubic_order", AsyncMock(return_value="fixture-order")
                ):
                    result = await api._send_anycubic_order(
                        AnycubicBaseOrderRequest(order_id=2, printer_id=7)
                    )
                self.assertEqual(result, "fixture-order")
            finally:
                command_mqtt_context.reset(context)
            with patch.object(AnycubicMQTTAPI, "_mqtt_message_router"):
                api._mqtt_message_router(message)
                await asyncio.sleep(0)
                self.assertEqual(entry["outcome"], "inconnue")
                message.retain = False
                api._mqtt_message_router(message)
                await asyncio.sleep(0)
            await engine.command_mqtt.flush()
            self.assertEqual(journal.rows()[0]["outcome"], "confirmée")
