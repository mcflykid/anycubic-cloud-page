"""Transforme les transitions ACE observées en alertes locales datées."""

import hashlib
import json

from notification_delivery import PrintEvent, private_json, read_private_json


class AceAlerts:
    """Conserve les transitions par boîtier et corrèle les commandes avec leur état observé."""

    def __init__(self, path=None):
        """Attend un premier relevé pour établir la référence du boîtier."""
        self.path = path
        self.drying = {}
        self.pending = {}
        self.stops = {}
        self.low = set()
        self.project = None
        self.refusals = []

    def restore(self, scope):
        """Recharge les séchages en cours du même compte après un redémarrage."""
        if self.path is None:
            return
        try:
            stored = read_private_json(self.path, 16384)
            if stored.get("scope") == scope:
                self.drying = {int(box): pair for box, pair in stored["drying"].items()}
                self.stops = {int(box): end for box, end in stored["stops"].items()}
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            pass

    def save(self, scope):
        """Garde l’échéance du séchage et les arrêts demandés sous droits privés."""
        if self.path is not None:
            private_json(self.path, {"scope": scope, "drying": self.drying, "stops": self.stops})

    def command(self, action, box, slot, stamp):
        """Enregistre une commande acceptée pendant sa fenêtre de confirmation."""
        if action == "dry-stop":
            self.stops[box] = stamp + 300
        elif action in {"feed", "retract"}:
            self.pending[box] = (action, slot, stamp)

    def refusal(self, box, slot, stamp, code):
        """Retient les refus confirmés du journal sans assimiler un silence à un refus."""
        self.refusals.append((box, slot, stamp, code))
        self.refusals = self.refusals[-32:]

    def sample(self, printer, scope, stamp):
        """Renvoie les nouvelles transitions fiables pour les seuls ACE joignables."""
        if printer.get("printer_online") is not True:
            return []
        events = [
            self.event(printer, scope, box, stamp, stamp, "ace_load_failed", slot, code)
            for box, slot, stamp, code in self.refusals
        ]
        self.refusals.clear()
        project = printer.get("command_project") if printer.get("job_state") == "printing" else None
        if project != self.project:
            self.low.clear()
            self.project = project
        for shortage in printer.get("filament_shortfalls") or []:
            slot = shortage.get("slot")
            if project and type(slot) is int and slot > 0 and slot not in self.low:
                self.low.add(slot)
                events.append(
                    self.event(printer, scope, None, stamp, project, "ace_filament_low", slot - 1)
                )
        for box in printer.get("boxes") or []:
            box_id = box.get("box_id")
            dry = box.get("drying") or {}
            remaining = dry.get("remaining_time")
            previous = self.drying.get(box_id)
            if dry.get("is_drying") is True and type(remaining) is int and 0 <= remaining <= 1440:
                # Une baisse du compteur est une preuve plus précise que l’heure du premier relevé.
                end = stamp + 60 * remaining
                if previous is None or end < previous[0]:
                    self.drying[box_id] = (end, previous[1] if previous else stamp)
            elif dry.get("is_drying") is False and previous:
                self.drying.pop(box_id)
                end, started = previous
                stopped = self.stops.pop(box_id, 0) >= stamp
                if not stopped and stamp >= end:
                    events.append(
                        self.event(printer, scope, box_id, stamp, started, "ace_drying_done")
                    )
                elif not stopped:
                    events.append(
                        self.event(printer, scope, box_id, stamp, started, "ace_drying_interrupted")
                    )
            pending = self.pending.get(box_id)
            if pending:
                action, slot, requested = pending
                engaged = box.get("loaded_slot")
                if stamp - requested > 300:
                    self.pending.pop(box_id)
                    events.append(
                        self.event(
                            printer, scope, box_id, stamp, requested, "ace_load_failed", slot
                        )
                    )
                elif type(engaged) is int and (
                    engaged == slot if action == "feed" else engaged == -1
                ):
                    self.pending.pop(box_id)
                    result = "ace_feed_done" if action == "feed" else "ace_retract_done"
                    events.append(
                        self.event(printer, scope, box_id, stamp, requested, result, slot)
                    )
        return events

    @staticmethod
    def event(printer, scope, box, stamp, occurrence, result, slot=None, code="", detail=""):
        """Construit une référence stable, sans identifiant privé visible dans le message."""
        key = hashlib.sha256(
            json.dumps([scope, box, occurrence, result, slot]).encode()
        ).hexdigest()
        label = printer.get("name")
        return PrintEvent(
            key, stamp, result, label if isinstance(label, str) else "", detail, code, slot
        )
