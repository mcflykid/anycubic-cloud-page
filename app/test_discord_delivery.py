"""Vérifie les preuves terminales, l’unicité et le transport Discord simulé."""

import asyncio
from pathlib import Path
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

from notification_delivery import Delivery, cloud_events, private_json
from notification_discord import DiscordConfig, DiscordResult, discord_url, format_message


def fixture_row(task="10", timestamp=110, **values):
    """Construit une ligne Cloud fictive sans référence d’un compte réel."""
    return {
        "printer_id": "fixture-printer",
        "task_id": task,
        "create_time": timestamp,
        "printer_name": "@everyone _Kobra_",
        "project_name": "fixture-private.gcode",
        **values,
    }


class DiscordDeliveryTests(unittest.IsolatedAsyncioTestCase):
    """Teste un canal simulé avec état privé et horloge déterministe."""

    def setUp(self):
        """Crée des chemins isolés et une horloge sans attendre les délais réels."""
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.clock = 100
        self.send = AsyncMock(return_value=DiscordResult("sent", 200))
        self.delivery = Delivery(self.root / "state", self.send, clock=lambda: self.clock)
        self.config = DiscordConfig(url="fixture-webhook", enabled=True)
        self.delivery.configure(self.config)

    async def asyncTearDown(self):
        """Annule la tâche simulée si un test s’arrête avant sa fin."""
        await self.delivery.close()

    def test_cloud_evidence_is_strict_and_correlates_both_sources(self):
        """Un arrêt ou un code isolé ne devient pas un échec."""
        legacy = [
            fixture_row("1", print_status=3),
            fixture_row("2", print_status=3, title="Print failed"),
            fixture_row("3", print_status=3, title="Print to terminate"),
            fixture_row("4", print_status=2, title="Print failed"),
            fixture_row("5", title="Print to paused"),
        ]
        slicer = [
            fixture_row("1", alarm_code=10115),
            fixture_row("2", alarm_code=10115),
            fixture_row("3", alarm_code=10115),
            fixture_row("6", alarm_code="200"),
        ]
        results = cloud_events("scope", slicer, legacy)
        self.assertCountEqual(
            [(row.result, row.code) for row in results],
            [
                ("failed", "10115"),
                ("completed", ""),
            ],
        )

    async def test_baseline_and_restart_never_send_old_or_duplicate_results(self):
        """L’historique de démarrage et les tâches déjà vues restent silencieux."""
        old = cloud_events("scope", [fixture_row("1", 99, alarm_code=200)], [])
        await self.delivery.observe(old)
        self.clock = 112
        recent = cloud_events("scope", [fixture_row("2", alarm_code=200)], [])
        await self.delivery.observe(recent)
        await self.delivery.observe(recent)
        await self.delivery.join()
        self.send.assert_awaited_once()
        await self.delivery.close()
        other = Delivery(self.root / "state", self.send, clock=lambda: self.clock)
        self.addAsyncCleanup(other.close)
        other.configure(self.config)
        await other.observe(old + recent)
        await other.join()
        self.send.assert_awaited_once()

    async def test_parallel_observations_commit_once_off_the_event_loop(self):
        """Le verrou de stockage sérialise les écritures et préserve le dédoublonnage."""
        await self.delivery.observe([])
        self.clock = 112
        recent = cloud_events("scope", [fixture_row(alarm_code=200)], [])
        with patch("notification_delivery.asyncio.to_thread", wraps=asyncio.to_thread) as offload:
            await asyncio.gather(self.delivery.observe(recent), self.delivery.observe(recent))
            await self.delivery.join()

        self.send.assert_awaited_once()
        self.assertEqual(offload.await_count, 3)
        for call in offload.await_args_list:
            self.assertIs(call.args[0], private_json)

    async def test_unobserved_intervals_are_logged_and_expired_results_stay_silent(self):
        """Les lectures de reprise rendent visibles les coupures sans rejouer l’historique."""
        legacy = AsyncMock(return_value=[])
        old = fixture_row("1", 99, alarm_code=200)
        with self.assertLogs("cloud_page.notifications", level="INFO") as output:
            await self.delivery.observe_cloud("scope", "slicer", [old], legacy)
            self.clock = 750
            expired = fixture_row("2", 110, alarm_code=200)
            await self.delivery.observe_cloud("scope", "slicer", [expired], legacy)
            await self.delivery.observe_cloud("scope", "slicer", [expired], legacy)
            self.delivery.configure(DiscordConfig(url="autre-webhook", enabled=True))
            await self.delivery.observe_cloud("scope", "slicer", [expired], legacy)

        outcomes = [
            record._operational_fields["outcome"]
            for record in output.records
            if record._operational_event == "notification_observation_gap"
        ]
        self.assertEqual(
            outcomes, ["startup", "cloud_gap", "expired", "settings_discarded", "settings"]
        )
        self.send.assert_not_awaited()

    async def test_ambiguous_delivery_is_never_retried(self):
        """Un résultat incertain est conservé et ne déclenche aucun nouvel essai."""
        await self.delivery.observe([])
        self.clock = 112
        self.send.return_value = DiscordResult("uncertain")
        await self.delivery.observe(cloud_events("scope", [fixture_row(alarm_code=200)], []))
        await self.delivery.join()
        self.send.assert_awaited_once()
        self.assertEqual(self.delivery.last_outcome, "uncertain")

    def test_legacy_url_is_canonicalized_without_redirects(self):
        """Les anciennes adresses restent compatibles avec la destination HTTPS actuelle."""
        path = "/api/webhooks/12345678901234567/" + "a" * 64
        self.assertEqual(discord_url("https://discordapp.com" + path), "https://discord.com" + path)
        for host in (
            "discordapp.com.evil.invalid",
            "discordapp.com:444",
            "discordapp.com@localhost",
        ):
            with self.assertRaises(ValueError):
                discord_url("https://" + host + path)

    def test_host_and_message_are_bounded(self):
        """N’accepte qu’un webhook Discord et neutralise les mentions des libellés."""
        for invalid in (
            "http://discord.com/api/webhooks/1/x",
            "https://discord.com.evil.invalid/x",
            "https://discord.com@localhost/api/webhooks/1/x",
            "https://discord.com/api/webhooks/12345678901234567/" + "a" * 64 + "?wait=false",
        ):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                discord_url(invalid)
        item = cloud_events("scope", [fixture_row(alarm_code=200)], [])[0]
        payload = format_message(item, self.config)
        self.assertEqual(payload["allowed_mentions"], {"parse": []})
        self.assertNotIn("@everyone", payload["content"])
        self.assertNotIn("fixture-private.gcode", payload["content"])

    def test_failure_includes_the_localized_catalogue_title(self):
        """Un échec connu conserve le code et son titre local, sans texte distant."""
        item = cloud_events("scope", [], [fixture_row(title="Print failed", reason_id=10113)])[0]
        config = DiscordConfig(url="fixture-webhook", enabled=True, language="es")
        payload = format_message(item, config)
        self.assertIn(
            "10113 · Falló la comprobación de integridad del archivo descargado", payload["content"]
        )
        unknown = cloud_events("scope", [], [fixture_row(title="Print failed", reason_id=99999)])[0]
        self.assertIn("Código de error 99999", format_message(unknown, config)["content"])

    async def test_retry_after_then_success(self):
        """Seul un refus temporaire établi réessaie et respecte la pause fournie."""
        sleeps = []

        async def wait(delay):
            """Avance l’horloge fictive plutôt que d’attendre Discord."""
            sleeps.append(delay)
            self.clock += delay
            await asyncio.sleep(0)

        self.delivery.wait = wait
        await self.delivery.observe([])
        self.clock = 112
        self.send.side_effect = [DiscordResult("retry", 429, 2), DiscordResult("sent", 200)]
        await self.delivery.observe(cloud_events("scope", [fixture_row(alarm_code=200)], []))
        await self.delivery.join()
        self.assertEqual(self.send.await_count, 2)
        self.assertEqual(sleeps, [2])

    async def test_recent_alarm_uses_one_legacy_read_and_needs_explicit_failure(self):
        """Le journal historique complète une alarme récente dans le budget du compte."""
        legacy = AsyncMock(return_value=[fixture_row(title="Print failed", print_status=3)])
        await self.delivery.observe_cloud("scope", "slicer", [], legacy)
        self.clock = 112
        row = fixture_row(alarm_code=10115)
        await self.delivery.observe_cloud("scope", "slicer", [row], legacy)
        await self.delivery.observe_cloud(
            "scope", "slicer", [row, fixture_row(task="11", alarm_code=10115)], legacy
        )
        await self.delivery.join()
        legacy.assert_awaited_once()
        self.send.assert_awaited_once()
        self.assertEqual(self.send.call_args.args[1].result, "failed")

    async def test_disable_prevents_retry_after_an_inflight_refusal(self):
        """Une modification du réglage interrompt toute reprise de l’ancienne destination."""
        started, release = asyncio.Event(), asyncio.Event()

        async def send(config, event):
            """Suspend la première réponse pour simuler une désactivation concurrente."""
            started.set()
            await release.wait()
            return DiscordResult("retry", 429, 2)

        self.send.side_effect = send
        await self.delivery.observe([])
        self.clock = 112
        await self.delivery.observe(cloud_events("scope", [fixture_row(alarm_code=200)], []))
        await started.wait()
        self.delivery.configure(DiscordConfig())
        release.set()
        await self.delivery.join()
        self.send.assert_awaited_once()


