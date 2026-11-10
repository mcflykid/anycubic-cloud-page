"""Journaux HTTP de conteneur : corrélation sans contenu de requête privé."""

import unittest
from unittest.mock import patch
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from server import operational_requests


class OperationalHTTPTests(unittest.IsolatedAsyncioTestCase):
    """Le template de route remplace les identifiants et les arguments utilisateur."""

    async def test_route_template_and_correlation_are_logged_without_private_input(self):
        """Une requête à paramètre privé ne fait entrer ni argument ni secret dans le log."""

        async def handler(request):
            """Fournit une réponse fictive pour observer uniquement la frontière HTTP."""
            return web.json_response({"ok": True})

        app = web.Application(middlewares=[operational_requests])
        app.router.add_get("/imprimante-api/fixture/{reference}", handler)
        async with TestClient(TestServer(app)) as client:
            with patch("server.log_event") as emit:
                response = await client.get(
                    "/imprimante-api/fixture/private-printer?token=private-token",
                    headers={"Authorization": "private-auth"},
                )
                self.assertEqual(response.status, 200)
                self.assertRegex(response.headers["X-Request-ID"], r"^[a-f0-9]{32}$")
                self.assertEqual(
                    emit.call_args.kwargs["route"], "/imprimante-api/fixture/{reference}"
                )
                self.assertEqual(
                    emit.call_args.kwargs["request_id"], response.headers["X-Request-ID"]
                )
                self.assertNotIn("private-", str(emit.call_args))

    async def test_http_error_keeps_a_correlated_warning(self):
        """Un refus HTTP journalise son statut sans le texte de l’exception."""

        async def handler(request):
            """Fournit une réponse fictive pour observer uniquement la frontière HTTP."""
            raise web.HTTPForbidden(text="private-refusal-detail")

        app = web.Application(middlewares=[operational_requests])
        app.router.add_get("/imprimante-api/fixture", handler)
        async with TestClient(TestServer(app)) as client:
            with patch("server.log_event") as emit:
                response = await client.get("/imprimante-api/fixture")
                self.assertEqual(response.status, 403)
                self.assertEqual(emit.call_args.kwargs["status"], 403)
                self.assertNotIn("private-refusal", str(emit.call_args))
