# Origine et composants tiers

## Client cloud Python

Le dossier `app/anycubic_cloud_api/` dérive de [ljschmitt/hass-anycubic_cloud_v3](https://github.com/ljschmitt/hass-anycubic_cloud_v3), sous GPL-3.0. Le fichier de licence est conservé dans `LICENSE` et `app/LICENSE`.

Le client n’est pas une API officielle Anycubic. Les adaptations comprennent la connexion mode slicer, la compatibilité MQTT/TLS historique, le traitement de rapports de firmware récents et l’externalisation du matériel client/certificats. Le backend et le frontend de l’atelier autonome, les extensions cloud, la récupération locale de token et la distribution Docker sont fournis sous GPL-3.0-or-later.

Les certificats et la constante de signature client ne sont **pas** inclus dans Git. Le script de préparation les récupère depuis la révision amont indiquée et les conserve dans le dossier runtime privé. Cela n’autorise pas la publication des tokens ou identifiants personnels.

## Caméra Agora

Dépendance : `agora-rtc-sdk-ng` **4.24.9**, propriétaire de la publication npm : Agora. La métadonnée de licence du package npm annonce MIT ; les conditions et notices de l’éditeur demeurent applicables. Le bundle n’est pas versionné ici : le build utilise `npm ci` et copie le fichier distribué, avec son en-tête de copyright, dans l’image Docker.

## Visuels

Les illustrations locales Kobra S1/ACE sont des visuels non officiels créés pour cette interface avec assistance générative. Elles ne sont pas des logos officiels Anycubic. L’icône nuage du projet est un SVG original. Les captures publiques sont des captures du mode démonstration, avec données fictives.

Anycubic, Kobra, ACE et Agora sont des marques de leurs titulaires. Le projet n’est ni affilié ni présenté comme un service officiel.
