# Dépannage

| Symptôme | Vérification |
| --- | --- |
| Page503 : mot de passe absent | Vérifier la valeur WEB_PASSWORD et les logs de démarrage du service avec docker compose logs. En Docker comme depuis les sources, vérifier l’existence et les permissions du fichier APPDATA_DIR/private/web-password sans afficher son contenu. Distinguer un échec de préparation, un mauvais montage appdata et un mot de passe absent. |
| Session expirée / API401 | Utiliser `admin` ou `WEB_USER`, avec le mot de passe web choisi. Reconnectez-vous sur `/login`. Le mot de passe Anycubic n’est pas celui de la page. |
| Cloud indisponible au démarrage | Vérifier que le compte est associé à une Kobra S1 et que la connexion User Center a réussi. Une MFA/CAPTCHA non pris en charge nécessite une intervention. |
| Token absent/expiré | Mode compte : vérifier les fichiers privés de connexion. Mode slicer : reconnecter le slicer, puis relancer l’extracteur ou son watcher. |
| Plusieurs imprimantes | Choisir la machine dans la barre du haut ; `PRINTER_ID` reste un défaut facultatif. Un choix retiré du compte est refusé pour les commandes : actualiser la page. Ne pas publier les identifiants. |
| Commande refusée / bouton désactivé | Vérifier que la machine est libre/en ligne et que la capacité est annoncée. Les réglages de projet ne s’appliquent que pendant une impression. |
| IA indisponible | Réessayer lorsque la machine est libre. Une réponse doit venir du bon topic et de la fenêtre active. Ne pas enlever les garde-fous pour forcer l’écriture. |
| Firmware : version cible identique | Lire l’indicateur officiel de mise à jour. Une version cible renseignée ne suffit pas à activer le bouton. |
| Aperçu indisponible | Le fournisseur n’a pas fourni d’image exploitable, le fichier a disparu ou la référence n’est pas résolue de façon unique. |
| Connexion429 | Attendre la fin de la fenêtre de cinq minutes. Sans TRUSTED_PROXIES, un proxy partage le compteur entre les utilisateurs. Déclarer uniquement ses adresses fiables pour séparer les clients ; voir le guide reverse proxy. |
| Caméra ne démarre pas | Vérifier HTTPS/localhost, les accès Agora et la disponibilité du navigateur. Le statut MQTT ne prouve pas qu’un flux vidéo est ouvert. |
| Connexion depuis un autre domaine refusée | Définir l’origine exacte dans `PUBLIC_ORIGIN`, puis recréer le service web. |
| Données anciennes | Lire la date d’actualisation, l’état cloud et MQTT. Le cache ne prouve pas que la machine est encore dans cet état. |

Pour un signalement, décrire les étapes, l’état attendu et le modèle/firmware. Ne publier ni contenu de `appdata/`, ni log contenant des tokens, ni copie de journal du slicer. Déconnecter le suivi de cette page n’arrête pas l’impression physique.

Le service unique prépare ses données avant de lancer le serveur sans privilèges root. Si cette préparation échoue, renseignez les valeurs requises puis relancez Compose. Un téléchargement de matériel client bloqué par le réseau doit être résolu avant le démarrage.


## « Une opération est en cours » pendant une consultation

Les lectures automatiques ne sont plus prises pour une commande utilisateur concurrente. Le serveur attend au maximum 30 secondes avant émission ; si la consultation reste bloquée, il indique explicitement qu’aucune commande n’a été envoyée. Deux opérations utilisateur simultanées restent refusées. Aucun ordre physique n’est rejoué automatiquement après un résultat incertain.

Pour changer de version, adoptez le Compose de la livraison souhaitée et préservez `APPDATA_DIR`. Lancez `docker compose pull` puis `docker compose up -d`. Utilisez le même Compose et le même environnement qu’au démarrage. Ne supprimez pas les données pendant la mise à jour.

Une erreur caméra d’authentification, TLS ou de format n’entraîne pas une seconde ouverture automatique. Une panne de transport reconnue peut être retentée une fois ; les réponses valides restent en cache cinq secondes. Aucun délai de déduplication du cloud n’est supposé.


## Proxy, 403 et 502

Une erreur 403 publique peut venir du filtrage du User-Agent. Comparez la santé locale avec la santé publique en utilisant curl avec `-A 'Mozilla/5.0'` et affichez l’URL et le code HTTP. Ne désactivez pas les protections du proxy ni Origin.

Si l’application est healthy mais le proxy renvoie 502, vérifiez la cible, le réseau commun et PROXY_NETWORK_EXTERNAL=true. Un gestionnaire peut utiliser un autre fichier d’environnement et donc un autre montage appdata. Contrôlez la configuration réellement lancée, sans afficher les secrets.

Pour Caddy, validez puis rechargez le fichier modifié : `up -d` ne recrée pas forcément un conteneur existant. Sur un domaine partagé, les chemins /login et /logout et les ressources doivent être routés, et les en-têtes du site statique ne doivent pas écraser la CSP ou Referrer-Policy de l’application. Voir le [guide reverse proxy](REVERSE-PROXY.md).

Des 502 pendant une recréation ne sont pas des échecs persistants : attendez healthy, reconnectez-vous et relancez les lectures. Conservez les journaux et séparez cette fenêtre des nouvelles erreurs après disponibilité.

## Secrets conservés

Le stockage privé est commun aux modes Docker et sources : APPDATA_DIR/private. En mode compte, gardez ANYCUBIC_TOKEN vide lorsque les mots de passe sont retirés de l’environnement ; un jeton hérité ne doit pas remplacer implicitement un compte enregistré. Ne recopiez pas les secrets dans un journal pour les vérifier. Une modification de APPDATA_DIR peut présenter un dossier vide au service sans supprimer les données du dossier précédent.

## Diagnostic caméra

Un manque d’identifiants Agora, une réponse cloud de format invalide et un transport KVS non pris en charge produisent des messages distincts. Le transport KVS n’est pas ouvert implicitement avec le lecteur Agora. Les erreurs et représentations de diagnostic ne contiennent ni canal, ni identifiant de session, ni clé ou jeton temporaire.

Lorsqu’une référence de corrélation est disponible, les rapports MQTT de la session courante peuvent préciser l’initialisation, la jonction et le début ou l’arrêt d’envoi de vidéo. Un acquittement ne prouve pas qu’une image est visible. Les rapports d’une autre machine, d’une ancienne session ou reçus hors ordre ne remplacent pas une étape plus avancée.


## Gros envois de G-code (#57)
Le transfert vers le stockage signé dispose de 120 secondes plus une durée calculée à 32 Kio/s, avec plafond d’une heure ; connexion et attente de réponse restent bornées séparément. Les appels API gardent leur délai court. Le navigateur réserve une durée supérieure pour l’envoi au serveur puis au cloud, jusqu’à deux heures. Ces budgets ne garantissent pas le succès sur tout réseau.

Une interruption ne prouve pas l’échec : vérifier les fichiers cloud et l’état machine avant toute nouvelle tentative. Aucun transfert n’est rejoué automatiquement. Dans la même page et pour le même fichier, mode, cible et ordre de bobines, une nouvelle tentative manuelle après erreur conserve l’identifiant de demande afin que le serveur reconnaisse une opération déjà commencée. Un rechargement de page ou un redémarrage du service ne conserve pas cette protection en mémoire : la vérification manuelle reste nécessaire.
