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

    def req(self, rid="command-test-0001"):
        """Renvoie une requête de commande fictive avec identifiant stable pour tester la déduplication."""
        return SimpleNamespace(
            headers={},
            transport=SimpleNamespace(is_closing=lambda: False),
            json=AsyncMock(return_value={"request_id": rid, "action": "light", "enabled": True}),
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

    async def test_command_waits_for_read_then_sends_once(self):
        """Vérifie que une commande attend la lecture puis n’est envoyée qu’une fois."""
        await self.engine.lock.acquire()
        task = asyncio.create_task(adapter.command(self.req()))
        await asyncio.sleep(0)
        self.assertTrue(self.engine.command_lock.locked())
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
        old = root / "upload-oldfile1"
        fresh = root / "upload-newfile1"
        foreign = root / "upload-foreign1"
        for folder in (old, fresh, foreign):
            folder.mkdir()
        (old / "payload.gcode").write_text("G28")
        (foreign / "other").write_text("conserver")
        link = root / "upload-symbolic"
        link.symlink_to(foreign, target_is_directory=True)
        age = time.time() - 86401
        for path in (old, old / "payload.gcode", foreign):
            os.utime(path, (age, age))
        adapter.purge_abandoned_uploads(root)
        self.assertFalse(old.exists())
        self.assertTrue(fresh.exists())
        self.assertTrue(link.is_symlink())
        self.assertTrue((foreign / "other").exists())

    async def test_upload_timeout_does_not_reserve_or_upload(self):
        """Vérifie que une attente expirée n’effectue ni transfert ni réservation de résultat."""
        adapter.COMMAND_READ_WAIT_SECONDS = 0.01
        await self.engine.lock.acquire()
        with self.assertRaisesRegex(ValueError, "Aucune commande envoyée"):
            await adapter.upload(self.upload_req())
        self.engine.api.upload_file_to_cloud.assert_not_awaited()
        self.assertFalse(self.engine.commands)
        self.assertFalse(self.engine.command_lock.locked())
        self.engine.lock.release()

    async def test_upload_and_command_share_operation_guard(self):
        """Vérifie que les transferts et commandes partagent le même verrou d’opération."""
        entered = asyncio.Event()
        finish = asyncio.Event()

        async def upload(**kwargs):
            """Simule un transfert suspendu afin de vérifier son exclusion avec les commandes."""
            entered.set()
            await finish.wait()

        self.engine.api.upload_file_to_cloud.side_effect = upload
        task = asyncio.create_task(adapter.upload(self.upload_req()))
        await entered.wait()
        with self.assertRaisesRegex(ValueError, "opération est en cours"):
            await adapter.command(self.req())
        self.engine.action.assert_not_awaited()
        finish.set()
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
