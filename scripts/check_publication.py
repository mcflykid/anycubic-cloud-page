"""Contrôle les fichiers publiables et les textes des images sans divulguer les valeurs détectées."""

import hashlib
import ipaddress
import json
import os
import pathlib
import re
import struct
import subprocess
import sys
import zlib
from xml.etree import ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[1]
PRIVATE_FILE = ".publication-private-patterns"
PRIVATE_ENV = "PUBLICATION_PRIVATE_PATTERNS"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
METADATA_LIMIT = 1024 * 1024
PATTERNS = {
    "private key": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE" + rb" KEY-----"),
    "JWT credential": re.compile(rb"eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{30,}"),
    "GitHub credential": re.compile(rb"gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}"),
    "personal home path": re.compile(rb'/(?:Users|home)/[^/\s\x00\'"`<>]+'),
}
# Deux URL documentaires publiques contiennent le segment « home » ; seule
# la règle des chemins personnels doit les ignorer, jamais les règles privées.
PUBLIC_WIKI_LINKS = re.compile(
    rb"https://wiki\.anycubic\.com/en/"
    rb"home/knowledge-sharing/(?:pressure-advance|ai-detection(?:\#h-33-relevant-error-codes)?)"
    rb"""(?=[\s"'\x60<>()]|$)"""
)
IPV4 = re.compile(rb"(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])")
IPV6 = re.compile(
    rb"(?i)(?<![\w:])(?:f[cd][0-9a-f]{2}|fe[89ab][0-9a-f])(?::[0-9a-f]{0,4}){2,7}(?![\w:])"
)
# Le contrôle inspecte aussi son propre source : aucun exemple d'hôte privé n'y est inscrit.
PRIVATE_NETWORKS = tuple(
    ipaddress.ip_network(value)
    for value in (
        (10 << 24, 8),
        ((172 << 24) | (16 << 16), 12),
        ((192 << 24) | (168 << 16), 16),
        ((169 << 24) | (254 << 16), 16),
        (0xFC << 120, 7),
        (0xFE80 << 112, 10),
    )
)


def load_private_patterns(root=ROOT, environ=None):
    """Charge les motifs JSON locaux et CI ; lève ValueError sans leur contenu si le format est invalide."""
    environ = os.environ if environ is None else environ
    documents = []
    path = pathlib.Path(root) / PRIVATE_FILE
    if path.is_file():
        documents.append(path.read_text())
    if environ.get(PRIVATE_ENV):
        documents.append(environ[PRIVATE_ENV])
    patterns = []
    try:
        for document in documents:
            rows = json.loads(document)
            if not isinstance(rows, list):
                raise ValueError
            for row in rows:
                value = row.get("regex") if isinstance(row, dict) else row
                if not isinstance(value, str) or not value:
                    raise ValueError
                patterns.append(re.compile(value.encode(), re.IGNORECASE))
    except (ValueError, TypeError, re.error):
        # Les erreurs JSON et regex standard peuvent contenir le motif privé lui-même.
        raise ValueError("Configuration des motifs privés invalide") from None
    return patterns


def publication_files(root=ROOT):
    """Renvoie les fichiers suivis et non ignorés ; propage CalledProcessError si Git est indisponible."""
    raw = subprocess.check_output(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        cwd=root,
        stderr=subprocess.PIPE,
    )
    return sorted({os.fsdecode(path) for path in raw.split(b"\0") if path})


def private_address(data):
    """Indique si le contenu contient une adresse privée ; les adresses d'exemple de documentation restent permises."""
    for pattern in (IPV4, IPV6):
        for match in pattern.finditer(data):
            try:
                address = ipaddress.ip_address(match.group().decode())
            except ValueError:
                continue
            if any(
                address.version == network.version and address in network
                for network in PRIVATE_NETWORKS
            ):
                return True
    return False


