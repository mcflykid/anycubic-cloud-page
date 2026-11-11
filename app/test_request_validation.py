"""Les requêtes JSON mal formées sont refusées avant tout transport Cloud."""

import unittest
from unittest.mock import AsyncMock
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from request_validation import json_object
from server import errors


class RequestValidationTests(unittest.IsolatedAsyncioTestCase):
    """Vérifie les erreurs HTTP françaises et l’absence d’appel réseau pour un JSON invalide."""

    async def asyncSetUp(self):
        """Crée une route fictive où le transport ne s’exécute qu’après validation commune."""
        self.cloud = AsyncMock()
        app = web.Application(middlewares=[errors])
        app["cloud"] = self.cloud

        async def endpoint(request):
            """Passe uniquement un objet JSON validé au transport fictif."""
            body = await json_object(request)
            await request.app["cloud"](body)
            return web.json_response({"ok": True})

        app.router.add_post("/fixture", endpoint)
        self.client = TestClient(TestServer(app))
        await self.client.start_server()

    async def asyncTearDown(self):
        """Ferme le serveur local de test."""
        await self.client.close()

    async def test_non_object_json_returns_french_400_before_cloud(self):
        """Un tableau JSON n’est pas accepté à la place d’un objet de paramètres."""
        response = await self.client.post("/fixture", json=["fixture"])
        self.assertEqual(response.status, 400)
        self.assertEqual((await response.json())["message"], "Corps JSON invalide.")
        self.cloud.assert_not_awaited()

    async def test_malformed_json_returns_french_400_before_cloud(self):
        """Un corps tronqué reçoit une erreur locale explicite et ne sollicite pas le Cloud."""
        response = await self.client.post(
            "/fixture", data=b"{", headers={"Content-Type": "application/json"}
        )
        self.assertEqual(response.status, 400)
        self.assertEqual((await response.json())["message"], "Corps JSON invalide.")
        self.cloud.assert_not_awaited()
