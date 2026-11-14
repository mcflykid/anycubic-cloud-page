"""Tests d’extraction locale utilisant uniquement des journaux et jetons fictifs."""

import base64, json, pathlib, tempfile, time, unittest
from unittest.mock import patch
from extract_token import extract, scan_log


def token(exp, kind="access-token"):
    """Renvoie un JWT fictif non signé ; exp et kind contrôlent l’expiration et le type du scénario."""
    claims = {"iss": "https://uc.makeronline.com", "tokenType": kind, "exp": exp}
    return (
        "eyJhbGciOiJub25lIn0."
        + base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip("=")
        + ".synthetic"
    )


class Extraction(unittest.TestCase):
    """Vérifications du choix d’un jeton utilisable et des erreurs sans contenu de journaux."""

    def test_valid_access_chosen_and_expired_or_id_tokens_ignored(self):
        """Vérifie que seul un jeton d’accès non expiré est retenu parmi les données du journal."""
        with tempfile.TemporaryDirectory() as folder:
            valid = token(time.time() + 3600)
            pathlib.Path(folder, "slicer.log").write_text(
                "accessToken = "
                + valid
                + "\nid_token="
                + token(time.time() - 1)
                + "\nid_token="
                + token(time.time() + 3600, "id-token")
            )
            self.assertEqual(extract(folder), valid)

    def test_no_candidate_is_reported_without_dumping_log_contents(self):
        """Vérifie que l’absence de jeton utilisable ne divulgue pas le contenu du journal."""
        with tempfile.TemporaryDirectory() as folder:
            pathlib.Path(folder, "slicer.log").write_text("sensitive-unrelated-text")
            with self.assertRaisesRegex(ValueError, "Aucun token"):
                extract(folder)

    def test_large_log_and_unchanged_cache(self):
        """Lit un journal de 100 Mio sans perdre le jeton placé sur une frontière."""
        with tempfile.TemporaryDirectory() as folder:
            valid = token(time.time() + 3600)
            path = pathlib.Path(folder, "slicer.log")
            with path.open("wb") as log:
                log.write(b" " * (64 * 1024 - 8) + ("accessToken = " + valid + "\n").encode())
                log.truncate(100 * 1024 * 1024)
            cache = {}
            self.assertEqual(extract(folder, cache), valid)
            with patch("extract_token.scan_log", wraps=scan_log) as read:
                self.assertEqual(extract(folder, cache), valid)
                read.assert_not_called()


if __name__ == "__main__":
    unittest.main()
