"""Vérifie le registre local des fichiers à préparer."""

import tempfile
import unittest
from pathlib import Path

from print_queue import read_queue, update_queue


class PrintQueueTests(unittest.TestCase):
    """Une file survit à la relecture et ignore les ajouts dupliqués."""

    def test_order_and_unknown_file(self):
        """Le changement d’ordre ne remplace ni ne crée une référence invalide."""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "queue.json"
            first, second = "a" * 20, "b" * 20
            update_queue(path, "add", first, {"name": "Première"})
            update_queue(path, "add", second, {"name": "Seconde"})
            update_queue(path, "add", first, {"name": "Doublon"})
            update_queue(path, "up", second)
            self.assertEqual([row["name"] for row in read_queue(path)], ["Seconde", "Première"])
            with self.assertRaises(ValueError):
                update_queue(path, "add", "c" * 20)
            update_queue(path, "remove", second)
            self.assertEqual(read_queue(path), [{"handle": first, "name": "Première"}])
