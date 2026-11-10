"""Aperçus d’impressions lancées sur la machine, sans ordre réel ni correspondance de nom approximative."""

import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from printer_files import current_preview
from anycubic_cloud_api.data_models.project import AnycubicProject


class CurrentPreviewTests(unittest.IsolatedAsyncioTestCase):
    """La miniature est attachée au projet courant de la bonne imprimante."""

    def target(self, **project_fields):
        """Prépare une cible et un projet fictifs dont la référence n’expose aucun identifiant."""
        project = SimpleNamespace(
            id=42, image_url="https://cdn.example.test/image.png", **project_fields
        )
        printer = SimpleNamespace(
            id=7, latest_project=project, latest_project_image_url=project.image_url
        )
        return SimpleNamespace(
            printer=printer,
            session=object(),
            command_project_key=lambda: "a" * 20,
            local_preview=AsyncMock(),
            extras=SimpleNamespace(preview_row=AsyncMock(return_value={"image": None})),
        )

    async def test_uses_image_of_current_native_project_without_file_command(self):
        """Le lien déjà attaché au projet évite une commande de consultation inutile."""
        target = self.target()
        with patch(
            "printer_files.download_preview",
            new=AsyncMock(return_value="data:image/png;base64,fixture"),
        ) as download:
            self.assertEqual(
                await current_preview(target, "a" * 20), {"image": "data:image/png;base64,fixture"}
            )
            download.assert_awaited_once_with(
                target.session, target.printer.latest_project.image_url
            )
        target.local_preview.assert_not_awaited()

    async def test_rejects_late_answer_after_job_changed(self):
        """Une réponse du projet précédent ne devient jamais l’image du suivant."""
        target = self.target()

        async def delayed(*_):
            """Simule une réponse arrivée après le remplacement du projet courant."""
            target.command_project_key = lambda: "b" * 20
            return "old-image"

        with patch("printer_files.download_preview", new=AsyncMock(side_effect=delayed)):
            self.assertEqual(await current_preview(target, "a" * 20), {"image": None})
        target.local_preview.assert_not_awaited()

    async def test_retains_native_filename_for_local_thumbnail(self):
        """Le nom affichable sans extension ne doit pas remplacer le chemin natif de l’aperçu."""
        project = AnycubicProject(
            api_parent=SimpleNamespace(),
            id=42,
            taskid=43,
            gcode_id=44,
            estimate=0,
            progress=0,
            status=1,
            create_time=1,
            gcode_name=".3mf_temp/fixture.gcode.3mf",
            source="local",
        )
        self.assertEqual(project.preview_filename, ".3mf_temp/fixture.gcode.3mf")
        target = self.target()
        target.printer.latest_project = project
        target.printer.latest_project_image_url = None
        target.local_preview.return_value = "local-image"
        with patch("printer_files.download_preview", new=AsyncMock(return_value=None)):
            self.assertEqual(await current_preview(target, "a" * 20), {"image": "local-image"})
        target.local_preview.assert_awaited_once_with("local", ".3mf_temp/fixture.gcode.3mf", "/")

    async def test_stale_reference_never_requests_a_thumbnail(self):
        """Une ancienne référence est refusée avant de consulter le fournisseur."""
        target = self.target()
        with patch("printer_files.download_preview", new=AsyncMock()) as download:
            self.assertEqual(await current_preview(target, "b" * 20), {"image": None})
            download.assert_not_awaited()

    async def test_job_change_during_detail_never_starts_a_local_lookup(self):
        """Une tâche remplacée pendant son détail ne sollicite pas le fichier de la suivante."""
        target = self.target(_taskid=43, _source="local", preview_filename="old.gcode")

        async def late_detail(*_):
            """Simule le changement de tâche pendant une consultation de détail."""
            target.command_project_key = lambda: "b" * 20
            return {"image": None}

        target.extras.preview_row = AsyncMock(side_effect=late_detail)
        with patch("printer_files.download_preview", new=AsyncMock(return_value=None)):
            self.assertEqual(await current_preview(target, "a" * 20), {"image": None})
        target.local_preview.assert_not_awaited()
