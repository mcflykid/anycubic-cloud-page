"""Tests isolés : command lock, sans commande physique ni connexion au cloud."""

import asyncio, importlib.util, json, os, pathlib, tempfile, time, tracemalloc, unittest
from io import BytesIO
from types import SimpleNamespace
from zipfile import ZipFile
from unittest.mock import AsyncMock, Mock, patch

from printer_commands import execute_command

spec = importlib.util.spec_from_file_location(
    "command_lock_adapter", pathlib.Path(__file__).with_name("server.py")
)
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


class Part:
    """Partie multipart fictive pour tester les transferts sans fichier réel."""

    def __init__(self, name, value, filename=None):
        """Initialise la doublure de test."""
        self.name = name
        self.value = value.encode() if isinstance(value, str) else value
        self.filename = filename

    async def text(self):
        """Renvoie la valeur textuelle de cette partie multipart fictive."""
        return self.value

    async def read_chunk(self, size):
        """Renvoie le contenu fictif une seule fois, pour reproduire une lecture multipart consommable."""
        value = self.value
        self.value = b""
        return value


class Parts:
    """Itérateur multipart fictif pour tester la lecture asynchrone d’un transfert."""

    def __init__(self, parts):
        """Initialise la doublure de test."""
        self.parts = iter(parts)

    def __aiter__(self):
        """Renvoie l’itérateur multipart fictif utilisé par les tests de transfert."""
        return self

    async def __anext__(self):
        """Renvoie la partie multipart suivante ; lève StopAsyncIteration à la fin du transfert fictif."""
        try:
            return next(self.parts)
        except StopIteration:
            raise StopAsyncIteration from None


