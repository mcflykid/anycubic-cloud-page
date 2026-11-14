"""Vérifie la lecture des quantités écrites par le trancheur avant le transfert."""

import unittest

from anycubic_cloud_api.data_models.gcode_file import AnycubicGcodeFile


class GcodeQuantitiesTests(unittest.IsolatedAsyncioTestCase):
    """Un G-code monofilament utilise des scalaires dans ses commentaires."""

    async def test_single_filament_metadata_is_available_for_ace_mapping(self):
        """Le transfert ACE doit pouvoir lire les trois quantités d’un G-code monofilament."""
        parsed = await AnycubicGcodeFile.async_read_from_file(
            file_bytes=(
                b"; filament used [mm] = 100.5\n"
                b"; filament used [cm3] = 0.25\n"
                b"; filament used [g] = 0.31\n"
                b'; paint_info = [{"material_type":"PLA","paint_color":[0,0,0],"paint_index":0}]\n'
            )
        )
        material = parsed.material_list[0]
        self.assertEqual(material["filament_used"], 0.31)
        self.assertEqual(material["filament_used_mm"], 100.5)
        self.assertEqual(material["filament_used_cm3"], 0.25)
