"""Vérifie les fenêtres locales, le contenu et l’unicité des bilans Discord."""

from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock
from zoneinfo import ZoneInfo

from notification_discord import DiscordConfig, DiscordResult, format_message
from notification_reports import ReportSchedule, collect_history, format_report, report_window
from notification_settings import _report_payload

PARIS = ZoneInfo("Europe/Paris")
REPORT = "https://discord.com/api/webhooks/12345678901234567/" + "b" * 64


def local_stamp(year, month, day, hour, minute=0):
    """Construit une seconde de référence dans le fuseau testé."""
    return datetime(year, month, day, hour, minute, tzinfo=PARIS).timestamp()


class ReportWindowTest(unittest.TestCase):
    """Découpe la journée selon le calendrier local, y compris au changement d’heure."""

    def test_windows_and_dst(self):
        for year, month, day, hours in ((2026, 3, 29, 10), (2026, 10, 25, 12)):
            with self.subTest(month=month):
                clock = local_stamp(year, month, day, 8)
                start, end = report_window(clock, PARIS)
                self.assertEqual((end - start) / 3600, hours)
                self.assertEqual(end, clock)
                self.assertIsNone(report_window(clock - 1, PARIS))
                self.assertIsNone(report_window(clock + 600, PARIS))
                evening = local_stamp(year, month, day, 21)
                self.assertEqual(report_window(evening, PARIS), (clock, evening))


class ReportDeliveryTest(unittest.IsolatedAsyncioTestCase):
    """Utilise un transport fictif et vérifie les preuves de couverture."""

    def test_reports_and_alerts_use_the_same_discord_avatar(self):
        """Vérifie que les deux canaux reprennent l’image publique du projet."""
        config = DiscordConfig(REPORT, True)
        payload = _report_payload(None, config)
        self.assertTrue(payload["avatar_url"].endswith("/docs/assets/discord-avatar.png"))
        self.assertEqual(payload["allowed_mentions"], {"parse": []})
        self.assertEqual(payload["avatar_url"], format_message(None, config)["avatar_url"])

    async def test_restart_keeps_one_report_and_no_alert_state(self):
        with TemporaryDirectory() as folder:
            state = Path(folder)
            now = local_stamp(2026, 11, 11, 8, 1)
            reader = AsyncMock(return_value=([], True))
            sender = AsyncMock(return_value=DiscordResult("sent", 200))
            for _ in range(2):
                schedule = ReportSchedule(state, sender, PARIS, reader, clock=lambda: now)
                schedule.delivery.configure(DiscordConfig(REPORT, True))
                await schedule.tick()
                await schedule.delivery.join()
            self.assertEqual(reader.await_count, 1)
            self.assertEqual(sender.await_count, 1)
            config, report = sender.await_args.args
            self.assertEqual(config.url, REPORT)
            payload = _report_payload(report, config)
            self.assertIn("Aucune impression", payload["content"])
            self.assertEqual(payload["avatar_url"], _report_payload(None, config)["avatar_url"])
            self.assertFalse((state / "notification-delivery.json").exists())

    async def test_terminal_interval_is_not_replaced_by_cloud_counter(self):
        """Le bilan utilise le même intervalle que l’historique, sans doubler le compteur."""
        from notification_reports import _make_report

        row = {
            "print_status": 3,
            "start_time": 1800000000,
            "end_time": 1800000600,
            "print_time": 90,
        }
        report = _make_report("fixture", 1800000000, 1800001000, PARIS, [row], True)
        self.assertEqual(report.durations, (10,))
        message = format_report(report, DiscordConfig(language="fr"))
        self.assertIn("intervalles ou compteurs", message)
        self.assertIn("10 min", message)

    async def test_only_terminal_rows_and_verified_metrics(self):
        now = local_stamp(2026, 11, 11, 21)
        printer = SimpleNamespace(id=5)
        completed = {
            "id": 1,
            "print_status": 2,
            "end_time": int(now) * 1000,
            "print_time": 30,
            "total_filament_used": 15,
        }
        stopped = {
            "id": 2,
            "print_status": 3,
            "end_time": int(now) - 60,
            "print_time": 5,
            "reason_id": 10115,
            "reason": "Texte brut à ne pas transmettre",
        }
        extras = SimpleNamespace(
            account_printers=lambda: [printer],
            task_rows=AsyncMock(return_value=([completed, completed, stopped], False)),
        )
        start, end = report_window(now, PARIS)
        rows, complete = await collect_history(extras, start, end)
        self.assertTrue(complete)
        self.assertEqual(len(rows), 2)
        with TemporaryDirectory() as folder:
            sender = AsyncMock(return_value=DiscordResult("sent", 200))
            schedule = ReportSchedule(
                Path(folder),
                sender,
                PARIS,
                AsyncMock(return_value=(rows, False)),
                clock=lambda: now,
            )
            schedule.delivery.configure(DiscordConfig(REPORT, True))
            await schedule.tick()
            await schedule.delivery.join()
            message = format_report(sender.await_args.args[1], DiscordConfig(language="fr"))
        for expected in ("Collecte incomplète", "35 min", "15 g", "10115"):
            self.assertIn(expected, message)
        self.assertNotIn("Texte brut", message)

    async def test_failed_or_truncated_history_is_never_confirmed_empty(self):
        now = local_stamp(2026, 11, 11, 21)
        start, end = report_window(now, PARIS)
        extras = SimpleNamespace(
            account_printers=lambda: [SimpleNamespace(id=5)],
            task_rows=AsyncMock(return_value=([], True)),
        )
        self.assertEqual(await collect_history(extras, start, end), ([], False))
        self.assertEqual(extras.task_rows.await_count, 3)
        extras.task_rows.side_effect = ValueError
        self.assertEqual(await collect_history(extras, start, end), ([], False))

    async def test_reports_can_read_account_without_a_selected_printer(self):
        from unittest.mock import patch

        from server import discord_report_history

        engine = SimpleNamespace(
            api=object(),
            account_token="fictif",
            ok=False,
            reconnect_required=False,
            extras=object(),
        )
        reader = AsyncMock(return_value=([], True))
        with patch("server.engine", engine), patch("server.collect_history", reader):
            self.assertEqual(await discord_report_history(1, 2), ([], True))
        reader.assert_awaited_once_with(engine.extras, 1, 2)


class NextReportTests(unittest.TestCase):
    """Le prochain créneau affiché suit le fuseau de l’atelier."""

    def test_next_slot_moves_to_evening_then_next_morning(self):
        """Avant 21 h : le soir même ; après 21 h : 08 h le lendemain."""
        from datetime import datetime
        from zoneinfo import ZoneInfo
        from notification_reports import next_report_time

        zone = ZoneInfo("Europe/Paris")
        noon = datetime(2026, 11, 13, 12, tzinfo=zone).timestamp()
        late = datetime(2026, 11, 13, 22, tzinfo=zone).timestamp()
        self.assertEqual(next_report_time(noon, zone).hour, 21)
        upcoming = next_report_time(late, zone)
        self.assertEqual((upcoming.day, upcoming.hour), (14, 8))
