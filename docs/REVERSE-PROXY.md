# Reverse proxy existant

L’application écoute en HTTP sur le port interne 8080. Votre proxy fournit HTTPS. **Ne publiez jamais le port HTTP directement sur Internet.** N’ajoutez pas de basic_auth : la connexion est gérée par l’application.

Un seul `compose.yaml` couvre les deux modes. `APPDATA_DIR` vaut `./appdata` par défaut. Dans `.env`, `PUBLIC_ORIGIN` est l’origine exacte du navigateur, protocole, domaine et port éventuel, sans chemin ; le proxy ne doit pas réécrire Origin.

Avec une origine HTTPS, le cookie de session `__Host-anycubic_session` est émis avec `Secure`, `Path=/` et sans attribut `Domain`. L’origine HTTP locale conserve `anycubic_session`.

## Proxy sur l’hôte

```dotenv
BIND_ADDRESS=127.0.0.1
WEB_PORT=8080
PUBLIC_ORIGIN=https://printer.example.com
```

Laissez PROXY_NETWORK et PROXY_NETWORK_EXTERNAL absents. Compose crée son réseau. La cible du proxy est `127.0.0.1:8080` ; adaptez-la si WEB_PORT change.

## Proxy dans un conteneur

Choisissez un réseau déjà partagé avec le proxy :

```dotenv
PROXY_NETWORK=proxy-shared
PROXY_NETWORK_EXTERNAL=true
PUBLIC_ORIGIN=https://printer.example.com
```

Les deux réglages sont nécessaires : le nom seul ne déclare pas un réseau externe. `external=true` empêche Compose d’en gérer le cycle de vie. Si le réseau n’existe pas, créez-le avec `docker network create proxy-shared` ou dans le Compose de votre proxy. La cible est `anycubic-cloud-page:8080`.

```sh
docker compose config --quiet
docker compose up -d
```

Le port reste publié sur `127.0.0.1:8080` par défaut, même dans ce mode ; cela ne l’expose pas à Internet. Le réseau externe est conservé lors de `docker compose down`. Les installations CI vérifient aussi un réseau appartenant à un autre projet Compose.

## Exemples pour un domaine dédié

