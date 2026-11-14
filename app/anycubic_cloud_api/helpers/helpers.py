"""Conversions de formats constructeur, identifiants et chemins des certificats MQTT."""
from __future__ import annotations

import hashlib
import json
import re
import struct
import uuid
from datetime import timedelta
from os import path
from typing import Any

ALPHANUMERIC_CHARS: str = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
GCODE_STRING_FIRST_ATTR_LINE: str = '; filament used'

REX_GCODE_DATA_KEY_VALUE: re.Pattern[Any] = re.compile(r'; ([a-zA-Z0-9_\[\] ]+) = (.*)$')

REX_PRINT_TOTAL_TIME: re.Pattern[Any] = re.compile(r'^([\d]+)hour([\d]+)min$')


def timedelta_to_total_minutes(
    delta: timedelta,
) -> float:
    """Renvoie la durée en minutes, jours compris."""
    return delta.total_seconds() / 60.0


def timedelta_to_total_hours(
    delta: timedelta,
) -> float:
    """Renvoie la durée en heures, jours compris."""
    return delta.total_seconds() / 3600.0


def timedelta_to_dhm_string(
    delta: timedelta,
) -> str:
    """Renvoie la durée au format jours:heures:minutes sans arrondi des secondes."""
    days = delta.days
    hours, remain_sec = divmod(delta.seconds, 3600)
    mins = int(remain_sec / 60)

    return f"{days}:{hours}:{mins}"


def hour_min_time_string_to_delta(
    time_string: str,
) -> timedelta:
    """Renvoie une durée depuis le format constructeur NhourNmin ; lève ValueError sans correspondance."""
    match = REX_PRINT_TOTAL_TIME.match(time_string)

    if match:
        hours = int(match.group(1))
        mins = int(match.group(2))

        return timedelta(
            minutes=mins,
            hours=hours,
        )

    raise ValueError("No hour min regex match.")


def int_seconds_string_to_delta(
    time_string: str,
) -> timedelta:
    """Renvoie une durée depuis un nombre entier de secondes ; lève ValueError si la chaîne est invalide."""
    try:
        total_seconds = int(time_string)
        return timedelta(
            seconds=total_seconds
        )
    except ValueError:
        raise


def float_minutes_string_to_delta(
    time_string: str,
) -> timedelta:
    """Renvoie une durée depuis des minutes décimales, tronquée à la seconde ; ValueError si invalide."""
    try:
        minutes = float(time_string)
        total_seconds = int(minutes * 60)
        return timedelta(
            seconds=total_seconds
        )
    except ValueError:
        raise


def time_duration_string_to_delta(
    time_string: str | None,
) -> timedelta:
    """Renvoie la durée en interprétant des minutes ou NhourNmin ; renvoie une durée nulle sinon."""
    if isinstance(time_string, str):

        try:
            return float_minutes_string_to_delta(time_string)
        except ValueError:
            pass

        try:
            return hour_min_time_string_to_delta(time_string)
        except ValueError:
            pass

    return timedelta()


def get_part_from_mqtt_topic(topic: str, part: int) -> str | None:
    """Renvoie le segment d’indice part du sujet MQTT, ou None si le sujet est trop court."""
    split_topic = topic.split("/")
    if len(split_topic) < part + 1:
        return None

    return split_topic[part]


def redact_part_from_mqtt_topic(topic: str, part: int) -> str:
    """Masque le segment d’indice part pour ne pas publier l’identifiant présent dans le sujet MQTT."""
    split_topic = topic.split("/")
    new_chunk = list()
    if len(split_topic) < part + 1:
        return topic

    for idx, chunk in enumerate(split_topic):
        if idx != part:
            new_chunk.append(chunk)
        else:
            new_chunk.append("**REDACTED**")

    return "/".join(new_chunk)