def png_text(data):
    """Renvoie les textes PNG, même compressés ; lève ValueError si les métadonnées sont invalides ou trop grandes."""
    if not data.startswith(PNG_SIGNATURE):
        return []
    texts = []
    offset = len(PNG_SIGNATURE)
    while offset + 12 <= len(data):
        length = struct.unpack(">I", data[offset : offset + 4])[0]
        kind = data[offset + 4 : offset + 8]
        end = offset + 12 + length
        if end > len(data):
            raise ValueError("Métadonnées PNG tronquées")
        value = data[offset + 8 : offset + 8 + length]
        try:
            compressed = False
            if kind == b"tEXt":
                value = value.split(b"\0", 1)[1]
            elif kind == b"zTXt":
                value = value.split(b"\0", 1)[1]
                if not value or value[0] != 0:
                    raise ValueError
                value = value[1:]
                compressed = True
            elif kind == b"iTXt":
                value = value.split(b"\0", 1)[1]
                if len(value) < 2 or value[0] not in (0, 1) or value[1] != 0:
                    raise ValueError
                compressed = bool(value[0])
                value = value[2:].split(b"\0", 2)[2]
            else:
                offset = end
                continue
            if compressed:
                # Une métadonnée compressée ne doit masquer aucun texte ni épuiser la mémoire.
                decoder = zlib.decompressobj()
                value = decoder.decompress(value, METADATA_LIMIT + 1)
                if not decoder.eof:
                    raise ValueError
            if len(value) > METADATA_LIMIT:
                raise ValueError
            texts.append(value)
        except (IndexError, ValueError, zlib.error):
            raise ValueError("Métadonnées PNG invalides ou trop volumineuses") from None
        offset = end
    return texts


def exif_text(data):
    """Extrait les textes TIFF/EXIF, dont Unicode ; ValueError refuse un format invalide, trop grand ou géolocalisé."""
    if len(data) < 8 or data[:2] not in (b"II", b"MM"):
        raise ValueError("En-tête EXIF invalide")
    endian = "<" if data[:2] == b"II" else ">"

    def number(offset, size):
        """Lit un entier borné à l’intérieur du segment EXIF, sans suivre de données extérieures."""
        if offset < 0 or offset + size > len(data):
            raise ValueError("Offset EXIF invalide")
        return int.from_bytes(data[offset : offset + size], "little" if endian == "<" else "big")

    if number(2, 2) != 42:
        raise ValueError("Format TIFF non pris en charge")
    sizes = {
        1: 1,
        2: 1,
        3: 2,
        4: 4,
        5: 8,
        6: 1,
        7: 1,
        8: 2,
        9: 4,
        10: 8,
        11: 4,
        12: 8,
        13: 4,
        129: 1,
    }
    pending = [number(4, 4)]
    seen = set()
    texts = []
    while pending:
        offset = pending.pop()
        if not offset:
            continue
        if offset < 8 or offset in seen or len(seen) >= 256:
            raise ValueError("Chaînage EXIF invalide")
        seen.add(offset)
        count = number(offset, 2)
        end = offset + 2 + count * 12
        following = number(end, 4)
        pending.append(following)
        for entry in range(offset + 2, end, 12):
            tag = number(entry, 2)
            kind = number(entry + 2, 2)
            items = number(entry + 4, 4)
            if kind not in sizes or items * sizes[kind] > METADATA_LIMIT:
                raise ValueError("Type ou taille EXIF non pris en charge")
            length = items * sizes[kind]
            start = entry + 8 if length <= 4 else number(entry + 8, 4)
            if start < 0 or start + length > len(data):
                raise ValueError("Valeur EXIF tronquée")
            value = data[start : start + length]
            # Les coordonnées numériques ne correspondent pas à un motif textuel mais restent privées.
            if tag == 0x8825 and any(value):
                raise ValueError("Géolocalisation EXIF interdite")
            if tag in {0x8769, 0xA005, 0x014A}:
                if kind not in {4, 13}:
                    raise ValueError("Pointeur EXIF invalide")
                pending.extend(number(start + index * 4, 4) for index in range(items))
            if tag in {0x9C9B, 0x9C9C, 0x9C9D, 0x9C9E, 0x9C9F}:
                texts.append(value.decode("utf-16-le").rstrip("\0").encode())
            elif tag == 0x9286 and kind == 7:
                prefix, content = value[:8], value[8:]
                if prefix == b"UNICODE\0":
                    encoding = (
                        "utf-16"
                        if content[:2] in {b"\xff\xfe", b"\xfe\xff"}
                        else ("utf-16-le" if endian == "<" else "utf-16-be")
                    )
                    texts.append(content.decode(encoding).rstrip("\0").encode())
                elif prefix == b"ASCII\0\0\0":
                    texts.append(content.decode("ascii").rstrip("\0").encode())
                elif prefix == b"JIS\0\0\0\0\0":
                    texts.append(content.decode("iso2022_jp").rstrip("\0").encode())
                elif prefix == b"\0" * 8:
                    texts.append(content)
                else:
                    raise ValueError("Encodage du commentaire EXIF inconnu")
            elif kind in {2, 129}:
                try:
                    text = value.decode("utf-8")
                except UnicodeError:
                    if kind == 129:
                        raise ValueError("Texte EXIF UTF-8 invalide") from None
                    text = value.decode("latin-1")
                texts.append(text.rstrip("\0").encode())
    return texts