Remplacez `printer.example.com`. Ces exemples transmettent tout le site, sans retirer de préfixe : page, /login, /logout, /about, /conditions, /cookies, /credits, /imprimante-api/*, /css/*, /js/* et /icons/*.

### Caddy

Proxy sur l’hôte :

```caddyfile
printer.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Proxy dans un conteneur :

```caddyfile
printer.example.com {
    reverse_proxy anycubic-cloud-page:8080
}
```

Sauvegardez le Caddyfile avant modification. Validez puis chargez explicitement la configuration :

```sh
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

Pour Caddy dans un conteneur, exécutez ces commandes via `docker compose exec <service-proxy>`. Un simple `up -d` peut conserver le conteneur et ne recharge pas forcément un Caddyfile monté modifié. Une recréation ciblée avec `up -d --no-deps --force-recreate <service-proxy>` charge aussi le fichier, mais interrompt brièvement ce proxy.

### Nginx

Avec un certificat déjà présent :

```nginx
server {
    listen 443 ssl;
    server_name printer.example.com;
    ssl_certificate /etc/letsencrypt/live/printer.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/printer.example.com/privkey.pem;
    location / {
        proxy_pass http://anycubic-cloud-page:8080;
        proxy_set_header Host $http_host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Pour un proxy sur l’hôte, remplacez la cible par `http://127.0.0.1:8080`. Les certificats et leur renouvellement relèvent de votre Nginx. Démarrez l’application avant de valider avec `nginx -t`, puis rechargez avec `nginx -s reload`.

### Traefik

Dans le fournisseur de fichiers de votre Traefik, avec un point d’entrée websecure et un résolveur letsencrypt déjà configurés :

```yaml
http:
  routers:
    anycubic-cloud-page:
      rule: "Host(`printer.example.com`)"
      entryPoints: ["websecure"]
      service: "anycubic-cloud-page"
      tls:
        certResolver: "letsencrypt"
  services:
    anycubic-cloud-page:
      loadBalancer:
        servers:
          - url: "http://anycubic-cloud-page:8080"
```

Sur l’hôte, remplacez la cible par `http://127.0.0.1:8080`. L’application ne nécessite pas d’accès au socket Docker du proxy.

## Domaine partagé avec un site existant

Les chemins doivent appartenir sans ambiguïté à une application. L’atelier utilise des chemins absolus ; il ne peut pas être installé sous un préfixe arbitraire. Exemple Caddy :

```caddyfile
printer.example.com {
    @atelier path /imprimante.html /login /logout /imprimante-api /imprimante-api/*
    handle @atelier {
        reverse_proxy anycubic-cloud-page:8080
    }
    handle {
        root * /srv/site
        file_server
    }
}
```

Les scripts, styles, illustrations et notices de l’atelier passent sous `/imprimante-api/ui/`. Les installations qui transmettent déjà `/imprimante-api/*` reçoivent ces ressources sans ajouter de chemins. Les en-têtes CSP et Referrer-Policy de l’autre site doivent être limités à son bloc, sans écraser ceux de l’application. Une CSP avec `form-action 'none'` bloque la connexion ; `Referrer-Policy: no-referrer` peut rendre Origin nul sur un formulaire. Conservez les en-têtes de sécurité de l’application et sa protection Origin.

## Intégrer à une stack existante avec un .env central et DOCKERDIR

Exemple générique d’arborescence : `/srv/containers/compose/anycubic-cloud-page/compose.yaml`, environnement central `/srv/containers/compose/.env`, données dans `/srv/containers/appdata/anycubic-cloud-page`.

```dotenv
# Variables déjà partagées entre les services.
DOCKERDIR=/srv/containers
PUID=1000
PGID=1000
TZ=Europe/Paris

# Anycubic Cloud Page
ANYCUBIC_EMAIL='votre-compte@example.com'
ANYCUBIC_PASSWORD='votre-mot-de-passe-anycubic'
ANYCUBIC_TOKEN=
WEB_USER=admin
WEB_PASSWORD='choisissez-un-mot-de-passe-web'
PUBLIC_ORIGIN=https://printer.example.com
HOME_URL=/imprimante.html
PRINTER_ID=
APPDATA_DIR=${DOCKERDIR}/appdata/anycubic-cloud-page
PROXY_NETWORK=proxy-shared
PROXY_NETWORK_EXTERNAL=true
BIND_ADDRESS=127.0.0.1
WEB_PORT=8080
```

Ne dupliquez pas les variables communes déjà définies. Vérifiez qu’une variable générique comme APPDATA_DIR n’est pas utilisée avec une autre signification dans les autres services. Gardez cet environnement en 600. La préparation permet ensuite de vider les mots de passe, selon le [guide d’installation](INSTALLATION.md).

```sh
docker compose --env-file /srv/containers/compose/.env -f /srv/containers/compose/anycubic-cloud-page/compose.yaml config --quiet
docker compose --env-file /srv/containers/compose/.env -f /srv/containers/compose/anycubic-cloud-page/compose.yaml up -d
```

Un gestionnaire de stacks doit utiliser exactement ce fichier et cet environnement. Vérifiez aussi le montage `/appdata` et le réseau réellement présents dans `docker inspect`, sans publier l’environnement résolu. Des variables différentes peuvent créer un autre dossier de données alors que le conteneur est healthy.

## Contrôles et diagnostic

Sur l’hôte :

```sh
curl -A 'Mozilla/5.0' --silent --show-error --output /dev/null --write-out '%{url_effective} HTTP %{http_code}\n' http://127.0.0.1:8080/imprimante-api/health
```

À travers le proxy :

```sh
curl -A 'Mozilla/5.0' --silent --show-error --output /dev/null --write-out '%{url_effective} HTTP %{http_code}\n' https://printer.example.com/imprimante-api/health
```

La santé attendue est 200. Elle prouve HTTP, pas la connexion cloud. Vérifiez ensuite la connexion, le statut cloud et les [lectures authentifiées](INSTALLATION.md#contrôles-authentifiés-en-lecture). Un 403 public avec une santé locale valide peut venir du filtrage du User-Agent : comparez avec le navigateur avant de modifier l’application. Un 502 avec une application healthy indique souvent un réseau ou une cible proxy incorrects. Ne désactivez ni le filtrage ni Origin pour faire passer une sonde.

Après une mise à jour, vérifiez aussi les ressources et pages ajoutées à l’atelier. Avec une liste de chemins exacte, la 1.2.8 et les versions suivantes requièrent notamment `/icons/printer.svg`, `/icons/ace.svg`, `/icons/ace-pro.svg` et les pages `/conditions`, `/cookies`, `/credits`. La 1.2.8 requiert aussi `/js/ui-language.js`. Une ressource en 404 ou renvoyée par le site statique au lieu de l’atelier peut bloquer l’interface. Les trois notices doivent être servies en `text/html` après connexion.

Une recréation interrompt brièvement HTTP et invalide les sessions. Les lectures en cours peuvent recevoir 502 ; attendez healthy, reconnectez-vous et distinguez les erreurs de cette fenêtre des nouvelles erreurs. Conservez les traces, sans les effacer ni les noyer. Ne rejouez jamais automatiquement une commande physique après un résultat incertain.

Références : [réseaux externes Compose](https://docs.docker.com/reference/compose-file/networks/#external), [Caddy reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), [Nginx proxy](https://nginx.org/en/docs/http/ngx_http_proxy_module.html), [Traefik HTTP](https://doc.traefik.io/traefik/reference/routing-configuration/http/routing/router/).


## Compteurs de connexion et proxys de confiance
Par défaut, la limitation de connexion utilise l’adresse du pair HTTP et ignore `X-Forwarded-For`. Les adresses IPv6 sont regroupées par préfixe `/64`, afin qu’un client ne contourne pas le quota en changeant seulement son adresse dans le même sous-réseau. Derrière un proxy, renseignez `TRUSTED_PROXIES` avec l’adresse IP exacte de ce proxy (ou son réseau strictement maîtrisé), puis recréez le service. Le proxy doit remplacer l’en-tête client ou lui ajouter le pair réel selon une chaîne de confiance connue. La résolution parcourt la chaîne depuis la droite et s’arrête au premier pair non déclaré fiable ; une chaîne partiellement invalide revient entièrement au pair HTTP, sans retenir les adresses fournies. Ne faites pas confiance à tous les réseaux ni aux clients finaux.

Une adresse ayant cinq échecs reste temporairement limitée, même avec le bon mot de passe ; les autres adresses ne partagent plus son compteur si le proxy est correctement déclaré. La table conserve au plus 1 024 compteurs et retire le plus ancien avant d’enregistrer une nouvelle adresse. La saturation ne bloque donc pas globalement les nouvelles connexions, au prix de l’expiration anticipée d’un ancien compteur sous très forte rotation d’adresses. Cette configuration n’influence ni `PUBLIC_ORIGIN` ni les cookies Secure.

Si plusieurs personnes obtiennent HTTP 429 après les échecs d’une seule, vérifiez si l’application voit la même adresse de proxy pour toutes. Par exemple, avec un proxy fixe à `192.0.2.10`, configurez `TRUSTED_PROXIES=192.0.2.10/32` (adresse fictive à remplacer). Un réseau partagé avec d’autres services étendrait la confiance à ces services. Vérifiez la transmission de `X-Forwarded-For` côté proxy et séparez les clients à l’aide d’adresses de test, sans atteindre le seuil en production.
