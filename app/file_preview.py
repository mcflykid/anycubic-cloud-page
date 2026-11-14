"""Rapprochement exact des fichiers machine et des aperçus de projets Anycubic."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Protocol


class ProjectPreview(Protocol):
    """Décrit les seuls champs nécessaires au rapprochement d’un fichier et d’un aperçu."""

    @property
    def printer_id(self) -> int | None:
        """Identifiant de la machine, ou None si l’association n’est pas connue."""
        ...

    @property
    def name(self) -> str:
        """Nom de fichier du projet utilisé pour une correspondance exacte."""
        ...

    @property
    def image_url(self) -> str | None:
        """URL d’aperçu du projet, ou None si le cloud n’en fournit pas."""
        ...


def normalize_preview_filename(filename: str) -> str:
    """Renvoie un nom comparable sans chemin ni suffixe connu, sans rapprochement approximatif."""
    basename = filename.replace("\\", "/").rsplit("/", 1)[-1].strip().casefold()
    for suffix in (".gcode.3mf", ".gcode.gz", ".gcode", ".3mf"):
        if basename.endswith(suffix):
            return basename[: -len(suffix)]
    return basename


def find_project_preview_url(
    projects: Iterable[ProjectPreview],
    printer_id: int,
    filename: str,
) -> str | None:
    """Renvoie le premier aperçu exact de la machine dans projects, ou None ; l’ordre d’entrée fait foi."""
    normalized_filename = normalize_preview_filename(filename)
    if not normalized_filename:
        return None

    for project in projects:
        if (
            project.printer_id == printer_id
            and normalize_preview_filename(project.name) == normalized_filename
            and project.image_url
        ):
            return project.image_url

    return None
