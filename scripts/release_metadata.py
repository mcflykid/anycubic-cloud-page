"""Valide un tag de livraison et extrait uniquement son entrée du changelog."""

import argparse
import json
import pathlib
import re
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
VERSION = r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)"


def release_metadata(tag, package, changelog):
    """Renvoie (version, notes) ; ValueError si le tag, le manifeste ou l’entrée sont incohérents."""
    if not re.fullmatch("v" + VERSION, tag) or package.get("version") != tag[1:]:
        raise ValueError("Le tag doit être vX.Y.Z et correspondre exactement à package.json.")
    version = tag[1:]
    sections = re.split(r"^## ", changelog, flags=re.MULTILINE)[1:]
    matches = [
        section
        for section in sections
        if re.fullmatch(re.escape(version) + r"(?: — [^\n]+)?", section.split("\n", 1)[0])
    ]
    if len(matches) != 1 or "\n" not in matches[0] or not matches[0].split("\n", 1)[1].strip():
        raise ValueError(
            "Le changelog doit contenir une entrée unique et non vide pour cette version."
        )
    return version, matches[0].split("\n", 1)[1].strip() + "\n"


def require_unpublished(version):
    """Refuse une image existante ; toute erreur réseau ou de registre bloque la publication."""
    repository = "mcflykid/anycubic-cloud-page"
    query = urllib.parse.urlencode(
        {"service": "ghcr.io", "scope": "repository:" + repository + ":pull"}
    )
    with urllib.request.urlopen("https://ghcr.io/token?" + query, timeout=30) as response:
        token = json.load(response)["token"]
    request = urllib.request.Request(
        "https://ghcr.io/v2/" + repository + "/manifests/" + version,
        headers={
            "Authorization": "Bearer " + token,
            "Accept": "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30):
            pass
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return
        raise RuntimeError(
            "Impossible de vérifier la disponibilité du numéro de version."
        ) from None
    raise ValueError("Cette version d’image existe déjà ; choisir un nouveau numéro.")


def main():
    """Écrit les notes et la sortie GitHub Actions ; renvoie 1 sans donnée sensible en cas de refus."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tag")
    parser.add_argument("--notes-file", type=pathlib.Path, required=True)
    parser.add_argument("--check-unpublished", action="store_true")
    args = parser.parse_args()
    try:
        version, notes = release_metadata(
            args.tag,
            json.loads((ROOT / "package.json").read_text()),
            (ROOT / "CHANGELOG.md").read_text(),
        )
        if args.check_unpublished:
            require_unpublished(version)
        args.notes_file.write_text(notes)
    except (ValueError, KeyError, OSError, RuntimeError):
        print(
            "Publication refusée : vérifier tag, version, changelog et disponibilité du registre."
        )
        return 1
    print("version=" + version)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
