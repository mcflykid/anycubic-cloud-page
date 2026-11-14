"""Résultat cloud d’une demande d’impression et références associées."""
from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .printer_properties import AnycubicMaterialMapping


class AnycubicPrintResponse:
    """Bilan d’une demande d’impression, sans garantie d’exécution physique sur la machine."""
    __slots__ = (
        "_order_msg_id",
        "_printer_id",
        "_saved_in_cloud",
        "_file_name",
        "_cloud_file_id",
        "_gcode_id",
        "_material_list",
        "_ams_box_mapping",
    )

    def __init__(
        self,
        order_msg_id: str | None = None,
        printer_id: int | None = None,
        saved_in_cloud: bool = False,
        file_name: str | None = None,
        cloud_file_id: int | None = None,
        gcode_id: int | None = None,
        material_list: list[dict[str, Any]] | None = None,
        ams_box_mapping: list[AnycubicMaterialMapping] | None = None,
    ) -> None:
        """Initialise le modèle et ses données locales depuis les paramètres fournis."""
        self._order_msg_id: str | None = order_msg_id
        self._printer_id: int | None = printer_id
        self._saved_in_cloud: bool = bool(saved_in_cloud)
        self._file_name: str | None = file_name
        self._cloud_file_id: int | None = cloud_file_id
        self._gcode_id: int | None = gcode_id
        self._material_list: list[dict[str, Any]] | None = material_list
        self._ams_box_mapping: list[AnycubicMaterialMapping] | None = ams_box_mapping

    @property
    def order_msg_id(self) -> str | None:
        """Renvoie l’identifiant confirmé par le Cloud, ou None si le résultat reste incertain."""
        return self._order_msg_id

    @property
    def event_dict(self) -> dict[str, Any]:
        """Événement sérialisé à partir de la réponse d’impression."""
        ams_box_mapping = None

        if self._ams_box_mapping:
            ams_box_mapping = list([
                x.as_box_mapping_data() for x in self._ams_box_mapping
            ])
        return {
            'order_msg_id': self._order_msg_id,
            'printer_id': self._printer_id,
            'saved_in_cloud': self._saved_in_cloud,
            'file_name': self._file_name,
            'cloud_file_id': self._cloud_file_id,
            'gcode_id': self._gcode_id,
            'material_list': self._material_list,
            'ams_box_mapping': ams_box_mapping,
        }

    def __repr__(self) -> str:
        """Renvoie une représentation de diagnostic du modèle ; peut contenir des données constructeur privées."""
        return (
            f"AnycubicPrintResponse("
            f"order_msg_id={self._order_msg_id}, "
            f"printer_id={self._printer_id}, "
            f"saved_in_cloud={self._saved_in_cloud}, "
            f"file_name={self._file_name}, "
            f"cloud_file_id={self._cloud_file_id}, "
            f"gcode_id={self._gcode_id}, "
            f"material_list={self._material_list}, "
            f"ams_box_mapping={self._ams_box_mapping})"
        )
