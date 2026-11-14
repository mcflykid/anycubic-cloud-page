# SPDX-License-Identifier: GPL-3.0-or-later
"""Connexion HTTP et fil de suivi MQTT partagés par les imprimantes d’un compte."""

import asyncio
import threading
from dataclasses import dataclass, field

import aiohttp

from anycubic_cloud_api.models.auth import AnycubicAuthMode
from cloud_budget import CloudRequestBudget


@dataclass
class AccountTransport:
    """Conserve le client, le budget HTTP, la session et le suivi MQTT du compte."""

    api: object | None = None
    session: aiohttp.ClientSession | None = None
    token: str | None = None
    reconnect_required: bool = False
    mqtt_enabled: bool = True
    mqtt_thread: threading.Thread | None = None
    mqtt_auth_pending: bool = False
    mqtt_auth_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    cloud_budget: CloudRequestBudget = field(default_factory=CloudRequestBudget)
    # Une seule mutation Cloud par compte évite les courses entre moteurs d’imprimante.
    cloud_mutation_lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    async def connect(self, account, api_factory, owner, session_renewed, updated, subscribed):
        """Ouvre le client authentifié et découvre les imprimantes du compte."""
        self.reconnect_required = True
        if not self.session:
            # Le profil Slicer n’exige pas d’User-Agent ; préserver les valeurs explicites des parcours web.
            self.session = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=45), skip_auto_headers={"User-Agent"}
            )
        self.token = await account.token(self.session)
        if self.api:
            self.api.disconnect_mqtt()
        if self.mqtt_thread and self.mqtt_thread.is_alive():
            await asyncio.to_thread(self.mqtt_thread.join, 3)
            if self.mqtt_thread.is_alive():
                raise RuntimeError("Reconnexion du suivi en attente")
        self.mqtt_thread = None
        self.mqtt_auth_pending = False

        async def refresh_access():
            self.token = await account.renew_after_rejection(self.session)
            return self.token

        self.api = api_factory(
            self.session,
            self.session.cookie_jar,
            refresh_access=refresh_access,
            session_renewed=session_renewed,
            auth_token=self.token,
            auth_mode=AnycubicAuthMode.SLICER,
            cloud_request_budget=self.cloud_budget,
            mqtt_callback_printer_update=updated,
            mqtt_callback_subscribed=subscribed,
        )
        if not await self.api.check_api_tokens():
            raise RuntimeError("Authentification refusée")
        self.api.cloud_engine = owner
        self.api._mqtt_callback_printer_update = getattr(self.api, "cloud_printer_updated", updated)
        return await self.api.list_my_printers()

    def start(self, report, restore=None):
        """Démarre un seul fil et restaure les abonnements avant sa connexion."""
        if not self.mqtt_enabled or (self.mqtt_thread and self.mqtt_thread.is_alive()):
            return
        if restore:
            restore()
        client = self.api

        def run():
            try:
                client.connect_mqtt()
            except Exception as error:
                report("MQTT", "Connexion indisponible (" + type(error).__name__ + ")")

        self.mqtt_thread = threading.Thread(target=run, daemon=True)
        self.mqtt_thread.start()

    async def restart(self, api, start):
        """Attend l’arrêt du fil ; renvoie True si le suivi redémarre sans client concurrent."""
        async with self.mqtt_auth_lock:
            if self.api is not api or not self.mqtt_auth_pending:
                return False
            api.disconnect_mqtt()
            thread = self.mqtt_thread
            if thread and thread.is_alive():
                await asyncio.to_thread(thread.join, 3)
            if self.api is not api or (thread and thread.is_alive()):
                return False
            self.mqtt_thread = None
            self.mqtt_auth_pending = False
            start()
            return True
