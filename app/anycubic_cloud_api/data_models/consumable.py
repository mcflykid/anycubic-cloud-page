"""Suivi des champs consommés lors du décodage des messages MQTT."""
from __future__ import annotations

from collections import UserDict
from typing import Any


class AnycubicConsumableData(UserDict[Any, Any]):
    """Dictionnaire suivant les champs MQTT déjà lus pour détecter les données non prises en charge."""
    __slots__ = (
        "data",
        "_consumed_data",
    )

    def __init__(
        self,
        *args: Any,
        **kwargs: Any,
    ) -> None:
        """Initialise le modèle et ses données locales depuis les paramètres fournis."""
        super().__init__(*args, **kwargs)
        self.data: dict[Any, Any] = self._encode_items()
        self._consumed_data: dict[Any, Any] = dict()

    @property
    def is_empty(self) -> bool:
        """Indique si tous les champs suivis ont été consommés."""
        return len(self.data) == 0

    @property
    def remaining_data(self) -> dict[Any, Any]:
        """Champs du message MQTT qui n’ont pas encore été consommés."""
        return self.data

    def force_empty(self) -> None:
        """Marque tous les champs restants comme consommés pour tolérer un rapport volontairement ignoré."""
        for key in list(self.data.keys()):
            self._consumed_data[key] = self.data.pop(key)

    def _encode_list(
        self,
        data: list[Any],
    ) -> list[None | str | int | float | bool | AnycubicConsumableData | list[Any]]:
        new_data: list[Any] = list()
        for v in data:
            if isinstance(v, AnycubicConsumableData):
                new_data.append(v)
            elif isinstance(v, dict):
                new_data.append(AnycubicConsumableData(v))
            elif isinstance(v, list):
                new_data.append(self._encode_list(v))
            elif (
                isinstance(v, str) or
                isinstance(v, int) or
                isinstance(v, float) or
                isinstance(v, bool) or
                v is None
            ):
                new_data.append(v)
            else:
                raise TypeError(
                    f"Invalid type for AnycubicConsumableData: {type(v)}"
                )

        return new_data

    def _encode_items(
        self,
    ) -> dict[Any, None | str | int | float | bool | AnycubicConsumableData | list[Any]]:
        new_data: dict[Any, Any] = dict()
        for k, v in self.data.items():
            if isinstance(v, AnycubicConsumableData):
                new_data[k] = v
            elif isinstance(v, dict):
                new_data[k] = AnycubicConsumableData(v)
            elif isinstance(v, list):
                new_data[k] = self._encode_list(v)
            elif (
                isinstance(v, str) or
                isinstance(v, int) or
                isinstance(v, float) or
                isinstance(v, bool) or
                v is None
            ):
                new_data[k] = v
            else:
                raise TypeError(
                    f"Invalid type for AnycubicConsumableData: {type(v)}"
                )

        return new_data

    def __getitem__(
        self,
        key: Any,
    ) -> Any:
        """Renvoie et consomme le champ key tout en permettant sa relecture ; lève KeyError si le champ est absent."""
        try:
            return self._consumed_data[key]
        except KeyError:
            pass

        try:
            value = self.data[key]
            if (
                not isinstance(value, AnycubicConsumableData) or
                value.is_empty
            ):
                self._consumed_data[key] = self.data.pop(key)
        except KeyError:
            raise

        return value

    def get(
        self,
        key: Any,
        default: Any = None,
    ) -> Any:
        """Lit et consomme le champ key ; renvoie default si absent, sans rendre les relectures impossibles."""
        try:
            return self[key]
        except KeyError:
            return default
