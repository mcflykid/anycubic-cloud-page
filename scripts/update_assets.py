"""Contrôle les ressources web préparées au démarrage par l’application."""

import argparse
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "app"))

from web_assets import build_web_assets  # noqa: E402


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Valide les ressources sans écrire.")
    parser.parse_args()
    pages, scripts, _, _ = build_web_assets(ROOT / "web")
    print(f"Ressources contrôlées : {len(pages)} pages et {len(scripts)} scripts.")
