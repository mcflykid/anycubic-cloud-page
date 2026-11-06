"""Tests de l’abandon des privilèges, sans exécuter setpriv ni démarrer un serveur réel."""

import os, unittest
from unittest.mock import patch
from container_entrypoint import launch


class Entrypoint(unittest.TestCase):
    """Le processus serveur reçoit une identité non-root sans copier les secrets dans son environnement."""

    def test_root_uses_setpriv_and_exec(self):
        """Le démarrage root prépare les fichiers puis remplace PID 1 avec les groupes supplémentaires supprimés."""
        with (
            patch.dict(
                os.environ,
                {
                    "PUID": "1201",
                    "PGID": "1301",
                    "WEB_PASSWORD": "fixture-secret",
                    "ANYCUBIC_PASSWORD": "fixture-secret",
                },
                clear=True,
            ),
            patch("container_entrypoint.initialize") as initialize,
            patch("container_entrypoint.os.geteuid", return_value=0),
            patch("container_entrypoint.os.execvp") as execute,
        ):
            launch(["python", "/app/app/server.py"])
            initialize.assert_called_once_with(appdata_dir="/appdata")
            execute.assert_called_once_with(
                "setpriv",
                [
                    "setpriv",
                    "--reuid=1201",
                    "--regid=1301",
                    "--clear-groups",
                    "--no-new-privs",
                    "python",
                    "/app/app/server.py",
                ],
            )
            self.assertNotIn("WEB_PASSWORD", os.environ)
            self.assertNotIn("ANYCUBIC_PASSWORD", os.environ)

    def test_non_root_preserves_direct_identity(self):
        """Un conteneur déjà non-root ne tente ni setpriv ni changement de son identité imposée."""
        with (
            patch.dict(os.environ, {}, clear=True),
            patch("container_entrypoint.initialize"),
            patch("container_entrypoint.os.geteuid", return_value=1201),
            patch("container_entrypoint.os.execvp") as execute,
        ):
            launch(["python", "/app/app/server.py"])
            execute.assert_called_once_with("python", ["python", "/app/app/server.py"])

    def test_root_target_is_rejected_before_preparation(self):
        """PUID zéro est refusé avant toute écriture et avant l’exécution du serveur."""
        with (
            patch.dict(os.environ, {"PUID": "0"}, clear=True),
            patch("container_entrypoint.initialize") as initialize,
            patch("container_entrypoint.os.execvp") as execute,
        ):
            with self.assertRaises(ValueError):
                launch(["python", "/app/app/server.py"])
            initialize.assert_not_called()
            execute.assert_not_called()
