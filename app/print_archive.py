"""Conserve les fichiers tranchés importés explicitement depuis l’historique."""

import asyncio
from contextlib import closing, contextmanager
import hashlib
import os
from pathlib import Path
import re
import sqlite3
import tempfile
from zipfile import BadZipFile, ZipFile

from aiofiles import open as aio_open
from aiohttp import web

from file_uploads import UPLOAD_LIMIT
from upload_formats import validate_cloud_model


ARCHIVE_LIMIT = 512 * 1024**2
MAX_ENTRIES = 2000
LOCK = asyncio.Lock()
DIGEST = re.compile(r"[a-f0-9]{64}")


class PrintArchive:
    """Indexe les originaux par machine, tâche et empreinte, avec quota partagé."""

    def __init__(self, state_dir):
        """Place l’index et les fichiers dans le stockage d’état sauvegardable."""
        self.root = state_dir / "print-archive"

    @contextmanager
    def _index(self):
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.root / "index.sqlite")) as db, db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS originals ("
                "printer TEXT, task TEXT, digest TEXT, name TEXT, size INTEGER, "
                "PRIMARY KEY (printer, task, digest))"
            )
            yield db

    def list(self, printer, task):
        """Renvoie les fichiers de cette tâche, dernier import en premier."""
        if not self.root.exists():
            return []
        with self._index() as db:
            rows = db.execute(
                "SELECT digest, name, size FROM originals WHERE printer=? AND task=? ORDER BY rowid DESC",
                (printer, task),
            ).fetchall()
        return [dict(sha256=digest, name=name, size=size) for digest, name, size in rows]

    def add(self, printer, task, name, staged):
        """Vérifie l’original puis indexe une copie sans dupliquer son contenu."""
        size = staged.stat().st_size
        if not 0 < size <= UPLOAD_LIMIT:
            raise ValueError("Fichier limité à 100 Mo")
        if not isinstance(name, str) or not re.fullmatch(r"[^/\\\x00-\x1f\x7f]{1,240}", name):
            raise ValueError("Nom de fichier invalide")
        suffix = name.casefold()
        if suffix.endswith(".gcode.3mf"):
            validate_cloud_model(staged, ".3mf", size)
            try:
                with ZipFile(staged) as package:
                    if not any(
                        item.filename.casefold().endswith(".gcode") and item.file_size > 0
                        for item in package.infolist()
                    ):
                        raise ValueError("Le paquet ne contient aucun G-code")
            except BadZipFile:
                raise ValueError("Paquet tranché invalide") from None
        elif suffix.endswith(".gcode"):
            with staged.open("rb") as source:
                prefix = source.read(1024 * 1024)
            if b"\0" in prefix or not re.search(rb"(?im)^\s*(?:G0?0|G0?1|G28)\b", prefix):
                raise ValueError("Le fichier ne contient aucun G-code reconnu")
        else:
            raise ValueError("Choisissez un fichier .gcode ou .gcode.3mf")
        with staged.open("rb") as source:
            digest = hashlib.file_digest(source, "sha256").hexdigest()
        blob = self.root / digest
        with self._index() as db:
            db.execute("BEGIN IMMEDIATE")
            if db.execute(
                "SELECT 1 FROM originals WHERE printer=? AND task=? AND digest=?",
                (printer, task, digest),
            ).fetchone():
                return digest
            count = db.execute("SELECT COUNT(*) FROM originals").fetchone()[0]
            used = sum(
                item.stat().st_size for item in self.root.iterdir() if DIGEST.fullmatch(item.name)
            )
            if count >= MAX_ENTRIES or (not blob.exists() and used + size > ARCHIVE_LIMIT):
                raise ValueError("Le quota d’archivage est atteint")
            os.chmod(staged, 0o600)
            if not blob.exists():
                os.link(staged, blob)
            db.execute(
                "INSERT INTO originals VALUES (?, ?, ?, ?, ?)", (printer, task, digest, name, size)
            )
        return digest

    def resolve(self, printer, task, digest):
        """Vérifie que le fichier demandé appartient à la tâche et à la machine."""
        if not DIGEST.fullmatch(digest):
            raise web.HTTPNotFound()
        row = next((row for row in self.list(printer, task) if row["sha256"] == digest), None)
        path = self.root / digest
        if row is None or not path.is_file():
            raise web.HTTPNotFound()
        return row, path


async def archive_upload(request, archive, printer, task):
    """Reçoit un seul fichier par blocs et efface le temporaire même après un refus."""
    if LOCK.locked():
        raise ValueError("Un import est déjà en cours")
    async with LOCK:
        reader = await request.multipart()
        part = await reader.next()
        if part is None or part.name != "file" or not part.filename:
            raise ValueError("Original tranché manquant")
        archive.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="import-", dir=archive.root) as directory:
            path = Path(directory) / "original"
            size = 0
            async with aio_open(path, "wb") as dest:
                while chunk := await part.read_chunk(256 * 1024):
                    size += len(chunk)
                    if size > UPLOAD_LIMIT:
                        raise ValueError("Fichier limité à 100 Mo")
                    await dest.write(chunk)
            if await reader.next() is not None:
                raise ValueError("Un seul original est accepté")
            # L’écriture reste dans la portée du temporaire si le client se déconnecte.
            worker = asyncio.create_task(
                asyncio.to_thread(archive.add, printer, task, part.filename, path)
            )
            try:
                digest = await asyncio.shield(worker)
            except asyncio.CancelledError:
                await asyncio.gather(worker, return_exceptions=True)
                raise
        return web.json_response({"ok": True, "sha256": digest})


def archive_download(row, path):
    """Force le téléchargement pour éviter d’interpréter le contenu comme une page."""
    from urllib.parse import quote

    return web.FileResponse(
        path,
        headers={
            "Content-Disposition": "attachment; filename*=UTF-8''" + quote(row["name"], safe=""),
            "Content-Type": "application/octet-stream",
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )
