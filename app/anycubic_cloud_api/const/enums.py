"""Codes constructeur des commandes, états et capacités des imprimantes."""
from enum import IntEnum, StrEnum


class AnycubicFeedType(IntEnum):
    """Codes constructeur de chargement, retrait et fin de chargement du filament."""
    Feed = 1
    Retract = 2
    Finish = 3


class AnycubicPrintStatus(IntEnum):
    """Codes des phases d’impression annoncées par le constructeur."""
    Printing = 1
    Complete = 2
    Cancelled = 3
    Downloading = 4
    Checking = 5
    Preheating = 6
    Slicing = 7
    Leveling = 9


class AnycubicOrderID(IntEnum):
    """Codes des commandes constructeur ; leur présence ne garantit pas leur prise en charge locale."""
    START_PRINT = 1
    PAUSE_PRINT = 2
    RESUME_PRINT = 3
    STOP_PRINT = 4
    PRINT_SETTINGS = 6
    IGNORE = 11
    DETECT = 12
    STOP_PRINT_FORCE = 44
    LIST_UDISK_FILES = 101
    DELETE_UDISK_FILE = 102
    LIST_LOCAL_FILES = 103
    DELETE_LOCAL_FILE = 104
    MOVE_AXLE = 201
    MOVE_AXLE_TO_COORDINATES = 202
    START_EXPOSURE = 301
    CANCEL_EXPOSURE = 302
    START_RESIDUAL = 501
    CANCEL_RESIDUAL = 502
    SET_DEVICE_SELF_TEST = 601
    GET_DEVICE_SELF_TEST = 602
    SET_AUTO_OPERATION = 701
    GET_AUTO_OPERATION = 702
    RESET_RELEASE_FILM = 801
    GET_RELEASE_FILM = 802
    SET_PRINT_STATUS_FREE = 901
    CAMERA_OPEN = 1001
    CAMERA_CLOSE = 1002
    MULTI_COLOR_BOX_GET_INFO = 1206
    MULTI_COLOR_BOX_DRY = 1207
    FEED_FILAMENT = 1208
    FEED_FILAMENT_FINISH = 1209
    MULTI_COLOR_BOX_REFRESH_SLOT = 1210
    MULTI_COLOR_BOX_SET_SLOT = 1211
    MULTI_COLOR_BOX_AUTO_FEED = 1212
    MOVE_AXLE_TURN_OFF = 1213
    FILAMENT_CONTROL = 1215
    FEED_RESIN = 1224
    M7_AUTO_OPERATION = 1225
    CYCLIC_CLEANING = 1226
    SET_AUTO_FEED_INFO = 1227
    GET_M7_AUTO_OPERATION = 1228
    EXTFILBOX = 1229
    GET_EXTFILBOX_INFO = 1230
    QUERY_PERIPHERALS = 1231
    GET_LIGHT_STATUS = 1232
    SET_LIGHT_STATUS = 1233


class AnycubicFunctionID(IntEnum):
    """Codes des capacités annoncées par les modèles d’imprimante."""
    AXLE_MOVEMENT = 1
    FILE_MANAGER = 2
    EXPOSURE_TEST = 3
    LCD_PEER_VIDEO = 7
    FDM_AXIS_MOVE = 13
    FDM_PEER_VIDEO = 22
    DEVICE_STARTUP_SELF_TEST = 26
    PRINT_STARTUP_SELF_TEST = 27
    AUTOMATIC_OPERATION = 28
    RESIDUE_CLEAN = 29
    NOVICE_GUIDE = 30
    RELEASE_FILM = 31
    TASK_MODE = 32
    LCD_INTELLIGENT_MATERIALS_BOX = 33
    LCD_AUTO_OUT_IN_MATERIALS = 34
    M7PRO_AUTOMATIC_OPERATION = 35
    AI_DETECTION = 36
    AUTO_LEVELER = 37
    VIBRATION_COMPENSATION = 38
    TIME_LAPSE = 39
    VIDEO_LIGHT = 40
    BOX_LIGHT = 41
    MULTI_COLOR_BOX = 2006


class AnycubicPrinterMaterialType(StrEnum):
    """Familles de matériau distinguant les imprimantes FDM et résine."""
    FILAMENT = "Filament"
    RESIN = "Resin"
