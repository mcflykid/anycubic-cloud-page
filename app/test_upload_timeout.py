"""Budgets des transferts signés sur session HTTP entièrement simulée."""
import unittest
from types import SimpleNamespace
from unittest.mock import Mock,MagicMock,AsyncMock
from anycubic_cloud_api.api.base import AnycubicAPIBase
from anycubic_cloud_api.exceptions.exceptions import AnycubicAPIParsingError
from anycubic_cloud_api.models.http import HTTP_METHODS

class UploadTimeout(unittest.IsolatedAsyncioTestCase):
 """Un gros PUT ne doit pas hériter des 45 secondes réservées aux appels API."""
 async def test_signed_transfer_has_size_budget_and_normal_api_keeps_default(self):
  """Inspecte le délai réellement transmis à la session, sans attendre ni ouvrir de socket."""
  session=MagicMock();resp=SimpleNamespace(status=200,url='https://example.test/upload',text=AsyncMock(return_value=''),json=AsyncMock(return_value={}))
  for method in [session.put,session.post]:method.return_value.__aenter__=AsyncMock(return_value=resp)
  api=SimpleNamespace(_session=session,_web_headers=lambda **kw:{},_log_api_call_info=False,_last_warn_api_duration=None)
  await AnycubicAPIBase._fetch_ext_resp(api,HTTP_METHODS.PUT,'https://example.test/upload',put_data=b'x'*(2*1024*1024),is_json=False)
  timeout=session.put.call_args.kwargs['timeout'];self.assertEqual(timeout.total,184);self.assertEqual(timeout.sock_connect,30);self.assertEqual(timeout.sock_read,120)
  await AnycubicAPIBase._fetch_ext_resp(api,HTTP_METHODS.POST,'https://example.test/api')
  self.assertNotIn('timeout',session.post.call_args.kwargs)

 async def test_empty_failed_put_is_not_a_success(self):
  """Un rejet HTTP sans corps déclenche le chemin d’échec du transfert."""
  session=MagicMock()
  response=SimpleNamespace(status=403,text=AsyncMock(return_value=''))
  session.put.return_value.__aenter__=AsyncMock(return_value=response)
  api=SimpleNamespace(_session=session,_web_headers=lambda **kwargs:{})
  with self.assertRaises(AnycubicAPIParsingError):
   await AnycubicAPIBase._fetch_ext_resp(api,HTTP_METHODS.PUT,'https://example.test/upload',put_data=b'x',is_json=False)
  response.text.assert_not_awaited()
