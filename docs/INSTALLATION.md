# Installation

Docker et son plugin Compose suffisent sur la machine de déploiement. Le projet fournit un service unique, avec préparation intégrée ; HTTPS et l’accès distant passent par votre propre reverse proxy. Un compte Anycubic et une imprimante associée au cloud sont nécessaires. Python, Git et le slicer ne sont pas requis sur l’hôte.

## Démarrage depuis un dossier vide

1. Téléchargez [`compose.yaml`](../compose.yaml).
2. Dans `anycubic-cloud-page.environment`, remplacez les expressions des lignes suivantes, ou conservez les expressions et renseignez un `.env` à partir de [`.env.example`](../.env.example) :

```yaml
- "ANYCUBIC_EMAIL=votre-compte@example.com"
- "ANYCUBIC_PASSWORD=votre-mot-de-passe-anycubic"
- "WEB_PASSWORD=choisissez-un-mot-de-passe-web"
- "WEB_USER=admin"
```

Le mot de passe web est distinct du mot de passe Anycubic et contient au moins six caractères. `WEB_USER` est modifiable et ne peut pas être vide. Un `$` écrit directement dans Compose doit être doublé (`$$`) ; dans `.env`, utilisez des quotes simples pour garder la valeur littérale. Ne publiez pas vos fichiers personnalisés.

3. Lancez :

```sh
docker compose up -d
```

4. Ouvrez **http://localhost:8080/imprimante.html** sur cet hôte et utilisez vos identifiants web.

L’image `ghcr.io/mcflykid/anycubic-cloud-page:1.1.0` est fournie pour Linux amd64 et arm64 et téléchargée depuis le registre au démarrage. La préparation récupère le matériel client amont depuis une révision épinglée, crée les fichiers privés, puis lance le serveur sans privilèges root. L’application utilise le compte sans garder le slicer ouvert.

**Ne publiez jamais ce port HTTP directement sur Internet.** Pour un accès distant, suivez le [guide reverse proxy](REVERSE-PROXY.md), avec HTTPS et `PUBLIC_ORIGIN` correspondant exactement à l’adresse publique.

## Service et configuration

| Service | Rôle |
| --- | --- |
| `anycubic-cloud-page` | Connexion cloud, suivi HTTP/MQTT et interface ; état attendu `healthy`. |

| Réglage | Valeur par défaut / usage |
| --- | --- |
| `WEB_USER` | `admin` ; identifiant vide refusé. |
| `WEB_PASSWORD` | À renseigner ; au moins six caractères. |
| `BIND_ADDRESS` | `127.0.0.1`, accès depuis l’hôte uniquement. |
| `WEB_PORT` | `8080` ; adapter aussi `PUBLIC_ORIGIN` si le port change. |
| `PUBLIC_ORIGIN` | `http://localhost:8080` ; adresse exacte ouverte dans le navigateur, protocole et port compris. |
| `HOME_URL` | `/imprimante.html` ; destination des deux liens de navigation. Vide masque les liens. HTTP(S) ou chemin relatif uniquement. |
| `APPDATA_DIR` | `./appdata`, relatif au dossier Compose. |
| `PUID`, `PGID` | `1000` ; propriétaire des données persistantes. |
| `PRINTER_ID` | Facultatif ; sélection explicite si plusieurs imprimantes compatibles sont présentes. |
| `PROXY_NETWORK` | Utilisé seulement avec `compose.proxy.yaml` ; réseau externe partagé avec votre proxy. |
| `APP_IMAGE` | Image de la livraison ; permet de tester une image construite depuis les sources. |

Sans `PRINTER_ID`, une unique Kobra S1 est sélectionnée. Plusieurs correspondances sont refusées. Les limites CPU, mémoire, privilèges et écritures sont définies pour le service. L’entrée démarre en root pour initialiser les propriétaires, puis `setpriv` lance le serveur avec `PUID:PGID`.

## Fuseau et processus

`TZ=Europe/Paris` est la valeur par défaut. Le fuseau IANA choisi est utilisé pour l’historique, les axes et infobulles des graphiques, les retours horodatés et les messages applicatifs des logs. Les données échangées et enregistrées gardent leurs horodatages UTC ou Unix pour rester comparables ; les horodatages ajoutés par Docker lui-même peuvent rester en UTC. Le montage `/etc/localtime` est en lecture seule ; la variable `TZ` explicite est prioritaire.

`init: true` relaie les signaux et récupère les processus terminés. `pids_limit: 100` borne leur nombre. Le label d’auto-redémarrage en mauvaise santé est un exemple commenté : seul un outil externe que vous configurez peut l’utiliser.

## Données persistantes

Toutes les données sont sous `APPDATA_DIR` :

- `private/` : compte, token, mot de passe web et matériel client ; droits 700 sur les dossiers, 600 sur les fichiers ; contenu accessible seulement au propriétaire configuré.
- `state/` : session Anycubic, températures et préréglages.

Les temporaires restent en mémoire et les logs sont gérés par Docker. Aucun volume nommé n’est créé. Sauvegardez tout `appdata`, services arrêtés, avant une migration. Un autre `APPDATA_DIR` permet d’isoler un autre compte ; changer seulement le nom du projet Compose ne sépare pas ces données.

