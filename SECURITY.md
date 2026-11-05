# Sécurité

Ne joignez aucun token, email de compte, mot de passe, clé privée, certificat client privé ou journal brut à une issue ou une pull request. Ni le dossier `appdata/`, ni votre Compose personnalisé ou `.env` contenant des identifiants ne doivent être publiés.

Le service exige un mot de passe web et refuse l’accès si son fichier est absent/vide. Docker lie l’application à la boucle locale par défaut. HTTPS et l’accès distant passent par votre reverse proxy séparé. Pour un accès distant, utilisez HTTPS et votre propre contrôle d’accès réseau. Le token du compte reste côté serveur ; le navigateur reçoit uniquement ce dont le lecteur caméra a besoin pour une session temporaire.

Les certificats historiques du fournisseur demandent une compatibilité TLS particulière, documentée dans `docs/PROTOCOL.md`. Ce dépôt ne fournit pas de clé privée ni de secret de signature embarqué. Le préparateur place le matériel amont dans des fichiers locaux ignorés par Git.

Pour signaler une vulnérabilité, utilisez le signalement privé GitHub si disponible, avec une description expurgée. En cas d’exposition d’un identifiant personnel, révoquez/renouvelez-le auprès de son fournisseur.

La CI et `scripts/check_publication.py` apportent des contrôles ciblés ; ils ne constituent pas une certification de sécurité exhaustive.

La saisie des identifiants dans le Compose ou `.env` est un choix d’installation local : ces valeurs sont visibles aux administrateurs Docker du conteneur. Elles ne sont pas incluses dans l’image et ne sont pas écrites dans les logs pendant la préparation.


Le mot de passe web est actuellement conservé dans un fichier privé en mode 0600. Une migration vers une empreinte doit conserver les mots de passe existants, notamment les valeurs longues et la rotation des sessions. La limite d’entrée de bcrypt et la compatibilité entre versions doivent être traitées avant une conversion automatique.
