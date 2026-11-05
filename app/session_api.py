# SPDX-License-Identifier: GPL-3.0-or-later
"""Rétablissement des sessions explicitement refusées sans rejouer les opérations ambiguës."""
import asyncio,time
from anycubic_cloud_api.exceptions.exceptions import AnycubicAuthError

class CloudSessionAuthError(AnycubicAuthError):"""Signale qu’une session cloud explicitement refusée ne peut pas être rétablie immédiatement.""";pass

class SessionRecovery:
 """Renouvelle une session refusée une seule fois entre requêtes concurrentes, sans rejouer les échecs ambigus."""
 def __init__(self,*args,refresh_access=None,session_renewed=None,**kwargs):
  """Configure les rappels de renouvellement et le verrou partagé des échanges de session."""
  self._session_lock=asyncio.Lock();self._session_generation=0;self._session_retry_after=0
  self._refresh_access=refresh_access;self._session_renewed=session_renewed
  super().__init__(*args,**kwargs)
 @staticmethod
 def _expired(response):
  return isinstance(response,dict) and str(response.get('code'))=='10001'
 async def _fetch_api_resp(self,*args,**kwargs):
  generation=self._session_generation
  response=await super()._fetch_api_resp(*args,**kwargs)
  authenticated=kwargs.get('with_token',args[5] if len(args)>5 else True)
  if not authenticated or not self._expired(response):return response
  async with self._session_lock:
   if generation==self._session_generation:
    if time.monotonic()<self._session_retry_after:raise CloudSessionAuthError('Reconnexion Anycubic en attente')
    try:
     try:await self._get_user_token_with_access_token()
     except AnycubicAuthError:
      if not self._refresh_access:raise
      access=await self._refresh_access()
      self.anycubic_auth.set_access_token(access)
      await self._get_user_token_with_access_token()
     self._session_generation+=1;self._session_retry_after=0
    except Exception:
     self._session_retry_after=time.monotonic()+60
     raise CloudSessionAuthError('Reconnexion Anycubic indisponible') from None
    if self._session_renewed:self._session_renewed(self)
  # Seul un refus explicite prouve l’absence d’exécution : ne pas rejouer un délai expiré ou une réponse illisible.
  response=await super()._fetch_api_resp(*args,**kwargs)
  if self._expired(response):
   self._session_retry_after=time.monotonic()+60
   raise CloudSessionAuthError('Session Anycubic refusée après reconnexion')
  return response
