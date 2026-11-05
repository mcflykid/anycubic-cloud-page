# Dépannage

| Symptôme | Vérification |
| --- | --- |
| Page503 : mot de passe absent | Vérifier la valeur WEB_PASSWORD et les logs de démarrage du service avec docker compose logs. En mode sources seulement, vérifier le fichier appdata/private/web-password. |
| Session expirée / API401 | Utiliser `admin` ou `WEB_USER`, avec le mot de passe web choisi. Reconnectez-vous sur `/login`. Le mot de passe Anycubic n’est pas celui de la page. |
| Cloud indisponible au démarrage | Vérifier que le compte est associé à une Kobra S1 et que la connexion User Center a réussi. Une MFA/CAPTCHA non pris en charge nécessite une intervention. |
| Token absent/expiré | Mode compte : vérifier les fichiers privés de connexion. Mode slicer : reconnecter le slicer, puis relancer l’extracteur ou son watcher. |
| Plusieurs imprimantes | Configurer `PRINTER_ID` localement ; ne pas partager cet identifiant dans une issue. |
| Commande refusée / bouton désactivé | Vérifier que la machine est libre/en ligne et que la capacité est annoncée. Les réglages de projet ne s’appliquent que pendant une impression. |
| IA indisponible | Réessayer lorsque la machine est libre. Une réponse doit venir du bon topic et de la fenêtre active. Ne pas enlever les garde-fous pour forcer l’écriture. |
| Firmware : version cible identique | Lire l’indicateur officiel de mise à jour. Une version cible renseignée ne suffit pas à activer le bouton. |
| Aperçu indisponible | Le fournisseur n’a pas fourni d’image exploitable, le fichier a disparu ou la référence n’est pas résolue de façon unique. |
| Connexion429 | Attendre la fin de la fenêtre de cinq minutes. Un proxy peut partager le compteur entre les utilisateurs ; les en-têtes client ne permettent pas de le contourner. |
| Caméra ne démarre pas | Vérifier HTTPS/localhost, les accès Agora et la disponibilité du navigateur. Le statut MQTT ne prouve pas qu’un flux vidéo est ouvert. |
| Connexion depuis un autre domaine refusée | Définir l’origine exacte dans `PUBLIC_ORIGIN`, puis recréer le service web. |
| Données anciennes | Lire la date d’actualisation, l’état cloud et MQTT. Le cache ne prouve pas que la machine est encore dans cet état. |

Pour un signalement, décrire les étapes, l’état attendu et le modèle/firmware. Ne publier ni contenu de `appdata/`, ni log contenant des tokens, ni copie de journal du slicer. Déconnecter le suivi de cette page n’arrête pas l’impression physique.

Le service unique prépare ses données avant de lancer le serveur sans privilèges root. Si cette préparation échoue, renseignez les valeurs requises puis relancez Compose. Un téléchargement de matériel client bloqué par le réseau doit être résolu avant le démarrage.


## « Une opération est en cours » pendant une consultation

Les lectures automatiques ne sont plus prises pour une commande utilisateur concurrente. Le serveur attend au maximum 30 secondes avant émission ; si la consultation reste bloquée, il indique explicitement qu’aucune commande n’a été envoyée. Deux opérations utilisateur simultanées restent refusées. Aucun ordre physique n’est rejoué automatiquement après un résultat incertain.

Pour changer de version, adoptez le Compose de la livraison souhaitée et préservez `APPDATA_DIR`. Lancez `docker compose pull` puis `docker compose up -d`. Utilisez les mêmes fichiers `-f` qu’au démarrage si vous avez un proxy existant. Ne supprimez pas les données pendant la mise à jour.

Une erreur caméra d’authentification, TLS ou de format n’entraîne pas une seconde ouverture automatique. Une panne de transport reconnue peut être retentée une fois ; les réponses valides restent en cache cinq secondes. Aucun délai de déduplication du cloud n’est supposé.
