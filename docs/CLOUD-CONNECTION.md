# Reproduire la connexion au cloud Anycubic

Ce document décrit le chemin utilisé par cette application. Il ne constitue pas une spécification officielle. Les endpoints peuvent changer ; les exemples n’incluent aucun identifiant réel, token, mot de passe ni clé de signature.

## Méthode A — récupérer automatiquement le token sans slicer

C’est la méthode activée en renseignant `ANYCUBIC_EMAIL` et `ANYCUBIC_PASSWORD` dans le Compose. L’assistant optionnel `scripts/configure.py` propose aussi cette méthode pour une installation depuis les sources. Elle n’ouvre pas AnycubicSlicerNext et ne lit pas ses fichiers.

```text
Compte saisi localement
  → User Center : code d’autorisation lié à PKCE S256
  → échange du code + code_verifier
  → access_token et refresh_token
  → échange du token d’accès avec l’API workbench
  → session cloud + connexion MQTT
```

Implémentation reproductible : [`app/account_auth.py`](../app/account_auth.py), méthodes `login`, `refresh`, `token` et `renew_after_rejection`.

1. Générer un `code_verifier` aléatoire, puis son challenge `BASE64URL(SHA256(verifier))`.
2. Envoyer la demande de connexion au User Center `https://uc.makeronline.com/api/login`, avec l’identifiant de client du slicer, `responseType=code`, `redirectUri=acnext://login`, `code_challenge_method=S256`, le challenge et un `state` aléatoire. Le corps contient le compte et le mot de passe ; aucun log de ces valeurs n’est ajouté par l’adaptateur.
3. Vérifier que la réponse annonce `status=ok` et fournit un code exploitable. Un rejet, CAPTCHA ou mécanisme non pris en charge n’est pas contourné.
4. Échanger ce code via `/api/login/oauth/access_token` avec `grant_type=authorization_code`, le même client, le `code_verifier` et la redirection attendue.
5. Conserver l’`access_token`, le `refresh_token` et la date d’obtention dans le fichier de session privé. Refuser un token expiré ou un changement inattendu de compte. La lecture locale des claims contrôle le format et la cohérence ; elle n’est pas une validation cryptographique de la signature JWT.

Le mot de passe du compte est conservé localement pour permettre une nouvelle connexion si le renouvellement échoue. Il ne transite que vers le User Center Anycubic. Le mot de passe web est distinct et ne lui est pas transmis.

### Renouvellement

Le polling appelle le gestionnaire d’authentification. Celui-ci réutilise un token encore valable et tente le renouvellement après sept jours ou lorsque le token n’est plus valable. Le chemin de refresh utilise `/api/login/oauth/refresh_token` ; en cas d’échec, il tente la connexion au compte. Une temporisation évite de réessayer en boucle pendant une indisponibilité.

La connexion directe a été vérifiée dans le déploiement d’origine. Le refresh et ses replis sont testés par simulation ; la continuité réelle pendant plusieurs semaines n’est pas établie. Une MFA, un CAPTCHA ou un changement du User Center peut imposer une reconnexion manuelle ou une adaptation du code.

## Méthode B — récupérer automatiquement le token du slicer

Cette méthode ne connaît pas votre mot de passe Anycubic. Elle lit uniquement les journaux locaux d’une session du slicer déjà connectée :

```sh
python3 scripts/extract_token.py --log-dir /chemin/des/journaux
```

Le script recherche les marqueurs `accessToken =` et `id_token=`, décode les claims localement et retient un token d’accès User Center non expiré. Un marqueur `id_token` ne suffit pas : le contenu doit bien annoncer `tokenType=access-token`. Les journaux sont parcourus du plus récent au plus ancien, avec une limite de taille par fichier.

Le résultat est écrit dans un fichier privé (le volume partagé pour le watcher Docker, ou `appdata/private/anycubic-token` pour le script local), jamais dans le terminal. `--watch` recommence toutes les 30 secondes et remplace le fichier seulement si le token change. Le serveur détecte ensuite le changement lors du polling et reconnecte sa session.

**Limite :** lire un token existant ne crée pas une session User Center. Si les journaux ne contiennent rien de valide, reconnectez-vous dans le slicer ou choisissez la méthode A. L’emplacement macOS a été vérifié ; les emplacements proposés pour Windows/Linux sont des conventions à adapter avec `--log-dir`.

