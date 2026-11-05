"""Charges utiles des commandes et des sessions caméra Anycubic."""
from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .printer_properties import AnycubicMaterialMapping


class AnycubicBaseOrderRequest:
    """Enveloppe minimale d’une commande cloud destinée à une imprimante."""
    __slots__ = (
        "_order_id",
        "_printer_id",
    )

    def __init__(
        self,
        order_id: int | None = None,
        printer_id: int | None = None,
    ) -> None:
        """Initialise le modèle et ses données locales depuis les paramètres fournis. Lève Exception si les paramètres sont incompatibles."""
        if order_id is None:
            raise Exception("AnycubicBaseOrderRequest missing order_id")

        if printer_id is None:
            raise Exception("AnycubicBaseOrderRequest missing printer_id")

        self._order_id: int = int(order_id)
        self._printer_id: int = int(printer_id)

    @property
    def order_request_data(self) -> dict[str, Any]:
        """Charge utile sérialisée à transmettre au point d’accès des commandes."""
        return {
            'order_id': self._order_id,
            'printer_id': self._printer_id,
        }

    def __repr__(self) -> str:
        """Renvoie une représentation de diagnostic du modèle ; peut contenir des données constructeur privées."""
        return (
            f"AnycubicBaseOrderRequest("
            f"order_id={self._order_id}, "
            f"printer_id={self._printer_id})"
        )


class AnycubicBaseProjectOrderRequest(AnycubicBaseOrderRequest):
    """Commande cloud associant imprimante et projet sans données supplémentaires."""
    __slots__ = (
        "_project_id",
    )

    def __init__(
        self,
        project_id: int,
        **kwargs: Any,
    ) -> None:
        """Initialise le modèle et ses données locales depuis les paramètres fournis."""
        super().__init__(**kwargs)
        self._project_id = int(project_id)

    @property
    def order_request_data(self) -> dict[str, Any]:
        """Charge utile sérialisée à transmettre au point d’accès des commandes."""
        return {
            **super().order_request_data,
            'project_id': self._project_id,
        }

    def __repr__(self) -> str:
        """Renvoie une représentation de diagnostic du modèle ; peut contenir des données constructeur privées."""
        return (
            f"AnycubicBaseProjectOrderRequest("
            f"order_id={self._order_id}, "
            f"printer_id={self._printer_id}, "
            f"project_id={self._project_id})"
        )


class AnycubicProjectOrderRequest(AnycubicBaseProjectOrderRequest):
    """Commande de projet avec données supplémentaires au format constructeur."""
    __slots__ = (
        "_order_data",
    )

    def __init__(
        self,
        order_data: dict[str, Any] = {},
        **kwargs: Any,
    ) -> None:
        """Initialise le modèle et ses données locales depuis les paramètres fournis."""
        super().__init__(**kwargs)
        self._order_data = order_data

    @property
    def order_request_data(self) -> dict[str, Any]:
        """Charge utile sérialisée à transmettre au point d’accès des commandes."""
        return {
            **super().order_request_data,
            'data': self._order_data,
        }

    def __repr__(self) -> str:
        """Renvoie une représentation de diagnostic du modèle ; peut contenir des données constructeur privées."""
        return (
            f"AnycubicProjectOrderRequest("
            f"order_id={self._order_id}, "
            f"printer_id={self._printer_id}, "
            f"project_id={self._project_id}, "
            f"order_data={self._order_data})"
        )


