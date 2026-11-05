"""Tests de configuration Compose isolée, sans connexion réseau ni véritables identifiants."""
import json,pathlib,tempfile,unittest
from container_setup import initialize

class Setup(unittest.TestCase):
 """Vérifications de la configuration initiale et de sa réutilisation sans exposer de secrets."""
 def setUp(self):
  """Prépare des chemins temporaires et des identifiants fictifs pour isoler chaque scénario."""
  self.temp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.temp.name);self.secrets=self.root/'secrets';self.state=self.root/'state';self.prepares=0
  self.env={'ANYCUBIC_EMAIL':'fixture@example.test','ANYCUBIC_PASSWORD':'test-only-password','WEB_PASSWORD':'long-test-only-password'}
 def tearDown(self):"""Libère les fichiers temporaires de configuration du scénario.""";self.temp.cleanup()
 def prepare(self,path):
  """Simule les éléments client amont et compte les préparations sans aucun accès réseau."""
  self.prepares+=1;path=pathlib.Path(path);(path/'mqtt').mkdir(parents=True)
  (path/'client.json').write_text('{}')
  for name in ['anycubic_mqqt_tls_ca.crt','anycubic_mqqt_tls_client.crt','anycubic_mqqt_tls_client.key']:(path/'mqtt'/name).write_text('test-only-material')
 def run_setup(self,env=None):"""Exécute l’initialisation sur les dossiers temporaires ; env remplace l’environnement fictif par défaut.""";initialize(self.secrets,self.state,self.env if env is None else env,self.prepare)
 def test_account_setup_is_private_and_idempotent(self):
  """Vérifie les droits privés et l’absence de nouvelle récupération du client à la seconde initialisation."""
  self.run_setup();self.run_setup();self.assertEqual(self.prepares,1)
  data=json.loads((self.secrets/'anycubic-account').read_text());self.assertEqual(data['email'],'fixture@example.test')
  self.assertEqual((self.secrets/'web-password').stat().st_mode&0o777,0o600);self.assertEqual(self.secrets.stat().st_mode&0o777,0o700)
 def test_appdata_groups_all_persistent_directories(self):
  """Une installation vide regroupe les données privées et applique leurs droits."""
  appdata=self.root/'appdata'
  initialize(appdata/'private',appdata/'state',self.env,self.prepare,appdata_dir=appdata)
  self.assertEqual({p.name for p in self.root.iterdir()},{'appdata'})
  for relative in ['private','state']:
   self.assertEqual((appdata/relative).stat().st_mode&0o777,0o700)
  self.assertEqual({path.name for path in appdata.iterdir()},{'private','state'})
  self.assertEqual((appdata/'private/web-password').stat().st_mode&0o777,0o600)
 def test_fresh_install_rejects_missing_or_partial_credentials(self):
  """Vérifie qu’une configuration incomplète est refusée avant toute écriture."""
  for env in [{},{'ANYCUBIC_EMAIL':'fixture@example.test','WEB_PASSWORD':'long-test-only-password'}]:
   with self.assertRaises(ValueError):self.run_setup(env)
  self.assertFalse(self.secrets.exists())
 def test_existing_configuration_can_restart_without_environment_secrets(self):
  """Vérifie qu’une configuration persistée redémarre sans secrets dans l’environnement."""
  self.run_setup();self.run_setup({});self.assertEqual(self.prepares,1)
 def test_passwords_can_be_cleared_after_first_success(self):
  """Le compte enregistré est réutilisé avec le même email et les mots de passe vidés."""
  self.run_setup()
  account=(self.secrets/'anycubic-account').read_bytes();web=(self.secrets/'web-password').read_bytes()
  self.run_setup({**self.env,'ANYCUBIC_PASSWORD':'','WEB_PASSWORD':''})
  self.assertEqual((self.secrets/'anycubic-account').read_bytes(),account)
  self.assertEqual((self.secrets/'web-password').read_bytes(),web)
  self.assertEqual(self.prepares,1)
 def test_changed_email_requires_password(self):
  """Un autre email ne réutilise pas implicitement les secrets du compte enregistré."""
  self.run_setup()
  with self.assertRaises(ValueError):self.run_setup({**self.env,'ANYCUBIC_EMAIL':'other@example.test','ANYCUBIC_PASSWORD':''})
 def test_invalid_identity_is_rejected_before_writing(self):
  """Une identité root, non numérique ou hors plage ne doit jamais lancer la préparation."""
  for values in [{'PUID':'0'},{'PUID':'bad'},{'PGID':'-1'}]:
   with self.assertRaises(ValueError):self.run_setup({**self.env,**values})
  self.assertFalse(self.secrets.exists())
 def test_non_root_preparation_skips_chown(self):
  """Des dossiers accessibles permettent une préparation non-root sans appel chown."""
  from unittest.mock import patch
  with patch('container_setup.os.geteuid',return_value=1201),patch('container_setup.os.chown') as chown:
   self.run_setup();chown.assert_not_called()
 def test_empty_web_user_is_rejected_before_writing(self):
  """Un identifiant explicitement vide n'est pas remplacé silencieusement par admin."""
  for value in ['', '   ']:
   with self.assertRaises(ValueError):self.run_setup({**self.env,'WEB_USER':value})
  self.assertFalse(self.secrets.exists())
 def test_weak_web_password_is_rejected_before_writing(self):
  """Vérifie qu’un mot de passe web trop court est refusé avant toute écriture."""
  with self.assertRaises(ValueError):self.run_setup({**self.env,'WEB_PASSWORD':'short'})
  self.assertFalse(self.secrets.exists())
 def test_six_character_web_password_is_accepted(self):
  """La longueur minimale autorisée reste exactement six caractères."""
  self.run_setup({**self.env,'WEB_PASSWORD':'six-ok'})
  self.assertEqual((self.secrets/'web-password').read_text(),'six-ok')
 def test_token_mode_does_not_silently_override_account_mode(self):
  """Vérifie qu’un jeton ne remplace pas implicitement le mode de connexion par compte."""
  self.run_setup()
  with self.assertRaises(ValueError):self.run_setup({'ANYCUBIC_TOKEN':'fixture-token','WEB_PASSWORD':'long-test-only-password'})
if __name__=='__main__':unittest.main()
