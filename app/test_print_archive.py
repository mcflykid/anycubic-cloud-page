"""Contrôle l’archivage et la préparation de réimpression avec un Cloud doublé."""

from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock

from aiohttp import web
from print_archive import PrintArchive, prepare_archived_print


class ArchiveTests(unittest.IsolatedAsyncioTestCase):
    """Vérifie l’identité du contenu et l’isolation des tâches et imprimantes."""

    async def test_deduplication_and_same_filename(self):
        """Le contenu identique est partagé ; un nom identique ne fusionne pas deux fichiers."""
        with TemporaryDirectory() as directory:
            root = Path(directory)
            archive = PrintArchive(root)
            path = root / "fixture"
            path.write_bytes(b"G28\nG1 X2")
            one = archive.add("a", "task", "plate.gcode", path)
            self.assertEqual(one, archive.add("a", "task", "other.gcode", path))
            self.assertEqual(one, archive.add("a", "second", "plate.gcode", path))
            # L’import réel utilise un temporaire neuf à chaque envoi.
            path.unlink()
            path.write_bytes(b"G28\nG1 X3")
            two = archive.add("a", "task", "plate.gcode", path)
            self.assertNotEqual(one, two)
            self.assertEqual(len(archive.list("a", "task")), 2)
            self.assertEqual(archive.resolve("a", "task", one)[1].read_bytes(), b"G28\nG1 X2")
            with self.assertRaises(web.HTTPNotFound):
                archive.resolve("b", "task", one)

    async def test_transfer_does_not_launch(self):
        """Un fichier Cloud non identifié ne permet aucune proposition de lancement."""
        with TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "fixture"
            path.write_bytes(b"G28\nG1 X2")
            launch = AsyncMock()
            upload = AsyncMock(return_value=7)
            latest = AsyncMock(return_value=SimpleNamespace(id=8, gcode_id=20))
            mock = SimpleNamespace(
                state_dir=root,
                cloudfiles={},
                archived_cloudfiles=[],
                api=SimpleNamespace(
                    get_user_cloud_store=AsyncMock(
                        return_value=SimpleNamespace(available_bytes=300)
                    ),
                    upload_file_to_cloud=upload,
                    get_latest_cloud_file=latest,
                    print_with_cloud_gcode_id=launch,
                ),
            )
            data = {"name": "plate.gcode", "size": path.stat().st_size}
            with self.assertRaises(ValueError):
                await prepare_archived_print(mock, data, path)
            self.assertEqual(mock.cloudfiles, {})
            latest.return_value.id = 7
            result = await prepare_archived_print(mock, data, path)
            self.assertEqual(mock.cloudfiles[result["handle"]].gcode_id, 20)
            self.assertEqual(upload.await_count, 2)
            launch.assert_not_called()
