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
            patch("container_entrypoint.configure_logging") as configure,
            patch("container_entrypoint.log_event"),
            patch("container_entrypoint.initialize") as initialize,
            patch("container_entrypoint.os.geteuid", return_value=0),
            patch("container_entrypoint.os.execvp") as execute,
        ):
            launch(["python", "/app/app/server.py"])
            configure.assert_called_once_with()
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
            patch("container_entrypoint.configure_logging"),
            patch("container_entrypoint.log_event"),
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
            patch("container_entrypoint.configure_logging"),
            patch("container_entrypoint.log_event"),
            patch("container_entrypoint.initialize") as initialize,
            patch("container_entrypoint.os.execvp") as execute,
        ):
            with self.assertRaises(ValueError):
                launch(["python", "/app/app/server.py"])
            initialize.assert_not_called()
            execute.assert_not_called()

    def test_startup_error_uses_static_message_and_exception_type(self):
        """Une erreur de préparation garde son type de diagnostic mais n’affiche jamais son message privé."""
        with (
            patch("container_entrypoint.launch", side_effect=RuntimeError("fixture-secret")),
            patch("container_entrypoint.log_event") as log,
        ):
            with self.assertRaises(SystemExit) as caught:
                from container_entrypoint import main

                main()
        self.assertNotIn("fixture-secret", str(caught.exception))
        self.assertIn("container_start_failed", str(log.call_args))
        self.assertIn("RuntimeError", str(log.call_args))
