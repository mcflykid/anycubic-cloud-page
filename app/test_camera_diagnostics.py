"""Diagnostics caméra sur fixtures privées fictives, sans cloud ni ouverture de flux réel."""

import json, unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch
from anycubic_cloud_api.api.functions import AnycubicAPIFunctions
from anycubic_cloud_api.exceptions.exceptions import AnycubicCameraSessionError
import server as adapter


def agora():
    """Renvoie une session fictive complète ; ses valeurs ne doivent jamais entrer dans un diagnostic."""
    return {
        "code": 1,
        "data": {
            "msgid": "fixture-private-session",
            "shengwang": {
                "appid": "fixture-private-app",
                "channel": "fixture-private-channel",
                "rtc_token": "fixture-private-token",
                "client_uid": "123",
                "encryption_kdf_salt": "Zml4dHVyZQ==",
                "encryption_key": "fixture-private-key",
                "encryption_mode": "AES_128_GCM2",
            },
            "shengwang_device": {"uid": 456},
        },
    }


class CameraDiagnostics(unittest.IsolatedAsyncioTestCase):
    """Les erreurs de schéma sont distinctes du transport et ne publient aucune valeur de la réponse."""

    async def session(self, response):
        """Appelle uniquement une fonction de parsing avec un transport simulé."""
        client = SimpleNamespace(_fetch_api_resp=AsyncMock(return_value=response))
        return await AnycubicAPIFunctions.get_camera_session(client, SimpleNamespace(id=1))

    async def test_agora_open_uses_numeric_order_and_top_level_flag(self):
        """La forme déjà acceptée par les réponses Agora reste circonscrite à l’ouverture."""
        for response in (agora(), {"code": 0, "data": agora()["data"]}, {"code": 1, "data": []}):
            client = SimpleNamespace(_fetch_api_resp=AsyncMock(return_value=response))
            if response["code"] == 1 and isinstance(response["data"], dict):
                await AnycubicAPIFunctions.get_camera_session(client, SimpleNamespace(id=42))
            else:
                with self.assertRaises(AnycubicCameraSessionError):
                    await AnycubicAPIFunctions.get_camera_session(client, SimpleNamespace(id=42))
            params = client._fetch_api_resp.call_args.kwargs["params"]
            self.assertEqual(
                params, {"order_id": 1001, "printer_id": 42, "shengwang_rtc_support": True}
            )
            self.assertIs(type(params["order_id"]), int)

    async def test_missing_invalid_and_legacy_responses_are_distinct(self):
        """Les trois raisons sont fixes ; aucun champ privé ne peut devenir un message d’erreur."""
        cases = [
            ({"code": 1, "data": {}}, "missing_credentials"),
            ({"code": 1, "data": {"shengwang": {}}}, "missing_credentials"),
            ({"code": 1, "data": "fixture-private-response"}, "invalid_format"),
            ({"code": 1, "data": {"shengwang": "fixture-private-response"}}, "invalid_format"),
            (
                {"code": 1, "data": {"token": {"tmpSecretKey": "fixture-private-legacy"}}},
                "unsupported_transport",
            ),
        ]
        for body, reason in cases:
            with self.subTest(reason=reason):
                with self.assertRaises(AnycubicCameraSessionError) as caught:
                    await self.session(body)
                self.assertEqual(caught.exception.reason, reason)
                self.assertNotIn("fixture-private", repr(caught.exception))
                self.assertFalse(adapter.camera_transport_failure(caught.exception))

    async def test_invalid_uids_do_not_escape_as_value_errors_with_private_content(self):
        """La conversion int ne doit jamais recopier la valeur reçue dans une erreur publique."""
        for field in ["client_uid", "printer_uid"]:
            body = agora()
            if field == "client_uid":
                body["data"]["shengwang"]["client_uid"] = "fixture-private-bad-uid"
            else:
                body["data"]["shengwang_device"]["uid"] = "fixture-private-bad-uid"
            with self.assertRaises(AnycubicCameraSessionError) as caught:
                await self.session(body)
            self.assertEqual(caught.exception.reason, "invalid_format")
            self.assertNotIn("fixture-private", str(caught.exception))

    async def test_valid_session_preserves_runtime_values_but_redacts_repr(self):
        """Le lecteur reçoit ses paramètres inchangés ; les diagnostics ne contiennent que leur présence."""
        body = agora()
        result = await self.session(body)
        self.assertEqual(result.rtc_token, body["data"]["shengwang"]["rtc_token"])
        self.assertEqual(result.client_uid, 123)
        self.assertEqual(result.printer_uid, 456)
        self.assertNotIn("fixture-private", repr(result))
        self.assertNotIn("fixture-private", json.dumps(result.safe_summary))
        self.assertTrue(result.safe_summary["has_rtc_token"])

    def test_video_diagnostics_ignore_foreign_old_and_out_of_order_reports(self):
        """Un rapport ne peut décrire une autre machine ou session, ni faire régresser une étape déjà confirmée."""
        e = adapter.Engine()
        e.printer = SimpleNamespace(key="fixture-machine")
        e.camera_message_id = "fixture-session"
        topic = "anycubic/anycubicCloud/v1/printer/app/20025/fixture-machine/video"
        payload = {
            "type": "video",
            "action": "startCapture",
            "state": "pushStarted",
            "msgid": "old-session",
            "data": {"secret": "fixture-private-response"},
        }
        e.receive_video_reply(topic, payload)
        self.assertIsNone(e.camera_diagnostic)
        payload["msgid"] = "fixture-session"
        e.receive_video_reply(topic.replace("fixture-machine", "other-machine"), payload)
        self.assertIsNone(e.camera_diagnostic)
        e.receive_video_reply(topic, payload)
        self.assertEqual(e.camera_diagnostic["stage"], "pushStarted")
        self.assertNotIn("fixture", json.dumps(e.camera_diagnostic))
        payload["state"] = "initSuccess"
        e.receive_video_reply(topic, payload)
        self.assertEqual(e.camera_diagnostic["stage"], "pushStarted")
        payload["state"] = "unknown"
        e.receive_video_reply(topic, payload)
        self.assertEqual(e.camera_diagnostic["stage"], "pushStarted")

    async def test_json_and_events_contain_only_sanitized_reason(self):
        """La frontière HTTP conserve le diagnostic français et aucun corps fournisseur ni identifiant."""
        engine = SimpleNamespace(event=Mock())

        async def failing(req):
            """Simule une réponse caméra mal formée sans réseau."""
            return await self.session({"code": 1, "data": "fixture-private-response"})

        with patch.object(adapter, "engine", engine):
            response = await adapter.errors(
                SimpleNamespace(path="/imprimante-api/camera-session"), failing
            )
        result = json.loads(response.body)
        self.assertEqual(response.status, 409)
        self.assertEqual(result["camera_error"], "invalid_format")
        self.assertIn("format invalide", result["message"])
        self.assertNotIn("fixture-private", response.text)
        self.assertNotIn("fixture-private", str(engine.event.call_args))
