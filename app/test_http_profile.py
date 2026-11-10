"""En-têtes effectivement émis par le transport local, sans appel au fournisseur."""

import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock
from aiohttp import web
from aiohttp.test_utils import TestServer
from account_transport import AccountTransport
from anycubic_cloud_api.models.auth import AnycubicAuthMode


class HttpProfileTests(unittest.IsolatedAsyncioTestCase):
    """Une session commune conserve les en-têtes explicites sans annoncer son moteur HTTP."""

    async def test_wire_headers_do_not_disclose_runtime_or_local_diagnostics(self):
        """Le serveur fictif observe les octets de requête, pas seulement une configuration attendue."""
        captured = []

        async def receive(request):
            captured.append(dict(request.headers))
            return web.json_response({"ok": True})

        app = web.Application()
        app.router.add_get("/", receive)
        server = TestServer(app)
        await server.start_server()
        transport = AccountTransport()
        account = SimpleNamespace(token=AsyncMock(return_value="fixture-token"))

        def factory(session, jar, **kwargs):
            self.assertEqual(kwargs["auth_mode"], AnycubicAuthMode.SLICER)
            return SimpleNamespace(
                check_api_tokens=AsyncMock(return_value=True),
                list_my_printers=AsyncMock(return_value=[]),
            )

        try:
            await transport.connect(account, factory, object(), None, None, None)
            async with transport.session.get(server.make_url("/")) as response:
                await response.read()
            self.assertNotIn("User-Agent", captured[0])
            self.assertNotIn("Origin", captured[0])
            self.assertNotIn("X-Request-ID", captured[0])
            async with transport.session.get(
                server.make_url("/"),
                headers={"User-Agent": "fixture-browser", "Origin": "https://example.invalid"},
            ) as response:
                await response.read()
            self.assertEqual(captured[1]["User-Agent"], "fixture-browser")
            self.assertEqual(captured[1]["Origin"], "https://example.invalid")
        finally:
            if transport.session:
                await transport.session.close()
            await server.close()
