"""Métadonnées de tranche extraites des commentaires G-code reconnus."""
from __future__ import annotations

from collections import UserDict
from typing import Any

from aiofiles import open as aio_file_open

from ..exceptions.error_strings import ErrorsGcodeParsing
from ..exceptions.exceptions import AnycubicGcodeParsingError
from ..helpers.helpers import (
    GCODE_STRING_FIRST_ATTR_LINE,
    REX_GCODE_DATA_KEY_VALUE,
    gcode_key_value_pair_to_dict,
)


class AnycubicGcodeFile(UserDict[str, Any]):
    """Métadonnées de tranche G-code et correspondance des matériaux pour les bobines ACE."""
    __slots__ = (
        "_material_list",
    )

    def __init__(
        self,
        *args: Any,
        **kwargs: Any,
    ) -> None:
        """Initialise le modèle et ses données locales depuis les paramètres fournis."""
        super().__init__(*args, **kwargs)
        self._material_list: list[dict[str, Any]] | None = None

        try:
            self.material_list
        except AnycubicGcodeParsingError:
            pass

    @classmethod
    async def async_read_from_file(
        cls,
        full_file_path: str | None = None,
        file_bytes: bytes | None = None,
    ) -> AnycubicGcodeFile:
        """Renvoie les métadonnées d’un chemin local ou de file_bytes UTF-8, à partir du marqueur de filament. Lève AnycubicGcodeParsingError si les données ou l’état requis sont invalides."""
        data_found = False
        slicer_data = {}
        metadata_size = 0

        def parse(line):
            nonlocal data_found, metadata_size
            if line.startswith(GCODE_STRING_FIRST_ATTR_LINE):
                data_found = True
            if data_found:
                fields = gcode_key_value_pair_to_dict(REX_GCODE_DATA_KEY_VALUE, line)
                if fields:
                    metadata_size += len(line)
                    if metadata_size > 4 * 1024 * 1024:
                        raise ValueError('Trop de métadonnées G-code')
                    slicer_data.update(fields)

        if full_file_path is None and file_bytes is None:
            raise AnycubicGcodeParsingError(ErrorsGcodeParsing.invalid_path_and_bytes)
        try:
            if full_file_path is not None:
                async with aio_file_open(full_file_path, mode='r') as source:
                    tail = ''
                    while chunk := await source.read(64 * 1024):
                        *lines, tail = (tail + chunk).split('\n')
                        if len(tail) > 1024 * 1024:
                            raise ValueError('Ligne G-code trop longue')
                        for line in lines:
                            if len(line) > 1024 * 1024:
                                raise ValueError('Ligne G-code trop longue')
                            parse(line)
                    if tail:
                        parse(tail)
            else:
                for line in file_bytes.decode('utf-8').split('\n'):
                    parse(line)
        except (OSError, UnicodeError, ValueError, TypeError) as error:
            raise AnycubicGcodeParsingError(ErrorsGcodeParsing.parse_meta_fail.format(type(error).__name__)) from None

        return cls(slicer_data)

    @property
    def material_list(self) -> list[dict[str, Any]]:
        """Matériaux du G-code ; lève AnycubicGcodeParsingError si les données de peinture ou de filament manquent."""
        if self._material_list is not None:
            return self._material_list

        filament_used_g = self.data.get('filament_used_g')
        filament_used_mm = self.data.get('filament_used_mm')
        filament_used_cm3 = self.data.get('filament_used_cm3')
        ams_data = self.data.get('paint_info')

        if not ams_data:
            raise AnycubicGcodeParsingError(ErrorsGcodeParsing.empty_paint_info)

        if not filament_used_g or len(filament_used_g) < 1:
            raise AnycubicGcodeParsingError(ErrorsGcodeParsing.empty_used_filament)

        if len(filament_used_g) < len(ams_data):
            raise AnycubicGcodeParsingError(ErrorsGcodeParsing.invalid_used_filament)

        if not filament_used_mm or len(filament_used_mm) < len(ams_data):
            filament_used_mm = list([None for x in range(len(ams_data))])

        if not filament_used_cm3 or len(filament_used_cm3) < len(ams_data):
            filament_used_cm3 = list([None for x in range(len(ams_data))])

        self._material_list = list([
            {
                **paint_info,
                'filament_used': filament_used_g[paint_info['paint_index']],
                'filament_used_mm': filament_used_mm[paint_info['paint_index']],
                'filament_used_cm3': filament_used_cm3[paint_info['paint_index']],
            } for paint_info in ams_data
        ])

        self.data['material_list'] = self._material_list

        return self._material_list
