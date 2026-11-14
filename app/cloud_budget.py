"""Cadence HTTP locale prudente partagée par le client d’un compte, sans rejeu."""

import asyncio
import math
import time

from anycubic_cloud_api.api.base import AnycubicRateLimited


class CloudRequestBudget:
    """Espace les départs d’au moins une seconde et refuse toute demande pendant un Retry-After."""

    def __init__(self, *, monotonic=time.monotonic, sleep=asyncio.sleep):
        """Injecte les horloges pour tester les délais sans requête ni attente réelle."""
        self._clock = monotonic
        self._sleep = sleep
        self._lock = asyncio.Lock()
        self._next = 0.0
        self._blocked_until = 0.0

    def defer(self, seconds):
        """Étend la pause globale annoncée par le fournisseur sans raccourcir une pause active."""
        self._blocked_until = max(self._blocked_until, self._clock() + seconds)

    def _check(self):
        """Refuse localement un départ pendant la pause, sans ajouter d’attente réseau."""
        remaining = self._blocked_until - self._clock()
        if remaining > 0:
            raise AnycubicRateLimited(math.ceil(remaining))

    async def acquire(self):
        """Réserve un départ HTTP ou lève AnycubicRateLimited sans nouvel appel pendant une pause."""
        self._check()
        async with self._lock:
            self._check()
            delay = self._next - self._clock()
            if delay > 0:
                await self._sleep(delay)
            # Une réponse 429 peut arriver pendant l’attente de cadence d’une autre requête.
            self._check()
            self._next = self._clock() + 1.0
