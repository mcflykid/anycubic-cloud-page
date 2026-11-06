"""Cycle de quota cloud avec transport simulé et fichier de démonstration."""

import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

from anycubic_cloud_api.models.cloud_upload import AnycubicCloudUpload
from anycubic_cloud_api.api.functions import AnycubicAPIFunctions
from anycubic_cloud_api.exceptions.exceptions import AnycubicFileNotFoundError


class CloudUploadCleanup(unittest.IsolatedAsyncioTestCase):
    """La réservation est libérée dans les cas d’échec et d’annulation."""

    async def test_failure_and_cancellation_release_quota(self):
        """Un échec du PUT ne valide pas le fichier et demande le nettoyage."""
        for failure in (TimeoutError(), asyncio.CancelledError()):
            with self.subTest(failure=type(failure).__name__):
                api = SimpleNamespace(
                    _lock_storage_space=AsyncMock(
                        return_value={"id": 42, "preSignUrl": "https://example.test/upload"}
                    ),
                    _fetch_aws_put_resp=AsyncMock(side_effect=failure),
                    _claim_file_upload_from_aws=AsyncMock(),
                    _unlock_storage_space=AsyncMock(),
                    _log_to_debug=Mock(),
                )
                upload = AnycubicCloudUpload(
                    api, file_name="fixture.gcode", file_bytes=b"G28", is_temp_file=True
                )
                with self.assertRaises(type(failure)) as caught:
                    await upload.async_process_upload()
                self.assertIs(caught.exception, failure)
                api._claim_file_upload_from_aws.assert_not_awaited()
                api._unlock_storage_space.assert_awaited_once_with(42, is_delete_cos=True)

    async def test_missing_print_acknowledgement_never_repeats_order(self):
        """Une réponse sans identifiant reste incertaine même avec reprise explicite autorisée."""
        printer = SimpleNamespace(primary_multi_color_box=None)
        send = AsyncMock(return_value=None)
        api = SimpleNamespace(_send_order_start_print=send)
        for options in ({}, {"allow_retry": True}):
            self.assertIsNone(
                await AnycubicAPIFunctions.print_with_cloud_file_id(api, printer, 42, **options)
            )
            send.assert_awaited_once()
            send.reset_mock()
        send.side_effect = AnycubicFileNotFoundError()
        with self.assertRaises(AnycubicFileNotFoundError):
            await AnycubicAPIFunctions.print_with_cloud_file_id(api, printer, 42)
        send.assert_awaited_once()
