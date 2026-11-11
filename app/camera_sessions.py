"""Sessions vidéo et durée de présence des onglets, par imprimante."""

import asyncio
import logging
import re
import ssl
import time

import aiohttp
from aiohttp import web

from anycubic_cloud_api.const.enums import AnycubicOrderID
from anycubic_cloud_api.data_models.orders import AnycubicBaseOrderRequest
from anycubic_cloud_api.exceptions.exceptions import (
    AnycubicAuthError,
    AnycubicAuthTokensExpired,
    AnycubicCameraSessionError,
)
from operational_logging import log_event
from printer_registry import printer_key

CAMERA_VIEWER_TTL = 180
OPS_LOG = logging.getLogger("cloud_page.server")


def camera_transport_failure(error):
    """Reconnaît une panne de connexion ou un délai, même enveloppé ; refuse les erreurs TLS, d’authentification et de format."""
    chain = []
    seen = set()
    while error is not None and id(error) not in seen:
        seen.add(id(error))
        chain.append(error)
        error = error.__cause__ if error.__cause__ is not None else error.__context__
    # Le client embarqué enveloppe les erreurs : leur type reste exploitable sans lire de message sensible.
    if any(
        isinstance(
            item,
            (
                AnycubicAuthError,
                AnycubicAuthTokensExpired,
                AnycubicCameraSessionError,
                ValueError,
                ssl.SSLError,
                aiohttp.ClientSSLError,
                aiohttp.ServerFingerprintMismatch,
            ),
        )
        for item in chain
    ):
        return False
    return any(
        isinstance(item, (aiohttp.ClientConnectionError, asyncio.TimeoutError)) for item in chain
    )


async def camera(req, engine, verify_printer_target):
    """Renvoie une session en cache cinq secondes ; retente une seule panne de transport, propage les autres erreurs."""
    viewer = req.headers.get("X-Camera-Viewer")
    if viewer and not re.fullmatch(r"[a-f0-9-]{36}", viewer):
        raise ValueError("Session vidéo invalide")
    if not engine.printer:
        raise ValueError("Connexion en cours")
    async with engine.lock:
        async with engine.command_lock:
            verify_printer_target(req, engine)
            prune_camera_viewers(engine)
            if viewer and engine.camera_departures.get(viewer, 0) > time.monotonic():
                raise ValueError("Cet onglet a déjà fermé sa session vidéo")
            if viewer and len(engine.camera_viewers) >= 32 and viewer not in engine.camera_viewers:
                raise ValueError("Trop de sessions vidéo ouvertes")
            if (
                not engine.camera
                or time.time() - engine.last_session > 5
                or (viewer and engine.camera_owner != viewer)
            ):
                engine.camera_message_id = None
                engine.camera_diagnostic = None
                engine.camera_stage = -1
                started = time.monotonic()
                attempt = 1
                try:
                    try:
                        session = await engine.printer.get_camera_session()
                    except Exception as error:
                        # Seule une panne de transport temporaire justifie une seconde demande.
                        if not camera_transport_failure(error):
                            raise
                        log_event(
                            OPS_LOG,
                            logging.DEBUG,
                            "camera_session_retry",
                            message="Transport vidéo indisponible ; une seule nouvelle demande",
                            attempt=attempt,
                            error_type=type(error).__name__,
                        )
                        attempt += 1
                        session = await engine.printer.get_camera_session()
                    if session is None:
                        raise ValueError("Caméra indisponible")
                except Exception as error:
                    log_event(
                        OPS_LOG,
                        logging.WARNING,
                        "camera_session_failed",
                        message="Session vidéo indisponible ; aucune image n’a été confirmée",
                        attempt=attempt,
                        error_type=type(error).__name__,
                        duration_ms=(time.monotonic() - started) * 1000,
                    )
                    raise
                log_event(
                    OPS_LOG,
                    logging.INFO,
                    "camera_session_received",
                    message="Session vidéo reçue ; le navigateur doit encore se connecter au flux",
                    attempt=attempt,
                    duration_ms=(time.monotonic() - started) * 1000,
                )
                engine.camera = session.data
                engine.camera_message_id = getattr(session, "msg_id", None)
                engine.last_session = time.time()
            else:
                log_event(
                    OPS_LOG,
                    logging.DEBUG,
                    "camera_session_reused",
                    message="Session vidéo récente réutilisée sans nouvel appel Cloud",
                )
            if viewer:
                engine.camera_owner = viewer
                engine.camera_viewers.add(viewer)
            elif hasattr(engine, "camera_viewers"):
                # L’échéance évite qu’une interface ancienne garde la caméra réservée après sa déconnexion.
                engine.camera_viewers.add("legacy")
                viewer = "legacy"
            engine.camera_viewer_expiries[viewer] = camera_viewer_deadline(req)
            schedule_camera_expiry(engine)
            if engine.camera_close_task and not engine.camera_close_task.done():
                engine.camera_close_task.cancel()
            return web.json_response(engine.camera, headers={"Cache-Control": "no-store"})


def camera_viewer_deadline(request):
    """Renouvelle le spectateur pour trois minutes, sans dépasser sa session web."""
    now_monotonic = time.monotonic()
    expires = request.get("session_expires") if hasattr(request, "get") else None
    if isinstance(expires, (int, float)) and not isinstance(expires, bool):
        return min(now_monotonic + CAMERA_VIEWER_TTL, expires)
    return now_monotonic + CAMERA_VIEWER_TTL


