"""Transport Cloud journalise ses résultats sans paramètres ni réponses brutes."""

import logging
import unittest
from unittest.mock import AsyncMock, patch

from anycubic_cloud_api.api.base import AnycubicHTTPUnauthorized
from anycubic_cloud_api.const.api_endpoints import API_ENDPOINT
from anycubic_cloud_api.models.http import AnycubicAPIEndpoint, HTTP_METHODS
from server import CloudPageAPI
from session_api import SessionRecovery


class CloudRequestLoggingTests(unittest.IsolatedAsyncioTestCase):
    """Les tests interceptent le parent async; aucun transport ni compte n’est créé."""

    async def test_known_endpoint_logs_method_duration_and_cloud_code_only(self):
        """Le diagnostic d’un appel ne doit pas rendre visibles ses paramètres ou son résultat privé."""
        api = object.__new__(CloudPageAPI)
        response = {"code": 1, "data": {"private": "response-payload"}}
        with (
            patch.object(
                SessionRecovery,
                "_fetch_api_resp",
                new=AsyncMock(return_value=response),
            ) as base_call,
            patch("printer_engine.log_event") as emit,
        ):
            result = await api._fetch_api_resp(
                API_ENDPOINT.printer_info,
                query={"printer_id": "private-printer"},
                params={"token": "fixture-secret", "payload": "private-request"},
                extra_headers={"Authorization": "private-auth"},
            )

        self.assertIs(result, response)
        base_call.assert_awaited_once()
        fields = emit.call_args.kwargs
        self.assertEqual(emit.call_args.args[1], logging.DEBUG)
        self.assertEqual(emit.call_args.args[2], "cloud_request")
        self.assertEqual(fields["endpoint"], "printer_info")
        self.assertEqual(fields["method"], "GET")
        self.assertEqual(fields["cloud_code"], 1)
        self.assertEqual(fields["outcome"], "json_success")
        self.assertNotIn("fixture-secret", str(emit.call_args))
        self.assertNotIn("private-printer", str(emit.call_args))
        self.assertNotIn("private-request", str(emit.call_args))
        self.assertNotIn("response-payload", str(emit.call_args))
        self.assertNotIn("private-auth", str(emit.call_args))

    async def test_unlisted_endpoint_path_is_replaced_by_custom(self):
        """Un endpoint ajouté par un client ne doit jamais exposer son chemin privé dans les logs."""
        api = object.__new__(CloudPageAPI)
        response = {"code": 10001, "data": None}
        custom = AnycubicAPIEndpoint(HTTP_METHODS.POST, "/private/customer/path")
        with (
            patch.object(
                SessionRecovery,
                "_fetch_api_resp",
                new=AsyncMock(return_value=response),
            ),
            patch("printer_engine.log_event") as emit,
        ):
            await api._fetch_api_resp(custom)

        fields = emit.call_args.kwargs
        self.assertEqual(fields["endpoint"], "custom")
        self.assertEqual(fields["method"], "POST")
        self.assertEqual(fields["cloud_code"], 10001)
        self.assertEqual(fields["outcome"], "json_non_success")
        self.assertNotIn("/private/customer/path", str(emit.call_args))

    async def test_transport_failure_logs_type_and_safe_frames_only(self):
        """L’échec doit rester localisable sans reproduire le texte sensible de son exception."""
        api = object.__new__(CloudPageAPI)
        error = AnycubicHTTPUnauthorized()
        with (
            patch.object(
                SessionRecovery,
                "_fetch_api_resp",
                new=AsyncMock(side_effect=error),
            ) as base_call,
            patch("printer_engine.log_event") as emit,
        ):
            with self.assertRaises(AnycubicHTTPUnauthorized):
                await api._fetch_api_resp(API_ENDPOINT.printer_info)

        base_call.assert_awaited_once()
        fields = emit.call_args.kwargs
        self.assertEqual(emit.call_args.args[1], logging.WARNING)
        self.assertEqual(fields["error_type"], "AnycubicHTTPUnauthorized")
        self.assertEqual(fields["status"], 401)
        self.assertTrue(fields["frames"])
        self.assertNotIn("Refus HTTP", str(emit.call_args))


if __name__ == "__main__":
    unittest.main()
