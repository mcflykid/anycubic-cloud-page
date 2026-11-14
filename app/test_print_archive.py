"""Contrôle l’archivage local."""

from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from aiohttp import web
from print_archive import PrintArchive


class ArchiveTests(unittest.TestCase):
    """Vérifie l’identité du contenu et l’isolation des tâches et imprimantes."""

    def test_deduplication_and_same_filename(self):
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
