"""Vérifie le contrôle de confidentialité avec des dépôts et des valeurs entièrement fictifs."""

import contextlib
import io
import json
import pathlib
import re
import struct
import subprocess
import tempfile
import unittest
import zlib
from unittest.mock import patch

import check_publication as check


def png_chunk(kind, value):
    """Construit une métadonnée PNG synthétique avec CRC pour tester le contrôle sans dépendance graphique."""
    return (
        struct.pack(">I", len(value)) + kind + value + struct.pack(">I", zlib.crc32(kind + value))
    )


class PublicationTests(unittest.TestCase):
    """Contrôle la détection et l'absence de valeurs privées dans les diagnostics."""

    def setUp(self):
        """Prépare un dépôt temporaire indépendant du projet et de ses motifs privés réels."""
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = pathlib.Path(self.tmp.name)
        subprocess.run(["git", "init", "-q", str(self.root)], check=True, capture_output=True)
        (self.root / ".gitignore").write_text(check.PRIVATE_FILE + "\n")

    def output(self, environ=None):
        """Renvoie code et sortie avec un environnement isolé, sans lire les secrets de la session."""
        stream = io.StringIO()
        with (
            patch.dict("os.environ", environ or {}, clear=True),
            contextlib.redirect_stdout(stream),
        ):
            code = check.main(self.root)
        return code, stream.getvalue()

    def test_clean_checkout_without_private_configuration(self):
        """Un projet public sain peut être vérifié sans configuration privée locale ni secret CI."""
        (self.root / "README.md").write_text("Exemple public : http://localhost:8080\n")
        self.assertEqual(self.output()[0], 0)

    def test_public_wiki_links_do_not_mask_private_paths(self):
        """Seuls les articles publics explicitement connus échappent au filtre des chemins personnels."""
        path = b"/" + b"home/knowledge-sharing/ai-detection"
        public = b"https://wiki.anycubic.com/en" + path
        private = b"/" + b"home/fixture-account"
        self.assertEqual(check.findings(public + b"#h-33-relevant-error-codes"), set())
        self.assertIn("personal home path", check.findings(b"https://example.org/en" + path))
        self.assertIn("personal home path", check.findings(public + b"?q=private"))
        self.assertIn("personal home path", check.findings(public + b"/private"))
        self.assertIn("personal home path", check.findings(public + b" " + private))
        self.assertIn("private pattern", check.findings(public, [re.compile(b"ai-detection")]))

    def test_local_and_ci_patterns_are_both_loaded(self):
        """Les règles privées locales et CI complètent les règles génériques sans se remplacer."""
        local = "fixture-local-marker"
        ci = "fixture-ci-marker"
        (self.root / check.PRIVATE_FILE).write_text(json.dumps([{"regex": local}]))
        loaded = check.load_private_patterns(self.root, {check.PRIVATE_ENV: json.dumps([ci])})
        self.assertEqual(check.findings(local.encode(), loaded), {"private pattern"})
        self.assertEqual(check.findings(ci.encode(), loaded), {"private pattern"})
        self.assertNotIn(check.PRIVATE_FILE, check.publication_files(self.root))

    def test_private_match_is_not_printed(self):
        """Le diagnostic identifie la catégorie et le fichier sans reproduire la valeur détectée."""
        marker = "fixture-sensitive-marker"
        (self.root / "example.txt").write_text(marker)
        code, output = self.output({check.PRIVATE_ENV: json.dumps([marker])})
        self.assertEqual(code, 1)
        self.assertIn("example.txt: private pattern", output)
        self.assertNotIn(marker, output)

    def test_private_filename_is_redacted(self):
        """Un nom de fichier peut lui-même contenir une valeur qui doit rester masquée."""
        marker = "fixture-filename-marker"
        (self.root / (marker + ".txt")).write_text("Contenu public")
        code, output = self.output({check.PRIVATE_ENV: json.dumps([marker])})
        self.assertEqual(code, 1)
        self.assertIn("[private filename]", output)
        self.assertNotIn(marker, output)

    def test_malformed_private_configuration_fails_without_echo(self):
        """Une configuration invalide bloque le contrôle sans publier son contenu dans une erreur Python."""
        for raw in ["fixture-invalid-json", '{"fixture": 1}', '["("]', "[null]", '[""]']:
            with self.subTest(format=raw[:1]):
                code, output = self.output({check.PRIVATE_ENV: raw})
                self.assertEqual(code, 1)
                self.assertNotIn(raw, output)
                self.assertIn("unable to complete", output)

    def test_generic_private_network_addresses(self):
        """Les réseaux privés sont refusés indépendamment de toute liste personnelle de déploiement."""
        values = [
            ".".join(parts)
            for parts in [
                ["10", "20", "30", "40"],
                ["172", "17", "2", "3"],
                ["192", "168", "4", "5"],
            ]
        ]
        values += [":".join(["fd12", "", "1"]), ":".join(["fe80", "", "1"])]
        for value in values:
            with self.subTest(family="ipv6" if ":" in value else "ipv4"):
                self.assertTrue(check.private_address(value.encode()))
        for value in ["127.0.0.1", "0.0.0.0", "::1", "192.0.2.15", "172.40.2.3"]:
            self.assertFalse(check.private_address(value.encode()))

    def test_generic_home_paths(self):
        """Les chemins personnels sont refusés même si aucun nom de personne n'est configuré."""
        for folder in ["Users", "home"]:
            value = "/".join(["", folder, "fixture-person", "project"])
            self.assertIn("personal home path", check.findings(value.encode()))
        self.assertNotIn("personal home path", check.findings(b"/app/web/imprimante.html"))

    def test_compressed_png_metadata_is_inspected(self):
        """La compression des métadonnées ne permet pas de contourner le contrôle de publication."""
        marker = b"fixture-image-marker"
        patterns = [re.compile(marker)]
        for kind, payload in [
            (b"tEXt", b"Comment\0" + marker),
            (b"zTXt", b"Comment\0\0" + zlib.compress(marker)),
            (b"iTXt", b"Comment\0\1\0\0\0" + zlib.compress(marker)),
        ]:
            path = self.root / "image.png"
            path.write_bytes(check.PNG_SIGNATURE + png_chunk(kind, payload))
            self.assertIn("private pattern", check.inspect_file(self.root, "image.png", patterns))

    def test_invalid_or_oversized_png_metadata_fails_closed(self):
        """Une image dont les métadonnées sont illisibles ne doit pas être annoncée comme vérifiée."""
        for payload in [
            b"Comment\0\0invalid",
            b"Comment\0\0" + zlib.compress(b"x" * (check.METADATA_LIMIT + 1)),
        ]:
            (self.root / "image.png").write_bytes(check.PNG_SIGNATURE + png_chunk(b"zTXt", payload))
            self.assertEqual(self.output()[0], 1)
        (self.root / "image.png").write_bytes(
            check.PNG_SIGNATURE + struct.pack(">I", 99) + b"tEXt" + b"short"
        )
        self.assertEqual(self.output()[0], 1)

    def test_symlink_is_rejected_without_following_external_file(self):
        """Un lien vers un fichier extérieur ne doit pas en charger le contenu dans un diagnostic."""
        external = self.root.parent / (self.root.name + "-external")
        external.write_text("fixture-external-content")
        self.addCleanup(external.unlink)
        (self.root / "public.txt").symlink_to(external)
        code, output = self.output()
        self.assertEqual(code, 1)
        self.assertIn("symbolic link", output)
        self.assertNotIn("fixture-external-content", output)

    def test_forced_private_file_is_blocked_even_if_ignored(self):
        """Un ajout forcé par Git ne doit pas rendre un fichier de motifs privés publiable."""
        path = self.root / check.PRIVATE_FILE
        path.write_text("[]")
        subprocess.run(
            ["git", "-C", str(self.root), "add", "-f", path.name], check=True, capture_output=True
        )
        code, output = self.output()
        self.assertEqual(code, 1)
        self.assertIn("private instructions or patterns", output)

    def test_environment_and_runtime_data_are_blocked(self):
        """Les fichiers privés sont interdits par leur rôle, même lorsque leurs valeurs semblent inoffensives."""
        (self.root / "appdata").mkdir()
        (self.root / "appdata" / "settings.json").write_text("{}")
        (self.root / ".env.production").write_text("PLACEHOLDER=example")
        code, output = self.output()
        self.assertEqual(code, 1)
        self.assertIn("private runtime path", output)
        self.assertIn("private environment file", output)


if __name__ == "__main__":
    unittest.main()
