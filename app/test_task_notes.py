"""Persistance isolée des notes locales d’impression."""

from pathlib import Path
import stat
import tempfile
import unittest

from task_notes import read_task_notes, save_task_note


class TaskNoteTests(unittest.TestCase):
    """Le fichier local reste privé et conserve les caractères utilisateur."""

    def test_note_round_trip_and_validation(self):
        """Une écriture invalide ne remplace pas la note précédente."""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "task-notes.json"
            key = "a" * 20
            self.assertEqual(read_task_notes(path), {})
            expected = {"text": "Ça tient à 0,2 mm 🧪", "tags": ["PLA"]}
            self.assertEqual(save_task_note(path, key, expected), expected)
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertEqual(read_task_notes(path), {key: expected})
            with self.assertRaises(ValueError):
                save_task_note(path, key, {"text": "x" * 2001, "tags": []})
            with self.assertRaises(ValueError):
                save_task_note(path, "../unknown", expected)
            self.assertEqual(read_task_notes(path), {key: expected})
