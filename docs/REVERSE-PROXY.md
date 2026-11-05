# Reverse proxy existant

L’application fournit HTTP sur le port interne 8080. Le HTTPS est assuré par votre proxy, installé séparément. **N’exposez jamais le port HTTP de l’application directement sur Internet.** N’ajoutez pas de `basic_auth` au proxy : l’application prend en charge la connexion web.

Les exemples utilisent le domaine fictif `printer.example.com`. Remplacez-le par votre domaine. Configurez dans `.env` :

```dotenv
PUBLIC_ORIGIN=https://printer.example.com
HOME_URL=/imprimante.html
```

`PUBLIC_ORIGIN` doit être l’origine exacte du navigateur : protocole, domaine et port éventuel, sans chemin. Une origine différente fait échouer les requêtes protégées. Le proxy transmet Host et le protocole public, sans réécrire l’en-tête Origin. Les exemples transmettent tout le site : `/imprimante.html`, `/imprimante-api/*`, `/about`, `/css/*`, `/js/*`, `/icons/*` `/login`, `/logout` et les routes de connexion. Ne retirez pas de préfixe de chemin.

## Proxy installé sur l’hôte

Le Compose de base fonctionne sans `PROXY_NETWORK` :

```dotenv
BIND_ADDRESS=127.0.0.1
WEB_PORT=8080
```

```sh
docker compose up -d
```

La cible du proxy est `127.0.0.1:8080`. Si vous changez `WEB_PORT`, adaptez cette cible ; `PUBLIC_ORIGIN` reste l’adresse publique du proxy.

### Caddy sur l’hôte

Ajoutez ce bloc au Caddyfile de votre proxy existant :

```caddyfile
printer.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

### Nginx sur l’hôte

Exemple de serveur HTTPS avec un certificat déjà présent :

```nginx
server {
    listen 443 ssl;
    server_name printer.example.com;
    ssl_certificate /etc/letsencrypt/live/printer.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/printer.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $http_host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Adaptez les chemins du certificat à votre proxy. Son renouvellement relève de votre installation Nginx.

### Traefik sur l’hôte

Dans le fournisseur de fichiers de votre Traefik existant, ajoutez ce fichier dynamique. L’exemple suppose un point d’entrée HTTPS `websecure` et un résolveur de certificats `letsencrypt` déjà configurés ; adaptez leurs noms si nécessaire.

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
          - url: "http://127.0.0.1:8080"
```

## Proxy dans un conteneur

Téléchargez aussi [`compose.proxy.yaml`](../compose.proxy.yaml). Compose 2.24.4 ou supérieur est requis. Choisissez un réseau externe déjà partagé avec votre proxy :

```dotenv
PROXY_NETWORK=proxy-shared
PUBLIC_ORIGIN=https://printer.example.com
```

Si le réseau n’existe pas, créez-le une seule fois :

```sh
docker network create proxy-shared
```

Dans le Compose de votre proxy, rattachez son service au même réseau, en conservant ses autres réseaux et ses réglages. Fragment à adapter au nom réel du service proxy :

```yaml
services:
  proxy:
    networks:
      - "proxy"
networks:
  proxy:
    external: true
    name: "${PROXY_NETWORK:?Définissez le réseau partagé}"
```

Définissez `PROXY_NETWORK` aussi pour ce Compose, puis démarrez l’application :

```sh
docker compose -f compose.yaml -f compose.proxy.yaml up -d
```

**Aucun port n’est publié sur l’hôte dans ce mode.** `BIND_ADDRESS` et `WEB_PORT` ne s’appliquent plus ; la cible est `anycubic-cloud-page:8080`. L’application et le proxy doivent partager le réseau externe. Ce réseau reste géré séparément : arrêter l’application ne le supprime pas.

### Caddy en conteneur

```caddyfile
printer.example.com {
    reverse_proxy anycubic-cloud-page:8080
}
```

### Nginx en conteneur

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

Les certificats doivent être montés dans votre conteneur Nginx. Démarrez l’application avant de recharger cette configuration pour que son nom soit résolu.

### Traefik en conteneur

Utilisez le fournisseur de fichiers existant, sans demander l’accès au socket Docker pour cette application. Mêmes prérequis HTTPS que dans le cas hôte :

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

## Contrôles

Vérifiez `docker compose ps -a`, puis la santé à travers le proxy :

```sh
curl --fail https://printer.example.com/imprimante-api/health
```

La santé reste publique. La page doit demander la connexion de l’application ; testez ensuite une lecture de statut. Une réponse de santé ne prouve pas la connexion au cloud. En cas d’erreur Origin, comparez l’adresse réelle du navigateur à `PUBLIC_ORIGIN` au lieu de désactiver la protection.

Références : [Caddy reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), [Nginx proxy](https://nginx.org/en/docs/http/ngx_http_proxy_module.html), [Traefik HTTP](https://doc.traefik.io/traefik/reference/routing-configuration/http/routing/router/), [réseaux externes Compose](https://docs.docker.com/reference/compose-file/networks/#external).
