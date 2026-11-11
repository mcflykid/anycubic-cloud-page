"""Vérifie les déclarations des composants du nouveau cadre de l’atelier."""

import re
import unittest
from pathlib import Path


CSS = Path(__file__).resolve().parents[1] / "web" / "css"
TOKENS = CSS / "atelier-tokens.css"
DECLARATION = re.compile(r"(?:[;{]|^)\s*(?:--)?[-a-z][\w-]*\s*:\s*([^;{}]+)", re.M)
LITERAL = re.compile(
    r"#[0-9a-f]{3,8}\b|\b(?:rgb|hsl|oklch|oklab)\w*\s*\("
    r"|(?<![\w-])\d+(?:\.\d+)?(?:px|rem|em|ms)\b",
    re.I,
)


class DesignTokensTests(unittest.TestCase):
    def test_component_values_use_the_shared_tokens(self):
        """Les sélecteurs et seuils adaptatifs ne sont pas des déclarations de style."""
        components = sorted(path for path in CSS.glob("atelier-*.css") if path != TOKENS)
        self.assertTrue(components)
        for path in components:
            with self.subTest(component=path.name):
                css = re.sub(r"/\*.*?\*/", "", path.read_text(), flags=re.S)
                literals = [
                    match.group()
                    for declaration in DECLARATION.findall(css)
                    for match in LITERAL.finditer(declaration)
                ]
                self.assertEqual(literals, [])
