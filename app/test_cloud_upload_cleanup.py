"""Cycle de quota cloud avec transport simulé et fichier de démonstration."""
import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

from anycubic_cloud_api.models.cloud_upload import AnycubicCloudUpload


class CloudUploadCleanup(unittest.IsolatedAsyncioTestCase):
    """La réservation est libérée dans les cas d’échec et d’annulation."""

    async def test_failure_and_cancellation_release_quota(self):
        """Un échec du PUT ne valide pas le fichier et demande le nettoyage."""
        for failure in (TimeoutError(), asyncio.CancelledError()):
            with self.subTest(failure=type(failure).__name__):
                api = SimpleNamespace(
                    _lock_storage_space=AsyncMock(return_value={'id': 42, 'preSignUrl': 'https://example.test/upload'}),
                    _fetch_aws_put_resp=AsyncMock(side_effect=failure),
                    _claim_file_upload_from_aws=AsyncMock(),
                    _unlock_storage_space=AsyncMock(),
                    _log_to_debug=Mock(),
                )
                upload = AnycubicCloudUpload(api, file_name='fixture.gcode', file_bytes=b'G28', is_temp_file=True)
                with self.assertRaises(type(failure)) as caught:
                    await upload.async_process_upload()
                self.assertIs(caught.exception, failure)
                api._claim_file_upload_from_aws.assert_not_awaited()
                api._unlock_storage_space.assert_awaited_once_with(42, is_delete_cos=True)
