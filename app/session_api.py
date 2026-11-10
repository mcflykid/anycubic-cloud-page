# SPDX-License-Identifier: GPL-3.0-or-later
"""Rétablissement des sessions explicitement refusées sans rejouer les opérations ambiguës."""

import asyncio, time
import logging
from anycubic_cloud_api.exceptions.exceptions import AnycubicAuthError
from anycubic_cloud_api.api.base import AnycubicHTTPUnauthorized
from operational_logging import log_event

_log = logging.getLogger("cloud_page.session")


class CloudSessionAuthError(AnycubicAuthError):
    """Signale qu’une session cloud explicitement refusée ne peut pas être rétablie immédiatement."""

    pass


class SessionRecovery:
    """Renouvelle une session refusée une seule fois entre requêtes concurrentes, sans rejouer les échecs ambigus."""

    def __init__(self, *args, refresh_access=None, session_renewed=None, **kwargs):
        """Configure les rappels de renouvellement et le verrou partagé des échanges de session."""
        self._session_lock = asyncio.Lock()
        self._session_generation = 0
        self._session_retry_after = 0
        self._refresh_access = refresh_access
        self._session_renewed = session_renewed
        super().__init__(*args, **kwargs)

    @staticmethod
    def _expired(response):
        # Un résultat joint contredit le refus et ne permet pas de rejouer la demande.
        return (
            isinstance(response, dict)
            and str(response.get("code")) == "10001"
            and response.get("data") is None
        )

    async def _fetch_api_resp(self, *args, **kwargs):
        generation = self._session_generation
        unauthorized = False
        unauthorized_error = None
        try:
            response = await super()._fetch_api_resp(*args, **kwargs)
        except AnycubicHTTPUnauthorized as error:
            if error.has_data:
                raise
            response = None
            unauthorized = True
            unauthorized_error = error
        authenticated = kwargs.get("with_token", args[5] if len(args) > 5 else True)
        if not authenticated:
            if unauthorized_error:
                raise unauthorized_error
            return response
        if not (unauthorized or self._expired(response)):
            return response
        log_event(
            _log,
            logging.DEBUG,
            "session_recovery_started",
            message="Refus de session confirmé; renouvellement demandé",
        )
        async with self._session_lock:
            if generation == self._session_generation:
                if time.monotonic() < self._session_retry_after:
                    raise CloudSessionAuthError("Reconnexion Anycubic en attente")
                try:
                    try:
                        await self._get_user_token_with_access_token()
                    except AnycubicAuthError:
                        if not self._refresh_access:
                            raise
                        access = await self._refresh_access()
                        self.anycubic_auth.set_access_token(access)
                        await self._get_user_token_with_access_token()
                    self._session_generation += 1
                    self._session_retry_after = 0
                except Exception as error:
                    self._session_retry_after = time.monotonic() + 60
                    log_event(
                        _log,
                        logging.WARNING,
                        "session_recovery_failed",
                        message="Renouvellement de session impossible; réessayer plus tard",
                        error_type=type(error).__name__ if error else "Exception",
                    )
                    raise CloudSessionAuthError("Reconnexion Anycubic indisponible") from None
                if self._session_renewed:
                    self._session_renewed(self)
                log_event(
                    _log,
                    logging.INFO,
                    "session_recovery_succeeded",
                    message="Session renouvelée; une seule reprise sera tentée",
                )
        # Seul un refus explicite prouve l’absence d’exécution : ne pas rejouer un délai expiré ou une réponse illisible.
        try:
            response = await super()._fetch_api_resp(*args, **kwargs)
        except AnycubicHTTPUnauthorized:
            self._session_retry_after = time.monotonic() + 60
            log_event(
                _log,
                logging.WARNING,
                "session_retry_refused",
                message="Nouvelle session refusée; reprise arrêtée",
                outcome="refusée",
            )
            raise CloudSessionAuthError("Session Anycubic refusée après reconnexion") from None
        if self._expired(response):
            self._session_retry_after = time.monotonic() + 60
            raise CloudSessionAuthError("Session Anycubic refusée après reconnexion")
        return response
