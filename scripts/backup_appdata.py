"""Sauvegarde appdata à l’arrêt et restaure une copie privée dans un dossier neuf."""

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import tempfile
from zipfile import ZIP_DEFLATED, ZipFile

ROOTS = {"private", "state"}
MAX_TOTAL = 1024 * 1024 * 1024
MAX_FILES = 4096
MAX_INDEX = 2 * 1024 * 1024


def file_digest(source, dest=None):
    """Lit par blocs et calcule l’empreinte sans charger un fichier entier en mémoire."""
    digest = hashlib.sha256()
    for chunk in iter(lambda: source.read(1024 * 1024), b""):
        digest.update(chunk)
        if dest is not None:
            dest.write(chunk)
    return digest.hexdigest()


def safe_name(name):
    """Borne la restauration aux dossiers persistants attendus par le conteneur."""
    path = PurePosixPath(name)
    if (
        len(path.parts) < 2
        or path.parts[0] not in ROOTS
        or ".." in path.parts
        or path.as_posix() != name
        or "\\" in name
        or "\x00" in name
    ):
        raise ValueError("Chemin d’archive invalide")
    return path


def backup(source, archive, version):
    """Crée une archive privée hors appdata, sans suivre les liens ni écraser un fichier."""
    source = source.resolve(strict=True)
    if archive.resolve().is_relative_to(source):
        raise ValueError("Archive à placer hors d’appdata")
    files = []
    for name in sorted(ROOTS):
        folder = source / name
        if not folder.is_dir() or folder.is_symlink():
            raise ValueError("Dossier persistant absent ou invalide")
        for path in folder.rglob("*"):
            mode = path.lstat().st_mode
            if stat.S_ISREG(mode):
                files.append(path)
            elif not stat.S_ISDIR(mode):
                raise ValueError("Lien ou fichier spécial dans appdata")
    if len(files) > MAX_FILES or sum(p.stat().st_size for p in files) > MAX_TOTAL:
        raise ValueError("Sauvegarde trop volumineuse")
    manifest = {"schema": 1, "version": version, "files": {}}
    fd = os.open(archive, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        with os.fdopen(fd, "wb") as target, ZipFile(target, "w", ZIP_DEFLATED) as out:
            for path in sorted(files):
                name = path.relative_to(source).as_posix()
                safe_name(name)
                before = path.stat()
                with path.open("rb") as read, out.open(name, "w") as write:
                    value = file_digest(read, write)
                after = path.stat()
                if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                    raise ValueError("appdata a changé pendant la sauvegarde")
                manifest["files"][name] = {"size": before.st_size, "sha256": value}
            out.writestr("manifest.json", json.dumps(manifest))
    except BaseException:
        archive.unlink()
        raise


def restore(archive, target):
    """Vérifie l’archive entière avant de déplacer la copie vers sa destination neuve."""
    target.mkdir(mode=0o700)
    try:
        with tempfile.TemporaryDirectory(dir=target) as stage, ZipFile(archive) as source:
            entries = source.infolist()
            by_name = {row.filename: row for row in entries}
            if len(entries) != len(by_name) or len(entries) > MAX_FILES + 1:
                raise ValueError("Entrées en double ou trop nombreuses")
            index = by_name.get("manifest.json")
            if not index or index.file_size > MAX_INDEX:
                raise ValueError("Manifeste absent ou invalide")
            manifest = json.loads(source.read(index))
            files = manifest.get("files")
            if (
                manifest.get("schema") != 1
                or not isinstance(files, dict)
                or set(files) != by_name.keys() - {"manifest.json"}
            ):
                raise ValueError("Contenu différent du manifeste")
            if sum(by_name[name].file_size for name in files) > MAX_TOTAL:
                raise ValueError("Archive trop volumineuse")
            stage = Path(stage)
            for name in ROOTS:
                (stage / name).mkdir(mode=0o700)
            for name, info in files.items():
                path = stage / safe_name(name)
                entry = by_name[name]
                mode = entry.external_attr >> 16
                if entry.is_dir() or stat.S_ISLNK(mode) or entry.file_size != info["size"]:
                    raise ValueError("Entrée non conforme")
                path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                with source.open(entry) as read, path.open("xb") as write:
                    path.chmod(0o600)
                    if file_digest(read, write) != info["sha256"]:
                        raise ValueError("Empreinte invalide")
            for name in ROOTS:
                (stage / name).rename(target / name)
    except BaseException:
        shutil.rmtree(target)
        raise


def main():
    """Expose deux opérations explicites et masque le détail des erreurs contenant des chemins."""
    parser = argparse.ArgumentParser(description=__doc__)
    cmds = parser.add_subparsers(dest="action", required=True)
    save = cmds.add_parser("backup")
    save.add_argument("source", type=Path)
    save.add_argument("archive", type=Path)
    save.add_argument("--version", required=True)
    load = cmds.add_parser("restore")
    load.add_argument("archive", type=Path)
    load.add_argument("target", type=Path)
    args = parser.parse_args()
    try:
        if args.action == "backup":
            if not re.fullmatch(r"\d+\.\d+\.\d+", args.version):
                raise ValueError("Version invalide")
            backup(args.source, args.archive, args.version)
        else:
            restore(args.archive, args.target)
    except Exception:
        parser.exit(
            1, "Échec. Vérifiez les permissions, le dossier neuf et l’intégrité de l’archive.\n"
        )


if __name__ == "__main__":
    main()