class DiscordTransportTests(unittest.IsolatedAsyncioTestCase):
    """Contrôle les preuves HTTP sans ouverture d’un socket réseau."""

    async def test_requires_a_confirmed_message_and_disables_redirects(self):
        """Un 2xx incomplet ou une erreur amont ne suffit pas à confirmer un message."""
        from types import SimpleNamespace
        from unittest.mock import MagicMock
        from notification_discord import send_discord

        url = "https://discord.com/api/webhooks/12345678901234567/" + "a" * 64
        config = DiscordConfig(url=url, enabled=True)
        cases = [
            (200, {}, b'{"id":"12345678901234567"}', "sent", None),
            (200, {}, b"{}", "uncertain", None),
            (302, {"Location": "https://example.invalid"}, b"", "failed", None),
            (429, {"Retry-After": "incorrect"}, b'{"retry_after":1.5}', "retry", 1.5),
            (500, {}, b"", "uncertain", None),
        ]
        for status, headers, body, outcome, delay in cases:
            with self.subTest(status=status, outcome=outcome):
                response = SimpleNamespace(
                    status=status,
                    headers=headers,
                    content=SimpleNamespace(
                        readexactly=AsyncMock(side_effect=asyncio.IncompleteReadError(body, 16385))
                    ),
                )
                request = MagicMock()
                request.__aenter__.return_value = response
                session = SimpleNamespace(post=MagicMock(return_value=request))
                result = await send_discord(session, config, None)
                self.assertEqual(result, DiscordResult(outcome, status, delay))
                self.assertFalse(session.post.call_args.kwargs["allow_redirects"])
                self.assertEqual(session.post.call_args.kwargs["params"], {"wait": "true"})
