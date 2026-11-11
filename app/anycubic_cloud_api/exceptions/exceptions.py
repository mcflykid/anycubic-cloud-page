"""Exceptions spécialisées du client Anycubic embarqué."""
from __future__ import annotations

from typing import Any


class AnycubicAPIError(Exception):
    """Erreur de base des échanges et commandes du client Anycubic."""
    pass


class AnycubicOrderRefused(AnycubicAPIError):
    """Identifie un refus codé sans exposer le texte brut de la réponse distante."""

    def __init__(self, code: str) -> None:
        """Conserve le code constructeur déjà validé par l’adaptateur HTTP."""
        self.code = code
        super().__init__("Ordre refusé par Anycubic.")


class AnycubicAuthTokensExpired(AnycubicAPIError):
    """Session cloud refusée à cause de jetons absents ou expirés."""
    pass


class AnycubicAPIParsingError(AnycubicAPIError):
    """Réponse HTTP ou stockage distant inexploitable par le client."""
    pass


class AnycubicCameraSessionError(AnycubicAPIParsingError):
    """Diagnostic caméra borné à des raisons connues, sans conserver la réponse ni ses secrets."""
    MESSAGES = {
        'missing_credentials': 'La réponse cloud ne contient pas les identifiants Agora nécessaires à la vidéo.',
        'invalid_format': 'Le cloud a renvoyé une session caméra de format invalide.',
        'unsupported_transport': 'Cette caméra utilise un transport vidéo non pris en charge par l’atelier (KVS).',
    }

    def __init__(self, reason: str) -> None:
        """Conserve seulement une raison autorisée ; une valeur inconnue devient un format invalide."""
        self.reason = reason if reason in self.MESSAGES else 'invalid_format'
        super().__init__(self.MESSAGES[self.reason])


class AnycubicFileNotFoundError(AnycubicAPIError):
    """Fichier demandé introuvable dans le stockage constructeur."""
    pass


class AnycubicPropertiesNotLoaded(AnycubicAPIError):
    """Propriétés nécessaires encore absentes du modèle local."""
    pass


class AnycubicInvalidValue(AnycubicAPIError):
    """Valeur de réglage incompatible avec les limites connues du projet."""
    pass


class AnycubicAuthError(AnycubicAPIError):
    """Authentification absente ou refusée par le protocole constructeur."""
    pass


class AnycubicMQTTClientError(AnycubicAPIError):
    """Configuration, certificat ou identité empêchant le client MQTT de fonctionner."""
    pass


class AnycubicCloudUploadError(AnycubicAPIError):
    """Échec de réservation ou d’enregistrement d’un transfert cloud."""
    pass


class AnycubicDataParsingError(AnycubicAPIError):
    """Données constructeur impossibles à convertir en modèle local."""
    pass


class AnycubicGcodeParsingError(AnycubicDataParsingError):
    """Métadonnées G-code absentes, incohérentes ou impossibles à décoder."""
    pass


class AnycubicMQTTUnknownUpdate(AnycubicDataParsingError):
    """Rapport MQTT dont le type, l’action ou l’état n’est pas reconnu."""
    pass


class AnycubicMQTTUnknownType(AnycubicMQTTUnknownUpdate):
    """Type de rapport inconnu, distinct d’une action inconnue d’un type déjà pris en charge."""
    pass


class AnycubicMQTTUnhandledData(AnycubicDataParsingError):
    """Rapport MQTT reconnu mais contenant des champs non consommés, joints à l’exception."""
    __slots__ = (
        "_unhandled_mqtt_data",
        "_unhandled_mqtt_type",
        "_unhandled_mqtt_action",
        "_unhandled_mqtt_state",
    )

    def __init__(
        self,
        *args: Any,
        unhandled_mqtt_data: dict[Any, Any] | None = None,
        unhandled_mqtt_type: str | None = None,
        unhandled_mqtt_action: str | None = None,
        unhandled_mqtt_state: str | None = None,
        **kwargs: Any,
    ):
        """Initialise le modèle et ses données locales depuis les paramètres fournis."""
        super().__init__(*args, **kwargs)
        self._unhandled_mqtt_data = unhandled_mqtt_data
        self._unhandled_mqtt_type = unhandled_mqtt_type
        self._unhandled_mqtt_action = unhandled_mqtt_action
        self._unhandled_mqtt_state = unhandled_mqtt_state

    @property
    def unhandled_mqtt_data(self) -> dict[Any, Any] | None:
        """Champs MQTT non consommés joints à l’exception de décodage."""
        return self._unhandled_mqtt_data

    @property
    def unhandled_mqtt_type(self) -> str | None:
        """Type du message MQTT que le modèle n’a pas pu interpréter."""
        return self._unhandled_mqtt_type

    @property
    def unhandled_mqtt_action(self) -> str | None:
        """Action du message MQTT que le modèle n’a pas pu interpréter."""
        return self._unhandled_mqtt_action

    @property
    def unhandled_mqtt_state(self) -> str | None:
        """État du message MQTT que le modèle n’a pas pu interpréter."""
        return self._unhandled_mqtt_state