def xmp_text(data):
    """Extrait textes et attributs XML décodés ; ValueError refuse les entités externes, formats invalides et champs GPS."""
    if len(data) > METADATA_LIMIT:
        raise ValueError("Métadonnées XMP trop grandes")
    try:
        source = data.decode("utf-8-sig")
        if "<!DOCTYPE" in source.upper() or "<!ENTITY" in source.upper():
            raise ValueError
        root = ET.fromstring(source)
        texts = []
        for node in root.iter():
            names = [node.tag, *node.attrib]
            if any(name.rsplit("}", 1)[-1].startswith("GPS") for name in names):
                raise ValueError
            texts.extend(
                value.encode() for value in [node.text, node.tail, *node.attrib.values()] if value
            )
        return texts
    except (UnicodeError, ET.ParseError, ValueError):
        raise ValueError("Métadonnées XMP invalides ou privées") from None


def jpeg_text(data):
    """Extrait commentaires, EXIF et XMP, même réparti entre segments ; ValueError refuse une analyse incomplète."""
    if not data.startswith(b"\xff\xd8"):
        return []
    offset = 2
    in_scan = False
    texts = []
    extended = {}
    total_metadata = 0
    finished = False
    while offset < len(data):
        if in_scan:
            offset = data.find(b"\xff", offset)
            if offset < 0:
                break
        if data[offset] != 255:
            raise ValueError("Marqueur JPEG invalide")
        while offset < len(data) and data[offset] == 255:
            offset += 1
        if offset >= len(data):
            break
        marker = data[offset]
        offset += 1
        if marker == 0 and in_scan or marker in range(0xD0, 0xD8) and in_scan:
            continue
        in_scan = False
        if marker == 0xD9:
            if data[offset:].strip(b"\0\xff \t\r\n"):
                raise ValueError("Données inattendues après JPEG")
            finished = True
            break
        if marker == 0x01:
            continue
        if marker in {0, 0xD8} or offset + 2 > len(data):
            raise ValueError("Marqueur JPEG invalide")
        length = int.from_bytes(data[offset : offset + 2], "big")
        if length < 2 or offset + length > len(data):
            raise ValueError("Segment JPEG tronqué")
        value = data[offset + 2 : offset + length]
        offset += length
        if marker == 0xDA:
            in_scan = True
            continue
        if marker not in {0xE1, 0xFE}:
            continue
        total_metadata += len(value)
        if total_metadata > METADATA_LIMIT:
            raise ValueError("Métadonnées JPEG trop grandes")
        if marker == 0xFE:
            # Les commentaires n’ont pas tous d’encodage déclaré ; conserver aussi leurs variantes Unicode.
            texts.append(value)
            for encoding in ["utf-8-sig", "utf-16", "utf-16-le", "utf-16-be", "latin-1"]:
                try:
                    texts.append(value.decode(encoding).rstrip("\0").encode())
                except UnicodeError:
                    pass
        elif value.startswith(b"Exif\0\0"):
            texts.extend(exif_text(value[6:]))
        elif value.startswith(b"http://ns.adobe.com/xap/1.0/\0"):
            texts.extend(xmp_text(value.split(b"\0", 1)[1]))
        elif value.startswith(b"http://ns.adobe.com/xmp/extension/\0"):
            header = len(b"http://ns.adobe.com/xmp/extension/\0")
            if len(value) < header + 40:
                raise ValueError("En-tête XMP étendu tronqué")
            guid = value[header : header + 32]
            size, position = struct.unpack(">II", value[header + 32 : header + 40])
            chunk = value[header + 40 :]
            if (
                not re.fullmatch(b"[0-9A-Fa-f]{32}", guid)
                or not 0 < size <= METADATA_LIMIT
                or position + len(chunk) > size
            ):
                raise ValueError("Segment XMP étendu invalide")
            expected, chunks = extended.setdefault(guid.upper(), (size, {}))
            if expected != size or position in chunks:
                raise ValueError("Segments XMP étendus incohérents")
            chunks[position] = chunk
    if not finished:
        raise ValueError("JPEG incomplet")
    for guid, (size, chunks) in extended.items():
        position = 0
        parts = []
        for start, chunk in sorted(chunks.items()):
            if start != position:
                raise ValueError("XMP étendu incomplet ou chevauchant")
            parts.append(chunk)
            position += len(chunk)
        content = b"".join(parts)
        if (
            position != size
            or hashlib.md5(content, usedforsecurity=False).hexdigest().upper().encode() != guid
        ):
            raise ValueError("Intégrité XMP étendu invalide")
        texts.extend(xmp_text(content))
    return texts


