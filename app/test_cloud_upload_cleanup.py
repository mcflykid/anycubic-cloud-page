"""Cycle de quota cloud avec transport simulé et fichier de démonstration."""

import asyncio
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from functools import partial

from anycubic_cloud_api.models.cloud_upload import AnycubicCloudUpload
from anycubic_cloud_api.api.functions import AnycubicAPIFunctions
from anycubic_cloud_api.exceptions.exceptions import AnycubicFileNotFoundError


class CloudUploadCleanup(unittest.IsolatedAsyncioTestCase):
    """La réservation est libérée dans les cas d’échec et d’annulation."""

    async def test_local_file_measurement_uses_real_async_stat(self):
        """Le chemin multipart doit être mesurable sans remplacer aiofiles par un faux lecteur."""
        with TemporaryDirectory() as directory:
            path = Path(directory) / "fixture.gcode"
            path.write_bytes(b"; fixture, aucun envoi\n")
            upload = AnycubicCloudUpload(api_parent=SimpleNamespace(), full_file_path=str(path))
            await upload.async_check_path_is_valid()
            await upload.async_measure_file()
            self.assertEqual(upload.file_size, path.stat().st_size)

    async def test_local_upload_streams_file_and_releases_reservation(self):
        """Le parcours fichier complet mesure puis transfère sans conserver les octets en mémoire."""
        with TemporaryDirectory() as directory:
            path = Path(directory) / "fixture.gcode"
            content = b"; aucun ordre, transport simule\n"
            path.write_bytes(content)

            async def receive(*, final_url, put_data):
                self.assertEqual(final_url, "https://example.test/upload")
                self.assertEqual(put_data.read(), content)

            api = SimpleNamespace(
                get_user_cloud_store=AsyncMock(
                    side_effect=[
                        SimpleNamespace(available_bytes=1024),
                        SimpleNamespace(available_bytes=1024 - len(content)),
                    ]
                ),
                _lock_storage_space=AsyncMock(
                    return_value={"id": 42, "preSignUrl": "https://example.test/upload"}
                ),
                _fetch_aws_put_resp=AsyncMock(side_effect=receive),
                _claim_file_upload_from_aws=AsyncMock(return_value=99),
                _unlock_storage_space=AsyncMock(),
                _log_to_debug=Mock(),
            )
            upload = AnycubicCloudUpload(api, full_file_path=str(path))
            self.assertEqual(await upload.async_process_upload(), 99)
            api._lock_storage_space.assert_awaited_once_with(
                file_size=len(content), file_name="fixture.gcode", is_temp_file=False
            )
            api._unlock_storage_space.assert_awaited_once_with(42, is_delete_cos=False)
            api._fetch_aws_put_resp.assert_awaited_once()
            self.assertIsNone(upload.file_bytes)

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

    async def test_saved_and_temporary_uploads_send_at_most_one_order(self):
        """Les deux chemins passent par le vrai choix de reprise du client."""
        printer = SimpleNamespace(id=7, primary_multi_color_box=None)
        send = AsyncMock()
        upload = AsyncMock(return_value=42)
        file = SimpleNamespace(id=42, gcode_id=80, slice_material_info_list=[])
        api = SimpleNamespace(
            upload_file_to_cloud=upload,
            get_latest_cloud_file=AsyncMock(return_value=file),
            fetch_project_gcode_info_fdm=AsyncMock(return_value=file),
            _send_order_start_print=send,
        )
        api.print_with_cloud_file_id = partial(AnycubicAPIFunctions.print_with_cloud_file_id, api)
        api.print_with_cloud_gcode_id = partial(AnycubicAPIFunctions.print_with_cloud_gcode_id, api)
        for method, temporary in (
            (AnycubicAPIFunctions.print_and_upload_save_in_cloud, False),
            (AnycubicAPIFunctions.print_and_upload_no_cloud_save, True),
        ):
            with self.subTest(temporary=temporary):
                upload.reset_mock()
                send.reset_mock(side_effect=True)
                send.return_value = None
                response = await method(api, printer, file_name="fixture.gcode", file_bytes=b"G28")
                self.assertIsNone(response.order_msg_id)
                self.assertEqual(response.event_dict["saved_in_cloud"], not temporary)
                self.assertEqual(upload.await_args.kwargs.get("temp_file", False), temporary)
                send.assert_awaited_once()

                send.reset_mock()
                send.side_effect = AnycubicFileNotFoundError()
                with self.assertRaises(AnycubicFileNotFoundError):
                    await method(api, printer, file_name="fixture.gcode", file_bytes=b"G28")
                send.assert_awaited_once()
