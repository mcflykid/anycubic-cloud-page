"""Contrôle la restauration privée et le refus d’une archive altérée."""

from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile

from backup_appdata import backup, restore


class BackupTests(unittest.TestCase):
    """La sauvegarde ne touche ni au dossier actif ni à une ancienne restauration."""

    def test_backup_and_restore_with_tampering(self):
        """Une copie contient les mêmes réglages, et une archive altérée ne laisse aucun résultat."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "appdata"
            (source / "private").mkdir(parents=True)
            (source / "state").mkdir()
            (source / "private/discord-webhook").write_text("fixture")
            archive, target = root / "copy.zip", root / "restored"
            backup(source, archive, "2.1.0")
            restore(archive, target)
            restored = target / "private/discord-webhook"
            self.assertEqual(restored.read_text(), "fixture")
            self.assertEqual(restored.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError):
                restore(archive, target)
            altered = root / "altered.zip"
            with ZipFile(archive) as old, ZipFile(altered, "w") as new:
                new.writestr("manifest.json", old.read("manifest.json"))
                new.writestr("private/discord-webhook", b"changed")
            with self.assertRaises(ValueError):
                restore(altered, root / "rejected")
            self.assertFalse((root / "rejected").exists())
