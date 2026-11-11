"""Vérifie la persistance locale des températures sans moteur ni machine réelle."""

import asyncio
import csv
import json
import io
import time
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from temperature_history import TemperatureHistory


class TemperatureHistoryTests(unittest.IsolatedAsyncioTestCase):
    """L’écriture asynchrone garde l’event loop disponible et remplace le fichier atomiquement."""

    async def test_slow_save_runs_outside_event_loop(self):
        """Une écriture lente de fichier ne retarde pas les autres tâches asyncio."""
        with tempfile.TemporaryDirectory() as directory:
            history = TemperatureHistory(Path(directory) / "temperatures.json")
            history.add(100, {"nozzle": 20})
            entered = threading.Event()
            release = threading.Event()
            original = history._save_snapshot

            def slow_save(snapshot, generation=None):
                """Retarde l’écriture sur le fil pour vérifier la disponibilité de la boucle asynchrone."""
                entered.set()
                release.wait(2)
                original(snapshot, generation)

            with patch.object(history, "_save_snapshot", side_effect=slow_save):
                task = asyncio.create_task(history.save_async())
                self.assertTrue(await asyncio.to_thread(entered.wait, 1))
                self.assertEqual(await asyncio.wait_for(asyncio.sleep(0, result="ok"), 0.1), "ok")
                history.add(101, {"nozzle": 21})
                second = asyncio.create_task(history.save_async())
                await asyncio.sleep(0)
                release.set()
                await asyncio.gather(task, second)
            saved = json.loads((Path(directory) / "temperatures.json").read_text())
            self.assertEqual([row["nozzle"] for row in saved["raw"]], [20, 21])

    async def test_failed_replace_keeps_previous_file_readable(self):
        """Une erreur de remplacement conserve l’ancien historique complet."""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "temperatures.json"
            path.write_text('[{"time":1,"nozzle":18}]')
            history = TemperatureHistory(path)
            history.add(2, {"nozzle": 19})
            with patch.object(Path, "replace", side_effect=OSError("fixture")):
                with self.assertRaises(OSError):
                    await history.save_async()
            self.assertEqual(json.loads(path.read_text()), [{"time": 1, "nozzle": 18}])

    async def test_legacy_list_migrates_to_bounded_v2_with_rollups(self):
        """La migration conserve les relevés existants et les agrège sans inventer d’historique."""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "temperatures.json"
            stamp = time.time() - 3600
            path.write_text(
                json.dumps(
                    [
                        {"time": int(stamp), "nozzle": 0, "bed": None},
                        {"time": int(stamp) + 10, "nozzle": 20, "bed": None},
                    ]
                )
            )
            history = TemperatureHistory(path)
            self.assertEqual(len(history.rows), 2)
            await history.save_async()
            payload = json.loads(path.read_text())
            self.assertEqual(payload["version"], 2)
            self.assertEqual(len(payload["raw"]), 2)
            aggregate = payload["hourly"][0]
            self.assertEqual(aggregate["metrics"]["nozzle"]["average"], 10)
            self.assertEqual(aggregate["metrics"]["bed"]["count"], 0)

    async def test_long_windows_use_hourly_values_and_keep_missing_distinct(self):
        """Les agrégats horaires ignorent les mesures absentes, sans assimiler zéro à une lacune."""
        with tempfile.TemporaryDirectory() as directory:
            history = TemperatureHistory(Path(directory) / "temperatures.json")
            stamp = int(time.time()) - 3 * 3600
            self.assertTrue(history.add(stamp, {"nozzle": 0, "bed": None, "ace": None}))
            self.assertTrue(history.add(stamp + 10, {"nozzle": 20, "bed": 0, "ace": None}))
            rows = history.recent(48)
            self.assertEqual(history.resolution_seconds(48), 3600)
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["nozzle"], 10)
            self.assertEqual(rows[0]["bed"], 0)
            self.assertIsNone(rows[0]["ace"])

    async def test_v2_reload_does_not_count_raw_points_twice(self):
        """Le redémarrage relit les agrégats persistés sans les additionner aux points bruts."""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "temperatures.json"
            history = TemperatureHistory(path)
            stamp = int(time.time()) - 60
            history.add(stamp, {"nozzle": 20})
            history.add(stamp + 10, {"nozzle": 40})
            await history.save_async()
            restored = TemperatureHistory(path)
            self.assertEqual(restored.recent(48)[0]["nozzle"], 30)
            payload = json.loads(path.read_text())
            self.assertEqual(payload["hourly"][0]["metrics"]["nozzle"]["count"], 2)

    async def test_hourly_ace_averages_remain_isolated_by_box_and_slot(self):
        """Chaque boîte et emplacement conserve son propre compteur de valeurs disponibles."""
        with tempfile.TemporaryDirectory() as directory:
            history = TemperatureHistory(Path(directory) / "temperatures.json")
            stamp = int(time.time()) - 2 * 3600
            history.add(
                stamp,
                {"ace_boxes": {"0": {"humidity": 0, "slots": {"1": {"remaining": 0}}}}},
            )
            history.add(
                stamp + 10,
                {"ace_boxes": {"1": {"humidity": 40, "slots": {"2": {"remaining": 80}}}}},
            )
            row = history.recent(48)[0]
            self.assertEqual(row["ace_boxes"]["0"]["humidity"], 0)
            self.assertEqual(row["ace_boxes"]["0"]["slots"]["1"]["remaining"], 0)
            self.assertEqual(row["ace_boxes"]["1"]["humidity"], 40)
            self.assertEqual(row["ace_boxes"]["1"]["slots"]["2"]["remaining"], 80)

    async def test_csv_matches_displayed_rows_and_omits_private_identity(self):
        """L’export reflète la même fenêtre, les zéros et les absences sans identité de cible."""
        with tempfile.TemporaryDirectory() as directory:
            history = TemperatureHistory(Path(directory) / "temperatures.json")
            stamp = int(time.time()) - 60
            history.add(stamp, {"nozzle": 0, "bed": None, "source": "mqtt"})
            history.add(stamp + 10, {"nozzle": 210, "bed": 50, "source": "cloud"})
            lines = list(csv.reader(io.StringIO(history.export_csv(1))))
            self.assertEqual(len(lines), 3)
            self.assertIn("nozzle_c", lines[0])
            nozzle = lines[0].index("nozzle_c")
            bed = lines[0].index("bed_c")
            self.assertEqual([row[nozzle] for row in lines[1:]], ["0.0", "210.0"])
            self.assertEqual(lines[1][bed], "")
            self.assertEqual(lines[1][lines[0].index("source")], "mqtt")
            self.assertFalse(
                any("printer" in field.lower() or "path" in field.lower() for field in lines[0])
            )

    async def test_clear_erases_raw_and_aggregated_history(self):
        """L’effacement explicite retire les deux résolutions et leur fichier persistant."""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "temperatures.json"
            history = TemperatureHistory(path)
            history.add(int(time.time()) - 3600, {"nozzle": 42})
            history.save()
            history.clear()
            self.assertFalse(path.exists())
            self.assertEqual(len(history.rows), 0)
            self.assertEqual(history.recent(720), [])

    async def test_clear_during_slow_async_save_cannot_restore_erased_data(self):
        """Une sauvegarde déjà en cours ne peut pas recréer un fichier après l’effacement."""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "temperatures.json"
            history = TemperatureHistory(path)
            history.add(int(time.time()), {"nozzle": 42})
            entered = threading.Event()
            release = threading.Event()
            original = history._save_snapshot

            def slow_save(payload, generation=None):
                "Suspend la sauvegarde pour vérifier que l’effacement attend le même verrou."
                entered.set()
                release.wait(2)
                original(payload, generation)

            with patch.object(history, "_save_snapshot", side_effect=slow_save):
                task = asyncio.create_task(history.save_async())
                self.assertTrue(await asyncio.to_thread(entered.wait, 1))
                history.clear()
                release.set()
                await task
            self.assertFalse(path.exists())

    async def test_files_are_bounded_per_printer_and_expire_after_thirty_days(self):
        """La rétention et la limite de lignes empêchent une croissance sans borne par imprimante."""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "temperatures.json"
            history = TemperatureHistory(path)
            now = int(time.time())
            history.add(now - 31 * 86400, {"nozzle": 100})
            history.add(now - 30 * 86400 + 3600, {"nozzle": 0})
            for index in range(history.RAW_MAX_ROWS + 10):
                history.add(now - history.RAW_MAX_ROWS + index, {"nozzle": index % 250})
            await history.save_async()
            payload = json.loads(path.read_text())
            self.assertLessEqual(path.stat().st_size, history.MAX_STORAGE_BYTES)
            self.assertLessEqual(len(payload["raw"]), history.RAW_MAX_ROWS)
            self.assertLessEqual(len(payload["hourly"]), history.ROLLUP_MAX_HOURS)
            self.assertTrue(all(row["time"] >= now - 86400 for row in payload["raw"]))
