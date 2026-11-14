"""Vérifie les refus de publication et la composition des notes de release."""

import io
import re
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch
from release_metadata import release_metadata, require_unpublished


class ReleaseMetadataTests(unittest.TestCase):
    """Protège la validation du tag et l’historique associé à chaque release."""

    def test_external_workflow_references_use_full_commit_with_version(self):
        """Un tag amont mobile ne change pas le code chargé par les workflows."""
        workflows = Path(__file__).resolve().parents[1] / ".github" / "workflows"
        for filename in ("ci.yml", "publish.yml"):
            refs = re.findall(
                r"^\s*(?:-\s+)?uses:\s*([^\n]+)", (workflows / filename).read_text(), re.M
            )
            external = [ref for ref in refs if not ref.startswith("./")]
            self.assertTrue(external)
            for ref in external:
                with self.subTest(workflow=filename, ref=ref):
                    self.assertRegex(ref, r"^[^@\s]+@[a-f0-9]{40}\s+#\s+v\d+\.\d+\.\d+$")

    def test_notes_include_current_and_earlier_versions(self):
        """La release conserve les anciens titres et laisse les versions suivantes hors des notes."""
        text = (
            "# Changements\n\n## 2.4.0 — en préparation\n\n- Version suivante.\n\n"
            "## 2.3.9\n\n- Ancien correctif.\n\n## 2.3.10 — 2026-11-06\n\n- Correction #42.\n\n"
            "## 2.3.8\n\n- Autre entrée.\n"
        )
        self.assertEqual(
            release_metadata("v2.3.10", {"version": "2.3.10"}, text),
            (
                "2.3.10",
                "## 2.3.10 — 2026-11-06\n\n- Correction #42.\n\n"
                "## 2.3.9\n\n- Ancien correctif.\n\n## 2.3.8\n\n- Autre entrée.\n",
            ),
        )

    def test_wrong_tag_or_version_is_rejected(self):
        """Le filtrage des événements GitHub ne suffit pas à valider un tag."""
        for tag in ["2.3.4", "v2.3", "v2.3.4-beta", "v02.3.4", "v2.3.5", "main"]:
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                release_metadata(tag, {"version": "2.3.4"}, "## 2.3.4\n- Note.\n")

    def test_missing_empty_or_duplicate_notes_are_rejected(self):
        """Des notes ambiguës ne doivent pas produire une release incomplète."""
        for text in ["## 2.3.3\n- Autre.\n", "## 2.3.4\n\n", "## 2.3.4\n- A.\n## 2.3.4\n- B.\n"]:
            with self.subTest(text=text), self.assertRaises(ValueError):
                release_metadata("v2.3.4", {"version": "2.3.4"}, text)

    @patch("release_metadata.urllib.request.urlopen")
    def test_existing_image_is_rejected(self, open_url):
        """Un rerun ne doit jamais écraser une image déjà publiée."""
        open_url.side_effect = [io.BytesIO(b'{"token":"fixture"}'), io.BytesIO(b"{}")]
        with self.assertRaises(ValueError):
            require_unpublished("2.3.4")

    @patch("release_metadata.urllib.request.urlopen")
    def test_only_registry_not_found_allows_publication(self, open_url):
        """Seule une absence explicite autorise la création du numéro demandé."""
        open_url.side_effect = [
            io.BytesIO(b'{"token":"fixture"}'),
            urllib.error.HTTPError("https://registry.example", 404, "Not Found", {}, None),
        ]
        self.assertIsNone(require_unpublished("2.3.4"))

    @patch("release_metadata.urllib.request.urlopen")
    def test_registry_denial_or_network_failure_blocks(self, open_url):
        """Une panne ou un refus d’accès ne prouve pas qu’un numéro est libre."""
        for error in [
            urllib.error.HTTPError("https://registry.example", 403, "Forbidden", {}, None),
            urllib.error.URLError("fixture offline"),
        ]:
            open_url.side_effect = [io.BytesIO(b'{"token":"fixture"}'), error]
            with (
                self.subTest(error=type(error).__name__),
                self.assertRaises((RuntimeError, OSError)),
            ):
                require_unpublished("2.3.4")


if __name__ == "__main__":
    unittest.main()
