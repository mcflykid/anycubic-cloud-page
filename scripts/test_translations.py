"""Vérifie que les libellés statiques de l’atelier et de la connexion ont deux traductions."""

from html.parser import HTMLParser
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1] / "web"
ATTRIBUTES = {"title", "aria-label", "placeholder", "data-confirm", "alt"}
INVARIANT = {
    "Anycubic Cloud Page",
    "Anycubic Kobra S1",
    "GPL-3.0-or-later",
    "#B1B3B3",
    "English",
    "Español",
    "Français",
    "1 mm",
    "15 mm",
    "50 mm",
    "ABS",
    "ASA",
    "HIPS",
    "PA",
    "PACF",
    "PC",
    "PETG",
    "PLA",
    "PLA SE",
    "X +",
    "X −",
    "Y +",
    "Y −",
    "Z +",
    "Z −",
}


class VisibleLabels(HTMLParser):
    """Collecte les textes d’interface sans traiter les valeurs des formulaires comme des labels."""

    def __init__(self):
        """Initialise un ensemble de libellés propre à chaque page."""
        super().__init__()
        self.labels = set()

    def handle_data(self, data):
        """Ignore les espaces et symboles qui ne nécessitent aucune traduction."""
        label = data.strip()
        if any(character.isalpha() for character in label):
            self.labels.add(label)

    def handle_starttag(self, tag, attrs):
        """Inclut les libellés accessibles, infobulles et confirmations statiques."""
        self.labels.update(value.strip() for key, value in attrs if key in ATTRIBUTES and value)


class TranslationTests(unittest.TestCase):
    """Protège la couverture des pages lors de l’ajout de nouveaux libellés."""

    def test_static_pages_have_english_and_spanish_labels(self):
        """Échoue si une page contient un texte manquant dans le catalogue."""
        catalogue = json.loads((ROOT / "js/workshop-translations.json").read_text())
        for key, pair in catalogue.items():
            self.assertEqual(len(pair), 2, key)
            self.assertTrue(all(isinstance(value, str) and value.strip() for value in pair), key)
        for page in sorted(ROOT.glob("*.html")):
            with self.subTest(page=page.name):
                parser = VisibleLabels()
                parser.feed(page.read_text())
                self.assertEqual(parser.labels - catalogue.keys() - INVARIANT, set())
