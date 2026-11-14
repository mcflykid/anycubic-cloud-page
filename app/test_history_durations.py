"""Durées historiques sur réponses synthétiques séparées, sans réseau ni appareil."""

import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from cloud_extras import CloudExtras
from history_durations import history_duration


class DurationTests(unittest.TestCase):
    """Le sens d’une durée ne dépend ni du complément de page ni du rendu."""

    def test_terminal_interval_wins_but_counter_survives(self):
        """Une contradiction n’efface pas le compteur fournisseur."""
        for status in (2, 3):
            result = history_duration(
                {"print_status": status, "start_time": 1000, "end_time": 1600, "print_time": 90}
            )
            self.assertEqual(result["minutes"], 10)
            self.assertEqual(result["kind"], "interval")
            self.assertEqual(result["reported_minutes"], 90)
            self.assertTrue(result["conflict"])

    def test_active_ignores_old_end_and_invalid_numbers(self):
        """Un ancien horodatage de fin n’est pas la durée d’une tâche active."""
        for invalid in (None, -1, float("inf"), float("nan"), True, ""):
            result = history_duration(
                {"print_status": 1, "start_time": 1000, "end_time": 1600, "print_time": invalid}
            )
            self.assertIsNone(result["minutes"])
            self.assertIsNone(result["interval_minutes"])
        self.assertEqual(history_duration({"print_status": 1, "print_time": 0})["minutes"], 0)

    def test_unknown_status_does_not_assert_terminal_interval(self):
        """Des dates seules ne prouvent pas que la tâche est terminée."""
        for status in (None, 0, 1, 9):
            result = history_duration(
                {"print_status": status, "start_time": 1000, "end_time": 1600}
            )
            self.assertIsNone(result["interval_minutes"])

    def test_invalid_dates_and_counter_fallback(self):
        """Les dates incomplètes ou inversées ne deviennent pas zéro."""
        for row in (
            {"start_time": 1000},
            {"start_time": 1000, "end_time": 999},
            {"start_time": 0, "end_time": 1000},
        ):
            result = history_duration({**row, "print_status": 3})
            self.assertIsNone(result["minutes"])
        self.assertEqual(history_duration({"print_status": 3, "print_time": "5"})["minutes"], 5)


class SourcesTests(unittest.IsolatedAsyncioTestCase):
    """Vérifie le raccordement des sources avant leur fusion."""

    def setUp(self):
        """Installe uniquement des doubles du transport et de l’imprimante."""
        self.engine = SimpleNamespace(
            printer=SimpleNamespace(id=7), api=SimpleNamespace(project_info_for_id=AsyncMock())
        )
        self.extras = CloudExtras(self.engine)

    async def test_complement_never_changes_primary_duration(self):
        """Sortir de la page getProjects ne change pas le sens de la durée principale."""
        row = {
            "printer_id": 7,
            "task_id": 8,
            "print_status": 3,
            "start_time": 1000,
            "end_time": 1600,
        }
        complement = {"printer_id": 7, "taskid": 8, "print_time": 90}
        results = []
        for page, projects in enumerate(([complement], []), start=1):
            self.extras.api = AsyncMock(side_effect=[[row], projects])
            results.append((await self.extras.task_list(page))["items"][0])
        self.assertEqual([r["elapsed_minutes"] for r in results], [10, 10])
        self.assertEqual(results[0]["duration"]["source"], "history_v2")
        self.assertEqual(results[0]["duration"]["supplement_reported_minutes"], 90)
        self.assertTrue(results[0]["duration"]["conflict"])

    async def test_missing_interval_does_not_promote_complement(self):
        """Un compteur uniquement complémentaire reste disponible sans piloter la liste."""
        row = {"printer_id": 7, "task_id": 8, "print_status": 1}
        self.extras.api = AsyncMock(
            side_effect=[[row], [{"printer_id": 7, "taskid": 8, "print_time": 90}]]
        )
        result = (await self.extras.task_list(1))["items"][0]
        self.assertIsNone(result["elapsed_minutes"])
        self.assertEqual(result["duration"]["supplement_reported_minutes"], 90)

    async def test_detail_keeps_each_source_and_fallback(self):
        """Le détail distingue v2, complément et v5, même si leurs compteurs divergent."""
        row = {
            "printer_id": 7,
            "task_id": 8,
            "print_status": 3,
            "print_time": 20,
            "start_time": 1000,
            "end_time": 1600,
        }
        self.extras.api = AsyncMock(
            side_effect=[[row], [{"printer_id": 7, "taskid": 8, "print_time": 90}]]
        )
        item = (await self.extras.task_list(1))["items"][0]
        for fallback in (False, True):
            detail = {"print_time": 80, "estimated_time_s": 600}
            self.extras.api = AsyncMock(return_value=None if fallback else detail)
            self.engine.api.project_info_for_id.return_value = detail
            result = await self.extras.detail(item["key"])
            self.assertEqual(result["duration"]["reported_minutes"], 20)
            self.assertEqual(result["duration"]["supplement_reported_minutes"], 90)
            self.assertEqual(result["duration"]["detail_reported_minutes"], 80)
            self.assertEqual(
                result["duration"]["detail_source"], "project_info" if fallback else "history_v5"
            )
            self.assertTrue(result["duration"]["conflict"])
            self.assertEqual(result["estimated_seconds"], 600)
