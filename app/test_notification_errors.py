"""Erreurs du journal Slicer, liens d'aide et références d’aperçu locales."""

import unittest
from unittest.mock import AsyncMock

from notification_service import AccountNotifications, history_entry


class NotificationErrorTests(unittest.IsolatedAsyncioTestCase):
    """Expose des codes fiables sans transformer une absence ou un lien arbitraire en diagnostic."""

    def test_slicer_alarm_code_has_known_title_description_and_official_help(self):
        """Le code connu doit conserver un diagnostic compréhensible et une aide officielle explicite."""
        entry = history_entry(
            {
                "id": 28,
                "printer_id": 7,
                "task_id": 91,
                "alarm_code": 10115,
                "reason_desc": "The printer cannot parse the file",
            }
        )
        self.assertEqual(entry["reason_code"], "10115")
        self.assertEqual(entry["error_title"], "L’imprimante ne peut pas lire ce fichier")
        self.assertEqual(entry["reason"], "")
        self.assertTrue(entry["error_description"])
        self.assertEqual(entry["help_url"], "https://wiki.anycubic.com/en/error-codes")

    def test_zero_boolean_and_unstable_codes_do_not_become_error_codes(self):
        """Les absences et données arbitraires ne doivent pas devenir de fausses alarmes."""
        for value in (None, 0, "0", False, 0.0, "10115 <script>", [10115]):
            with self.subTest(value=value):
                entry = history_entry({"id": 28, "alarm_code": value, "reason_id": value})
                self.assertEqual(entry["reason_code"], "")
                self.assertIsNone(entry.get("help_url"))

    def test_cloud_help_url_must_be_https_on_the_anycubic_wiki_without_query(self):
        """Un lien d’aide ne doit ni quitter le constructeur ni diffuser de paramètres privés."""
        for url in (
            "http://wiki.anycubic.com/en/error-codes",
            "https://wiki.anycubic.com.evil.invalid/en/error-codes",
            "https://wiki.anycubic.com/en/error-codes?token=secret",
            "https://evil.invalid/10115",
            "https://user@wiki.anycubic.com/en/error-codes",
        ):
            with self.subTest(url=url):
                entry = history_entry({"id": 28, "reason_help_url": url})
                self.assertIsNone(entry.get("help_url"))

    def test_valid_cloud_specific_help_url_is_preserved_for_unknown_code(self):
        """La fiche donnée par le fournisseur reste utile même si son code n’est pas encore traduit."""
        entry = history_entry(
            {
                "id": 28,
                "alarm_code": "20401",
                "reason_help_url": "https://wiki.anycubic.com/en/error-codes/device-offline",
            }
        )
        self.assertEqual(
            entry["help_url"], "https://wiki.anycubic.com/en/error-codes/device-offline"
        )

    async def test_slicer_preview_references_are_retained_only_in_server_rows(self):
        """Les références d’image nécessaires à une tâche ne doivent pas être exposées au navigateur."""
        notifications = AccountNotifications()
        api = type(
            "API",
            (),
            {
                "_fetch_api_resp": AsyncMock(
                    side_effect=[
                        {
                            "code": 1,
                            "data": [
                                {
                                    "id": 28,
                                    "task_id": 91,
                                    "taskid": 91,
                                    "project_id": 91,
                                    "alarm_code": "10115",
                                    "printer_list": [{"printer_id": 7, "name": "Kobra fixture"}],
                                    "image_url": "https://wiki.anycubic.com/preview.png",
                                    "thumbnail_url": "https://wiki.anycubic.com/thumb.png",
                                    "image_id": "fixture-image-id",
                                    "slice_param": {
                                        "image_id": "fixture-slice-image",
                                        "ignored": "private",
                                    },
                                }
                            ],
                        },
                        {"code": 1, "data": {"unread_total": 1}},
                    ]
                )
            },
        )()
        result = await notifications._slicer_page(api, 1)
        entry = result["items"][0]
        row = notifications.rows[entry["key"]]
        for name in (
            "task_id",
            "taskid",
            "project_id",
            "image_url",
            "thumbnail_url",
            "image_id",
            "slice_param",
        ):
            self.assertIn(name, row)
        self.assertNotIn("image_url", entry)
        self.assertNotIn("slice_param", entry)
        self.assertEqual(row["slice_param"], {"image_id": "fixture-slice-image"})
        self.assertEqual(entry["reason_code"], "10115")

    def test_success_alarm_200_is_not_displayed_as_an_error(self):
        """Le code d’événement de fin normale du slicer n’est pas une panne imprimante."""
        entry = history_entry({"id": 28, "print_status": 2, "alarm_code": 200, "reason_id": 200})
        self.assertEqual(entry["reason_code"], "")
        self.assertIsNone(entry.get("help_url"))

    def test_explicit_product_article_from_cloud_remains_clickable(self):
        """Une fiche constructeur de produit fournie avec l’événement n’est pas remplacée par l’index."""
        url = "https://wiki.anycubic.com/en/fdm-3d-printer/kobra-s1-combo/error-code-10115"
        entry = history_entry({"id": 28, "alarm_code": 10115, "reason_help_url": url})
        self.assertEqual(entry["help_url"], url)
