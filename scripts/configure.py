#!/usr/bin/env python3
"""Configuration interactive locale du compte Anycubic ou d’un jeton existant."""
import getpass,json,pathlib,sys
from prepare_vendor import prepare,private_write,ROOT,appdata_path

def configure():
 """Recueille et écrit la configuration privée sans afficher les secrets ; lève SystemExit si la saisie ou le mode est invalide."""
 print('Anycubic Cloud Page — configuration locale')
 print('1. Compte Anycubic (sans slicer, reconnexion automatique)\n2. Token existant (coller sans affichage)\n3. Récupérer depuis les journaux du slicer')
 mode=input('Méthode [1] : ').strip() or '1'
 secret=appdata_path()/'private'
 if mode=='1':
  email=input('Adresse du compte Anycubic : ').strip();password=getpass.getpass('Mot de passe Anycubic : ')
  if not email or not password:raise SystemExit('Identifiants incomplets.')
  private_write(secret/'anycubic-account',json.dumps({'email':email,'password':password}).encode())
  # Compose monte toujours le fichier de jeton ; AccountAuth donne priorité aux identifiants du compte.
  if not (secret/'anycubic-token').exists():private_write(secret/'anycubic-token',b'')
 elif mode=='2':
  if (secret/'anycubic-account').exists():raise SystemExit('Un compte est déjà configuré. Déplacez son fichier privé pour passer au mode token.')
  token=getpass.getpass('Token Anycubic (saisie masquée) : ').strip()
  if not token:raise SystemExit('Token vide.')
  private_write(secret/'anycubic-token',token.encode())
 elif mode=='3':
  if (secret/'anycubic-account').exists():raise SystemExit('Un compte est déjà configuré. Déplacez son fichier privé pour passer au mode token.')
  from extract_token import extract
  token=extract();private_write(secret/'anycubic-token',token.encode())
 else:raise SystemExit('Choix inconnu.')
 password=getpass.getpass('Choisissez le mot de passe de la page web (compte admin) : ')
 if len(password)<6:raise SystemExit('Utilisez au moins 6 caractères pour le mot de passe web.')
 if getpass.getpass('Confirmez le mot de passe web : ')!=password:raise SystemExit('Les mots de passe ne correspondent pas.')
 private_write(secret/'web-password',password.encode());prepare()
 state=appdata_path()/'state';state.mkdir(parents=True,exist_ok=True);__import__('os').chmod(state,0o700)
 env=ROOT/'.env'
 if not env.exists():
  uid=getattr(__import__('os'),'getuid',lambda:1000)();gid=getattr(__import__('os'),'getgid',lambda:1000)()
  env.write_text(f'PUID={uid}\nPGID={gid}\nPUBLIC_ORIGIN=http://localhost:8080\n')
 print('Configuration prête dans appdata/ (ignoré par Git). Construisez l’image de développement puis lancez le Compose standard (voir docs/INSTALLATION.md) puis ouvrez http://localhost:8080.')
if __name__=='__main__':configure()
