"""Limitation partagée avec horloge simulée, sans appel Cloud réel."""

import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from cloud_budget import CloudRequestBudget
from anycubic_cloud_api.api.base import AnycubicAPIBase, AnycubicRateLimited
from anycubic_cloud_api.models.http import HTTP_METHODS
from test_session_api import ResponseContext
from server import CloudPageAPI
from anycubic_cloud_api.api.mqtt import AnycubicMQTTAPI


class BudgetTests(unittest.IsolatedAsyncioTestCase):
    """Les demandes concurrentes sont espacées et les refus ne sont jamais rejoués."""

    async def test_parallel_requests_are_spaced_with_one_shared_clock(self):
        """Trois appels simultanés ne partent pas en rafale après le même relevé d’horloge."""
        clock = [10.0]

        async def sleep(seconds):
            "Avance l’horloge simulée pour vérifier l’espacement des demandes concurrentes."
            clock[0] += seconds

        budget = CloudRequestBudget(monotonic=lambda: clock[0], sleep=sleep)
        starts = []

        async def ask():
            "Réserve une requête dans le budget partagé avant de l’ajouter aux mesures de départ."
            await budget.acquire()
            starts.append(clock[0])

        await asyncio.gather(*(ask() for _ in range(3)))
        self.assertEqual(starts, [10.0, 11.0, 12.0])

    async def test_cooldown_fails_without_sleep_or_request_then_recovers(self):
        """Une pause active coupe les essais avant le transport et expire sans redémarrage."""
        clock = [10.0]
        sleeper = AsyncMock()
        budget = CloudRequestBudget(monotonic=lambda: clock[0], sleep=sleeper)
        budget.defer(120)
        for _ in range(3):
            with self.assertRaises(AnycubicRateLimited) as caught:
                await budget.acquire()
            self.assertEqual(caught.exception.retry_after, 120)
        sleeper.assert_not_awaited()
        clock[0] = 130.0
        await budget.acquire()

    async def test_429_is_classified_before_private_body_is_read(self):
        """Le statut et Retry-After suffisent ; aucun texte fournisseur privé n’est conservé."""
        response = SimpleNamespace(status=429, headers={"Retry-After": "120"}, json=AsyncMock())
        session = SimpleNamespace(post=Mock(return_value=ResponseContext(response)))
        client = object.__new__(AnycubicAPIBase)
        client._session = session
        client._anycubic_auth = SimpleNamespace(requires_user_agent=False)
        with self.assertRaises(AnycubicRateLimited) as caught:
            await client._fetch_ext_resp(HTTP_METHODS.POST, "https://example.test/cloud")
        self.assertEqual(caught.exception.retry_after, 120)
        response.json.assert_not_awaited()
        session.post.assert_called_once()

    def test_retry_after_seconds_date_and_invalid_value(self):
        """Les deux formes normalisées du délai sont comprises sans accepter NaN ou un délai négatif."""
        self.assertEqual(AnycubicRateLimited.from_header("90", now=0).retry_after, 90)
        self.assertEqual(
            AnycubicRateLimited.from_header("Thu, 01 Jan 1970 00:02:00 GMT", now=0).retry_after, 120
        )
        for value in [None, "invalid", "nan", "-4", "0"]:
            self.assertEqual(AnycubicRateLimited.from_header(value, now=0).retry_after, 60)

    async def test_client_429_blocks_next_endpoint_without_replay(self):
        """Le même client de compte bloque aussi un autre parcours après le refus fournisseur."""
        client = object.__new__(CloudPageAPI)
        client._cloud_request_budget = CloudRequestBudget(monotonic=lambda: 10.0)
        send = AsyncMock(side_effect=AnycubicRateLimited(120))
        with patch.object(AnycubicMQTTAPI, "_fetch_ext_resp", new=send):
            for endpoint in ["https://example.test/upload", "https://example.test/status"]:
                with self.assertRaises(AnycubicRateLimited):
                    await client._fetch_ext_resp(HTTP_METHODS.POST, endpoint)
        send.assert_awaited_once()

    async def test_queued_request_rechecks_cooldown_after_spacing_wait(self):
        """Un 429 arrivé pendant l’attente locale empêche le départ déjà réservé."""
        clock = [10.0]

        async def sleep(seconds):
            "Fait avancer l’horloge pendant la file afin de vérifier la réévaluation du cooldown."
            clock[0] += seconds
            budget.defer(60)

        budget = CloudRequestBudget(monotonic=lambda: clock[0], sleep=sleep)
        await budget.acquire()
        with self.assertRaises(AnycubicRateLimited):
            await budget.acquire()
