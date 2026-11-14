"""Types des méthodes HTTP et des points d’accès constructeur."""
from __future__ import annotations

from enum import Enum


class HTTP_METHODS(Enum):
    """Méthodes HTTP reconnues par le transport cloud."""
    GET = 1
    POST = 2
    PUT = 3


class AnycubicAPIEndpoint:
    """Méthode et chemin relatifs d’un appel au cloud constructeur."""
    __slots__ = ("_method", "_endpoint")

    def __init__(
        self,
        method: HTTP_METHODS,
        endpoint: str,
    ) -> None:
        """Initialise le modèle et ses données locales depuis les paramètres fournis."""
        self._method: HTTP_METHODS = method
        self._endpoint: str = endpoint

    @property
    def method(self) -> HTTP_METHODS:
        """Méthode HTTP du point d’accès."""
        return self._method

    @property
    def endpoint(self) -> str:
        """Chemin relatif du point d’accès HTTP."""
        return self._endpoint
