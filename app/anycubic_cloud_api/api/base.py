"""Transport HTTP et authentification du client cloud Anycubic."""
from __future__ import annotations

import asyncio
import json
import os
import time
from typing import Any, BinaryIO, overload

import aiohttp
from aiofiles import open as aio_file_open
from aiofiles.os import path as aio_path

from ..const.api_endpoints import API_ENDPOINT
from ..const.const import (
    ACCESS_TOKEN_LOGIN_RETRIES,
    ACCESS_TOKEN_LOGIN_RETRY_INTERVAL,
    AUTH_DOMAIN,
    BASE_DOMAIN,
    DEFAULT_USER_AGENT,
    MAX_API_FETCH_TIME_WARN,
    PUBLIC_API_ENDPOINT,
    WARN_INTERVAL_API_DURATION,
)
from ..exceptions.error_strings import (
    ErrorsAPIParsing,
    ErrorsAuth,
    ErrorsAuthTokenExpired,
)
from ..exceptions.exceptions import (
    AnycubicAPIParsingError,
    AnycubicAuthError,
    AnycubicAuthTokensExpired,
)
from ..models.auth import AnycubicAuthentication, AnycubicAuthMode
from ..models.http import HTTP_METHODS, AnycubicAPIEndpoint


class AnycubicAPIBase:
    """Client HTTP chargé du transport et de la session Anycubic."""
    __slots__ = (
        "_cached_web_auth_token_path",
        "_base_url",
        "_public_api_root",
        "_session",
        "_sessionjar",
        "_debug_logger",
        "_tokens_changed",
        "_log_api_call_info",
        "_last_warn_api_duration",
        "_anycubic_auth",
    )

    def __init__(
        self,
        session: aiohttp.ClientSession,
        cookie_jar: aiohttp.CookieJar,
        debug_logger: Any = None,
        auth_token: str | None = None,
        auth_mode: AnycubicAuthMode | None = None,
        device_id: str | None = None,
    ) -> None:
        """Réutilise session et cookie_jar de l’appelant ; auth_mode et device_id choisissent la signature constructeur, sans connexion immédiate."""
        self._cached_web_auth_token_path: str | None = None
        self._base_url: str = f"https://{BASE_DOMAIN}/"
        self._public_api_root: str = f"{self.base_url}{PUBLIC_API_ENDPOINT}"
        self._session: aiohttp.ClientSession = session
        self._sessionjar: aiohttp.CookieJar = cookie_jar
        self._debug_logger: Any = debug_logger
        self._tokens_changed: bool = False
        self._log_api_call_info: bool = False
        self._last_warn_api_duration: float | None = None
        self._anycubic_auth: AnycubicAuthentication | None = None

        if auth_token:
            self.set_authentication(
                auth_token=auth_token,
                auth_mode=auth_mode,
                device_id=device_id,
            )

    @property
    def base_url(self) -> str:
        """Racine HTTPS du service cloud."""
        return self._base_url

    def set_log_api_call_info(
        self,
        val: bool,
    ) -> None:
        """Active le diagnostic de durée des appels HTTP sans modifier les requêtes."""
        self._log_api_call_info = bool(val)

    @property
    def anycubic_auth(self) -> AnycubicAuthentication:
        """Authentification courante ; lève AnycubicAuthError si elle n’est pas configurée."""
        if self._anycubic_auth is None:
            raise AnycubicAuthError(ErrorsAuth.missing_auth)
        return self._anycubic_auth

    @property
    def tokens_changed(self) -> bool:
        """Indique si les jetons mémorisés doivent être sauvegardés par l’appelant."""
        return self._tokens_changed

    def _log_to_debug(self, msg: str) -> None:
        if self._debug_logger:
            self._debug_logger.debug(msg)

    def _log_to_warn(self, msg: str) -> None:
        if self._debug_logger:
            self._debug_logger.warning(msg)

    def _log_to_error(self, msg: str) -> None:
        if self._debug_logger:
            self._debug_logger.error(msg)


    def _web_headers(self, with_origin: str | None = AUTH_DOMAIN) -> dict[str, Any]:
        header_dict = {}
        if self.anycubic_auth.requires_user_agent:
            header_dict['User-Agent'] = DEFAULT_USER_AGENT

            if with_origin:
                header_dict['Origin'] = f'https://{with_origin}'

        return header_dict

    def _build_api_url(self, endpoint: AnycubicAPIEndpoint) -> str:
        return f"{self._public_api_root}{endpoint.endpoint}"

    @overload
    async def _fetch_ext_resp(
        self,
        method: HTTP_METHODS,
        base_url: str,
        query: dict[str, Any] | None = None,
        params: dict[str, Any] = {},
        extra_headers: dict[str, Any] = {},
        with_origin: str | None = AUTH_DOMAIN,
        put_data: bytes | BinaryIO | None = None,
        *,
        allow_redirects: bool = True,
    ) -> dict[Any, Any]: ...

    @overload
    async def _fetch_ext_resp(
        self,
        method: HTTP_METHODS,
        base_url: str,
        query: dict[str, Any] | None = None,
        params: dict[str, Any] = {},
        extra_headers: dict[str, Any] = {},
        with_origin: str | None = AUTH_DOMAIN,
        put_data: bytes | BinaryIO | None = None,
        is_json: bool = True,
        return_url: bool = False,
        *,
        allow_redirects: bool = True,
    ) -> dict[Any, Any] | str: ...

    async def _fetch_ext_resp(
        self,
        method: HTTP_METHODS,
        base_url: str,
        query: dict[str, Any] | None = None,
        params: dict[str, Any] | list[Any] | str | None = {},
        extra_headers: dict[str, Any] = {},
        with_origin: str | None = AUTH_DOMAIN,
        put_data: bytes | BinaryIO | None = None,
        is_json: bool = True,
        return_url: bool = False,
        *,
        allow_redirects: bool = True,
    ) -> dict[Any, Any] | str:
        url = base_url
        time_start = time.monotonic()
        headers = {**self._web_headers(with_origin=with_origin), **extra_headers}
        if method == HTTP_METHODS.POST:
            if params is not None and (isinstance(params, dict) or isinstance(params, list)):
                data = json.dumps(params)
            elif params is not None:
                data = str(params)
            else:
                data = None
            h_coro = self._session.post(
                url, params=query, data=data, headers=headers, allow_redirects=allow_redirects
            )
        elif method == HTTP_METHODS.PUT:
            # Le transfert signé suit sa taille, indépendamment des appels API courts.
            size = len(put_data or b'') if isinstance(put_data, (bytes, type(None))) else os.fstat(put_data.fileno()).st_size
            transfer_seconds = min(3600, 120 + size / 32768)
            h_coro = self._session.put(url, params=query, data=put_data, headers=headers,
                                       timeout=aiohttp.ClientTimeout(total=transfer_seconds, sock_connect=30, sock_read=120))
        else:
            if allow_redirects:
                h_coro = self._session.get(url, params=query, headers=headers)
            else:
                dispatched = False

                async def once(request, handler):
                    # Le firmware utilise un GET alors qu’une reconnexion peut rejouer cette mutation.
                    nonlocal dispatched
                    if dispatched:
                        raise AnycubicAPIParsingError('Résultat de la demande Anycubic inconnu')
                    dispatched = True
                    return await handler(request)

                h_coro = self._session.get(
                    url, params=query, headers=headers, allow_redirects=False, middlewares=(once,)
                )

        response_url = None

        status = None
        try:
            async with h_coro as resp:
                status = resp.status
                if not allow_redirects and 300 <= status < 400:
                    raise AnycubicAPIParsingError(f'Ordre Anycubic redirigé (HTTP {status})')
                if method == HTTP_METHODS.PUT and not 200 <= resp.status < 300:
                    raise AnycubicAPIParsingError(f'Transfert cloud refusé (HTTP {status})')
                if is_json:
                    resp_data: dict[str, Any] | str = await resp.json()
                else:
                    resp_data = await resp.text()

                response_url = resp.url
        except asyncio.TimeoutError as error:
            raise AnycubicAPIParsingError('Délai de réponse Anycubic dépassé') from error
        except (aiohttp.ContentTypeError, ValueError, UnicodeError) as error:
            suffix = f' (HTTP {status})' if status is not None else ''
            raise AnycubicAPIParsingError(f'Réponse Anycubic illisible{suffix}') from error
        except aiohttp.ClientResponseError as error:
            raise AnycubicAPIParsingError(f'Requête Anycubic refusée (HTTP {error.status})') from error
        except (aiohttp.ClientError, OSError) as error:
            raise AnycubicAPIParsingError('Connexion Anycubic interrompue') from error

        time_end = time.monotonic()
        time_diff: float = time_end - time_start
        over_limit: bool = int(time_diff) > MAX_API_FETCH_TIME_WARN
        if (
            over_limit
            and (
                self._last_warn_api_duration is None
                or time_end >= self._last_warn_api_duration + WARN_INTERVAL_API_DURATION
            )
        ):
            self._last_warn_api_duration = time_end
            self._log_to_warn(
                f"Responses from server are taking over {MAX_API_FETCH_TIME_WARN}s (Took {int(time_diff)}s)"
            )
        if self._log_api_call_info:
            destination = 'stockage cloud' if method == HTTP_METHODS.PUT else 'API Anycubic'
            self._log_to_debug(
                f"Finished fetching {destination} in {time_diff:.2f}s."
            )

        if return_url:
            return str(response_url)
        return resp_data

    async def _fetch_aws_put_resp(self, final_url: str, put_data: bytes | BinaryIO) -> dict[Any, Any] | str:
        resp = await self._fetch_ext_resp(
            method=HTTP_METHODS.PUT,
            base_url=final_url,
            is_json=False,
            put_data=put_data,
        )

        if isinstance(resp, str) and len(resp) > 0:
            raise AnycubicAPIParsingError(ErrorsAPIParsing.api_error_aws.format(resp))

        return resp

    async def _fetch_api_resp(
        self,
        endpoint: AnycubicAPIEndpoint,
        query: dict[str, Any] | None = None,
        params: dict[str, Any] = {},
        extra_headers: dict[str, Any] = {},
        with_origin: str | None = AUTH_DOMAIN,
        with_token: bool = True,
    ) -> dict[Any, Any]:
        resp = await self._fetch_ext_resp(
            method=endpoint.method,
            base_url=self._build_api_url(endpoint),
            query=query,
            params=params,
            extra_headers=self.anycubic_auth.get_auth_headers(
                with_token=with_token
            ),
            with_origin=with_origin,
            # Une redirection 307/308 peut rejouer le POST après réception de l’ordre.
            allow_redirects=endpoint not in (
                API_ENDPOINT.send_order,
                API_ENDPOINT.printer_firmware_update,
                API_ENDPOINT.printer_multi_color_box_firmware_update,
            ),
        )
        return resp


    def set_authentication(
        self,
        auth_token: str | None,
        auth_mode: AnycubicAuthMode | int | None = None,
        device_id: str | None = None,
        auth_access_token: str | None = None,
        auto_pick_token: bool = True,
    ) -> None:
        """Configure les jetons ; auto_pick_token traite le jeton Slicer comme un jeton d’accès. Lève AnycubicAuthError si les données ou l’état requis sont invalides."""
        if not auth_token and not auth_access_token:
            raise AnycubicAuthError(ErrorsAuth.set_auth_missing_token)

        if isinstance(auth_mode, int):
            auth_mode = AnycubicAuthMode(auth_mode)

        if (
            auto_pick_token and (
                not auth_access_token
                and auth_mode == AnycubicAuthMode.SLICER
            )
        ):
            auth_access_token = f"{auth_token}"
            auth_token = None

        self._anycubic_auth = AnycubicAuthentication(
            auth_token=auth_token,
            auth_mode=auth_mode,
            device_id=device_id,
            auth_access_token=auth_access_token,
        )

    async def _get_user_token_with_access_token_with_retry(self) -> None:
        retries = ACCESS_TOKEN_LOGIN_RETRIES
        for x in range(retries):
            try:
                await self._get_user_token_with_access_token()
                return
            except AnycubicAuthError:
                if x < retries - 1:
                    await asyncio.sleep(ACCESS_TOKEN_LOGIN_RETRY_INTERVAL)
                else:
                    raise

    async def _get_user_token_with_access_token(self) -> None:
        params = self.anycubic_auth.auth_access_token_payload
        resp = await self._fetch_api_resp(
            endpoint=API_ENDPOINT.auth_sig_token,
            query=None,
            params=params,
            with_token=False,
        )
        if not isinstance(resp, dict) or not isinstance(resp.get('data'), dict) or not isinstance(resp['data'].get('token'), str) or not resp['data']['token']:
            # Le fournisseur peut inclure sa requête dans msg : ne jamais recopier ce texte dans un diagnostic.
            error_message = 'Connexion de session Anycubic refusée'
            self._log_to_debug(f'{error_message}; has_response={resp is not None}')
            raise AnycubicAuthError(error_message)
        self.anycubic_auth.set_auth_token(
            resp['data']['token']
        )
        self._log_to_debug("Logged in and retrieved user token with access_token.")

    def get_auth_config_dict(self) -> dict[str, Any]:
        """Renvoie la configuration privée à persister, contenant les jetons d’authentification."""
        self._tokens_changed = False

        return self.anycubic_auth.get_auth_config_dict()

    def load_auth_config_from_dict(
        self,
        data: dict[str, Any],
        minimal: bool = False,
    ) -> None:
        """Restaure les jetons privés ; minimal limite les champs restaurés."""
        self.anycubic_auth.load_auth_config_from_dict(
            data,
            minimal=minimal,
        )
        self._log_to_debug("Loaded auth tokens from dict.")

    async def _load_cached_web_auth_token(self) -> None:
        if (
            self._cached_web_auth_token_path is not None
            and (await aio_path.exists(self._cached_web_auth_token_path))
        ):

            try:
                async with aio_file_open(self._cached_web_auth_token_path, mode='r') as wo:
                    token = await wo.read()
                self.set_authentication(
                    auth_token=token,
                )

            except Exception:
                pass

    async def _check_can_access_api(
        self,
    ) -> bool:
        await self._load_cached_web_auth_token()
        if self.anycubic_auth.requires_access_token:
            try:
                await self._get_user_token_with_access_token_with_retry()
            except AnycubicAuthError as error:
                self._log_to_debug(f"Access-token login failed: {error}")
                return False
        try:
            await self.get_user_info()
            return True
        except AnycubicAuthTokensExpired:
            self._log_to_debug("Tokens expired.")
            return False
        except AnycubicAuthError as error:
            self._log_to_debug(f"User-info auth check failed: {error}")
            return False

    async def check_api_tokens(self) -> bool:
        """Renvoie si l’API est accessible après éventuel renouvellement du jeton de session."""
        if not await self._check_can_access_api():
            if self.anycubic_auth.clear_cached_access_user_token():
                self._tokens_changed = True
                self._log_to_debug("Cleared cached user token.")
                return await self._check_can_access_api()
            return False

        return True

    async def get_user_info(
        self,
        raw_data: bool = False,
    ) -> dict[str, Any]:
        """Renvoie les informations du compte et met à jour son identité locale ; raw_data conserve l’enveloppe cloud. Lève AnycubicAPIParsingError, AnycubicAuthTokensExpired si les données ou l’état requis sont invalides."""
        resp = await self._fetch_api_resp(endpoint=API_ENDPOINT.user_info)
        if raw_data:
            return resp

        data: dict[str, Any] | None = resp['data']
        if resp and resp.get('msg') == 'request error':
            raise AnycubicAPIParsingError(ErrorsAPIParsing.api_error_user_server_maintenance)
        if data is None:
            raise AnycubicAuthTokensExpired(ErrorsAuthTokenExpired.invalid_credentials)

        self.anycubic_auth.set_api_user_id(data['id'])
        self.anycubic_auth.set_api_user_email(data['user_email'])

        return data
