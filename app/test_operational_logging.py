"""Garantit un format Docker lisible et filtre les contenus sensibles des journaux."""

import io
import json
import logging
from pathlib import Path
import unittest
from unittest.mock import patch

from operational_logging import configure_logging, log_event, request_context, safe_exception_frames


class OperationalLoggingTests(unittest.TestCase):
    """Les journaux de service gardent des diagnostics structurés sans données de compte."""

    def capture(self, fmt="json", level="DEBUG"):
        """Configure un flux mémoire avec les mêmes filtres et formateurs que stderr."""
        stream = io.StringIO()
        with patch.dict("os.environ", {"LOG_FORMAT": fmt, "LOG_LEVEL": level}):
            configure_logging(stream=stream)
        return stream

    def tearDown(self):
        """Retire les handlers mémoire afin de ne pas conserver le flux entre tests."""
        logging.shutdown()
        logging.getLogger().handlers.clear()

    def test_every_line_uses_embedded_version_in_both_formats(self):
        """Les extraits restent attribuables même hors démarrage et le champ d’appel ne falsifie pas la version."""
        expected = json.loads((Path(__file__).resolve().parents[1] / "package.json").read_text())[
            "version"
        ]
        for fmt in ["text", "json"]:
            stream = self.capture(fmt=fmt)
            log_event(
                logging.getLogger("cloud_page.http"),
                logging.INFO,
                "http_request",
                message="Requête terminée",
                version="0.0.0",
            )
            logging.getLogger("server").warning("Relevé de température ignoré (%s)", "fixture")
            lines = stream.getvalue().splitlines()
            self.assertEqual(len(lines), 2)
            for line in lines:
                if fmt == "json":
                    self.assertEqual(json.loads(line)["version"], expected)
                else:
                    self.assertIn("version=" + expected, line)
                self.assertNotIn("0.0.0", line)

    def test_json_event_has_utc_level_component_and_only_whitelisted_fields(self):
        """Un événement structuré expose uniquement le contexte opérationnel autorisé."""
        stream = self.capture()
        log_event(
            logging.getLogger("cloud_page.http"),
            logging.INFO,
            "request_complete",
            message="Lecture terminée",
            method="GET",
            route="/imprimante-api/status",
            status=200,
            duration_ms=17.4,
            request_id="a1b2c3d4e5f60718",
            mqtt_code=0,
            email="person@example.invalid",
            password="fixture-secret",
        )
        record = json.loads(stream.getvalue())
        self.assertTrue(record["timestamp"].endswith("Z"))
        self.assertEqual(record["level"], "INFO")
        self.assertEqual(record["component"], "cloud_page.http")
        self.assertEqual(record["event"], "request_complete")
        self.assertEqual(record["route"], "/imprimante-api/status")
        self.assertEqual(record["duration_ms"], 17.4)
        self.assertEqual(record["mqtt_code"], 0)
        self.assertNotIn("email", record)
        self.assertNotIn("password", record)
        self.assertNotIn("fixture-secret", stream.getvalue())

    def test_text_format_is_human_readable_and_redacts_legacy_messages(self):
        """Le format texte reste lisible et masque identifiants, chemins, emails et URL signées."""
        stream = self.capture(fmt="text")
        log_event(
            logging.getLogger("cloud_page.auth"),
            logging.WARNING,
            "session_retry",
            message="Reconnexion refusée",
            error_type="TimeoutError",
            attempt=2,
        )
        logging.getLogger("server").warning(
            "Jeton Bearer fixture-secret mail person@example.invalid url https://cloud.invalid/file?signature=fixture"
        )
        logging.getLogger("server").warning(
            "Relevé de température ignoré (%s)", "person@example.invalid\nBearer fixture-secret"
        )
        logging.getLogger("server").debug("print_history output: fixture-private-payload")
        output = stream.getvalue()
        self.assertIn("WARNING cloud_page.auth session_retry", output)
        self.assertIn("Reconnexion refusée", output)
        self.assertNotIn("fixture-secret", output)
        self.assertNotIn("person@example.invalid", output)
        self.assertNotIn("signature=fixture", output)
        self.assertIn("Relevé de température ignoré ([valeur masquée])", output)
        self.assertNotIn("fixture-private-payload", output)
        self.assertEqual(output.count("\n"), 2)

    def test_vendor_debug_payloads_and_tracebacks_are_suppressed(self):
        """Le mode DEBUG ne réactive pas les dumps du SDK, même si un tiers les émet."""
        stream = self.capture(level="DEBUG")
        logging.getLogger("anycubic_cloud_api.api.functions").debug(
            "print_history output: fixture-private-payload"
        )
        try:
            raise RuntimeError("fixture-private-error")
        except RuntimeError:
            logging.getLogger("legacy").exception("échec interne")
        self.assertNotIn("fixture-private", stream.getvalue())
        self.assertNotIn("Traceback", stream.getvalue())

    def test_local_file_diagnostics_accept_only_safe_enums(self):
        """Les journaux peuvent préciser le type de fichier sans révéler nom ou chemin."""
        stream = self.capture(fmt="text")
        log_event(
            logging.getLogger("cloud_page.upload"),
            logging.INFO,
            "local_print_requested",
            message="Demande d’impression locale transmise",
            storage="local",
            file_format="gcode_3mf",
            nested=True,
            payload="/" + "home/" + "private/model.gcode.3mf",
        )
        log_event(
            logging.getLogger("cloud_page.upload"),
            logging.INFO,
            "local_print_requested",
            message="Demande d’impression locale transmise",
            storage=["local"],
            file_format={"name": "private.gcode"},
            nested="yes",
        )
        output = stream.getvalue()
        self.assertIn("file_format=gcode_3mf", output)
        self.assertIn("storage=local", output)
        self.assertIn("nested=True", output)
        self.assertNotIn("private", output)
        self.assertEqual(output.count("storage="), 1)

    def test_cloud_transport_fields_are_bounded_enums(self):
        """Le transport n’expose qu’un nom d’endpoint connu et un code numérique borné."""
        stream = self.capture(fmt="json")
        log_event(
            logging.getLogger("cloud_page.cloud"),
            logging.DEBUG,
            "cloud_request",
            message="Réponse Cloud reçue",
            endpoint="printer_info",
            method="GET",
            cloud_code=10001,
        )
        log_event(
            logging.getLogger("cloud_page.cloud"),
            logging.DEBUG,
            "cloud_request",
            message="Réponse Cloud reçue",
            endpoint="/private/customer/path",
            cloud_code=10**20,
        )
        lines = [json.loads(line) for line in stream.getvalue().splitlines()]
        self.assertEqual(lines[0]["endpoint"], "printer_info")
        self.assertEqual(lines[0]["cloud_code"], 10001)
        self.assertNotIn("endpoint", lines[1])
        self.assertNotIn("cloud_code", lines[1])
        self.assertNotIn("/private/customer/path", stream.getvalue())

    def test_safe_traceback_keeps_only_basename_line_and_function(self):
        """Les repères de pile aident au diagnostic sans chemin ni ligne source."""
        try:
            raise RuntimeError("/" + "Users/" + "private/person@example.invalid fixture-secret")
        except RuntimeError as error:
            frames = safe_exception_frames(error)
        self.assertTrue(frames)
        self.assertTrue(all("/" not in frame and "fixture-secret" not in frame for frame in frames))
        self.assertTrue(all(frame.rsplit(":", 2)[1].isdigit() for frame in frames))

    def test_only_supported_levels_and_formats_are_accepted(self):
        """Une faute de configuration ne démarre pas avec un niveau ambigu."""
        for environ in ({"LOG_LEVEL": "TRACE"}, {"LOG_FORMAT": "xml"}):
            with patch.dict("os.environ", environ, clear=True), self.assertRaises(ValueError):
                configure_logging(stream=io.StringIO())

    def test_request_context_is_added_only_after_whitelist_validation(self):
        """Le contexte HTTP corrèle les événements sans propager une route ou un identifiant brut."""
        stream = self.capture()
        token = request_context.set(
            {
                "request_id": "0123456789abcdef",
                "method": "POST",
                "route": "/imprimante-api/command",
                "email": "ignored@example.invalid",
                "path": "/private/account/123456",
            }
        )
        try:
            log_event(
                logging.getLogger("cloud_page.session"),
                logging.INFO,
                "recovery",
                message="Session renouvelée",
            )
        finally:
            request_context.reset(token)
        record = json.loads(stream.getvalue())
        self.assertEqual(record["request_id"], "0123456789abcdef")
        self.assertEqual(record["method"], "POST")
        self.assertEqual(record["route"], "/imprimante-api/command")
        self.assertNotIn("email", record)
        self.assertNotIn("path", record)
