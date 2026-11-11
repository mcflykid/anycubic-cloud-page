"""Budgets des transferts signés sur session HTTP entièrement simulée."""

import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, AsyncMock
from aiohttp import ClientSession, web
from aiohttp.test_utils import TestServer
from anycubic_cloud_api.api.base import AnycubicAPIBase
from anycubic_cloud_api.const.api_endpoints import API_ENDPOINT
from anycubic_cloud_api.exceptions.exceptions import AnycubicAPIParsingError
from anycubic_cloud_api.models.http import HTTP_METHODS


class UploadTimeout(unittest.IsolatedAsyncioTestCase):
    """Un gros PUT ne doit pas hériter des 45 secondes réservées aux appels API."""

    async def test_sensitive_post_never_follows_a_redirect(self):
        """Un serveur fictif déjà atteint ne reçoit pas le même POST à une seconde URL."""
        calls = []

        async def order(request):
            "Interrompt la connexion après réception afin de vérifier qu’un POST n’est pas répété."
            calls.append(request.path)
            await request.read()
            raise web.HTTPTemporaryRedirect("/repeat")

        async def repeat(request):
            "Compte toute requête vers la destination de redirection fictive."
            calls.append(request.path)
            return web.json_response({"data": {"msgid": "fixture"}})

        app = web.Application()
        app.router.add_post(API_ENDPOINT.send_order.endpoint, order)
        app.router.add_post("/repeat", repeat)
        async with TestServer(app) as server, ClientSession() as session:
            api = AnycubicAPIBase(session, session.cookie_jar, auth_token="fixture-token")
            api._public_api_root = str(server.make_url("/")).rstrip("/")
            with self.assertRaisesRegex(AnycubicAPIParsingError, "HTTP 307"):
                await api._fetch_api_resp(API_ENDPOINT.send_order, params={"order": "fixture"})
        self.assertEqual(calls, [API_ENDPOINT.send_order.endpoint])

    async def test_firmware_get_is_not_replayed_after_disconnect(self):
        """La mise à jour GET a pu être acceptée avant la coupure du serveur fictif."""
        calls = []

        async def update(request):
            "Reçoit la demande de mise à jour et contrôle le comportement au transport."
            calls.append(request.path)
            if len(calls) == 1:
                request.transport.abort()
            return web.json_response({"code": 1})

        endpoint = API_ENDPOINT.printer_firmware_update
        app = web.Application()
        app.router.add_get(endpoint.endpoint, update)
        async with TestServer(app) as server, ClientSession() as session:
            api = AnycubicAPIBase(session, session.cookie_jar, auth_token="fixture-token")
            api._public_api_root = str(server.make_url("/")).rstrip("/")
            with self.assertRaises(AnycubicAPIParsingError):
                await api._fetch_api_resp(endpoint)
        self.assertEqual(calls, [endpoint.endpoint])

    async def test_signed_transfer_has_size_budget_and_normal_api_keeps_default(self):
        """Inspecte le délai réellement transmis à la session, sans attendre ni ouvrir de socket."""
        session = MagicMock()
        resp = SimpleNamespace(
            status=200,
            url="https://example.test/upload",
            text=AsyncMock(return_value=""),
            json=AsyncMock(return_value={}),
        )
        for method in [session.put, session.post]:
            method.return_value.__aenter__ = AsyncMock(return_value=resp)
        api = SimpleNamespace(
            _session=session,
            _web_headers=lambda **kw: {},
            _log_api_call_info=False,
            _last_warn_api_duration=None,
        )
        await AnycubicAPIBase._fetch_ext_resp(
            api,
            HTTP_METHODS.PUT,
            "https://example.test/upload",
            put_data=b"x" * (2 * 1024 * 1024),
            is_json=False,
        )
        timeout = session.put.call_args.kwargs["timeout"]
        self.assertEqual(timeout.total, 184)
        self.assertEqual(timeout.sock_connect, 30)
        self.assertEqual(timeout.sock_read, 120)
        await AnycubicAPIBase._fetch_ext_resp(api, HTTP_METHODS.POST, "https://example.test/api")
        self.assertNotIn("timeout", session.post.call_args.kwargs)

    async def test_empty_failed_put_is_not_a_success(self):
        """Un rejet HTTP sans corps déclenche le chemin d’échec du transfert."""
        session = MagicMock()
        response = SimpleNamespace(status=403, text=AsyncMock(return_value=""))
        session.put.return_value.__aenter__ = AsyncMock(return_value=response)
        api = SimpleNamespace(_session=session, _web_headers=lambda **kwargs: {})
        with self.assertRaises(AnycubicAPIParsingError):
            await AnycubicAPIBase._fetch_ext_resp(
                api, HTTP_METHODS.PUT, "https://example.test/upload", put_data=b"x", is_json=False
            )
        response.text.assert_not_awaited()