Pour reprendre des données existantes : sauvegardez-les et arrêtez les services, puis copiez leurs fichiers privés vers `appdata/private/` et leur état vers `appdata/state/`. Gardez les noms et les formats de `account-session.json`, `temperatures.json` et `presets.json`. Si les formats diffèrent, vérifiez leur compatibilité avant de poursuivre. Pour des volumes Docker, relevez les points de montage avec `docker volume inspect`, sans afficher les fichiers privés. Au prochain `docker compose up -d`, la préparation rétablit les droits. Contrôlez santé et cloud avant de retirer les sources de la copie. Ne lancez pas `down -v` pendant une migration.

Les valeurs du Compose et de `.env` sont accessibles aux administrateurs Docker. Elles ne sont jamais incluses dans l’image ni affichées par la préparation. La notice `/about` décrit les services externes utilisés ; le proxy doit la transmettre comme les autres routes.

## Token existant et slicer facultatif

Pour un token existant, laissez `ANYCUBIC_EMAIL` et `ANYCUBIC_PASSWORD` vides et renseignez `ANYCUBIC_TOKEN`. Un compte déjà enregistré n’est pas remplacé implicitement par ce mode.

Pour surveiller les journaux du slicer, téléchargez [`compose.slicer.yaml`](../compose.slicer.yaml), définissez `SLICER_LOG_DIR`, fournissez un token initial et lancez :

```sh
docker compose -f compose.yaml -f compose.slicer.yaml up -d
```

Ce service lit seulement les journaux et remplace le token dans `appdata/private/`, sans l’afficher. Il ne crée pas de session slicer. La connexion directe au compte ne dépend pas de lui. Voir le [guide cloud](CLOUD-CONNECTION.md).

## Développement depuis les sources

Sur une machine de développement disposant déjà de Docker, après clonage et configuration de `.env` :

```sh
docker build -t anycubic-cloud-page:dev .
APP_IMAGE=anycubic-cloud-page:dev docker compose up -d --pull never
```

Le Compose standard utilise cette image pour le service unique. Il n’y a pas de second Compose de développement à maintenir. Les scripts hôte facultatifs utilisent aussi `appdata/` ; exportez `APPDATA_DIR` dans votre terminal si vous avez choisi un autre emplacement.

Sans moteur Docker local, les vérifications de code sont :

```sh
python -m unittest discover -s app -p 'test_*.py' -q
python -m unittest discover -s scripts -p 'test_*.py' -q
node --check web/js/imprimante.js
python scripts/check_publication.py
```

Les scénarios Docker automatisés s’exécutent exclusivement dans GitHub Actions, en mode démonstration sans commande physique.

## Vérifier, arrêter, changer de version

```sh
docker compose ps -a
curl --fail http://127.0.0.1:8080/imprimante-api/health
docker compose stop
```

`health` vérifie le serveur web, pas la connexion cloud ni l’état physique de l’imprimante. Vérifiez ensuite les indicateurs Cloud/MQTT dans la page. Pour une mise à jour, adoptez le Compose de la livraison souhaitée, puis lancez `docker compose pull` et `docker compose up -d`, en conservant `APPDATA_DIR`. Utilisez les mêmes fichiers `-f` qu’au démarrage si vous avez activé les options réseau ou slicer.

## Retirer les mots de passe de l’environnement après préparation

Protégez `.env` avec `chmod 600 .env`. Au premier démarrage, le conteneur valide les réglages, crée `appdata/private` et `appdata/state`, écrit les secrets, applique les droits et les propriétaires `PUID:PGID` (1000 par défaut), puis abandonne les privilèges root avec `setpriv`. Le serveur refuse lui-même de démarrer en root. Si le conteneur est lancé directement en non-root, la préparation ne fait pas de chown : les dossiers doivent déjà être accessibles à cette identité.

Après un premier démarrage réussi, videz `ANYCUBIC_PASSWORD` et `WEB_PASSWORD` dans `.env`, puis lancez `docker compose up -d --force-recreate`. Gardez le même email Anycubic ou videz-le également : le compte enregistré est conservé. Un email différent sans son mot de passe est refusé. Les secrets sont réutilisés depuis `appdata/private` ; ne supprimez donc pas ce dossier. Les tests vérifient cette reprise sans nouvelle préparation du matériel client.

Les mots de passe fournis au démarrage restent visibles dans `docker inspect` tant que le conteneur n’a pas été recréé avec les valeurs vides. Pour les changer, renseignez de nouvelles valeurs puis recréez le service.

## Connexion et déconnexion

Le navigateur ouvre le formulaire français `/login`. La session dure huit heures au maximum et son cookie est HttpOnly, SameSite=Strict, Secure si `PUBLIC_ORIGIN` est HTTPS. Le bouton de déconnexion révoque la session côté serveur. Les échecs sont limités à cinq dans une fenêtre de cinq minutes, par adresse de connexion ; derrière un proxy, plusieurs utilisateurs peuvent partager cette limite. Un redémarrage ou un changement des identifiants invalide les sessions. Le contrôle Origin reste exigé sur les formulaires et les écritures API ; les lectures sans session renvoient 401 et l’interface propose une reconnexion sans rejouer de commande. `/imprimante-api/health` reste public.
