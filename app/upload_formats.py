"""Contrôles de structure des modèles conservés dans le stockage Cloud."""

import re
import struct
from zipfile import BadZipFile, ZipFile


def _bounded_zip_directory(source, size, tail, end):
    """Valide un répertoire ZIP classique ou Zip64 avant que ZipFile le charge."""
    absolute_end = size - len(tail) + end
    if end + 22 > len(tail):
        return False
    _, disk, directory_disk, disk_entries, entries, length, offset, comment = struct.unpack_from(
        "<4s4H2IH", tail, end
    )
    if end + 22 + comment != len(tail) or disk != 0 or directory_disk != 0:
        return False
    locator_pos = end - 20
    has_locator = locator_pos >= 0 and tail[locator_pos : locator_pos + 4] == b"PK\x06\x07"
    if has_locator:
        _, locator_disk, zip64_offset, total_disks = struct.unpack_from("<4sIQI", tail, locator_pos)
        if locator_disk != 0 or total_disks != 1:
            return False
        record_pos = zip64_offset - (size - len(tail))
        if record_pos < 0 or record_pos + 56 != locator_pos:
            return False
        (
            signature,
            record_size,
            _,
            _,
            zip_disk,
            directory_disk,
            disk_entries64,
            entries64,
            length64,
            offset64,
        ) = struct.unpack_from("<4sQ2H2I4Q", tail, record_pos)
        if signature != b"PK\x06\x06" or record_size != 44 or zip_disk != 0 or directory_disk != 0:
            return False
        if disk_entries64 != entries64 or entries64 > 4096 or entries64 == 0:
            return False
        if length64 > 2 * 1024 * 1024 or offset64 + length64 != zip64_offset:
            return False
        return True
    return (
        disk == directory_disk == 0
        and 0 < entries == disk_entries <= 4096
        and length <= 2 * 1024 * 1024
        and offset + length == absolute_end
    )


def validate_cloud_model(path, extension, size):
    """Vérifie un STL ou un paquet 3MF sans extraire les entrées ni lire le fichier entier."""
    with path.open("rb") as source:
        if extension == ".stl":
            header = source.read(65536)
            if len(header) >= 84:
                triangles = struct.unpack_from("<I", header, 80)[0]
                if triangles > 0 and size == 84 + 50 * triangles:
                    return
            source.seek(max(0, size - 65536))
            if (
                re.match(rb"\s*solid(?:\s|$)", header, re.I)
                and re.search(rb"(?im)^\s*facet\s+normal\s", header)
                and re.search(rb"(?im)^\s*endsolid(?:\s|$)", source.read())
            ):
                return
            raise ValueError("Le contenu du fichier STL est invalide.")

        # La table ZIP est chargée en mémoire par ZipFile. On borne sa taille avant ouverture.
        source.seek(max(0, size - 65557))
        tail = source.read()
        end = tail.rfind(b"PK\x05\x06")
        if end >= 0 and _bounded_zip_directory(source, size, tail, end):
            try:
                source.seek(0)
                with ZipFile(source) as package:
                    names = package.namelist()
                    if "[Content_Types].xml" in names and any(
                        name.lower().startswith("3d/") and name.lower().endswith(".model")
                        for name in names
                    ):
                        return
            except (BadZipFile, OSError, struct.error):
                pass
        raise ValueError("Le contenu du fichier 3MF est invalide.")
