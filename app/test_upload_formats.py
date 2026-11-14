"""Vérifie les enveloppes STL et 3MF avec des fichiers générés localement."""

import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from upload_formats import validate_cloud_model


def make_3mf(path):
    """Crée un petit conteneur 3MF fictif, sans contenu de tranche imprimable."""
    with ZipFile(path, "w", ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", "<Types/>")
        archive.writestr("3D/3dmodel.model", "<model/>")
    return path.read_bytes()


def force_zip64(data, entry_count=None):
    """Ajoute les enregistrements Zip64 EOCD autour d’un conteneur ZIP valide."""
    end = data.rfind(b"PK\x05\x06")
    eocd = bytearray(data[end:])
    _, _, _, disk_entries, entries, length, offset, _ = struct.unpack_from("<4s4H2IH", eocd)
    count = entries if entry_count is None else entry_count
    record_offset = end
    record = struct.pack(
        "<4sQ2H2I4Q",
        b"PK\x06\x06",
        44,
        45,
        45,
        0,
        0,
        count,
        count,
        length,
        offset,
    )
    locator = struct.pack("<4sIQI", b"PK\x06\x07", 0, record_offset, 1)
    struct.pack_into("<4H2I", eocd, 4, 0, 0, 0xFFFF, 0xFFFF, 0xFFFFFFFF, 0xFFFFFFFF)
    return data[:end] + record + locator + eocd


class CloudModelValidationTests(unittest.TestCase):
    """Les structures Zip64 valides sont acceptées sous les mêmes limites que ZIP classique."""

    def validate(self, data):
        """Écrit une archive temporaire puis la valide sans extraction."""
        temporary = tempfile.NamedTemporaryFile(suffix=".3mf")
        with temporary:
            path = Path(temporary.name)
            path.write_bytes(data)
            validate_cloud_model(path, ".3mf", len(data))

    def test_accepts_valid_standard_and_zip64_archives(self):
        """Les archives de stockage standard et Zip64 ont les métadonnées 3MF attendues."""
        with tempfile.TemporaryDirectory() as directory:
            standard = make_3mf(Path(directory) / "standard.3mf")
        self.validate(standard)
        self.validate(force_zip64(standard))

    def test_rejects_malformed_zip64_and_directory_entry_limit(self):
        """Un locator incohérent ou un compte Zip64 excessif ne fait pas charger le paquet."""
        with tempfile.TemporaryDirectory() as directory:
            standard = make_3mf(Path(directory) / "valid.3mf")
        valid64 = force_zip64(standard)
        corrupted = bytearray(valid64)
        locator = corrupted.rfind(b"PK\x06\x07")
        struct.pack_into("<Q", corrupted, locator + 8, len(corrupted) + 100)
        with self.assertRaises(ValueError):
            self.validate(bytes(corrupted))
        with self.assertRaises(ValueError):
            self.validate(force_zip64(standard, entry_count=4097))
        with self.assertRaises(ValueError):
            self.validate(b"PK\x03\x04malformed archive")

    def test_rejects_oversized_directory_before_opening_zip_or_zip64(self):
        """Un répertoire valide de plus de 2 Mio est refusé avant son chargement en mémoire."""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "oversized.3mf"
            with ZipFile(path, "w") as archive:
                archive.writestr("[Content_Types].xml", "<Types/>")
                archive.writestr("3D/3dmodel.model", "<model/>")
                for index in range(33):
                    entry = ZipInfo(f"Metadata/fixture-{index}.txt")
                    entry.comment = b"x" * 65535
                    archive.writestr(entry, "")
            standard = path.read_bytes()
        for archive in (standard, force_zip64(standard)):
            with patch("upload_formats.ZipFile") as zip_reader:
                with self.assertRaisesRegex(ValueError, "3MF est invalide"):
                    self.validate(archive)
                zip_reader.assert_not_called()

    def test_rejects_size_outside_declared_upload(self):
        """La taille déclarée doit correspondre au fichier reçu avant validation du contenu."""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "valid.3mf"
            data = make_3mf(path)
            with self.assertRaises(ValueError):
                validate_cloud_model(path, ".3mf", len(data) + 1)
