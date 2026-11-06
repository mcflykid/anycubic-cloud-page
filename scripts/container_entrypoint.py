"""Initialise appdata puis remplace le processus par le serveur sans privilèges root."""

import os, sys, time
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from container_setup import initialize, identity


def launch(arguments=None):
    """Prépare la configuration puis exécute la commande ; ValueError/OSError si le démarrage sûr est impossible."""
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
    except ValueError as error:
        raise SystemExit(str(error)) from None
    except Exception:
        raise SystemExit(
            "Préparation impossible : vérifiez la configuration, les permissions et l’accès réseau."
        ) from None


if __name__ == "__main__":
    main()