class AnycubicProjectCtrlOrderRequest(AnycubicProjectOrderRequest):
    """Commande de contrôle d’un projet d’impression déjà connu du cloud."""
    __slots__ = (
        "_ams_info",
        "_print_settings",
    )

    def __init__(
        self,
        ams_box_mapping: list[AnycubicMaterialMapping] | None = None,
        print_settings: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> None:
        """Initialise le modèle et ses données locales depuis les paramètres fournis."""
        super().__init__(**kwargs)
        self._ams_info: dict[str, Any] | None = None
        self._set_ams_info(ams_box_mapping)
        self._print_settings: dict[str, Any] | None = print_settings

    def _set_ams_info(self, ams_box_mapping: list[AnycubicMaterialMapping] | None) -> None:
        if ams_box_mapping:
            self._ams_info = {
                'ams_box_mapping': [
                    x.as_box_mapping_data()
                    for x in ams_box_mapping
                ],
                'use_ams': (
                    True
                    if len(ams_box_mapping) > 0 else
                    False
                ),
            }
        else:
            self._ams_info = None

    @property
    def order_request_data(self) -> dict[str, Any]:
        """Charge utile sérialisée à transmettre au point d’accès des commandes."""
        return {
            **super().order_request_data,
            'ams_info': self._ams_info,
            'settings': self._print_settings,
        }

    def __repr__(self) -> str:
        """Renvoie une représentation de diagnostic du modèle ; peut contenir des données constructeur privées."""
        return (
            f"AnycubicProjectCtrlOrderRequest("
            f"order_id={self._order_id}, "
            f"printer_id={self._printer_id}, "
            f"project_id={self._project_id}, "
            f"order_data={self._order_data}, "
            f"ams_info={self._ams_info}, "
            f"print_settings={self._print_settings})"
        )


class AnycubicBaseStartPrintRequest:
    """Paramètres communs d’une demande de démarrage d’impression."""
    __slots__ = (
        "_file_key",
        "_file_name",
        "_filetype",
        "_task_setting_ai_detect",
        "_task_setting_camera_timelapse",
    )

    def __init__(
        self,
        file_key: str = "",
        file_name: str = "",
        filetype: int = 0,
        task_setting_ai_detect: int = 0,
        task_setting_camera_timelapse: int = 0,
    ) -> None:
        """Initialise le modèle et ses données locales depuis les paramètres fournis."""
        self._file_key = file_key
        self._file_name = file_name
        self._filetype = filetype
        self._task_setting_ai_detect = task_setting_ai_detect
        self._task_setting_camera_timelapse = task_setting_camera_timelapse

    @property
    def task_settings(self) -> dict[str, Any]:
        """Paramètres de tranche et réglages courants réunis pour le projet."""
        return {
            'ai_detect': self._task_setting_ai_detect,
            'camera_timelapse': self._task_setting_camera_timelapse,
        }

    @property
    def data(self) -> dict[str, Any]:
        """Charge utile constructeur associée à ce modèle."""
        return {
            'filetype': self._filetype,
            'file_key': self._file_key,
            'file_name': self._file_name,
            'task_settings': self.task_settings,
        }

    def __repr__(self) -> str:
        """Renvoie une représentation de diagnostic du modèle ; peut contenir des données constructeur privées."""
        return (
            f"AnycubicBaseStartPrintRequest("
            f"filetype={self._filetype}, "
            f"file_name={self._file_name}, "
            f"task_settings={self.task_settings})"
        )


class AnycubicStartPrintRequestLocal(AnycubicBaseStartPrintRequest):
    """Référence d’un fichier interne à imprimer selon le protocole constructeur."""
    __slots__ = (
        "_filename",
        "_filepath",
    )

    def __init__(
        self,
        filename: str = "",
        filepath: str = "",
        **kwargs: Any,
    ) -> None:
        """Initialise le modèle et ses données locales depuis les paramètres fournis."""
        super().__init__(**kwargs)
        self._filename = filename
        self._filepath = filepath
        self._filetype = 1

    @property
    def filepath(self) -> str:
        """Chemin de fichier conservé dans le modèle."""
        cleaned_path = str(self._filepath or "").replace("\\", "/").strip("/")
        return f"/{cleaned_path}" if cleaned_path else "/"

    @property
    def data(self) -> dict[str, Any]:
        """Charge utile constructeur associée à ce modèle."""
        return {
            **super().data,
            'filename': self._filename,
            'filepath': self.filepath,
        }

    def __repr__(self) -> str:
        """Renvoie une représentation de diagnostic du modèle ; peut contenir des données constructeur privées."""
        return (
            f"AnycubicStartPrintRequestLocal("
            f"filetype={self._filetype}, "
            f"filename={self._filename}, "
            f"filepath={self._filepath}, "
            f"task_settings={self.task_settings})"
        )


class AnycubicStartPrintRequestUdisk(AnycubicStartPrintRequestLocal):
    """Référence d’un fichier USB à imprimer selon le protocole constructeur."""
    def __init__(
        self,
        **kwargs: Any,
    ) -> None:
        """Initialise le modèle et ses données locales depuis les paramètres fournis."""
        super().__init__(**kwargs)
        self._filetype = 2

    def __repr__(self) -> str:
        """Renvoie une représentation de diagnostic du modèle ; peut contenir des données constructeur privées."""
        return (
            f"AnycubicStartPrintRequestUdisk("
            f"filetype={self._filetype}, "
            f"filename={self._filename}, "
            f"filepath={self._filepath}, "
            f"task_settings={self.task_settings})"
        )


class AnycubicStartPrintRequestCloud(AnycubicBaseStartPrintRequest):
    """Référence d’un fichier cloud à imprimer, avec suppression éventuelle après usage."""
    __slots__ = (
        "_file_id",
        "_hollow_param",
        "_is_delete_file",
        "_matrix",
        "_project_type",
        "_punching_param",
        "_slice_param",
        "_slice_size",
        "_template_id",
    )

    def __init__(
        self,
        file_id: int = -1,
        hollow_param: Any = None,
        is_delete_file: int = 0,
        matrix: str = "",
        project_type: int = 1,
        punching_param: Any = None,
        slice_param: dict[str, Any] | None = None,
        slice_size: Any = None,
        template_id: int = 0,
        **kwargs: Any,
    ) -> None:
        """Initialise le modèle et ses données locales depuis les paramètres fournis."""
        super().__init__(**kwargs)
        self._file_id = file_id
        self._hollow_param = hollow_param
        self._is_delete_file = int(is_delete_file)
        self._matrix = matrix
        self._project_type = project_type
        self._punching_param = punching_param
        self._slice_param = slice_param
        self._slice_size = slice_size
        self._template_id = template_id

    @property
    def data(self) -> dict[str, Any]:
        """Charge utile constructeur associée à ce modèle."""
        return {
            **super().data,
            'file_id': self._file_id,
            'hollow_param': self._hollow_param,
            'is_delete_file': self._is_delete_file,
            'matrix': self._matrix,
            'project_type': self._project_type,
            'punching_param': self._punching_param,
            'slice_param': self._slice_param,
            'slice_size': self._slice_size,
            'template_id': self._template_id,
        }

    def __repr__(self) -> str:
        """Renvoie une représentation de diagnostic du modèle ; peut contenir des données constructeur privées."""
        return (
            f"AnycubicStartPrintRequestCloud("
            f"filetype={self._filetype}, "
            f"file_id={self._file_name}, "
            f"task_settings={self.task_settings})"
        )


class AnycubicCameraToken:
    """Jetons et paramètres de chiffrement de la connexion vidéo Agora."""
    __slots__ = (
        "_secret_id",
        "_secret_key",
        "_session_token",
        "_region",
        "_msg_id",
    )

    def __init__(
        self,
        secret_id: str,
        secret_key: str,
        session_token: str,
        region: str,
        msg_id: str,
    ) -> None:
        """Initialise le modèle et ses données locales depuis les paramètres fournis."""
        self._secret_id: str = secret_id
        self._secret_key: str = secret_key
        self._session_token: str = session_token
        self._region: str = region
        self._msg_id: str = msg_id

    @property
    def secret_id(self) -> str:
        """Identifiant temporaire du stockage fourni par la session caméra."""
        return self._secret_id

    @property
    def secret_key(self) -> str:
        """Secret temporaire du stockage fourni par la session caméra."""
        return self._secret_key

    @property
    def session_token(self) -> str:
        """Jeton temporaire de session fourni par le cloud."""
        return self._session_token

    @property
    def region(self) -> str:
        """Région du service caméra annoncée par le cloud."""
        return self._region

    @property
    def msg_id(self) -> str:
        """Identifiant de message utilisé pour corréler une commande."""
        return self._msg_id

    def __repr__(self) -> str:
        """Renvoie une représentation de diagnostic du modèle ; peut contenir des données constructeur privées."""
        return (
            f"AnycubicCameraToken("
            f"secret_id={self.secret_id}, "
            f"secret_key=<redacted>, "
            f"session_token=<redacted>, "
            f"region={self.region}, "
            f"msg_id={self.msg_id})"
        )


class AnycubicCameraSession:
    """Réponse cloud décrivant une session caméra et ses références de stockage temporaires."""
    __slots__ = (
        "_appid",
        "_channel",
        "_rtc_token",
        "_client_uid",
        "_printer_uid",
        "_encryption_kdf_salt",
        "_encryption_key",
        "_encryption_mode",
    )

    def __init__(
        self,
        appid: str,
        channel: str,
        rtc_token: str,
        client_uid: int,
        printer_uid: int | None,
        encryption_kdf_salt: str,
        encryption_key: str,
        encryption_mode: str,
    ) -> None:
        """Initialise le modèle et ses données locales depuis les paramètres fournis."""
        self._appid = appid
        self._channel = channel
        self._rtc_token = rtc_token
        self._client_uid = int(client_uid)
        self._printer_uid = int(printer_uid) if printer_uid is not None else None
        self._encryption_kdf_salt = encryption_kdf_salt
        self._encryption_key = encryption_key
        self._encryption_mode = encryption_mode

    @property
    def appid(self) -> str:
        """Identifiant d’application Agora fourni pour la connexion vidéo."""
        return self._appid

    @property
    def channel(self) -> str:
        """Canal Agora fourni pour la session caméra."""
        return self._channel

    @property
    def rtc_token(self) -> str:
        """Jeton d’accès au canal vidéo Agora."""
        return self._rtc_token

    @property
    def client_uid(self) -> int:
        """Identifiant client de la session caméra."""
        return self._client_uid

    @property
    def printer_uid(self) -> int | None:
        """Identifiant de machine fourni pour la session caméra."""
        return self._printer_uid

    @property
    def encryption_kdf_salt(self) -> str:
        """Sel de dérivation fourni pour le chiffrement caméra."""
        return self._encryption_kdf_salt

    @property
    def encryption_key(self) -> str:
        """Clé de chiffrement fournie pour la session caméra."""
        return self._encryption_key

    @property
    def encryption_mode(self) -> str:
        """Mode de chiffrement annoncé pour la session caméra."""
        return self._encryption_mode

    @property
    def data(self) -> dict[str, Any]:
        """Charge utile constructeur associée à ce modèle."""
        return {
            "appid": self.appid,
            "channel": self.channel,
            "rtc_token": self.rtc_token,
            "client_uid": self.client_uid,
            "printer_uid": self.printer_uid,
            "encryption_kdf_salt": self.encryption_kdf_salt,
            "encryption_key": self.encryption_key,
            "encryption_mode": self.encryption_mode,
        }

    @property
    def safe_summary(self) -> dict[str, Any]:
        """Résumé de session caméra conservant les identifiants de canal, mais masquant les jetons et clés de chiffrement."""
        return {
            "appid": self.appid,
            "channel": self.channel,
            "has_rtc_token": bool(self.rtc_token),
            "client_uid": self.client_uid,
            "printer_uid": self.printer_uid,
            "has_encryption_kdf_salt": bool(self.encryption_kdf_salt),
            "has_encryption_key": bool(self.encryption_key),
            "encryption_mode": self.encryption_mode,
        }

    def __repr__(self) -> str:
        """Renvoie une représentation de diagnostic du modèle ; peut contenir des données constructeur privées."""
        return (
            f"AnycubicCameraSession("
            f"appid={self.appid}, "
            f"channel={self.channel}, "
            f"rtc_token=<redacted>, "
            f"client_uid={self.client_uid}, "
            f"printer_uid={self.printer_uid}, "
            f"encryption_key=<redacted>, "
            f"encryption_mode={self.encryption_mode})"
        )