class CommandLockTests(unittest.IsolatedAsyncioTestCase):
    """Vérifications de l’attente des lectures et de l’exclusion entre opérations utilisateur."""

    async def asyncSetUp(self):
        """Prépare les doublures et l’état asynchrone isolés pour chaque scénario."""
        self.previous = adapter.engine
        self.timeout = adapter.COMMAND_READ_WAIT_SECONDS
        staging = tempfile.TemporaryDirectory()
        self.addCleanup(staging.cleanup)
        self.engine = SimpleNamespace(
            state_dir=pathlib.Path(staging.name),
            lock=asyncio.Lock(),
            command_lock=asyncio.Lock(),
            command_request_lock=asyncio.Lock(),
            upload_lock=asyncio.Lock(),
            transport=SimpleNamespace(cloud_mutation_lock=asyncio.Lock()),
            commands={},
            action=AsyncMock(return_value="accepted"),
            event=Mock(),
            printer=SimpleNamespace(is_available=True),
            api=SimpleNamespace(upload_file_to_cloud=AsyncMock()),
        )
        adapter.engine = self.engine
        adapter.COMMAND_READ_WAIT_SECONDS = 0.2

    async def asyncTearDown(self):
        """Restaure l’état partagé et ferme les ressources ouvertes par le scénario."""
        adapter.engine = self.previous
        adapter.COMMAND_READ_WAIT_SECONDS = self.timeout

    def req(self, rid="command-test-0001", action="light"):
        """Renvoie une requête de commande fictive avec identifiant stable pour tester la déduplication."""
        return SimpleNamespace(
            headers={},
            transport=SimpleNamespace(is_closing=lambda: False),
            json=AsyncMock(return_value={"request_id": rid, "action": action, "enabled": True}),
        )

    def upload_req(self, rid="upload-test-00001"):
        """Renvoie un transfert multipart fictif avec fichier et identifiant de demande."""
        parts = Parts(
            [
                Part("file", b"G28\n", "fixture.gcode"),
                Part("request_id", rid),
                Part("mode", "upload"),
            ]
        )
        return SimpleNamespace(
            headers={},
            transport=SimpleNamespace(is_closing=lambda: False),
            multipart=AsyncMock(return_value=parts),
        )

    async def test_operation_lock_order(self):
        """Refuse une acquisition inversée ou un verrou de lecture conservé durant le stockage."""
        events = []

        class TracedLock(asyncio.Lock):
            """Enregistre les acquisitions réelles, y compris celles faites avec wait_for."""

            def __init__(self, name):
                super().__init__()
                self.name = name

            async def acquire(self):
                """Trace le verrou seulement après la réussite de son acquisition."""
                acquired = await super().acquire()
                events.append(("acquire", self.name))
                return acquired

            def release(self):
                """Trace l’instant où le verrou redevient disponible."""
                super().release()
                events.append(("release", self.name))

        for name in ("lock", "command_lock", "command_request_lock", "upload_lock"):
            setattr(self.engine, name, TracedLock(name))
        self.engine.transport.cloud_mutation_lock = TracedLock("cloud")
        request = self.req()
        for options, locks in (
            ({}, ["command_request_lock", "lock", "command_lock"]),
            ({"cloud_only": True}, ["command_request_lock", "lock", "cloud"]),
            ({"bypass_read_lock": True}, ["command_lock"]),
        ):
            with self.subTest(options=options):
                events.clear()
                async with adapter.command_operation(request, **options):
                    self.assertEqual(events, [("acquire", lock) for lock in locks])
                self.assertEqual(
                    events,
                    [("acquire", lock) for lock in locks]
                    + [("release", lock) for lock in reversed(locks)],
                )

        events.clear()
        async with adapter.storage_upload_operation(request, self.engine):
            self.assertEqual(
                events,
                [
                    ("acquire", "upload_lock"),
                    ("acquire", "lock"),
                    ("release", "lock"),
                    ("acquire", "cloud"),
                ],
            )
        self.assertEqual(events[-2:], [("release", "cloud"), ("release", "upload_lock")])

    async def test_command_waits_for_read_then_sends_once(self):
        """Vérifie que une commande attend la lecture puis n’est envoyée qu’une fois."""
        await self.engine.lock.acquire()
        task = asyncio.create_task(adapter.command(self.req()))
        await asyncio.sleep(0)
        self.assertTrue(self.engine.command_request_lock.locked())
        self.assertFalse(self.engine.command_lock.locked())
        self.engine.action.assert_not_awaited()
        self.engine.lock.release()
        result = await task
        self.assertTrue(json.loads(result.body)["ok"])
        self.engine.action.assert_awaited_once_with("light", {"enabled": True})
        self.assertFalse(self.engine.lock.locked())
        self.assertFalse(self.engine.command_lock.locked())

    async def test_second_command_is_rejected_while_first_waits_for_read(self):
        """Vérifie que une seconde commande est refusée même si la première attend une lecture."""
        await self.engine.lock.acquire()
        task = asyncio.create_task(adapter.command(self.req()))
        await asyncio.sleep(0)
        with self.assertRaisesRegex(ValueError, "opération est en cours"):
            await adapter.command(self.req("command-test-0002"))
        self.engine.action.assert_not_awaited()
        self.engine.lock.release()
        await task
        self.engine.action.assert_awaited_once()

    async def test_second_command_is_rejected_during_actual_operation(self):
        """Vérifie que une seconde commande est refusée pendant l’opération effective."""
        entered = asyncio.Event()
        finish = asyncio.Event()

        async def action(*args):
            """Simule une commande suspendue afin de vérifier le verrou des opérations concurrentes."""
            entered.set()
            await finish.wait()
            return "accepted"

        self.engine.action.side_effect = action
        task = asyncio.create_task(adapter.command(self.req()))
        await entered.wait()
        with self.assertRaisesRegex(ValueError, "opération est en cours"):
            await adapter.command(self.req("command-test-0002"))
        finish.set()
        await task
        self.engine.action.assert_awaited_once()

    async def test_pause_and_cancel_pass_during_pending_cloud_task_delete(self):
        """Une mutation Cloud longue garde sa réservation sans prendre le verrou machine."""
        for priority in ("pause", "cancel"):
            with self.subTest(priority=priority):
                entered = asyncio.Event()
                finish = asyncio.Event()
                calls = []

                async def action(name, data, entered=entered, finish=finish, calls=calls):
                    """Suspend la suppression Cloud et accepte les ordres prioritaires fictifs."""
                    calls.append(name)
                    if name == "task-delete-many":
                        entered.set()
                        await finish.wait()
                    return "accepted"

                self.engine.action = AsyncMock(side_effect=action)
                cloud = asyncio.create_task(
                    adapter.command(self.req(f"cloud-request-{priority}", "task-delete-many"))
                )
                await asyncio.wait_for(entered.wait(), 1)
                self.assertTrue(self.engine.command_request_lock.locked())
                self.assertTrue(self.engine.transport.cloud_mutation_lock.locked())
                self.assertFalse(self.engine.command_lock.locked())
                result = await adapter.command(self.req(f"{priority}-request-0001", priority))
                self.assertTrue(json.loads(result.body)["ok"])
                self.assertEqual(calls, ["task-delete-many", priority])
                finish.set()
                self.assertTrue(json.loads((await cloud).body)["ok"])
                self.assertFalse(self.engine.transport.cloud_mutation_lock.locked())

    async def test_cloud_mutation_reservation_is_shared_across_printer_targets(self):
        """Le même compte refuse une mutation depuis une seconde cible pendant la première."""
        entered = asyncio.Event()
        finish = asyncio.Event()
        shared_transport = self.engine.transport

        async def pending_cloud(*args):
            """Maintient une mutation de la première cible en attente, sans réseau réel."""
            entered.set()
            await finish.wait()
            return "accepted"

        self.engine.action = AsyncMock(side_effect=pending_cloud)
        second = SimpleNamespace(
            state_dir=self.engine.state_dir,
            lock=asyncio.Lock(),
            command_lock=asyncio.Lock(),
            command_request_lock=asyncio.Lock(),
            upload_lock=asyncio.Lock(),
            transport=shared_transport,
            commands={},
            action=AsyncMock(return_value="accepted"),
            event=Mock(),
            printer=SimpleNamespace(is_available=True),
            api=SimpleNamespace(upload_file_to_cloud=AsyncMock()),
        )

        def target(req):
            """Sélectionne la cible fictive indiquée par le test pour exercer le verrou partagé."""
            return second if getattr(req, "selected", False) else self.engine

        first_req = self.req("first-cloud-request-0001", "task-delete-many")
        second_req = self.req("second-cloud-request-0001", "task-delete-many")
        second_req.selected = True
        with patch.object(adapter, "request_engine", side_effect=target):
            first = asyncio.create_task(adapter.command(first_req))
            await asyncio.wait_for(entered.wait(), 1)
            with self.assertRaisesRegex(ValueError, "action Cloud est déjà en cours"):
                await adapter.command(second_req)
            second.action.assert_not_awaited()
            finish.set()
            self.assertTrue(json.loads((await first).body)["ok"])

    async def test_command_journal_keeps_cloud_action_result(self):
        """Le journal local conserve le résultat final d’une action Cloud simulée."""
        from aiohttp.test_utils import TestClient, TestServer
        from command_journal import CommandJournal
        from web_host import TRUSTED_PROXIES_KEY

        journal = CommandJournal(self.engine.state_dir / "journal.jsonl")
        app = adapter.web.Application()
        app[adapter.COMMAND_JOURNAL_KEY] = journal
        app[TRUSTED_PROXIES_KEY] = ()
        app.router.add_post("/command", adapter.command)
        client = TestClient(TestServer(app))
        await client.start_server()
        request_data = {
            "request_id": "journal-request-0001",
            "action": "task-delete-many",
            "keys": ["fixture-task"],
        }
        with (
            patch.object(adapter, "request_engine", return_value=self.engine),
            patch.object(adapter, "json_object", new=AsyncMock(return_value=request_data)),
        ):
            response = await client.post("/command", json={})
        try:
            self.assertEqual(response.status, 200)
            rows = journal.rows()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["action"], "task-delete-many")
            self.assertEqual(rows[0]["outcome"], "acceptée")
        finally:
            await client.close()

    async def test_slow_read_times_out_without_send_or_unknown_reservation(self):
        """Vérifie que une lecture trop lente expire avant tout envoi ou réservation de résultat."""
        adapter.COMMAND_READ_WAIT_SECONDS = 0.01
        await self.engine.lock.acquire()
        with self.assertRaisesRegex(ValueError, "Aucune commande envoyée"):
            await adapter.command(self.req())
        self.engine.action.assert_not_awaited()
        self.assertNotIn("command-test-0001", self.engine.commands)
        self.assertTrue(self.engine.lock.locked())
        self.assertFalse(self.engine.command_lock.locked())
        self.engine.lock.release()

    async def test_cancellation_while_waiting_does_not_leak_operation_guard(self):
        """Vérifie que l’annulation d’une attente libère le verrou d’opération."""
        await self.engine.lock.acquire()
        task = asyncio.create_task(adapter.command(self.req()))
        await asyncio.sleep(0)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertTrue(self.engine.lock.locked())
        self.assertFalse(self.engine.command_lock.locked())
        self.engine.action.assert_not_awaited()
        self.assertFalse(self.engine.commands)
        self.engine.lock.release()

    async def test_disconnected_client_is_not_sent_after_waiting_for_read(self):
        """Vérifie que une demande abandonnée pendant l’attente n’est pas envoyée ensuite."""
        for disconnected in ["closing", "missing"]:
            with self.subTest(disconnected=disconnected):
                await self.engine.lock.acquire()
                req = self.req()
                task = asyncio.create_task(adapter.command(req))
                await asyncio.sleep(0)
                req.transport = (
                    None if disconnected == "missing" else SimpleNamespace(is_closing=lambda: True)
                )
                self.engine.lock.release()
                with self.assertRaisesRegex(ValueError, "Aucune commande envoyée"):
                    await task
                self.engine.action.assert_not_awaited()
                self.assertFalse(self.engine.commands)
                self.assertFalse(self.engine.lock.locked())
                self.assertFalse(self.engine.command_lock.locked())

    async def test_camera_waiting_for_read_leaves_pause_and_cancel_available(self):
        """La caméra attend la lecture puis l’ordre prioritaire, sans les chevaucher."""
        real_sleep = asyncio.sleep
        for opening in (True, False):
            for action in ("pause", "cancel"):
                with self.subTest(opening=opening, action=action):
                    engine = adapter.Engine()
                    started = asyncio.Event()
                    finish = asyncio.Event()
                    transport = AsyncMock(return_value=SimpleNamespace(data={"fixture": True}))
                    engine.printer = SimpleNamespace(id=42, get_camera_session=transport)
                    engine.api = SimpleNamespace(_send_anycubic_order=transport)

                    async def priority(*args, started=started, finish=finish):
                        started.set()
                        await finish.wait()
                        return "accepted"

                    engine.action = AsyncMock(side_effect=priority)
                    with (
                        patch.object(adapter, "engine", engine),
                        patch.object(adapter.asyncio, "sleep", new_callable=AsyncMock),
                    ):
                        await engine.lock.acquire()
                        camera = asyncio.create_task(
                            adapter.camera(self.req())
                            if opening
                            else adapter.close_idle_camera(engine, "42")
                        )
                        await real_sleep(0)
                        self.assertFalse(engine.command_lock.locked())
                        command = asyncio.create_task(adapter.command(self.req(action=action)))
                        try:
                            await asyncio.wait_for(started.wait(), 1)
                            engine.lock.release()
                            await real_sleep(0)
                            transport.assert_not_awaited()
                            finish.set()
                            self.assertTrue(json.loads((await command).body)["ok"])
                            await camera
                            engine.action.assert_awaited_once_with(action, {"enabled": True})
                            transport.assert_awaited_once()
                        finally:
                            if engine.lock.locked() and not started.is_set():
                                engine.lock.release()
                            tasks = (command, camera, engine.camera_expiry_task)
                            for task in tasks:
                                if task and not task.done():
                                    task.cancel()
                            await asyncio.gather(
                                *(task for task in tasks if task), return_exceptions=True
                            )

    async def test_unknown_physical_result_is_not_automatically_retried(self):
        """Vérifie qu’un délai dépassé au transport garde un résultat inconnu sans nouvel envoi."""
        self.engine.printer.connected_ace_units = 1
        self.engine.printer.machine_name = "Anycubic Kobra S1"
        transport = AsyncMock(side_effect=TimeoutError("fixture-ambiguous-result"))
        self.engine.api._send_order_set_light_status = transport

        async def action(name, data):
            """Passe par la validation de la commande avant le transport fictif."""
            return await execute_command(self.engine, name, data)

        self.engine.action.side_effect = action
        first = await adapter.command(self.req())
        repeat = await adapter.command(self.req())
        for result in (first, repeat):
            self.assertEqual(result.status, 409)
            self.assertFalse(json.loads(result.body)["ok"])
            self.assertNotIn("fixture-ambiguous-result", result.text)
        transport.assert_awaited_once_with(self.engine.printer, True, light_type=2)
        self.assertFalse(self.engine.lock.locked())
        self.assertFalse(self.engine.command_lock.locked())

    async def test_upload_waits_for_read_and_only_then_uploads(self):
        """Vérifie que le transfert attend la fin de la lecture avant de commencer."""
        await self.engine.lock.acquire()
        task = asyncio.create_task(adapter.upload(self.upload_req()))
        await asyncio.sleep(0)
        self.engine.api.upload_file_to_cloud.assert_not_awaited()
        self.engine.lock.release()
        result = await task
        self.assertTrue(json.loads(result.body)["ok"])
        self.engine.api.upload_file_to_cloud.assert_awaited_once()
        call = self.engine.api.upload_file_to_cloud.call_args.kwargs
        self.assertEqual(call["file_name"], "fixture.gcode")
        self.assertFalse(pathlib.Path(call["full_file_path"]).exists())

    async def test_cloud_model_uploads_never_use_print_transport(self):
        """STL et 3MF valides sont stockés, même si un formulaire falsifié demande une impression."""
        package = BytesIO()
        with ZipFile(package, "w") as archive:
            archive.writestr("[Content_Types].xml", "<Types/>")
            archive.writestr("3D/3dmodel.model", "<model/>")
        stl = b"mesh".ljust(80, b"\0") + b"\x01\0\0\0" + b"\0" * 50
        printer = self.engine.printer
        printer.print_and_upload_save_in_cloud = AsyncMock()
        for index, (name, content) in enumerate(
            (("cube.stl", stl), ("cube.3mf", package.getvalue()))
        ):
            for mode in ("save-print", "upload"):
                request = self.upload_req()
                request.multipart.return_value = Parts(
                    [
                        Part("file", content, name),
                        Part("request_id", f"fixture-model-{index:04}"),
                        Part("mode", mode),
                    ]
                )
                if mode == "save-print":
                    with self.assertRaisesRegex(ValueError, "Seul un fichier .gcode"):
                        await adapter.upload(request)
                else:
                    result = await adapter.upload(request)
                    self.assertTrue(json.loads(result.body)["ok"])
                    self.assertEqual(
                        self.engine.api.upload_file_to_cloud.call_args.kwargs["file_name"], name
                    )
        invalid = self.upload_req()
        invalid.multipart.return_value = Parts(
            [
                Part("file", b"not a zip archive", "invalid.3mf"),
                Part("request_id", "fixture-model-invalid"),
                Part("mode", "upload"),
            ]
        )
        with self.assertRaisesRegex(ValueError, "3MF est invalide"):
            await adapter.upload(invalid)
        self.assertEqual(self.engine.api.upload_file_to_cloud.await_count, 2)
        printer.print_and_upload_save_in_cloud.assert_not_awaited()

    async def test_local_presets_replace_file_only_after_success(self):
        """Le fichier et la mémoire gardent leur ancienne valeur si le remplacement échoue."""
        self.engine.printer = self.engine.api = None
        entries = [{"name": "PLA", "temperature": 45, "hours": 4}] * 4
        await execute_command(self.engine, "presets", {"presets": entries})
        path = self.engine.state_dir / "presets.json"
        self.assertEqual(json.loads(path.read_text()), entries)
        updated = [{**row, "hours": 8} for row in entries]
        with patch("printer_commands.os.replace", side_effect=OSError):
            with self.assertRaises(OSError):
                await execute_command(self.engine, "presets", {"presets": updated})
        self.assertEqual(json.loads(path.read_text()), entries)
        self.assertEqual(self.engine.presets, entries)
        self.assertEqual(list(path.parent.iterdir()), [path])

    async def test_purge_only_abandoned_upload_directories(self):
        """Un lien, une entrée étrangère et un transfert récent restent hors du nettoyage."""
        root = self.engine.state_dir
        old = [root / f"upload-oldfile{index}" for index in range(1, 4)]
        fresh = root / "upload-newfile1"
        foreign = root / "upload-foreign1"
        malformed = root / "upload-badfile1"
        for folder in (*old, fresh, foreign, malformed):
            folder.mkdir()
        for folder, extension in zip(old, ("gcode", "stl", "3mf"), strict=True):
            (folder / f"payload.{extension}").write_text("fixture")
        (foreign / "other").write_text("conserver")
        (malformed / "payload.exe").write_text("conserver")
        link = root / "upload-symbolic"
        link.symlink_to(foreign, target_is_directory=True)
        age = time.time() - 86401
        for path in (
            *old,
            *(folder / next(folder.iterdir()).name for folder in old),
            foreign,
            malformed,
        ):
            os.utime(path, (age, age))
        adapter.purge_abandoned_uploads(root)
        self.assertTrue(all(not folder.exists() for folder in old))
        self.assertTrue(fresh.exists())
        self.assertTrue(link.is_symlink())
        self.assertTrue((foreign / "other").exists())
        self.assertTrue(malformed.exists())

    async def test_upload_timeout_does_not_reserve_or_upload(self):
        """Vérifie que une attente expirée n’effectue ni transfert ni réservation de résultat."""
        adapter.COMMAND_READ_WAIT_SECONDS = 0.01
        await self.engine.lock.acquire()
        with self.assertRaisesRegex(ValueError, "Aucun fichier envoyé"):
            await adapter.upload(self.upload_req())
        self.engine.api.upload_file_to_cloud.assert_not_awaited()
        self.assertFalse(self.engine.commands)
        self.assertFalse(self.engine.command_lock.locked())
        self.engine.lock.release()

    async def test_upload_and_long_read_allow_one_pause_but_no_second_command(self):
        """Le stockage Cloud et une lecture longue cèdent à une seule commande physique prioritaire."""
        upload_entered = asyncio.Event()
        finish_upload = asyncio.Event()
        command_entered = asyncio.Event()
        finish_command = asyncio.Event()

        async def upload(**kwargs):
            """Maintient un transfert fictif en vol pendant le test des verrous."""
            upload_entered.set()
            await finish_upload.wait()

        async def command(action, data):
            """Maintient l’ordre fictif actif afin d’éprouver l’exclusion entre deux commandes."""
            command_entered.set()
            await finish_command.wait()
            return "accepted"

        self.engine.api.upload_file_to_cloud.side_effect = upload
        self.engine.action.side_effect = command
        task = asyncio.create_task(adapter.upload(self.upload_req()))
        await upload_entered.wait()
        await self.engine.lock.acquire()
        pause = asyncio.create_task(adapter.command(self.req(action="pause")))
        await command_entered.wait()
        with self.assertRaisesRegex(ValueError, "opération est en cours"):
            await adapter.command(self.req(rid="second-command-0001", action="cancel"))
        self.assertEqual(self.engine.action.await_count, 1)
        finish_command.set()
        await pause
        self.engine.lock.release()
        finish_upload.set()
        await task

    async def test_large_upload_stages_in_bounded_chunks(self):
        """Vérifie un transfert fictif de 100 Mio et mesure les allocations Python du traitement."""
        chunk = b"G" * (256 * 1024)
        remaining = 400

        async def read(size):
            """Produit des blocs sans matérialiser le fichier de test en mémoire."""
            nonlocal remaining
            self.assertEqual(size, len(chunk))
            if not remaining:
                return b""
            remaining -= 1
            return chunk

        file = Part("file", b"", "fixture.gcode")
        file.read_chunk = read
        req = self.upload_req()
        req.multipart.return_value = Parts([file, Part("request_id", "large-upload-0001")])

        async def transfer(full_file_path, file_name):
            """Observe le fichier préparé sans déclencher un transfert réel."""
            self.assertEqual(pathlib.Path(full_file_path).stat().st_size, 100 * 1024 * 1024)
            self.assertEqual(file_name, "fixture.gcode")

        self.engine.api.upload_file_to_cloud.side_effect = transfer
        tracemalloc.start()
        try:
            await adapter.upload(req)
            peak = tracemalloc.get_traced_memory()[1]
        finally:
            tracemalloc.stop()
        self.assertLess(peak, 5 * 1024 * 1024)
        self.assertEqual(list(self.engine.state_dir.iterdir()), [])

    async def test_upload_cancellation_removes_staged_file(self):
        """La fermeture de la requête libère le disque et garde la référence d’un envoi incertain."""
        entered = asyncio.Event()

        async def transfer(**kwargs):
            """Suspend le transfert fictif après la réservation locale."""
            entered.set()
            await asyncio.Event().wait()

        self.engine.api.upload_file_to_cloud.side_effect = transfer
        task = asyncio.create_task(adapter.upload(self.upload_req()))
        await entered.wait()
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertEqual(list(self.engine.state_dir.iterdir()), [])
        self.assertFalse(self.engine.commands["upload-test-00001"]["ok"])

    async def test_cached_command_reply_works_while_another_operation_runs(self):
        """Vérifie que un résultat déjà connu reste consultable pendant une autre opération."""
        cached = {"ok": True, "message": "previously accepted"}
        self.engine.commands["command-test-0001"] = cached
        await self.engine.command_lock.acquire()
        result = await adapter.command(self.req())
        self.assertEqual(json.loads(result.body), cached)
        self.engine.action.assert_not_awaited()
        self.engine.command_lock.release()


if __name__ == "__main__":
    unittest.main()