## Du token d’accès à la session workbench

Le token User Center n’est pas directement le token de session de l’API d’atelier. Le client appelle :

```text
POST https://cloud-universe.anycubic.com/p/p/workbench/api/v3/public/loginWithAccessToken
corps : access_token + device_type=pcf
réponse : session interne, utilisée dans XX-Token
```

Les requêtes workbench portent les en-têtes de client `Xx-Device-Type`, `Xx-Is-Cn`, `Xx-Nonce`, `Xx-Timestamp`, `Xx-Version` et `Xx-Signature`. La signature du protocole existant est :

```text
MD5(app_id + timestamp + version + app_secret + nonce + app_id)
```

Cette formule décrit le protocole constructeur, pas un choix de cryptographie recommandé. Le matériel client est chargé localement depuis `/run/secrets/vendor/` dans le conteneur, préparé par `scripts/prepare_vendor.py`. La valeur de signature et la clé privée MQTT ne sont pas publiées ici. Les identifiants de client présents dans le code sont des identifiants publics de protocole, pas les identifiants d’un compte personnel.

La reprise de session est dans [`app/session_api.py`](../app/session_api.py). Seul un rejet explicite `code=10001` autorise un nouvel échange de session et une répétition de la requête refusée. Un timeout, une réponse illisible ou une erreur ambiguë n’entraîne pas de répétition automatique de la commande. Un verrou/génération coordonne les requêtes concurrentes et le suivi MQTT est reconnecté après renouvellement.

## MQTT et caméra

Le moteur amont prépare l’identité MQTT et chiffre le token de session avec la clé publique du certificat constructeur pour le mode slicer. Les certificats client sont chargés depuis le dossier privé préparé localement. Le broker a nécessité l’identité client du protocole du slicer ; une identité arbitraire n’a pas été retenue.

Les ordres HTTP sont envoyés à `/work/operation/sendOrder`. La réponse HTTP contient un acquittement ; la confirmation d’état arrive ensuite par MQTT. **Acquittement, réponse machine et résultat physique sont trois niveaux distincts.**

La caméra utilise une session de courte durée et le SDK Agora dans le navigateur. Le token du compte reste côté serveur ; un jeton caméra temporaire est nécessaire au navigateur pour rejoindre le flux. Fermer la caméra ne doit pas arrêter l’impression.

## Points découverts sur la détection IA

Pour lire les réglages, le client constructeur envoie l’ordre `1242` avec `printer_id`, sans `project_id` ni corps `data`. La machine observée renvoie `type=aiSettings`, `action=query`, `state=done`, avec `data.ai_settings`.

Le `msgid` machine différait de celui de l’acquittement cloud. Le serveur accepte donc cette réponse uniquement pendant une consultation active de 30 secondes, depuis le topic de l’imprimante sélectionnée, avec le type et l’action attendus. Une réponse d’une autre machine, un message `set` ou un rapport hors fenêtre est refusé. Cette stratégie ne prétend pas distinguer deux consultations simultanées faites par deux clients externes sur la même machine ; le serveur sérialise ses propres consultations.

La lecture réelle et l’activation du formulaire ont été vérifiées. L’écriture des réglages n’a pas été testée physiquement pour cette publication.


## Refus du compte et reprise différée (#60)
Un refus explicite de la connexion par mot de passe (HTTP 401/403 ou réponse de connexion `status: error|fail|failed`) suspend les nouvelles tentatives automatiques. L’atelier affiche un message demandant de vérifier les identifiants ou les contrôles du compte et de mettre à jour la configuration. Une modification du fichier privé d’identifiants ou un redémarrage réarme cette tentative ; un simple polling ne la relance pas. Aucun message brut du fournisseur n’est affiché.

Une panne réseau ou une réponse illisible ne prouve pas un mauvais mot de passe : les délais augmentent de 30 secondes à 30 minutes. Une panne de renouvellement ne renvoie plus automatiquement le mot de passe ; seule une session de renouvellement explicitement refusée permet cette nouvelle connexion. Un jeton encore valide peut rester utilisable pendant une panne, avec l’avertissement visible ; un jeton explicitement rejeté ne sert pas de repli.
