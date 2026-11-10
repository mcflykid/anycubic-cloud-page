"""Vérifie la persistance locale des températures sans moteur ni machine réelle."""

import asyncio
import json
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

            def slow_save(snapshot):
                """Retarde l’écriture sur le fil pour vérifier la disponibilité de la boucle asynchrone."""
                entered.set()
                release.wait(2)
                original(snapshot)

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
            self.assertEqual([row["nozzle"] for row in saved], [20, 21])

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
            self.assertEqual(json.loads(path.read_text())[0]["time"], 1)
