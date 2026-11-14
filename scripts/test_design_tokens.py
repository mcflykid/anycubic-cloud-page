"""Protège le référentiel de présentation des feuilles de l’atelier."""

import re
import unittest
from collections import Counter
from pathlib import Path


CSS = Path(__file__).resolve().parents[1] / "web" / "css"
TOKENS = CSS / "atelier-tokens.css"
DECLARATION = re.compile(r"(?:[;{]|^)\s*((?:--)?[-a-z][\w-]*)\s*:\s*([^;{}]+)", re.M)
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
                    for _, declaration in DECLARATION.findall(css)
                    for match in LITERAL.finditer(declaration)
                ]
                self.assertEqual(literals, [])

    def test_shared_rules_apply_to_all_stylesheets(self):
        """Réserve les longueurs hors échelle aux géométries propres aux composants."""
        spacing = re.compile(r"^(?:gap|(?:row|column)-gap|margin(?:-|$)|padding(?:-|$))")
        size = re.compile(r"(?<![\w.])(?:\d+(?:\.\d+)?|\.\d+)(px|rem)\b")
        color = re.compile(r"#[0-9a-f]{3,8}\b|\b(?:rgb|hsl|oklch|oklab)\w*\s*\(", re.I)
        asset = re.compile(r"""url\((?:"[^"]*"|'[^']*'|[^)]*)\)""")
        for path in sorted(CSS.glob("*.css")):
            if path == TOKENS:
                continue
            with self.subTest(stylesheet=path.name):
                css = re.sub(r"/\*.*?\*/", "", path.read_text(), flags=re.S)
                invalid = []
                for name, value in DECLARATION.findall(css):
                    lengths = [
                        float(match[0][: -len(match[1])]) * (16 if match[1] == "rem" else 1)
                        for match in size.finditer(value)
                    ]
                    if (
                        (spacing.match(name) and any(4 <= n <= 32 for n in lengths))
                        or (name in ("font", "font-size") and lengths)
                        or (name.endswith("radius") and any(n > 0 for n in lengths))
                        or (name == "box-shadow" and LITERAL.search(value))
                        # Les dessins SVG servis dans une URL restent des illustrations.
                        or color.search(asset.sub("", value))
                    ):
                        invalid.append(f"{name}: {value.strip()}")
                self.assertEqual(invalid, [])

    def test_important_declarations_are_justified(self):
        """Les exceptions couvrent l’accessibilité et quelques collisions de cascade documentées."""
        allowed = {
            "imprimante.css": {
                # [hidden] et .control-hidden doivent l’emporter sur les règles de mise en page.
                ("display", "none"): 2,
                # La surface générique ne doit pas effacer le contour de la réinitialisation.
                (
                    "border-color",
                    "color-mix(in srgb, var(--atelier-error) 40%, var(--atelier-line))",
                ): 1,
                # Ces trois mesures gagnent contre les marges de composants génériques.
                ("margin", "var(--atelier-space-3) 0 var(--atelier-space-4)"): 1,
                ("margin", "0 0 var(--atelier-space-3)"): 1,
                ("margin-bottom", "0"): 1,
                # Les états interactifs et la vague mobile restent inertes en mouvement réduit.
                ("scroll-behavior", "auto"): 1,
                ("animation", "none"): 2,
                ("transition", "none"): 1,
            },
            # La marge de la case ne doit pas décaler la cible du geste de sélection.
            "interactions.css": {("margin", "0"): 1},
            "landing.css": {
                # Le pied passe sur sa propre ligne et annule les marges génériques en mobile.
                ("margin-top", "var(--atelier-space-2)"): 1,
                # La connexion et les documents ont leur propre règle de mouvement réduit.
                ("transition", "none"): 1,
                ("scroll-behavior", "auto"): 1,
            },
            # La vague de fermeture ne doit pas rejouer en mouvement réduit.
            "workshop-navigation.css": {("animation", "none"): 1},
        }
        for path in sorted(CSS.glob("*.css")):
            css = re.sub(r"/\*.*?\*/", "", path.read_text(), flags=re.S)
            with self.subTest(stylesheet=path.name):
                actual = Counter(
                    (name, re.sub(r"\s*!\s*important\s*$", "", value).strip())
                    for name, value in DECLARATION.findall(css)
                    if re.search(r"!\s*important\b", value)
                )
                self.assertEqual(actual - Counter(allowed.get(path.name, {})), {})

    def test_palette_text_has_sufficient_contrast(self):
        """Contrôle le texte courant, l’accent et les états sur les deux surfaces."""
        palettes = re.findall(r"(:root(?:\[data-style=.+?\])?)\s*\{([^{}]+)\}", TOKENS.read_text())
        for selector, declarations in palettes:
            roles = {
                name: (light, dark)
                for name, light, dark in re.findall(
                    r"--atelier-([a-z]+): light-dark\(#([0-9a-f]{6}), #([0-9a-f]{6})\);",
                    declarations,
                )
            }
            if not roles:
                continue
            for mode in (0, 1):
                for background in ("bg", "surface"):
                    for text in ("fg", "muted", "accent", "normal", "warning", "error"):
                        with self.subTest(
                            style=selector, mode=mode, background=background, text=text
                        ):
                            self.assertGreaterEqual(
                                contrast(roles[background][mode], roles[text][mode]), 4.5
                            )


def contrast(first, second):
    """Rapport de luminance relative de deux couleurs sRGB."""

    def luminance(color):
        channels = [int(color[index : index + 2], 16) / 255 for index in (0, 2, 4)]
        linear = [n / 12.92 if n <= 0.04045 else ((n + 0.055) / 1.055) ** 2.4 for n in channels]
        return sum(
            channel * weight
            for channel, weight in zip(linear, (0.2126, 0.7152, 0.0722), strict=True)
        )

    low, high = sorted((luminance(first), luminance(second)))
    return (high + 0.05) / (low + 0.05)
