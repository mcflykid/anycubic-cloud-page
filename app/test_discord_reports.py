"""Vérifie les fenêtres locales, le contenu et l’unicité des bilans Discord."""

from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock
from zoneinfo import ZoneInfo

from notification_discord import DiscordConfig, DiscordResult
from notification_reports import ReportSchedule, collect_history, format_report, report_window

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
            self.assertIn("Aucune impression", format_report(report, config))
            self.assertFalse((state / "notification-delivery.json").exists())

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