def base_62_encode_int(num: int) -> str:
    """Renvoie l’encodage constructeur sur onze caractères utilisé pour les nonces Android."""
    rounds = 11
    enc_arr = list(['0' for x in range(rounds)])
    while num != -1 and num != 0:
        rounds -= 1
        enc_arr[rounds] = ALPHANUMERIC_CHARS[(61 & num)]
        num = num >> 6
    return "".join(enc_arr)


def generate_fake_device_id() -> str:
    """Renvoie un identifiant synthétique de client sur trente-trois caractères."""
    return (uuid.uuid1().hex + uuid.uuid1().hex)[:33]


def generate_cookie_state() -> str:
    """Renvoie une valeur aléatoire de onze caractères pour l’état de connexion."""
    return str(uuid.uuid4())[-11:]


def get_msb_and_lsb_from_bytes(input_bytes: bytes) -> tuple[int, int]:
    """Renvoie deux entiers signés big-endian ; input_bytes doit contenir seize octets, sinon struct.error."""
    return struct.unpack(">qq", input_bytes)


def generate_android_app_nonce() -> str:
    """Renvoie un nonce au format attendu par le client Android constructeur."""
    nonce = uuid.uuid1()
    msb, lsb = get_msb_and_lsb_from_bytes(nonce.bytes)
    return base_62_encode_int(msb) + base_62_encode_int(lsb)


def generate_web_nonce() -> str:
    """Renvoie un UUID textuel au format du client web constructeur."""
    return str(uuid.uuid1())


def string_to_int_float(value: str) -> int | float | str:
    """Renvoie un entier ou flottant si la chaîne est convertible, sinon la chaîne d’origine."""
    if value.isdigit():
        return int(value)
    else:
        try:
            return float(value)
        except ValueError:
            pass

    return value


def gcode_key_value_pair_to_dict(
    rex: re.Pattern[Any],
    data_string: str,
) -> dict[str, Any]:
    """Renvoie une paire de métadonnées reconnue par rex ; ignore les marqueurs begin et end."""
    data_key = rex.findall(data_string)

    if not data_key or len(data_key) < 1:
        return {}

    key = data_key[0][0]
    value = data_key[0][1]

    if value in ['begin', 'end']:
        return {}

    for repl in [' ', '[', ']', '(', ')', '__']:
        key = key.replace(repl, '_')

    if key[-1] == '_':
        key = key[:-1]

    try:
        value = json.loads(value)
    except json.decoder.JSONDecodeError:
        if "," in value:
            value = list([string_to_int_float(x.strip()) for x in value.split(',')])

        else:
            value = string_to_int_float(value)

    return {
        key: value
    }


def md5_hex_of_string(
    input_string: str,
) -> str:
    """Renvoie le MD5 hexadécimal UTF-8 exigé par les signatures constructeur."""
    return hashlib.md5(input_string.encode('utf-8')).hexdigest().lower()


def get_ssl_cert_directory() -> str:
    """Renvoie ANYCUBIC_MQTT_DIR ou le dossier resources de la bibliothèque embarquée."""
    library_root = path.dirname(path.dirname(__file__))

    if 'anycubic_cloud_api' not in library_root:
        library_root = path.join(library_root, 'anycubic_cloud_api')

    ssl_root = __import__('os').environ.get('ANYCUBIC_MQTT_DIR', path.join(library_root, 'resources'))

    return ssl_root


def get_mqtt_ssl_path_ca(
    ssl_root: str,
) -> str:
    """Renvoie le chemin du certificat d’autorité, avec le nom de fichier historique mqqt."""
    return path.join(ssl_root, 'anycubic_mqqt_tls_ca.crt')


def get_mqtt_ssl_path_cert(
    ssl_root: str,
) -> str:
    """Renvoie le chemin du certificat client, avec le nom de fichier historique mqqt."""
    return path.join(ssl_root, 'anycubic_mqqt_tls_client.crt')


def get_mqtt_ssl_path_key(
    ssl_root: str,
) -> str:
    """Renvoie le chemin de la clé privée client, avec le nom de fichier historique mqqt."""
    return path.join(ssl_root, 'anycubic_mqqt_tls_client.key')
