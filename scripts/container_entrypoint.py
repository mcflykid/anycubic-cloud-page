"""Initialise appdata puis remplace le processus par le serveur sans privilèges root."""

import logging
import os, pathlib, sys, time
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

APP_DIRECTORY = str(pathlib.Path(__file__).resolve().parents[1] / "app")
if APP_DIRECTORY not in sys.path:
    sys.path.insert(0, APP_DIRECTORY)

from operational_logging import (
    LoggingConfigurationError,
    configure_logging,
    log_event,
    safe_exception_frames,
)
from container_setup import initialize, identity

_log = logging.getLogger("cloud_page.bootstrap")


def launch(arguments=None):
    """Prépare la configuration puis exécute la commande ; ValueError/OSError si le démarrage sûr est impossible."""
    configure_logging()
    log_event(
        _log,
        logging.INFO,
        "container_starting",
        message="Initialisation du conteneur avant le démarrage sans privilèges root",
    )
    command = list(sys.argv[1:] if arguments is None else arguments)
    if not command:
        raise ValueError("Aucune commande serveur fournie.")
    uid, gid = identity(os.environ)
    zone = os.environ.setdefault("TZ", "Europe/Paris")
    try:
        ZoneInfo(zone)
    except (ValueError, ZoneInfoNotFoundError):
        raise ValueError("TZ doit être un fuseau IANA valide.") from None
    if hasattr(time, "tzset"):
        time.tzset()
    initialize(appdata_dir="/appdata")
    # Le serveur n’a plus besoin des copies des secrets dans son environnement de processus.
    for name in ["ANYCUBIC_PASSWORD", "WEB_PASSWORD", "ANYCUBIC_TOKEN"]:
        os.environ.pop(name, None)
    if os.geteuid() == 0:
        # clear-groups fonctionne aussi pour un PUID absent de /etc/passwd ; exec conserve les signaux de PID 1.
        command = [
            "setpriv",
            "--reuid=" + str(uid),
            "--regid=" + str(gid),
            "--clear-groups",
            "--no-new-privs",
            *command,
        ]
    os.execvp(command[0], command)


def main():
    """Démarre ou échoue sans révéler les secrets présents dans une exception système ou réseau."""
    try:
        launch()
    except LoggingConfigurationError as error:
        # Le formatteur ne peut pas démarrer ; ce message fixe n’inclut aucune valeur saisie.
        raise SystemExit(str(error)) from None
    except Exception as error:
        log_event(
            _log,
            logging.ERROR,
            "container_start_failed",
            message="Préparation bloquée; vérifiez les identifiants de configuration, les permissions et l’accès réseau",
            error_type=type(error).__name__,
            frames=safe_exception_frames(error),
        )
        raise SystemExit("Préparation impossible; consultez les événements du conteneur.") from None


if __name__ == "__main__":
    main()
