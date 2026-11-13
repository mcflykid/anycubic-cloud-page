"""Vérifie le diagnostic expurgé et la cohérence du témoin hors matériel."""

import hashlib
import json
import re
import unittest
from pathlib import Path
from zipfile import ZipFile

from aiohttp.test_utils import TestClient, TestServer

from anycubic_cloud_api.data_models.gcode_file import AnycubicGcodeFile
from demo import create_demo
from developer_signals import mqtt_summary
from upload_formats import validate_cloud_model


class DeveloperToolsTests(unittest.IsolatedAsyncioTestCase):
    """Utilise les ressources publiques et la démonstration sans transport Cloud."""

    async def test_developer_query_only_exposes_the_fixture_on_explicit_request(self):
        """Le diagnostic classique garde son périmètre et le témoin ACE reste entièrement fictif."""
        async with TestClient(TestServer(create_demo())) as client:
            async with client.get("/imprimante-api/diagnostic") as response:
                self.assertNotIn("developer", await response.json())
            async with client.get("/imprimante-api/diagnostic?developer=1") as response:
                self.assertEqual(200, response.status)
                trace = (await response.json())["developer"]["last_stored_print"]
                self.assertEqual(trace["requested_slots"], [1])
                self.assertEqual(trace["serialized_mapping"], [{"ams_index": 0, "paint_index": 0}])
                self.assertFalse(set(trace) & {"name", "filename", "path", "filepath"})

    async def test_demo_states_use_the_real_rules_and_reset(self):
        """Chaque état fictif passe par les règles du serveur ; un nom inconnu est refusé."""
        expected = {
            "sechage-conseille": ("drying_advice", {"0": {"humidity": 48, "material": "PETG"}}),
            "humidite-absente": ("drying_advice", {}),
            "chauffe-lente": ("heat_alerts", [{"part": "bed", "target": 60, "actual": 52}]),
            "chute-en-impression": ("heat_alerts", [{"part": "nozzle", "target": 210}]),
        }
        async with TestClient(TestServer(create_demo())) as client:
            async with client.post(
                "/imprimante-api/demo/scenario", json={"name": "inconnu"}
            ) as response:
                self.assertEqual(400, response.status)
            for name, (key, value) in expected.items():
                await client.post("/imprimante-api/demo/scenario", json={"name": name})
                async with client.get("/imprimante-api/status") as response:
                    data = await response.json()
                if isinstance(value, dict):
                    for box, fields in value.items():
                        self.assertLessEqual(fields.items(), data[key][box].items())
                    self.assertEqual(bool(value), bool(data[key]))
                else:
                    self.assertEqual(len(value), len(data[key]))
                    self.assertLessEqual(value[0].items(), data[key][0].items())
            await client.post(
                "/imprimante-api/demo/scenario", json={"name": "mise-a-jour-obligatoire"}
            )
            async with client.get("/imprimante-api/status") as response:
                printer = (await response.json())["printer"]
            self.assertTrue(printer["firmware_update_available"])
            self.assertEqual(
                {"text": "", "required": True},
                {key: printer["firmware_notes"][key] for key in ("text", "required")},
            )
            await client.post("/imprimante-api/demo/reset", json={})
            async with client.get("/imprimante-api/status") as response:
                data = await response.json()
            self.assertNotIn("heat_alerts", data)
            self.assertFalse(data["printer"]["firmware_update_available"])

    def test_witness_has_consistent_formats_and_metadata(self):
        """Les octets téléchargés, la géométrie et les mesures tranchées ont une référence commune."""
        root = Path(__file__).resolve().parents[1] / "web" / "temoin"
        manifest = json.loads((root / "reference.json").read_text())
        for entry in manifest["files"]:
            path = root / entry["name"]
            self.assertEqual(entry["sha256"], hashlib.sha256(path.read_bytes()).hexdigest())
            if path.suffix in (".stl", ".3mf"):
                validate_cloud_model(path, path.suffix, path.stat().st_size)
        coords = re.findall(
            r"vertex (-?\d+) (-?\d+) (-?\d+)", (root / "piece-temoin.stl").read_text()
        )
        self.assertEqual(
            [max(map(int, axis)) - min(map(int, axis)) for axis in zip(*coords, strict=True)],
            manifest["dimensions_mm"],
        )
        with ZipFile(root / "piece-temoin.3mf") as project:
            self.assertFalse(any(name.endswith(".gcode") for name in project.namelist()))
        with ZipFile(root / "piece-temoin.gcode.3mf") as package:
            gcode = package.read("Metadata/plate_1.gcode")
            self.assertEqual(gcode, (root / "piece-temoin.gcode").read_bytes())
            self.assertIn(f"; total layers count = {manifest['layers']}".encode(), gcode)
            self.assertIn(f"; filament used [g] = {manifest['grams']}".encode(), gcode)
            for name in package.namelist():
                self.assertNotRegex(
                    package.read(name), rb"(?:/Users" + rb"/|/private/tmp/|file://)"
                )

    async def test_gcode_uses_real_monofilament_parser(self):
        """La référence fait passer la lecture scalaire par le même modèle que le transfert."""
        witness = Path(__file__).resolve().parents[1] / "web" / "temoin" / "piece-temoin.gcode"
        parsed = await AnycubicGcodeFile.async_read_from_file(file_bytes=witness.read_bytes())
        self.assertEqual(len(parsed.material_list), 1)
        self.assertEqual(parsed.material_list[0]["filament_used"], 1.17)
        self.assertEqual(parsed.material_list[0]["filament_used_mm"], 391.84)

    def test_mqtt_projection_keeps_zero_without_leaking_values(self):
        """Les rapports inconnus conservent un compteur sans clé privée."""
        result = mqtt_summary(
            {
                "type": "fan",
                "action": "query",
                "data": {
                    "fan_speed_pct": 0,
                    "aux_fan_speed_pct": 25,
                    "fake_private_field": "private fixture",
                },
            }
        )
        self.assertEqual(result["ventilateurs"], {"fan_speed_pct": 0, "aux_fan_speed_pct": 25})
        self.assertNotIn("private", json.dumps(result))
