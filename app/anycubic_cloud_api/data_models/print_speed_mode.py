"""Modes de vitesse annoncés par les projets Anycubic."""
from __future__ import annotations

from typing import Any


class AnycubicPrintSpeedMode:
    """Code et libellé d’un mode de vitesse proposé par le constructeur."""
    __slots__ = (
        "_title",
        "_mode",
    )

    def __init__(
        self,
        title: str,
        mode: int,
    ) -> None:
        """Initialise le modèle et ses données locales depuis les paramètres fournis."""
        self._title = str(title)
        self._mode = int(mode)

    @classmethod
    def from_json(cls, data: dict[str, Any] | None) -> AnycubicPrintSpeedMode | None:
        """Construit AnycubicPrintSpeedMode depuis data ; renvoie None si data vaut None, lève KeyError si un champ requis manque."""
        if data is None:
            return None

        return cls(
            title=data['title'],
            mode=data['print_speed_mode'],
        )

    @property
    def title(self) -> str:
        """Libellé du mode ou de l’objet destiné à l’affichage."""
        return self._title

    @property
    def mode(self) -> int:
        """Code constructeur du mode de vitesse."""
        return self._mode

    @property
    def data_object(self) -> dict[str, str | int]:
        """Représentation sérialisée des champs du modèle."""
        return {
            "description": self._title,
            "mode": self._mode,
        }

    def __repr__(self) -> str:
        """Renvoie une représentation de diagnostic du modèle ; peut contenir des données constructeur privées."""
        return (
            f"AnycubicPrintSpeedMode("
            f"title={self._title}, "
            f"mode={self._mode})"
        )

    def __eq__(self, other: object) -> bool:
        """Compare les composantes RGB pour reconnaître des couleurs de bobines équivalentes."""
        if isinstance(other, AnycubicPrintSpeedMode):
            return self.mode == other.mode
        else:
            try:
                return bool(self.mode == int(other))  # type: ignore[call-overload]
            except Exception:
                pass

        return False
