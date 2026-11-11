"""Tests isolés des sessions web, sans commande physique ni connexion au cloud."""

import ipaddress
import asyncio, os, pathlib, tempfile, time, unittest, uuid
from collections import OrderedDict
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from aiohttp import web
from aiohttp import FormData
from aiohttp.test_utils import TestClient, TestServer
from web_host import (
    access_control,
    credentials,
    install_access,
    install_ui_resources,
    session_digest,
    Session,
    ACCESS_KEY,
    COOKIE_NAME,
    SECURE_COOKIE_NAME,
    TRUSTED_PROXIES_KEY,
)
from printer_registry import printer_key, select_printer
from command_journal import CommandJournal
from printer_commands import execute_command
from printer_files import MQTTReplies
from server import COMMAND_JOURNAL_KEY, command, command_journal, errors, upload
from demo import create_demo


class WebBoundary(unittest.IsolatedAsyncioTestCase):
    """Vérifie formulaire, cookies, expiration, révocation, limitation et protection Origin."""

    async def asyncSetUp(self):
        """Crée un secret fictif et un serveur de test qui ne connaît aucune imprimante."""
        self.temp = tempfile.TemporaryDirectory()
        self.path = pathlib.Path(self.temp.name) / "password"
        self.path.write_text("test-only-password")
        self.origin = "http://localhost:8080"
        self.env = patch.dict(
            os.environ,
            {
                "WEB_PASSWORD_FILE": str(self.path),
                "WEB_USER": "admin",
                "PUBLIC_ORIGIN": self.origin,
            },
        )
        self.env.start()

        async def ok(request):
            """Renvoie un témoin pour tester uniquement la frontière d’accès."""
            return web.json_response({"ok": True})

        app = web.Application(middlewares=[access_control, errors, select_printer])
        install_access(app)
        install_ui_resources(app)
        app.router.add_get("/", ok)
        app.router.add_get("/imprimante.html", ok)
        app.router.add_post("/command", ok)
        app.router.add_get("/imprimante-api/status", ok)
        app.router.add_post("/imprimante-api/command", ok)
        app.router.add_get("/imprimante-api/health", ok)
        app.router.add_post("/imprimante-api/sensitive-fixture", command)
        app.router.add_post("/imprimante-api/upload", upload)
        app.router.add_get("/imprimante-api/journal", command_journal)
        app[COMMAND_JOURNAL_KEY] = CommandJournal(
            pathlib.Path(self.temp.name) / "command-journal.jsonl"
        )
        self.engines = {
            printer_key(i): SimpleNamespace(
                printer=SimpleNamespace(id=i, name=f"Machine {i}"),
                commands=OrderedDict(),
                state_dir=pathlib.Path(self.temp.name),
                api=SimpleNamespace(upload_file_to_cloud=AsyncMock()),
                command_lock=asyncio.Lock(),
                upload_lock=asyncio.Lock(),
                lock=asyncio.Lock(),
                action=AsyncMock(return_value="Acceptée fictivement"),
                event=lambda *args: None,
            )
            for i in (1, 2)
        }
        app["printer_registry"] = SimpleNamespace(
            resolve=AsyncMock(side_effect=lambda key, **_: self.engines.get(key))
        )
        self.client = TestClient(TestServer(app))
        await self.client.start_server()
        self.app = app

    async def asyncTearDown(self):
        """Ferme la frontière locale et restaure les variables de chaque scénario."""
        await self.client.close()
        self.env.stop()
        self.temp.cleanup()

    async def sign_in(
        self, username="admin", password="test-only-password", origin=None, headers=None
    ):
        """Poste un formulaire fictif et conserve le cookie sans suivre la redirection."""
        return await self.client.post(
            "/login",
            data={"username": username, "password": password},
            headers={"Origin": self.origin if origin is None else origin, **(headers or {})},
            allow_redirects=False,
        )

    async def test_ui_redirects_and_api_returns_401_without_basic_challenge(self):
        """Les visiteurs voient la page française ; les appels API expirés ne reçoivent aucune fenêtre Basic."""
        response = await self.client.get("/", allow_redirects=False)
        self.assertEqual(response.status, 303)
        self.assertEqual(response.headers["Location"], "/login")
        self.assertNotIn("WWW-Authenticate", response.headers)
        page = await self.client.get("/login")
        self.assertEqual(page.status, 200)
        self.assertIn("Se connecter", await page.text())
        self.assertEqual(page.headers["Referrer-Policy"], "same-origin")
        self.assertEqual((await self.client.get("/imprimante-api/status")).status, 401)
        self.assertEqual((await self.client.post("/imprimante-api/command")).status, 401)

    async def test_public_hardware_illustrations_do_not_redirect_to_login(self):
        """Le proxy peut servir les illustrations embarquées sans exposer les données machine."""
        for icon in (
            "kobra-s1-ace2pro.png",
            "ace2pro.png",
            "kobra-s1.svg",
            "ace.svg",
            "printer.svg",
        ):
            response = await self.client.get(
                f"/imprimante-api/ui/icons/{icon}", allow_redirects=False
            )
            self.assertEqual(response.status, 200)
            self.assertEqual(
                response.content_type, "image/png" if icon.endswith(".png") else "image/svg+xml"
            )
        self.assertEqual((await self.client.get("/imprimante-api/status")).status, 401)

    async def test_login_sets_limited_httponly_strict_cookie(self):
        """Le cookie opaque a une durée fixe ; une lecture et une écriture de même origine deviennent possibles."""
        response = await self.sign_in()
        self.assertEqual(response.status, 303)
        cookie = response.cookies[COOKIE_NAME]
        self.assertTrue(cookie["httponly"])
        self.assertEqual(cookie["samesite"], "Strict")
        self.assertEqual(cookie["max-age"], "28800")
        self.assertEqual(cookie["path"], "/")
        self.assertFalse(cookie["secure"])
        self.assertNotIn("admin", cookie.value)
        self.assertEqual((await self.client.get("/imprimante-api/status")).status, 200)
        self.assertEqual(
            (await self.client.post("/command", headers={"Origin": self.origin})).status, 200
        )

    async def test_public_https_forces_secure_even_with_untrusted_proxy_headers(self):
        """Le protocole déclaré gouverne Secure ; un client ne le désactive pas avec X-Forwarded-Proto."""
        await self.client.close()
        with patch.dict(os.environ, {"PUBLIC_ORIGIN": "https://printer.example.com"}):
            app = web.Application(middlewares=[access_control])
            install_access(app)
        self.client = TestClient(TestServer(app))
        await self.client.start_server()
        response = await self.sign_in(
            origin="https://printer.example.com", headers={"X-Forwarded-Proto": "http"}
        )
        cookie = response.cookies[SECURE_COOKIE_NAME]
        self.assertEqual(response.status, 303)
        self.assertTrue(cookie["secure"])
        self.assertEqual(cookie["path"], "/")
        self.assertFalse(cookie["domain"])
        self.assertNotIn(COOKIE_NAME, response.cookies)

    async def test_https_migrates_a_live_legacy_cookie_once(self):
        """Tourne le jeton d’origine en HTTPS et expire l’ancien cookie sans prolonger la session."""
        await self.client.close()
        with patch.dict(os.environ, {"PUBLIC_ORIGIN": "https://printer.example.com"}):
            app = web.Application(middlewares=[access_control])
            install_access(app)

        async def status(request):
            """Renvoie une réponse authentifiée sans toucher au cloud."""
            return web.json_response({"ok": True})

        app.router.add_get("/imprimante-api/status", status)
        legacy = "fixture-legacy-session"
        expiry = time.monotonic() + 60
        app[ACCESS_KEY].sessions[session_digest(legacy)] = Session(expiry, credentials()[2])
        self.client = TestClient(TestServer(app))
        await self.client.start_server()
        response = await self.client.get(
            "/imprimante-api/status", headers={"Cookie": COOKIE_NAME + "=" + legacy}
        )
        self.assertEqual(response.status, 200)
        self.assertEqual(response.cookies[COOKIE_NAME]["max-age"], "0")
        secure = response.cookies[SECURE_COOKIE_NAME]
        self.assertLessEqual(int(secure["max-age"]), 60)
        self.assertEqual(app[ACCESS_KEY].sessions[session_digest(secure.value)].expires, expiry)
        replay = await self.client.get(
            "/imprimante-api/status", headers={"Cookie": COOKIE_NAME + "=" + legacy}
        )
        self.assertEqual(replay.status, 401)

    async def confirm_action(self, action="firmware", printer=1, password="test-only-password"):
        """Demande un ticket au vrai gestionnaire avec un secret et une cible fictifs."""
        return await self.client.post(
            "/imprimante-api/reauth",
            json={"action": action, "password": password},
            headers={"Origin": self.origin, "X-Printer-Key": printer_key(printer)},
        )

    async def submit_sensitive_action(
        self, action="firmware", printer=1, confirmation=None, request_id=None
    ):
        """Passe par le vrai verrou de commande en substituant uniquement le moteur physique."""
        return await self.client.post(
            "/imprimante-api/sensitive-fixture",
            json={
                "action": action,
                "confirmation": confirmation,
                "request_id": request_id or str(uuid.uuid4()),
            },
            headers={"Origin": self.origin, "X-Printer-Key": printer_key(printer)},
        )

    async def test_sensitive_actions_require_matching_unused_confirmation(self):
        """Vérifie les trois actions, le refus d’un autre appareil et la consommation unique."""
        await self.sign_in()
        for action in ("firmware", "ace-firmware", "factory-reset"):
            self.assertEqual((await self.submit_sensitive_action(action)).status, 403)
        response = await self.confirm_action(password="fixture-incorrect")
        self.assertEqual(response.status, 403)
        self.assertNotIn("fixture-incorrect", await response.text())
        token = (await (await self.confirm_action()).json())["confirmation"]
        self.assertEqual(
            (await self.submit_sensitive_action(printer=2, confirmation=token)).status, 403
        )
        self.assertEqual(
            (await self.submit_sensitive_action("ace-firmware", confirmation=token)).status, 403
        )
        self.assertEqual((await self.submit_sensitive_action(confirmation=token)).status, 200)
        self.assertEqual((await self.submit_sensitive_action(confirmation=token)).status, 403)
        self.engines[printer_key(1)].action.assert_awaited_once_with("firmware", {})
        self.engines[printer_key(2)].action.assert_not_awaited()

    async def test_expired_confirmation_and_failed_attempts_do_not_block_login(self):
        """Une confirmation expirée échoue et une autre session reste utilisable après le blocage."""
        await self.sign_in()
        token = (await (await self.confirm_action()).json())["confirmation"]
        session = next(iter(self.app[ACCESS_KEY].sessions.values()))
        session.ticket.expires = time.monotonic() - 1
        self.assertEqual((await self.submit_sensitive_action(confirmation=token)).status, 403)
        for _ in range(5):
            self.assertEqual((await self.confirm_action(password="fixture-wrong")).status, 403)
        self.assertEqual((await self.confirm_action()).status, 429)
        self.assertEqual((await self.sign_in()).status, 303)
        self.assertEqual((await self.confirm_action()).status, 200)

    async def test_command_journal_survives_cache_reset_and_exports_redacted_rows(self):
        """Conserve une tentative par identifiant et expurge la session et l’adresse de l’export."""
        await self.sign_in()
        request_id = str(uuid.uuid4())
        self.assertEqual((await self.submit_sensitive_action(request_id=request_id)).status, 403)
        journal = self.app[COMMAND_JOURNAL_KEY]
        self.assertEqual(journal.rows()[0]["outcome"], "refusée")
        ticket = (await (await self.confirm_action()).json())["confirmation"]
        self.assertEqual(
            (await self.submit_sensitive_action(confirmation=ticket, request_id=request_id)).status,
            200,
        )
        engine = self.engines[printer_key(1)]
        engine.commands.clear()
        replay = await self.submit_sensitive_action(request_id=request_id)
        self.assertTrue((await replay.json())["ok"])
        engine.action.assert_awaited_once()
        self.assertEqual(len(journal.rows()), 1)
        row = journal.rows()[0]
        self.assertEqual(row["outcome"], "acceptée")
        self.assertNotIn(ticket, journal.path.read_text())
        self.assertEqual(journal.path.stat().st_mode & 0o777, 0o600)
        self.assertIsNotNone(row["client"])
        self.assertIsNotNone(row["session"])
        export = await self.client.get("/imprimante-api/journal?export=1&action=firmware")
        self.assertIn("attachment", export.headers["Content-Disposition"])
        item = (await export.json())[0]
        self.assertEqual(item["request_id"], request_id)
        self.assertNotIn("client", item)
        self.assertNotIn("session", item)
        other = await self.client.get("/imprimante-api/journal?printer=" + printer_key(2))
        self.assertEqual((await other.json())["items"], [])

    async def test_journal_records_upload_failure_without_duplicate(self):
        """Une panne du transfert conserve un résultat inconnu et protège la demande d’un renvoi."""
        await self.sign_in()
        engine = self.engines[printer_key(1)]
        engine.api.upload_file_to_cloud.side_effect = ValueError("fixture-secret-error")
        request_id = str(uuid.uuid4())

        def multipart():
            """Recrée le même envoi fictif après perte de la réponse."""
            form = FormData()
            form.add_field("file", b"G28\n", filename="fixture.gcode")
            form.add_field("request_id", request_id)
            return form

        headers = {"Origin": self.origin, "X-Printer-Key": printer_key(1)}
        first = await self.client.post("/imprimante-api/upload", data=multipart(), headers=headers)
        self.assertEqual(first.status, 409)
        self.assertNotIn("fixture-secret-error", await first.text())
        engine.commands.clear()
        repeat = await self.client.post("/imprimante-api/upload", data=multipart(), headers=headers)
        self.assertFalse((await repeat.json())["ok"])
        engine.api.upload_file_to_cloud.assert_awaited_once()
        rows = self.app[COMMAND_JOURNAL_KEY].rows()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["outcome"], "inconnue")
        self.assertEqual(rows[0]["parameters"], {"name": "fixture.gcode"})
        self.assertNotIn("fixture-secret-error", str(rows))

    async def test_non_string_command_action_is_rejected_before_cloud(self):
        """Une action JSON non textuelle reçoit 400 avant tout appel au moteur Cloud."""
        await self.sign_in()
        engine = self.engines[printer_key(1)]
        response = await self.client.post(
            "/imprimante-api/sensitive-fixture",
            json={"request_id": str(uuid.uuid4()), "action": ["pause"]},
            headers={"Origin": self.origin, "X-Printer-Key": printer_key(1)},
        )
        self.assertEqual(response.status, 400)
        self.assertEqual((await response.json())["message"], "Action invalide.")
        engine.action.assert_not_awaited()

    async def test_command_distinguishes_validation_from_failure_after_dispatch(self):
        """Un refus reste local et une panne après envoi conserve la déduplication."""
        await self.sign_in()
        engine = self.engines[printer_key(1)]
        engine.printer.connected_ace_units = 1
        engine.printer.machine_name = "Anycubic Kobra S1"
        engine.mqtt_replies = MQTTReplies()
        engine.printer.query_camera_light_status = AsyncMock(
            side_effect=TypeError("fixture-private-detail")
        )
        engine.api._send_order_set_light_status = AsyncMock(return_value=True)

        async def actual_action(name, data):
            return await execute_command(engine, name, data)

        engine.action.side_effect = actual_action
        headers = {"Origin": self.origin, "X-Printer-Key": printer_key(1)}
        url = "/imprimante-api/sensitive-fixture"
        rid = str(uuid.uuid4())
        request = {"request_id": rid, "action": "light", "enabled": True, "box": 9}
        rejected = await self.client.post(url, json=request, headers=headers)
        self.assertEqual(rejected.status, 400)
        self.assertIn("Valeur attendue", (await rejected.json())["message"])
        journal = self.app[COMMAND_JOURNAL_KEY]
        self.assertEqual(journal.rows()[0]["outcome"], "refusée")
        self.assertNotIn(rid, engine.commands)
        engine.api._send_order_set_light_status.assert_not_awaited()

        malformed = {**request, "box": 0}
        del malformed["enabled"]
        with self.assertLogs(level="WARNING"):
            invalid = await self.client.post(url, json=malformed, headers=headers)
        self.assertEqual(invalid.status, 400)
        self.assertEqual((await invalid.json())["message"], "Données de la demande invalides.")
        self.assertEqual(journal.rows()[0]["outcome"], "refusée")

        request["box"] = 0
        with self.assertLogs(level="WARNING") as logs:
            unknown = await self.client.post(url, json=request, headers=headers)
        self.assertEqual(unknown.status, 409)
        self.assertNotIn("fixture-private-detail", await unknown.text())
        self.assertNotIn("fixture-private-detail", " ".join(logs.output))
        self.assertEqual(journal.rows()[0]["outcome"], "inconnue")
        self.assertEqual((await self.client.post(url, json=request, headers=headers)).status, 409)
        engine.commands.clear()
        self.assertEqual((await self.client.post(url, json=request, headers=headers)).status, 409)
        engine.api._send_order_set_light_status.assert_awaited_once()
        engine.printer.query_camera_light_status.assert_awaited_once()

    async def test_wrong_login_does_not_echo_password(self):
        """L’erreur reste générique, y compris pour un identifiant inconnu."""
        response = await self.sign_in(username="other", password="fixture-wrong-password")
        self.assertEqual(response.status, 401)
        self.assertNotIn("fixture-wrong-password", await response.text())
        self.assertNotIn(COOKIE_NAME, response.cookies)

    async def test_origin_rejects_login_command_and_logout(self):
        """Aucune route d’écriture n’accepte une origine étrangère ou absente, même avec une session valide."""
        self.assertEqual((await self.sign_in(origin="https://foreign.example")).status, 403)
        response = await self.client.post(
            "/login", data={"username": "admin", "password": "test-only-password"}
        )
        self.assertEqual(response.status, 403)
        await self.sign_in()
        for path in ["/command", "/imprimante-api/command", "/logout"]:
            for headers in [{}, {"Origin": "https://foreign.example"}]:
                self.assertEqual((await self.client.post(path, headers=headers)).status, 403)
        self.assertEqual((await self.client.get("/imprimante-api/status")).status, 200)

    async def test_logout_revokes_cookie_even_if_replayed(self):
        """Effacer le cookie seul ne suffit pas : une copie du jeton doit être inutilisable après déconnexion."""
        login = await self.sign_in()
        token = login.cookies[COOKIE_NAME].value
        response = await self.client.post(
            "/logout", headers={"Origin": self.origin}, allow_redirects=False
        )
        self.assertEqual(response.status, 303)
        self.assertEqual(response.cookies[COOKIE_NAME]["max-age"], "0")
        replay = await self.client.get(
            "/imprimante-api/status", headers={"Cookie": COOKIE_NAME + "=" + token}
        )
        self.assertEqual(replay.status, 401)

    async def test_expiry_and_password_change_invalidate_session(self):
        """L’expiration est côté serveur et un changement du secret ne laisse pas de session précédente valide."""
        await self.sign_in()
        next(iter(self.app[ACCESS_KEY].sessions.values())).expires = time.monotonic() - 1
        self.assertEqual((await self.client.get("/imprimante-api/status")).status, 401)
        await self.sign_in()
        self.path.write_text("test-only-new-password")
        self.assertEqual((await self.client.get("/imprimante-api/status")).status, 401)

    async def test_failure_limit_cannot_be_bypassed_with_forwarded_headers(self):
        """Cinq échecs bloquent l’adresse réelle, puis la fenêtre expire sans bloquer définitivement le compte."""
        for index in range(5):
            self.assertEqual(
                (
                    await self.sign_in(password="wrong", headers={"X-Forwarded-For": str(index)})
                ).status,
                401,
            )
        response = await self.sign_in()
        self.assertEqual(response.status, 429)
        self.assertGreater(int(response.headers["Retry-After"]), 0)
        for key in self.app[ACCESS_KEY].failures:
            self.app[ACCESS_KEY].failures[key] = (5, time.monotonic() - 1)
        self.assertEqual((await self.sign_in()).status, 303)

    async def test_counter_saturation_does_not_block_new_valid_client(self):
        """Un millier d’échecs d’autres adresses ne bloque plus le propriétaire."""
        state = self.app[ACCESS_KEY]
        state.failures = {f"fixture-address-{i}": (1, time.monotonic() + 300) for i in range(1024)}
        self.assertEqual((await self.sign_in()).status, 303)
        self.assertEqual((await self.sign_in(password="wrong")).status, 401)
        self.assertLessEqual(len(state.failures), 1024)

    async def test_trusted_proxy_isolates_clients_and_stops_at_untrusted_hop(self):
        """Le proxy connu sépare les compteurs ; un préfixe injecté ne contourne pas le pair réel."""
        self.app[TRUSTED_PROXIES_KEY] = (ipaddress.ip_network("127.0.0.1/32"),)
        for _ in range(5):
            self.assertEqual(
                (
                    await self.sign_in(password="wrong", headers={"X-Forwarded-For": "192.0.2.1"})
                ).status,
                401,
            )
        self.assertEqual((await self.sign_in(headers={"X-Forwarded-For": "192.0.2.2"})).status, 303)
        self.assertEqual(
            (await self.sign_in(headers={"X-Forwarded-For": "192.0.2.99, 192.0.2.1"})).status, 429
        )
        self.assertEqual((await self.sign_in(headers={"X-Forwarded-For": "invalid"})).status, 303)

    async def test_ipv6_proxy_quota_groups_the_same_subnet(self):
        """Des adresses distinctes du même /64 partagent le quota du client derrière proxy."""
        self.app[TRUSTED_PROXIES_KEY] = (ipaddress.ip_network("127.0.0.1/32"),)
        for index in range(5):
            response = await self.sign_in(
                password="wrong",
                headers={"X-Forwarded-For": f"2001:db8:42::{index + 1}"},
            )
            self.assertEqual(response.status, 401)
        response = await self.sign_in(headers={"X-Forwarded-For": "2001:db8:42::abcd"})
        self.assertEqual(response.status, 429)

    async def test_partially_invalid_forwarded_chain_uses_http_peer(self):
        """Une chaîne incomplète ne laisse pas le proxy choisir le compteur d’une autre adresse."""
        self.app[TRUSTED_PROXIES_KEY] = (ipaddress.ip_network("127.0.0.1/32"),)
        for _ in range(5):
            response = await self.sign_in(
                password="wrong",
                headers={"X-Forwarded-For": "2001:db8:42::1, invalid"},
            )
            self.assertEqual(response.status, 401)
        self.assertEqual((await self.sign_in()).status, 429)

    async def test_health_stays_public_even_without_secret(self):
        """La supervision reste indépendante du secret ; les routes privées échouent fermées."""
        self.path.unlink()
        self.assertEqual((await self.client.get("/imprimante-api/health")).status, 200)
        self.assertEqual((await self.client.get("/login")).status, 503)

    async def test_login_body_is_bounded(self):
        """Un formulaire surdimensionné est refusé sans conserver le contenu dans les compteurs."""
        response = await self.client.post(
            "/login",
            data={"username": "admin", "password": "x" * 5000},
            headers={"Origin": self.origin},
        )
        self.assertEqual(response.status, 413)
        self.assertFalse(self.app[ACCESS_KEY].failures)


class OfflineDemo(unittest.IsolatedAsyncioTestCase):
    """La démonstration conserve l’interdiction des commandes physiques."""

    async def test_demo_never_accepts_real_actions(self):
        """Le mode visuel n’envoie rien au cloud, même lorsqu’une commande est demandée."""
        async with TestClient(TestServer(create_demo())) as client:
            response = await client.post("/imprimante-api/command", json={"action": "ace-firmware"})
            self.assertEqual(response.status, 403)
            response = await client.get("/imprimante-api/status")
            self.assertTrue((await response.json())["demo"])
