#!/usr/bin/env python3
"""Lecture locale d’un jeton d’accès non expiré dans les journaux du slicer, sans l’afficher."""

import argparse, base64, json, os, pathlib, re, sys, time
from prepare_vendor import appdata_path, private_write

PATTERN = re.compile(
    r"(?:accessToken\s*=\s*|id_token=)(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)"
)


def default_logs():
    """Renvoie le dossier habituel des journaux du slicer selon le système, sans vérifier son existence."""
    if sys.platform == "darwin":
        return pathlib.Path.home() / "Library/Application Support/AnycubicSlicerNext/log"
    if sys.platform == "win32":
        return (
            pathlib.Path(os.environ.get("APPDATA", pathlib.Path.home())) / "AnycubicSlicerNext/log"
        )
    return pathlib.Path.home() / ".config/AnycubicSlicerNext/log"


def expires(token):
    """Renvoie l’expiration déclarée d’un jeton d’accès reconnu, sans vérifier sa signature."""
    try:
        claims = json.loads(base64.urlsafe_b64decode(token.split(".")[1] + "==="))
        if (
            claims.get("iss") == "https://uc.makeronline.com"
            and claims.get("tokenType") == "access-token"
        ):
            return float(claims.get("exp", 0))
    except (ValueError, TypeError, AttributeError, IndexError):
        pass
    return 0


def scan_log(path, minimum):
    """Renvoie le dernier jeton valide trouvé en lisant des fenêtres bornées."""
    result = None
    tail = ""
    overlap = 16 * 1024
    with path.open(errors="ignore") as log:
        while True:
            chunk = log.read(64 * 1024)
            window = tail + chunk
            limit = max(0, len(window) - overlap) if chunk else len(window)
            for match in PATTERN.finditer(window):
                if match.start() >= limit:
                    break
                token = match[1]
                if (
                    len(token) <= 8192
                    and (not chunk or match.end() < len(window))
                    and expires(token) > minimum
                ):
                    result = token
            if not chunk:
                return result
            # Les jetons courts et leur préfixe restent lisibles même à la frontière de deux blocs.
            tail = window[limit:]


def extract(directory=None, cache=None):
    """Renvoie le jeton valide du journal le plus récent ; cache évite les relectures inutiles."""
    directory = pathlib.Path(directory or default_logs())
    if not directory.is_dir():
        raise ValueError("Journaux introuvables. Indiquez leur dossier avec --log-dir.")
    cache = {} if cache is None else cache
    files = {path: path.stat() for path in directory.iterdir() if path.is_file()}
    for path in cache.keys() - files.keys():
        del cache[path]
    minimum = time.time() + 300
    for path, stat in sorted(files.items(), key=lambda item: item[1].st_mtime, reverse=True):
        identity = (stat.st_ino, stat.st_size, stat.st_mtime_ns)
        previous, token = cache.get(path, (None, None))
        if previous != identity or (token and expires(token) <= minimum):
            token = scan_log(path, minimum)
            cache[path] = (identity, token)
        if token:
            return token
    raise ValueError(
        "Aucun token d’accès encore valide trouvé. Reconnectez-vous dans le slicer ou utilisez la connexion directe au compte."
    )


def main():
    """Écrit le jeton dans le fichier privé choisi ; --watch recommence toutes les trente secondes, sinon lève SystemExit en cas d’échec."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--log-dir", type=pathlib.Path)
    parser.add_argument(
        "--output", type=pathlib.Path, default=appdata_path() / "private/anycubic-token"
    )
    parser.add_argument("--watch", action="store_true")
    args = parser.parse_args()
    previous = None
    cache = {}
    while True:
        try:
            token = extract(args.log_dir, cache)
            if token != previous:
                private_write(args.output, token.encode())
                previous = token
                print("Token récupéré localement (valeur non affichée).", flush=True)
        except (ValueError, OSError) as error:
            if not args.watch:
                raise SystemExit(str(error))
            if previous is None:
                print("En attente d’un token valide dans les journaux du slicer.", flush=True)
                previous = "waiting"
        if not args.watch:
            break
        time.sleep(30)


if __name__ == "__main__":
    main()
