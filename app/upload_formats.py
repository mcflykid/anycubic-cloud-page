"""Contrôles de structure des modèles conservés dans le stockage Cloud."""

import re
import struct
from zipfile import BadZipFile, ZipFile


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
        if end >= 0 and len(tail) - end >= 22:
            _, disk, directory_disk, on_disk, entries, length, offset, comment = struct.unpack_from(
                "<4s4H2IH", tail, end
            )
            if (
                disk == directory_disk == 0
                and 0 < entries == on_disk <= 4096
                and length <= 2 * 1024 * 1024
                and offset + length == size - len(tail) + end
                and end + 22 + comment == len(tail)
            ):
                try:
                    source.seek(0)
                    with ZipFile(source) as package:
                        names = package.namelist()
                        if "[Content_Types].xml" in names and any(
                            name.lower().startswith("3d/") and name.lower().endswith(".model")
                            for name in names
                        ):
                            return
                except BadZipFile:
                    pass
        raise ValueError("Le contenu du fichier 3MF est invalide.")
