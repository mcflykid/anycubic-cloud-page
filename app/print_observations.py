"""Calcule des estimations d’impression à partir des relevés disponibles."""

import math
import json
from itertools import pairwise


def observe_timeline(events, job, stamp):
    """Ajoute une transition de phase ou de bobine seulement si elle apparaît dans les relevés."""
    state = job.get("job_state")
    active = ("downloading", "checking", "preheating", "leveling", "printing", "paused")
    if state not in (*active, "finished", "failed") or (not events and state not in active):
        return events
    previous = events[-1] if events else {}
    if previous.get("state") in ("finished", "failed") or stamp <= previous.get("time", 0):
        return events
    slots = (
        [
            [box.get("box_id"), box["loaded_slot"] + 1]
            for box in job.get("boxes") or []
            if type(box.get("loaded_slot")) is int and box["loaded_slot"] >= 0
        ]
        if state == "printing"
        else []
    )
    shortages = sorted(
        {
            item["slot"]
            for item in job.get("filament_shortfalls") or []
            if type(item.get("slot")) is int and item["slot"] > 0
        }
    )
    known_shortages = {
        slot
        for event in events
        if event.get("kind") == "filament_low"
        for slot in event.get("shortages", [])
    }
    new_shortages = [slot for slot in shortages if slot not in known_shortages]
    if previous.get("state") != state:
        kind = "resumed" if previous.get("state") == "paused" and state == "printing" else state
    elif state == "printing" and slots and previous.get("slots") and slots != previous["slots"]:
        kind = "spool"
    elif state == "printing" and new_shortages:
        kind = "filament_low"
    else:
        return events
    entry = {"kind": kind, "state": state, "time": stamp, "slots": slots}
    if kind == "filament_low":
        entry["shortages"] = new_shortages
    return [*events, entry][-200:]


def read_timelines(path):
    """Charge le registre local, vide à la première utilisation."""
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    return value if isinstance(value, dict) else {}


def drying_advice(printer, presets, samples, at):
    """Propose un préréglage existant après quinze minutes de mesures d’humidité cohérentes."""
    from filament_catalog import material_family

    if (
        not printer.get("printer_online")
        or printer.get("is_busy") is True
        or printer.get("job_in_progress") is not False
    ):
        return {}
    thresholds = {"PLA": 40, "PETG": 30, "PA": 30, "PC": 30, "TPU": 30, "ABS": 30, "ASA": 30}
    configured = {}
    for row in presets:
        if not isinstance(row.get("name"), str):
            continue
        # Un préréglage combiné peut servir à ses deux matières. Un préréglage dédié garde la priorité.
        label = row["name"].strip().upper()
        for name in label.split("/"):
            family = name.strip()
            if family in thresholds and (family not in configured or label == family):
                configured[family] = row
    result = {}
    for box in printer.get("boxes") or []:
        if box.get("drying", {}).get("is_drying") is not False:
            continue
        key = str(box.get("box_id"))
        humidity = []
        for sample in samples:
            if not 0 <= at - sample["time"] <= 1020:
                continue
            value = sample.get("ace_boxes", {}).get(key, {}).get("humidity")
            if type(value) in (int, float) and 0 <= value <= 100:
                humidity.append((sample["time"], value))
        if (
            len(humidity) < 3
            or humidity[-1][0] - humidity[0][0] < 900
            or at - humidity[-1][0] > 120
        ):
            continue
        if any(right[0] - left[0] > 180 for left, right in pairwise(humidity)):
            continue
        average = sum(value for _, value in humidity) / len(humidity)
        families = {
            material_family(spool.get("material_type"), printer.get("machine_name"))
            for spool in box.get("spools") or []
            if spool.get("spool_loaded") is True
        }
        if not families or not families <= configured.keys() or not families <= thresholds.keys():
            continue
        limits = {
            family: configured[family].get("humidity_threshold", thresholds[family])
            for family in families
        }
        sensitive = min(families, key=lambda family: (limits[family], family))
        if average <= limits[sensitive]:
            continue
        temperature = min(configured[family]["temperature"] for family in families)
        if box.get("model") == "ACE 2 Pro" and temperature > 65:
            continue
        result[key] = {
            "humidity": round(average),
            "material": sensitive,
            "temperature": temperature,
            "hours": configured[sensitive]["hours"],
        }
    return result


def heat_alerts(printer, samples, at):
    """Renvoie les chauffes lentes et les chutes après stabilisation à la consigne courante."""
    phase = printer.get("job_state")
    if phase not in ("preheating", "printing") or not printer.get("printer_online"):
        return []
    warnings = []
    for part, limit in (("nozzle", 300), ("bed", 600)):
        window, deviation = (limit, 5) if phase == "preheating" else (60, 10)
        field = "hotbed" if part == "bed" else "nozzle"
        goal = printer.get(f"target_{field}_temp")
        if type(goal) not in (int, float) or not math.isfinite(goal) or goal <= 0:
            continue
        actual = printer.get(f"curr_{field}_temp")
        # Les bornes larges écartent les codes de défaut sans confondre un changement de cible et une panne.
        ceiling = 500 if part == "nozzle" else 200
        if type(actual) in (int, float) and math.isfinite(actual) and not -40 <= actual <= ceiling:
            warnings.append(
                {"part": part, "target": goal, "actual": actual, "seconds": 0, "kind": "sensor"}
            )
            continue
        if phase == "printing":
            # Une chute suppose que la consigne courante a déjà été atteinte sans rupture de suivi.
            previous = at
            reached = False
            for sample in reversed(samples):
                stamp, temp = sample["time"], sample.get(part)
                if (
                    previous - stamp > 90
                    or sample.get(f"{part}_target") != goal
                    or type(temp) not in (int, float)
                    or not math.isfinite(temp)
                ):
                    break
                if abs(goal - temp) <= 5:
                    reached = True
                    break
                previous = stamp
            if not reached:
                continue
        points = []
        for sample in reversed(samples):
            stamp, temp = sample["time"], sample.get(part)
            if at - stamp > window + 20:
                break
            if (
                sample.get(f"{part}_target") != goal
                or type(temp) not in (int, float)
                or not math.isfinite(temp)
                or goal - temp <= deviation
                or (points and points[-1][0] - stamp > 90)
            ):
                break
            points.append((stamp, temp))
        if points and at - points[0][0] <= 30 and points[0][0] - points[-1][0] >= window:
            # Une valeur strictement identique, loin de la consigne, signale un capteur possiblement figé.
            stalled = actual == points[0][1] and all(temp == actual for _, temp in points)
            warnings.append(
                {
                    "part": part,
                    "target": goal,
                    "actual": points[0][1],
                    "seconds": points[0][0] - points[-1][0],
                    "kind": "stalled" if stalled else "slow" if phase == "preheating" else "drop",
                }
            )
    for warning in warnings:
        part = warning["part"]
        warning["readings"] = [
            {
                "time": sample["time"],
                part: sample.get(part),
                f"{part}_target": sample.get(f"{part}_target"),
            }
            for sample in samples
            if 0 <= at - sample["time"] <= 600
        ][-120:]
        warning["observed_at"] = at
    return warnings
