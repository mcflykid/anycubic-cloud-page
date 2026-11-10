"""Catalogue de matières : filtrage strict et capacités de modification indépendantes."""

import unittest
from filament_catalog import recognized_material, editable_materials, material_warnings


class FilamentCatalogueTests(unittest.TestCase):
    """Les noms constructeur n’autorisent ni chaîne arbitraire ni commande non établie."""

    def test_known_variants_remain_visible_without_accepting_arbitrary_cloud_text(self):
        """Les variantes sont reconnues exactement, sans accepter un suffixe arbitraire."""
        for name in ("PLA+", "PET-CF", "PA6-CF", "PEBA", "PLA Galaxy", "PLA Translucent"):
            self.assertEqual(recognized_material(name), name)
        for name in ("PLA <script>", "PLA Anything", "secret-token", None, 12, "PAHT-CF"):
            self.assertIsNone(recognized_material(name))
        self.assertEqual(recognized_material("petg"), "PETG")
        self.assertEqual(recognized_material("PAHT-CF", "Anycubic Kobra S1 Max"), "PAHT-CF")

    def test_editable_values_keep_proven_command_vocabulary(self):
        """Le catalogue de profils ne suffit pas à établir une valeur de commande ACE."""
        self.assertIn("PACF", editable_materials())
        self.assertNotIn("PAHT-CF", editable_materials())
        self.assertNotIn("PEBA", editable_materials())

    def test_warnings_are_advisory_and_distinguish_missing_and_mixed_materials(self):
        """Les familles et couleurs connues permettent un avertissement avant confirmation."""
        spools = [
            {"material_type": "PLA", "color": [255, 0, 0]},
            {"material_type": "ABS", "color": [0, 0, 0]},
        ]
        self.assertIn("mixed-temperatures", material_warnings(["PLA", "ABS"], spools))
        self.assertIn("material-mismatch", material_warnings(["PETG"], spools[:1]))
        self.assertIn("color-mismatch", material_warnings(["PLA"], spools[:1], [[0, 0, 0]]))
        self.assertEqual(material_warnings(["PLA"], spools[:1], [[255, 0, 0]]), [])
        self.assertIn("metadata-missing", material_warnings([], spools))

    def test_max_specific_material_keeps_its_family_during_comparison(self):
        """La qualification du modèle reste appliquée lors de la comparaison des matières."""
        self.assertEqual(
            material_warnings(
                ["PAHT-CF"], [{"material_type": "PAHT-CF"}], model="Anycubic Kobra S1 Max"
            ),
            [],
        )
        self.assertIn(
            "metadata-missing",
            material_warnings(
                ["PAHT-CF"], [{"material_type": "PAHT-CF"}], model="Anycubic Kobra S1"
            ),
        )

    def test_max_specific_polyamide_warns_when_mixed_with_pla(self):
        """Le groupe thermique de la polyamide haute température reste connu sur son modèle."""
        self.assertIn(
            "mixed-temperatures",
            material_warnings(
                ["PLA"], [{"material_type": "PAHT-CF"}], model="Anycubic Kobra S1 Max"
            ),
        )