async def camera_presence(req, engine, verify_printer_target):
    """Renouvelle localement un viewer actif sans demander de session ni envoyer d’ordre caméra."""
    viewer = req.headers.get("X-Camera-Viewer") or "legacy"
    if viewer != "legacy" and not re.fullmatch(r"[a-f0-9-]{36}", viewer):
        raise ValueError("Session vidéo invalide")
    # La fermeture différée doit voir ce renouvellement avant de décider d’envoyer sa commande.
    async with engine.lock:
        verify_printer_target(req, engine)
        deadline = engine.camera_viewer_expiries.get(viewer)
        if viewer not in engine.camera_viewers or deadline is None:
            raise ValueError("Session vidéo expirée")
        if deadline <= time.monotonic():
            engine.camera_viewers.discard(viewer)
            engine.camera_viewer_expiries.pop(viewer, None)
            expiry = engine.camera_expiry_task
            if expiry and not expiry.done():
                expiry.cancel()
            engine.camera_expiry_task = None
            if engine.camera_viewer_expiries:
                schedule_camera_expiry(engine)
            elif engine.printer:
                previous = engine.camera_close_task
                if previous and not previous.done():
                    previous.cancel()
                engine.camera_close_task = asyncio.create_task(
                    close_idle_camera(engine, str(engine.printer.id))
                )
            raise ValueError("Session vidéo expirée")
        engine.camera_viewer_expiries[viewer] = camera_viewer_deadline(req)
        schedule_camera_expiry(engine)
    return web.json_response({"ok": True})


def prune_camera_viewers(engine):
    """Retire les onglets dont la session web n’a pas renouvelé son échéance."""
    now_monotonic = time.monotonic()
    expired = [
        viewer
        for viewer, deadline in engine.camera_viewer_expiries.items()
        if deadline <= now_monotonic
    ]
    for viewer in expired:
        engine.camera_viewer_expiries.pop(viewer, None)
        engine.camera_viewers.discard(viewer)


def schedule_camera_expiry(engine):
    """Recalcule l’échéance la plus proche quand un onglet rejoint une autre session web."""
    task = engine.camera_expiry_task
    if task and not task.done():
        task.cancel()
    engine.camera_expiry_task = asyncio.create_task(expire_camera_viewers(engine))


async def expire_camera_viewers(engine):
    """Attend l’échéance la plus proche et programme la fermeture si aucun onglet ne revient."""
    try:
        while engine.camera_viewer_expiries:
            deadline = min(engine.camera_viewer_expiries.values())
            await asyncio.sleep(max(0, deadline - time.monotonic()))
            async with engine.lock:
                prune_camera_viewers(engine)
                if not engine.camera_viewer_expiries:
                    if engine.printer:
                        previous = engine.camera_close_task
                        if previous and not previous.done():
                            previous.cancel()
                        engine.camera_close_task = asyncio.create_task(
                            close_idle_camera(engine, str(engine.printer.id))
                        )
                    return
    finally:
        if engine.camera_expiry_task is asyncio.current_task():
            engine.camera_expiry_task = None


async def close_idle_camera(engine, target):
    """Envoie une fermeture unique après le départ du dernier spectateur de l’atelier."""
    await asyncio.sleep(3)
    async with engine.lock:
        async with engine.command_lock:
            if (
                engine.camera_viewers
                or not engine.api
                or not engine.printer
                or str(engine.printer.id) != target
            ):
                return
            registry = getattr(engine, "fleet_registry", None)
            if registry and printer_key(target) not in registry.catalogue():
                return
            engine.camera = None
            engine.camera_owner = None
            started = time.monotonic()
            try:
                request = AnycubicBaseOrderRequest(
                    order_id=AnycubicOrderID.CAMERA_CLOSE, printer_id=target
                )
                await engine.api._send_anycubic_order(order_request=request)
            except Exception as error:
                engine.event("Caméra", "Fermeture non confirmée (" + type(error).__name__ + ")")
                log_event(
                    OPS_LOG,
                    logging.WARNING,
                    "camera_close_uncertain",
                    message="Fermeture du flux non confirmée par le Cloud",
                    error_type=type(error).__name__,
                    duration_ms=(time.monotonic() - started) * 1000,
                )
            else:
                log_event(
                    OPS_LOG,
                    logging.INFO,
                    "camera_close_submitted",
                    message="Demande de fermeture du flux transmise au Cloud",
                    duration_ms=(time.monotonic() - started) * 1000,
                )


async def camera_close(req, engine, verify_printer_target):
    """Libère la session vidéo du navigateur et programme la fermeture si le flux est inutilisé."""
    viewer = req.headers.get("X-Camera-Viewer")
    if not viewer or not re.fullmatch(r"[a-f0-9-]{36}", viewer):
        raise ValueError("Session vidéo invalide")
    async with engine.lock:
        verify_printer_target(req, engine)
        # Un départ peut parvenir avant l’ouverture lorsque le navigateur ferme l’onglet.
        now_monotonic = time.monotonic()
        while (
            engine.camera_departures
            and next(iter(engine.camera_departures.values())) <= now_monotonic
        ):
            engine.camera_departures.popitem(last=False)
        engine.camera_departures.pop(viewer, None)
        engine.camera_departures[viewer] = now_monotonic + 120
        while len(engine.camera_departures) > 128:
            engine.camera_departures.popitem(last=False)
        if viewer in engine.camera_viewers:
            engine.camera_viewers.remove(viewer)
            engine.camera_viewer_expiries.pop(viewer, None)
            if not engine.camera_viewers:
                expiry = engine.camera_expiry_task
                if expiry and not expiry.done():
                    expiry.cancel()
                engine.camera_expiry_task = None
            if not engine.camera_viewers and engine.printer:
                previous = engine.camera_close_task
                if previous and not previous.done():
                    previous.cancel()
                engine.camera_close_task = asyncio.create_task(
                    close_idle_camera(engine, str(engine.printer.id))
                )
    return web.json_response({"ok": True}, status=202)
