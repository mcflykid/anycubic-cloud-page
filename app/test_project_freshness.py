"""Pause/reprise/arrêt : une relecture fictive doit confirmer la même tâche avant tout envoi."""

import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
import server
from anycubic_cloud_api.const.enums import AnycubicPrintStatus
from anycubic_cloud_api.data_models.project import AnycubicProject


class ProjectState(unittest.TestCase):
    """Vérifie les états et estimations issus des rapports du constructeur."""

    def test_leveling_stays_active_and_missing_pause_flag_means_unpaused(self):
        """Le nivellement reste actif, même sans indicateur de pause."""
        project = AnycubicProject.__new__(AnycubicProject)
        project._print_status = AnycubicPrintStatus.Leveling
        project._pause = None
        self.assertTrue(project.print_in_progress)
        self.assertFalse(project.print_is_paused)
        project._pause = 1
        self.assertTrue(project.print_is_paused)
        project._print_status = AnycubicPrintStatus.Complete
        self.assertFalse(project.print_is_paused)

    def test_eta_without_remaining_time_stays_unknown(self):
        """Une estimation positive ou une heure explicite peuvent être affichées."""
        project = AnycubicProject.__new__(AnycubicProject)
        project._end_time = None
        for remaining in (None, 0, -1):
            project._remain_time = remaining
            self.assertIsNone(project.print_approximate_completion_time)
        project._remain_time = 2
        with patch("anycubic_cloud_api.data_models.project.time.time", return_value=100):
            self.assertEqual(project.print_approximate_completion_time, 220)
        project._end_time = 300
        self.assertEqual(project.print_approximate_completion_time, 300)


class ProjectFreshness(unittest.IsolatedAsyncioTestCase):
    """Vérifie l’identité affichée, les transitions et l’échec fermé sans transport réel."""

    async def asyncSetUp(self):
        """Prépare une tâche en cours et des commandes entièrement simulées."""
        self.e = server.Engine()
        self.p = SimpleNamespace(
            id=1,
            connected_ace_units=0,
            latest_project=SimpleNamespace(id=10),
            latest_project_print_in_progress=True,
            latest_project_print_is_paused=False,
            printer_online=True,
            update_info_from_api=AsyncMock(),
            pause_print=AsyncMock(return_value="ok"),
            resume_print=AsyncMock(return_value="ok"),
            cancel_print=AsyncMock(return_value="ok"),
        )
        self.e.printer = self.p
        self.e.api = SimpleNamespace()
        self.key = self.e.command_project_key()

    async def test_fresh_http_read_precedes_exactly_one_command_without_mqtt(self):
        """L’absence de MQTT ne gêne pas une relecture HTTP récente et réussie."""
        for name in ["pause", "resume", "cancel"]:
            self.p.latest_project_print_is_paused = name == "resume"
            await self.e.action(name, {"project_key": self.key})
            getattr(self.p, name + "_print").assert_awaited_once_with(project=self.p.latest_project)
        self.assertEqual(self.p.update_info_from_api.await_count, 3)

    async def test_next_project_is_rejected_before_and_during_refresh(self):
        """Une confirmation ancienne ne peut agir sur le projet suivant, même changé pendant la lecture."""
        for during in [False, True]:
            self.p.latest_project = SimpleNamespace(id=10)
            if during:

                async def switch():
                    """Simule le projet suivant reçu pendant la consultation HTTP."""
                    self.p.latest_project = SimpleNamespace(id=11)

                self.p.update_info_from_api.side_effect = switch
            else:
                self.p.latest_project = SimpleNamespace(id=11)
            with self.assertRaisesRegex(ValueError, "projet a changé"):
                await self.e.action("cancel", {"project_key": self.key})
            self.p.cancel_print.assert_not_awaited()

    async def test_failed_refresh_never_uses_old_poll_or_unrelated_mqtt(self):
        """Un ancien polling et un MQTT récent ne remplacent pas la preuve d’état de la tâche."""
        self.e.updated = "old"
        self.e.mqtt_update = server.now()
        self.p.update_info_from_api.side_effect = TimeoutError()
        with self.assertRaisesRegex(ValueError, "État récent"):
            await self.e.action("pause", {"project_key": self.key})
        self.p.pause_print.assert_not_awaited()

    async def test_changed_pause_or_finished_job_is_rejected(self):
        """Les transitions entre affichage et envoi sont revérifiées, sans commande inverse implicite."""
        self.p.latest_project_print_is_paused = True
        with self.assertRaisesRegex(ValueError, "pause a changé"):
            await self.e.action("pause", {"project_key": self.key})
        self.p.pause_print.assert_not_awaited()
        self.p.latest_project_print_in_progress = False
        with self.assertRaisesRegex(ValueError, "Aucune impression active"):
            await self.e.action("cancel", {"project_key": self.key})
        self.p.cancel_print.assert_not_awaited()

    async def test_missing_reference_does_not_even_refresh(self):
        """Une ancienne interface sans référence ne peut envoyer une commande physique."""
        with self.assertRaises(ValueError):
            await self.e.action("cancel", {})
        self.p.update_info_from_api.assert_not_awaited()
        self.p.cancel_print.assert_not_awaited()

    async def test_same_project_with_new_attempt_cannot_reuse_confirmation(self):
        """Une nouvelle exécution du même projet invalide aussi la référence de confirmation."""
        self.p.latest_project = SimpleNamespace(
            id=10, _taskid=100, created_timestamp=50, _start_time=60
        )
        key = self.e.command_project_key()
        self.p.latest_project._start_time = 80
        with self.assertRaisesRegex(ValueError, "projet a changé"):
            await self.e.action("cancel", {"project_key": key})
        self.p.cancel_print.assert_not_awaited()
