"""Cycle de réservation, transfert et validation d’un fichier dans le stockage cloud."""
from __future__ import annotations

import traceback
from os.path import basename as path_basename
from typing import TYPE_CHECKING, Any

from aiofiles import open as aio_file_open
from aiofiles.os import path as aio_path

from ..exceptions.error_strings import ErrorsCloudUpload
from ..exceptions.exceptions import AnycubicAPIError

if TYPE_CHECKING:
    from ..anycubic_api import AnycubicAPI
    from ..data_models.files import AnycubicCloudStore


class AnycubicCloudUpload:
    """Cycle de réservation et transfert d’un fichier avec contrôle du quota cloud."""
    __slots__ = (
        "_api_parent",
        "_is_temp_file",
        "_full_file_path",
        "_file_name",
        "_file_bytes",
        "_is_file",
        "_file_size",
        "_previous_available_bytes",
        "_current_available_bytes",
        "_cloud_file_id",
        "_lock_file_id",
        "_upload_error",
        "_lock_data",
    )

    def __init__(
        self,
        api_parent: AnycubicAPI,
        full_file_path: str | None = None,
        file_name: str | None = None,
        file_bytes: bytes | None = None,
        is_temp_file: bool = False,
    ) -> None:
        """Prépare un transfert depuis full_file_path ou file_name avec file_bytes ; is_temp_file évite la conservation cloud. Lève AnycubicAPIError sans source."""
        self._api_parent: AnycubicAPI = api_parent
        self._is_temp_file: bool = is_temp_file
        if full_file_path is not None:
            self._full_file_path: str | None = full_file_path
            assert self._full_file_path
            self._file_name: str | None = str(path_basename(self._full_file_path))
            self._file_bytes: bytes | None = None
            self._is_file: bool = True
        elif file_name is not None and file_bytes is not None:
            self._full_file_path = None
            self._file_name = file_name
            self._file_bytes = file_bytes
            self._is_file = False
        else:
            raise AnycubicAPIError(ErrorsCloudUpload.missing_path_bytes)
        self._file_size: int = 0
        self._previous_available_bytes: int = 0
        self._current_available_bytes: int = 0
        self._cloud_file_id: int | None = None
        self._lock_file_id: int | None = None
        self._upload_error: str | None = None
        self._lock_data: dict[str, Any] | None = None

    @property
    def full_file_path(self) -> str | None:
        """Chemin complet du fichier local à transférer."""
        return self._full_file_path

    @property
    def file_name(self) -> str | None:
        """Nom du fichier retenu pour le transfert cloud."""
        return self._file_name

    @property
    def file_bytes(self) -> bytes | None:
        """Contenu binaire à transférer, éventuellement absent avant lecture."""
        return self._file_bytes

    @property
    def file_size(self) -> int:
        """Taille du fichier à transférer, en octets."""
        return self._file_size

    @property
    def lock_file_id(self) -> int | None:
        """Identifiant de réservation du stockage cloud, distinct du fichier final."""
        return self._lock_file_id

    @property
    def cloud_file_id(self) -> int | None:
        """Identifiant du fichier enregistré dans le cloud."""
        return self._cloud_file_id

    @property
    def upload_error(self) -> str | None:
        """Description de l’échec de transfert mémorisé, le cas échéant."""
        return self._upload_error

    @property
    def valid_path(self) -> bool:
        """Indique si un chemin non vide est configuré, sans vérifier son existence."""
        return self.full_file_path is not None and len(self.full_file_path) > 0

    @property
    def valid_size(self) -> bool:
        """Indique si la taille du fichier est strictement positive."""
        return self._file_size > 0

    @property
    def valid_bytes(self) -> bool:
        """Indique si un contenu binaire est présent, même vide."""
        return self._file_bytes is not None

    @property
    def valid_available_bytes(self) -> bool:
        """Indique si le quota connu avant transfert couvre la taille du fichier."""
        return self._previous_available_bytes >= self._file_size

    @property
    def valid_check_available_bytes_decreased(self) -> bool:
        """Indique si le quota a diminué d’au moins la taille transférée."""
        return self._current_available_bytes <= (self._previous_available_bytes - self._file_size)

    def set_file_size(self, filesize: int) -> None:
        """Mémorise la taille à réserver dans le cloud, en octets."""
        self._file_size = int(filesize)

    def set_file_bytes(self, file_bytes: bytes | None) -> None:
        """Mémorise les octets à transférer, ou None si le contenu n’est pas encore chargé."""
        self._file_bytes = file_bytes

    def set_previous_data_with_user_store(self, user_store: AnycubicCloudStore | None) -> None:
        """Mémorise le quota libre avant transfert pour vérifier la réservation. Lève AnycubicAPIError si les données ou l’état requis sont invalides."""
        if not user_store:
            raise AnycubicAPIError(ErrorsCloudUpload.missing_user_store_previous)
        self._previous_available_bytes = user_store.available_bytes

    def set_current_data_with_user_store(self, user_store: AnycubicCloudStore | None) -> None:
        """Mémorise le quota libre après transfert pour vérifier la présence du fichier. Lève AnycubicAPIError si les données ou l’état requis sont invalides."""
        if not user_store:
            raise AnycubicAPIError(ErrorsCloudUpload.missing_user_store_current)
        self._current_available_bytes = user_store.available_bytes

    def set_cloud_file_id(self, cloud_file_id: int) -> None:
        """Mémorise l’identifiant cloud obtenu après enregistrement du transfert."""
        self._cloud_file_id = cloud_file_id

    def set_lock_file_id(self, lock_file_id: int) -> None:
        """Mémorise l’identifiant de réservation nécessaire à la libération du quota."""
        self._lock_file_id = lock_file_id

    def set_error(self, upload_error: Any) -> None:
        """Conserve la description textuelle de l’échec pour le bilan du transfert."""
        self._upload_error = str(upload_error)

    async def async_check_path_is_valid(self) -> None:
        """Vérifie l’existence du fichier si le transfert lit un chemin local. Lève AnycubicAPIError si les données ou l’état requis sont invalides."""
        if self._is_file and not self.valid_path:
            raise AnycubicAPIError(ErrorsCloudUpload.missing_path)
        elif self._is_file:
            assert self.full_file_path
            if not (await aio_path.exists(self.full_file_path)):
                raise AnycubicAPIError(ErrorsCloudUpload.path_not_exist)

    def check_size_is_valid(self) -> None:
        """Refuse une taille vide avant réservation du stockage cloud. Lève AnycubicAPIError si les données ou l’état requis sont invalides."""
        if not self.valid_size:
            raise AnycubicAPIError(ErrorsCloudUpload.empty_file_size.format(self.file_name))

    def check_data_is_valid(self) -> None:
        """Refuse un transfert sans contenu binaire chargé. Lève AnycubicAPIError si les données ou l’état requis sont invalides."""
        if not self.valid_bytes:
            raise AnycubicAPIError(ErrorsCloudUpload.empty_file_bytes.format(self.file_name))

    def check_upload_succeeded(self) -> None:
        """Signale l’erreur de transfert mémorisée après libération du quota. Lève AnycubicAPIError si les données ou l’état requis sont invalides."""
        if self.upload_error:
            raise AnycubicAPIError(ErrorsCloudUpload.unknown.format(self.file_name, self.upload_error))

    async def async_check_available_cloud_space(self) -> None:
        """Vérifie le quota avant transfert, sauf pour les fichiers temporaires. Lève AnycubicAPIError si les données ou l’état requis sont invalides."""
        if not self._is_temp_file:
            self.set_previous_data_with_user_store(await self._api_parent.get_user_cloud_store())

            if not self.valid_available_bytes:
                raise AnycubicAPIError(ErrorsCloudUpload.no_space_available.format(self.file_name))

    async def async_check_decreased_cloud_space(self) -> None:
        """Vérifie que le quota a diminué après un transfert conservé dans le cloud. Lève AnycubicAPIError si les données ou l’état requis sont invalides."""
        if not self._is_temp_file:
            self.set_current_data_with_user_store(await self._api_parent.get_user_cloud_store())
            if not self.valid_check_available_bytes_decreased:
                raise AnycubicAPIError(ErrorsCloudUpload.not_found_cloud.format(self.file_name))

    async def async_read_file_bytes(self) -> None:
        """Charge le fichier local si nécessaire et déduit sa taille des octets disponibles."""
        if self._is_file:
            assert self.full_file_path
            async with aio_file_open(self.full_file_path, mode='rb') as f:
                self.set_file_bytes(await f.read())
        if self.file_bytes is not None:
            self.set_file_size(len(self.file_bytes))

    async def async_lock_storage_space(self) -> None:
        """Réserve le quota cloud et mémorise l’identifiant de réservation."""
        self._lock_data = await self._api_parent._lock_storage_space(
            file_size=self.file_size,
            file_name=self.file_name,
            is_temp_file=self._is_temp_file,
        )

        assert self._lock_data

        self.set_lock_file_id(int(self._lock_data['id']))

    async def async_unlock_storage_space(self) -> None:
        """Libère la réservation, en demandant le nettoyage du stockage si le transfert a échoué. Lève AnycubicAPIError si les données ou l’état requis sont invalides."""
        if self.lock_file_id is None:
            raise AnycubicAPIError(ErrorsCloudUpload.missing_unlock_file_id)
        await self._api_parent._unlock_storage_space(
            self.lock_file_id,
            is_delete_cos=(self.upload_error is not None),
        )

    async def async_upload_and_set_cloud_file_id(self) -> None:
        """Transfère vers le stockage signé puis enregistre le fichier ; mémorise les erreurs de transfert. Lève AnycubicAPIError si les données ou l’état requis sont invalides."""
        if self._lock_data is None:
            raise AnycubicAPIError(ErrorsCloudUpload.missing_lock_data)
        if self.file_bytes is None:
            raise AnycubicAPIError(ErrorsCloudUpload.missing_file_bytes)
        if self.lock_file_id is None:
            raise AnycubicAPIError(ErrorsCloudUpload.missing_lock_file_id)

        try:
            await self._api_parent._fetch_aws_put_resp(
                final_url=self._lock_data['preSignUrl'],
                put_data=self.file_bytes,
            )

            cloud_file_id = await self._api_parent._claim_file_upload_from_aws(self.lock_file_id)

            self.set_cloud_file_id(cloud_file_id)

        except Exception as error:
            tb = traceback.format_exc()
            self._api_parent._log_to_debug(
                f"Error during async_upload_and_set_cloud_file_id: {error}\n{tb}"
            )
            self.set_error(error)

    async def async_process_upload(self) -> int:
        """Renvoie l’identifiant cloud après le cycle de réservation, transfert, libération et contrôle."""
        await self.async_check_path_is_valid()

        await self.async_read_file_bytes()

        self.check_data_is_valid()

        self.check_size_is_valid()

        await self.async_check_available_cloud_space()

        await self.async_lock_storage_space()

        await self.async_upload_and_set_cloud_file_id()

        self.check_upload_succeeded()

        assert self.cloud_file_id is not None

        await self.async_unlock_storage_space()

        self.check_upload_succeeded()

        await self.async_check_decreased_cloud_space()

        return self.cloud_file_id
