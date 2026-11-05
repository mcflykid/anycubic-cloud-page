"""Chargement des secrets constructeur depuis les fichiers privés d’exécution."""
import json,os,pathlib

def load_vendor_config():
 """Charge le secret client et le dossier MQTT à l’exécution ; propage les erreurs de lecture ou de JSON."""
 file=pathlib.Path(os.environ.get('ANYCUBIC_CLIENT_FILE','/appdata/private/vendor/client.json'))
 if file.is_file():
  data=json.loads(file.read_text())
  if data.get('app_secret'):os.environ['ANYCUBIC_APP_SECRET']=data['app_secret']
 os.environ.setdefault('ANYCUBIC_MQTT_DIR','/appdata/private/vendor/mqtt')
