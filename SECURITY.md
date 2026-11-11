# Sécurité

Ne joignez aucun token, email de compte, mot de passe, clé privée, certificat client privé ou journal brut à une issue ou une pull request. Ni le dossier `appdata/`, ni votre Compose personnalisé ou `.env` contenant des identifiants ne doivent être publiés.

Le service exige un mot de passe web et refuse l’accès si son fichier est absent/vide. Docker lie l’application à la boucle locale par défaut. HTTPS et l’accès distant passent par votre reverse proxy séparé. Pour un accès distant, utilisez HTTPS et votre propre contrôle d’accès réseau. Le token du compte reste côté serveur ; le navigateur reçoit uniquement ce dont le lecteur caméra a besoin pour une session temporaire.

Sur une origine HTTPS, la session utilise le cookie `__Host-anycubic_session`, limité à l’hôte. En HTTP local, elle conserve `anycubic_session`. Une ancienne session HTTPS encore valide est migrée à sa première requête et son ancien jeton est révoqué.

Une mise à jour de micrologiciel ou une réinitialisation d’usine demande le mot de passe web. La confirmation expire après deux minutes, vaut une seule fois pour l’action et l’imprimante choisies, et s’ajoute au code de réinitialisation. Cinq échecs en cinq minutes limitent la session concernée. La connexion principale garde son propre compteur.

Le journal des commandes conserve jusqu’à 512 Kio de traces récentes sur 30 jours dans le volume privé, avec des paramètres filtrés. L’export depuis Réglages retire les adresses clientes et les empreintes de session. Les retours MQTT connus confirment une commande dans les cinq minutes si l’imprimante, la référence constructeur et l’état final concordent. La référence n’est gardée que sous forme d’empreinte privée, hors export. Les autres résultats gardent leur état HTTP ou restent inconnus.

Les certificats historiques du fournisseur demandent une compatibilité TLS particulière, documentée dans `docs/PROTOCOL.md`. Ce dépôt ne fournit pas de clé privée ni de secret de signature embarqué. Le préparateur place le matériel amont dans des fichiers locaux ignorés par Git.

Pour signaler une vulnérabilité, utilisez le signalement privé GitHub si disponible, avec une description expurgée. En cas d’exposition d’un identifiant personnel, révoquez/renouvelez-le auprès de son fournisseur.

La CI et `scripts/check_publication.py` apportent des contrôles ciblés ; ils ne constituent pas une certification de sécurité exhaustive.

La saisie des identifiants dans le Compose ou `.env` est un choix d’installation local : ces valeurs sont visibles aux administrateurs Docker du conteneur. Elles ne sont pas incluses dans l’image et ne sont pas écrites dans les logs pendant la préparation.


Le mot de passe web est actuellement conservé dans un fichier privé en mode 0600. Une migration vers une empreinte doit conserver les mots de passe existants, notamment les valeurs longues et la rotation des sessions. La limite d’entrée de bcrypt et la compatibilité entre versions doivent être traitées avant une conversion automatique.

## Webhooks Discord

Les canaux Discord sont facultatifs et désactivés par défaut. Le serveur lit les secrets depuis `APPDATA_DIR/private/discord-webhook` et `APPDATA_DIR/private/discord-reports-webhook`, en mode 0600. La modification, la suppression et le message de test demandent une session et le mot de passe web. Les connexions sortantes sont limitées au point d’entrée HTTPS de Discord et les redirections sont refusées. Ne partagez pas l’adresse du webhook ni le fichier privé. Si l’adresse a été divulguée, révoquez le webhook depuis Discord avant de le remplacer.

## Facteur temporaire local

L’atelier peut demander un TOTP après le mot de passe web. Le défi expire après trois minutes ou trois échecs. Les codes temporaires ont également un quota commun de vingt échecs en deux minutes. Un code de secours demeure utilisable après une nouvelle étape de mot de passe. L’atelier crée la session après consommation du code. La confirmation des réglages TOTP, de Discord et des autres opérations sensibles dispose du même quota par session.

Le fichier `APPDATA_DIR/private/web-totp.json` appartient à l’utilisateur du service, en mode 0600. Il contient la clé requise pour vérifier les codes, le dernier pas accepté et les empreintes des codes de secours. Protégez les sauvegardes de ce fichier comme celles des autres secrets. La preuve est enregistrée avant l’émission du cookie. Le verrou d’authentification couvre la lecture et l’écriture sur l’unique processus du service Compose. Une copie ancienne de l’état peut restaurer une clé ou un code déjà consommé. En cas de restauration, réinitialisez et réenrôlez le facteur.

La clé et les codes ne figurent jamais dans les journaux ni dans une URL HTTP. Le QR et la clé ne sont affichés qu’à la préparation, puis les codes de secours sont affichés à l’activation. Les réponses de sécurité sont servies sans cache. La récupération opérateur figure dans le [guide d’installation](docs/INSTALLATION.md#connexion-à-deux-facteurs).
