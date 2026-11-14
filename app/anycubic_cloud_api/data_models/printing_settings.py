"""Réglages d’impression optionnels sérialisés pour le protocole constructeur."""
from __future__ import annotations


class AnycubicPrintingSettings:
    """Réglages optionnels d’une commande d’impression ; les valeurs absentes restent omises."""
    __slots__ = (
        "_print_speed_mode",
        "_target_nozzle_temp",
        "_target_hotbed_temp",
        "_fan_speed_pct",
        "_aux_fan_speed_pct",
        "_box_fan_level",
        "_bottom_layers",
        "_bottom_time",
        "_off_time",
        "_on_time",
    )

    def __init__(
        self,
        print_speed_mode: int | None = None,
        target_nozzle_temp: int | None = None,
        target_hotbed_temp: int | None = None,
        fan_speed_pct: int | None = None,
        aux_fan_speed_pct: int | None = None,
        box_fan_level: int | None = None,
        bottom_layers: int | None = None,
        bottom_time: float | int | None = None,
        off_time: float | int | None = None,
        on_time: float | int | None = None,
    ):
        """Initialise le modèle et ses données locales depuis les paramètres fournis."""
        self._print_speed_mode: int | None = int(print_speed_mode) if print_speed_mode is not None else None
        self._target_nozzle_temp: int | None = int(target_nozzle_temp) if target_nozzle_temp is not None else None
        self._target_hotbed_temp: int | None = int(target_hotbed_temp) if target_hotbed_temp is not None else None
        self._fan_speed_pct: int | None = int(fan_speed_pct) if fan_speed_pct is not None else None
        self._aux_fan_speed_pct: int | None = int(aux_fan_speed_pct) if aux_fan_speed_pct is not None else None
        self._box_fan_level: int | None = int(box_fan_level) if box_fan_level is not None else None
        self._bottom_layers: int | None = int(bottom_layers) if bottom_layers is not None else None
        self._bottom_time: float | None = float(bottom_time) if bottom_time is not None else None
        self._off_time: float | None = float(off_time) if off_time is not None else None
        self._on_time: float | None = float(on_time) if on_time is not None else None

    @property
    def print_speed_mode(self) -> int | None:
        """Code du mode de vitesse courant du projet."""
        return self._print_speed_mode

    @property
    def target_nozzle_temp(self) -> int | None:
        """Consigne de température de buse en degrés Celsius."""
        return self._target_nozzle_temp

    @property
    def target_hotbed_temp(self) -> int | None:
        """Consigne de température du plateau en degrés Celsius."""
        return self._target_hotbed_temp

    @property
    def fan_speed_pct(self) -> int | None:
        """Vitesse du ventilateur de pièce en pourcentage."""
        return self._fan_speed_pct

    @property
    def aux_fan_speed_pct(self) -> int | None:
        """Vitesse du ventilateur auxiliaire en pourcentage."""
        return self._aux_fan_speed_pct

    @property
    def box_fan_level(self) -> int | None:
        """Niveau du ventilateur de l’enceinte, distinct d’un pourcentage."""
        return self._box_fan_level

    @property
    def bottom_layers(self) -> int | None:
        """Nombre de couches de base demandé pour l’impression résine."""
        return self._bottom_layers

    @property
    def bottom_time(self) -> float | None:
        """Durée d’exposition des couches de base selon le protocole résine."""
        return self._bottom_time

    @property
    def off_time(self) -> float | None:
        """Délai sans exposition demandé pour l’impression résine."""
        return self._off_time

    @property
    def on_time(self) -> float | None:
        """Durée d’exposition demandée pour l’impression résine."""
        return self._on_time

    @property
    def settings_data(self) -> dict[str, int | float]:
        """Réglages non absents sérialisés pour la commande cloud."""
        print_settings: dict[str, int | float] = dict()
        if self._print_speed_mode is not None:
            print_settings['print_speed_mode'] = self._print_speed_mode

        if self._target_nozzle_temp is not None:
            print_settings['target_nozzle_temp'] = self._target_nozzle_temp

        if self._target_hotbed_temp is not None:
            print_settings['target_hotbed_temp'] = self._target_hotbed_temp

        if self._fan_speed_pct is not None:
            print_settings['fan_speed_pct'] = self._fan_speed_pct

        if self._aux_fan_speed_pct is not None:
            print_settings['aux_fan_speed_pct'] = self._aux_fan_speed_pct

        if self._box_fan_level is not None:
            print_settings['box_fan_level'] = self._box_fan_level

        if self._bottom_layers is not None:
            print_settings['bottom_layers'] = self._bottom_layers

        if self._bottom_time is not None:
            print_settings['bottom_time'] = self._bottom_time

        if self._off_time is not None:
            print_settings['off_time'] = self._off_time

        if self._on_time is not None:
            print_settings['on_time'] = self._on_time

        return print_settings

    def __repr__(self) -> str:
        """Renvoie une représentation de diagnostic du modèle ; peut contenir des données constructeur privées."""
        return (
            f"AnycubicPrintingSettings("
            f"print_speed_mode={self._print_speed_mode}, "
            f"target_nozzle_temp={self._target_nozzle_temp}, "
            f"target_hotbed_temp={self._target_hotbed_temp}, "
            f"fan_speed_pct={self._fan_speed_pct}, "
            f"aux_fan_speed_pct={self._aux_fan_speed_pct}, "
            f"box_fan_level={self._box_fan_level}, "
            f"bottom_layers={self._bottom_layers}, "
            f"bottom_time={self._bottom_time}, "
            f"off_time={self._off_time}, "
            f"on_time={self._on_time})"
        )
