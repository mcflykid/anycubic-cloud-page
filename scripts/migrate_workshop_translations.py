"""Migre le catalogue positionnel vers des traductions nommées par langue."""

import json
from pathlib import Path


def main():
    """Convertit les anciennes entrées anglaises et espagnoles sans modifier leurs textes."""
    path = Path(__file__).resolve().parents[1] / "web/js/workshop-translations.json"
    entries = json.loads(path.read_text(encoding="utf-8"))
    converted = {
        source: dict(zip(("en", "es"), value, strict=True)) if isinstance(value, list) else value
        for source, value in entries.items()
    }
    path.write_text(json.dumps(converted, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
