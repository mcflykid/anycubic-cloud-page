"""Vérifie le second facteur sur une frontière HTTP locale et des clés fictives."""

import asyncio
import base64
from http.cookies import SimpleCookie
import ipaddress
import os
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

from aiohttp import CookieJar, web
from aiohttp.test_utils import TestClient, TestServer

from printer_registry import select_printer
from web_host import ACCESS_KEY, COOKIE_NAME, TRUSTED_PROXIES_KEY, access_control, install_access
from web_totp import TotpConfig, TotpStore, code_at, matching_step, qr_image, recovery_digest

FIXTURE_TIME = 1_700_000_000
FIXTURE_ORIGIN = "http://localhost:8080"
FIXTURE_SECRET = base64.b32encode(b"12345678901234567890").decode("ascii")
FIXTURE_PASSWORD = "test-only-password"
FIXTURE_RECOVERY = "0123-4567-89AB-CDEF-0123"
SECURITY = "/imprimante-api/security"


class TotpCodes(unittest.TestCase):
    """Compare l’algorithme aux vecteurs du RFC et contrôle la fenêtre de tolérance."""

    def test_rfc_vectors_and_clock_window(self):
        """Les six chiffres sont le suffixe des vecteurs SHA-1 à huit chiffres."""
        self.assertEqual(code_at(FIXTURE_SECRET, 59 // 30), "287082")
        self.assertEqual(code_at(FIXTURE_SECRET, 1_111_111_109 // 30), "081804")
        step = FIXTURE_TIME // 30
        for offset in (-1, 0, 1):
            code = code_at(FIXTURE_SECRET, step + offset)
            self.assertEqual(matching_step(FIXTURE_SECRET, code, FIXTURE_TIME), step + offset)
            self.assertIsNone(matching_step(FIXTURE_SECRET, code, FIXTURE_TIME, step + offset))
        self.assertIsNone(
            matching_step(FIXTURE_SECRET, code_at(FIXTURE_SECRET, step - 2), FIXTURE_TIME)
        )

    def test_qr_issuer_uses_uri_escaped_spaces(self):
        """L’émetteur reste lisible pour les lecteurs qui ne décodent pas le signe plus."""
        with patch("segno.make_qr") as qr:
            qr_image(FIXTURE_SECRET)
        uri = qr.call_args.args[0]
        self.assertIn("issuer=Anycubic%20Cloud%20Page", uri)
        self.assertNotIn("+", uri)


class TotpBoundary(unittest.IsolatedAsyncioTestCase):
    """Contrôle l’enrôlement, les cookies, le quota et la persistance après redémarrage."""

    async def asyncSetUp(self):
        """Démarre l’atelier fictif sans transport ni imprimante réelle."""
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        password = Path(directory.name) / "web-password"
        password.write_text(FIXTURE_PASSWORD)
        environment = patch.dict(
            os.environ,
            {
                "PUBLIC_ORIGIN": FIXTURE_ORIGIN,
                "WEB_PASSWORD_FILE": str(password),
                "WEB_USER": "admin",
                "WEB_TOTP_RESET": "false",
            },
        )
        environment.start()
        self.addCleanup(environment.stop)
        clock = patch("web_host.time.time", return_value=FIXTURE_TIME)
        clock.start()
        self.addCleanup(clock.stop)
        self.store = TotpStore(password)
        self.client = await self.start_client()

    async def start_client(self):
        """Crée un état d’accès neuf en gardant uniquement le fichier privé du test."""
        app = web.Application(middlewares=[access_control, select_printer])
        install_access(app)
        app["printer_registry"] = type("PrinterRegistryFixture", (), {"resolve": AsyncMock()})()

        async def status(request):
            """Retourne un témoin authentifié sans état de machine."""
            return web.json_response({"ok": True})

        app.router.add_get("/imprimante-api/status", status)
        client = TestClient(TestServer(app), cookie_jar=CookieJar(unsafe=True))
        await client.start_server()
        self.addAsyncCleanup(client.close)
        return client

    async def post(self, path="/login", client=None, address=None, **data):
        """Soumet un formulaire à la frontière d’origine normale."""
        headers = {"Origin": FIXTURE_ORIGIN}
        if address:
            headers["X-Forwarded-For"] = address
        return await (client or self.client).post(
            path, data=data, headers=headers, allow_redirects=False
        )

    async def first_factor(self, client=None, address=None):
        """Soumet les identifiants de démonstration sans fournir de second facteur."""
        return await self.post(
            client=client, address=address, username="admin", password=FIXTURE_PASSWORD
        )

    def enable_fixture(self):
        """Écrit une configuration validée avec un code de secours encore disponible."""
        self.store.save(TotpConfig(FIXTURE_SECRET, 0, (recovery_digest(FIXTURE_RECOVERY),)))

    async def test_enroll_log_in_and_disable(self):
        """Vérifie la création du QR, la première preuve, les secours et la désactivation."""
        self.assertEqual((await self.first_factor()).status, 303)
        prepare = await self.post(SECURITY, stage="prepare", password=FIXTURE_PASSWORD)
        body = await prepare.text()
        self.assertEqual(prepare.status, 200)
        self.assertEqual(prepare.headers["Cache-Control"], "no-store")
        self.assertIn("data:image/png;base64,", body)
        secret = re.search(r"Clé manuelle <code>([A-Z2-7]{32})</code>", body)[1]
        self.assertFalse(self.store.path.exists())
        rejected = await self.post(
            SECURITY, stage="activate", password=FIXTURE_PASSWORD, code="wrong"
        )
        self.assertEqual(rejected.status, 400)
        self.assertFalse(self.store.path.exists())
        activation_code = code_at(secret, FIXTURE_TIME // 30)
        activated = await self.post(
            SECURITY, stage="activate", password=FIXTURE_PASSWORD, code=activation_code
        )
        self.assertEqual(activated.status, 200)
        codes = re.findall(r"<li><code>([^<]+)</code></li>", await activated.text())
        self.assertEqual(len(codes), 10)
        self.assertNotIn(secret, await activated.text())
        self.assertNotIn(codes[0], self.store.path.read_text())
        self.assertEqual(self.store.path.stat().st_mode & 0o777, 0o600)
        settings = await self.client.get(SECURITY)
        self.assertNotIn(codes[0], await settings.text())
        self.assertNotIn(secret, await settings.text())
        self.client.server.app["printer_registry"].resolve.assert_not_awaited()

        visitor = await self.start_client()
        first = await self.first_factor(visitor)
        self.assertIn("Vérifier la connexion", await first.text())
        self.assertNotIn(COOKIE_NAME, first.cookies)
        self.assertEqual(len(visitor.server.app[ACCESS_KEY].sessions), 0)
        self.assertEqual((await visitor.get("/imprimante-api/status")).status, 401)
        replay = await self.post(client=visitor, stage="totp", code=activation_code)
        self.assertEqual(replay.status, 401)
        success = await self.post(client=visitor, stage="totp", code=codes[0])
        self.assertEqual(success.status, 303)
        self.assertIn(COOKIE_NAME, success.cookies)
        self.assertEqual((await visitor.get("/imprimante-api/status")).status, 200)
        bad_disable = await self.post(SECURITY, stage="disable", password="wrong")
        self.assertEqual(bad_disable.status, 403)
        self.assertIsNotNone(self.store.read())
        disable = await self.post(SECURITY, stage="disable", password=FIXTURE_PASSWORD)
        self.assertEqual(disable.status, 200)
        self.assertIsNone(self.store.read())

    async def test_replay_and_recovery_remain_consumed_after_restart(self):
        """La connexion refuse un pas rejoué, un code expiré et un secours déjà consommé."""
        self.enable_fixture()
        step = FIXTURE_TIME // 30
        await self.first_factor()
        current = code_at(FIXTURE_SECRET, step)
        expired = await self.post(stage="totp", code=code_at(FIXTURE_SECRET, step - 2))
        self.assertEqual(expired.status, 401)
        success = await self.post(stage="totp", code=current)
        self.assertEqual(success.status, 303)

        fresh = await self.start_client()
        await self.first_factor(fresh)
        replay = await self.post(client=fresh, stage="totp", code=current)
        self.assertEqual(replay.status, 401)
        self.assertEqual(
            (await self.post(client=fresh, stage="totp", code=FIXTURE_RECOVERY)).status, 303
        )
        fresh = await self.start_client()
        await self.first_factor(fresh)
        self.assertEqual(
            (await self.post(client=fresh, stage="totp", code=FIXTURE_RECOVERY)).status, 401
        )

    async def test_concurrent_code_submissions_issue_one_session(self):
        """Deux validations du même défi ne peuvent pas consommer deux preuves."""
        self.enable_fixture()
        await self.first_factor()
        replies = await asyncio.gather(
            self.post(stage="totp", code=code_at(FIXTURE_SECRET, FIXTURE_TIME // 30)),
            self.post(stage="totp", code=code_at(FIXTURE_SECRET, FIXTURE_TIME // 30)),
        )
        self.assertEqual(sorted(response.status for response in replies), [303, 401])
        self.assertEqual(len(self.client.server.app[ACCESS_KEY].sessions), 1)

    async def test_exhausted_challenge_requires_a_new_password_step(self):
        """Les essais du défi n’épuisent pas le quota distinct du mot de passe."""
        self.enable_fixture()
        await self.first_factor()
        for _ in range(2):
            self.assertEqual((await self.post(stage="totp", code="wrong")).status, 401)
        blocked = await self.post(stage="totp", code="wrong")
        self.assertEqual(blocked.status, 429)
        self.assertEqual((await self.post(stage="totp", code=FIXTURE_RECOVERY)).status, 401)
        self.assertEqual((await self.first_factor()).status, 200)
        self.assertEqual((await self.post(stage="totp", code=FIXTURE_RECOVERY)).status, 303)

    async def test_temporary_codes_have_a_shared_quota_but_recovery_remains_available(self):
        """Changer d’adresse ne remet pas le quota à zéro ; le secours reste utilisable."""
        self.enable_fixture()
        app = self.client.server.app
        app[TRUSTED_PROXIES_KEY] = (ipaddress.ip_network("127.0.0.1/32"),)
        state = app[ACCESS_KEY]
        with patch("web_host.TOTP_FAILURE_LIMIT", 3):
            for index in range(3):
                address = f"192.0.2.{index + 1}"
                self.assertEqual((await self.first_factor(address=address)).status, 200)
                self.assertEqual(
                    (await self.post(address=address, stage="totp", code="wrong")).status, 401
                )

            address = "192.0.2.99"
            await self.first_factor(address=address)
            current = code_at(FIXTURE_SECRET, FIXTURE_TIME // 30)
            reply = await self.post(address=address, stage="totp", code=current)
            self.assertEqual(reply.status, 429)
            self.assertIn("Retry-After", reply.headers)
            self.assertEqual(len(state.sessions), 0)
            self.assertEqual(
                (await self.post(address=address, stage="totp", code=FIXTURE_RECOVERY)).status, 303
            )
            self.assertFalse(self.store.read().recovery)

            state.totp_window_until = state.clock() - 1
            await self.first_factor(address=address)
            self.assertEqual(
                (await self.post(address=address, stage="totp", code=current)).status, 303
            )

    async def test_compose_recovery_disables_even_a_corrupt_factor(self):
        """Le démarrage de secours supprime l’état TOTP et rend le mot de passe suffisant."""
        self.store.path.write_text("corrupt fixture")
        unavailable = await self.first_factor()
        self.assertEqual(unavailable.status, 503)
        self.assertNotIn("corrupt fixture", await unavailable.text())
        with patch.dict(os.environ, {"WEB_TOTP_RESET": "true"}):
            recovery = await self.start_client()
            self.assertFalse(self.store.path.exists())
            self.assertEqual((await self.first_factor(recovery)).status, 303)
            state = await recovery.get(SECURITY)
            self.assertIn("récupération Compose est active", await state.text())

    async def test_code_without_challenge_and_failed_storage_never_issue_a_session(self):
        """Un code seul ne donne aucun droit et un échec disque ne consomme aucun secours."""
        self.enable_fixture()
        invalid = await self.post(stage="totp", code=FIXTURE_RECOVERY)
        self.assertEqual(invalid.status, 401)
        await self.first_factor()
        with patch.object(TotpStore, "save", side_effect=OSError("fixture secret")):
            response = await self.post(stage="totp", code=FIXTURE_RECOVERY)
        self.assertEqual(response.status, 503)
        self.assertNotIn("fixture secret", await response.text())
        self.assertEqual(SimpleCookie(response.headers.get("Set-Cookie", "")), {})
        self.assertEqual(self.store.read().recovery, (recovery_digest(FIXTURE_RECOVERY),))
        self.assertEqual(len(self.client.server.app[ACCESS_KEY].sessions), 0)