def findings(data, private_patterns=()):
    """Renvoie seulement les catégories détectées, jamais les chaînes sensibles qui leur correspondent."""
    reasons = {
        name
        for name, pattern in PATTERNS.items()
        if pattern.search(
            PUBLIC_WIKI_LINKS.sub(b" ", data) if name == "personal home path" else data
        )
    }
    if private_address(data):
        reasons.add("private network address")
    if any(pattern.search(data) for pattern in private_patterns):
        reasons.add("private pattern")
    return reasons


def inspect_file(root, relative, private_patterns=()):
    """Renvoie les catégories interdites ; refuse les liens sans lire leur cible et les fichiers privés."""
    relative = pathlib.Path(relative)
    path = pathlib.Path(root) / relative
    reasons = findings(os.fsencode(relative), private_patterns)
    if any(part in {"runtime", "secrets", "state", "appdata"} for part in relative.parts):
        reasons.add("private runtime path")
    if (
        relative.name == ".env"
        or relative.name.startswith(".env.")
        and relative.name != ".env.example"
    ):
        reasons.add("private environment file")
    if relative.name == PRIVATE_FILE or relative.name.endswith(".override.md"):
        reasons.add("private instructions or patterns")
    if path.is_symlink():
        return reasons | {"symbolic link"}
    if not path.is_file():
        return reasons | {"missing publication file"}
    data = path.read_bytes()
    reasons.update(findings(data, private_patterns))
    for metadata in [*png_text(data), *jpeg_text(data)]:
        reasons.update(findings(metadata, private_patterns))
    if path.suffix.lower() in {".key", ".pem", ".crt"}:
        reasons.add("certificate/key file")
    return reasons


def safe_path(relative, private_patterns=()):
    """Renvoie un chemin affichable ; masque un nom qui contient lui-même une valeur privée."""
    return (
        "[private filename]" if findings(os.fsencode(relative), private_patterns) else str(relative)
    )


def main(root=ROOT):
    """Renvoie 0 si la publication est autorisée, 1 si le contenu ou le contrôle est invalide."""
    try:
        private_patterns = load_private_patterns(root)
        paths = publication_files(root)
        blocked = []
        for relative in paths:
            reasons = inspect_file(root, relative, private_patterns)
            blocked.extend(
                (safe_path(relative, private_patterns), reason) for reason in sorted(reasons)
            )
    except (OSError, ValueError, subprocess.CalledProcessError):
        print("Publication check failed: unable to complete the confidentiality check.")
        return 1
    if blocked:
        for relative, reason in blocked:
            print(f"BLOCKED: {relative}: {reason}")
        return 1
    print(f"Publication check passed: {len(paths)} files; no private content detected.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
