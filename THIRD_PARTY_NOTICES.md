# Origine et composants tiers

## Client cloud Python

Le dossier `app/anycubic_cloud_api/` dérive de [ljschmitt/hass-anycubic_cloud_v3](https://github.com/ljschmitt/hass-anycubic_cloud_v3), sous GPL-3.0. Le fichier de licence est conservé dans `LICENSE` et `app/LICENSE`.

Le client n’est pas une API officielle Anycubic. Les adaptations comprennent la connexion mode slicer, la compatibilité MQTT/TLS historique, le traitement de rapports de firmware récents et l’externalisation du matériel client/certificats. Le backend et le frontend de l’atelier autonome, les extensions cloud, la récupération locale de token et la distribution Docker sont fournis sous GPL-3.0-or-later.

Les certificats et la constante de signature client ne sont **pas** inclus dans Git. Le script de préparation les récupère depuis la révision amont indiquée et les conserve dans le dossier runtime privé. Cela n’autorise pas la publication des tokens ou identifiants personnels.

Les correctifs MQTT ciblés de la version amont **0.4.5** (`67c671a5aaa5415a84d075a3f16ebf14650337ce`) sont repris pour les rapports ACE partiels, les phases de préparation, la ventilation, les rapports informatifs, les échecs vidéo et les particularités Kobra X (#63). Nos adaptations de confidentialité et de routage sont conservées. La révision de récupération des certificats reste inchangée ; cette reprise ne remplace pas le client complet.

Le transport des transferts signés dispose également d’un délai borné proportionnel à la taille du fichier (#57), distinct du délai des requêtes API.

L’interprétation de la pause et du nivellement suit les états documentés par le client amont 0.4.5 (#91).

## Caméra Agora

Dépendance : `agora-rtc-sdk-ng` **4.24.9**, propriétaire de la publication npm : Agora. La métadonnée de licence du package npm annonce MIT ; les conditions et notices de l’éditeur demeurent applicables. Le bundle n’est pas versionné ici : le build utilise `npm ci` et copie le fichier distribué, avec son en-tête de copyright, dans l’image Docker.

## Visuels

Les illustrations locales Kobra S1/ACE sont des visuels non officiels créés pour cette interface avec assistance générative. Elles ne sont pas des logos officiels Anycubic. L’icône nuage du projet est un SVG original. Les captures publiques sont des captures du mode démonstration, avec données fictives.

Anycubic, Kobra, ACE et Agora sont des marques de leurs titulaires. Le projet n’est ni affilié ni présenté comme un service officiel.

Le client cloud intégré libère la réservation de quota après un échec ou une annulation du transfert (#58). Les fichiers locaux sont lus progressivement pour limiter la mémoire pendant les envois (#24).

L’ordre de fermeture vidéo 1002 s’appuie sur le [changement RespawnDespair 53c406b](https://github.com/RespawnDespair/hass-anycubic_cloud_v3/commit/53c406b0244526c4244c42f75bce4d9ad933ca78), issu du client Anycubic sous GPL-3.0 (#64).

## Repères de vocabulaire et de matériaux

Les catalogues de traduction, `info/filament_info.json` et les noms des profils Anycubic Slicer Next 2.0.0.3 ont été consultés pour identifier les fonctions et les familles de matériaux (#130, #136, #138). Le glossaire et le petit catalogue de lecture de cet atelier sont rédigés pour le projet ; aucun catalogue `.mo`, profil, paramètre de tranche ou code du slicer n’est repris. Les désignations de matériaux sont des noms techniques. La licence de ces ressources empaquetées n’étant pas établie séparément, elles ne sont pas redistribuées. Les groupes thermiques servent uniquement à produire un avertissement ; ils ne fixent aucune température et n’autorisent aucune chauffe.

Les treize illustrations SVG supplémentaires du catalogue Kobra (#128) sont des dessins originaux simplifiés, créés pour l’atelier à partir des caractéristiques visuelles des modèles. Aucun pixel des images de couverture du slicer, logo ou texture de plateau n’est repris. Un dessin disponible ne constitue pas une déclaration de compatibilité Cloud.

## Étude amont 0.4.8 et forks

Les versions 0.4.5 à 0.4.8 de [ljschmitt/hass-anycubic_cloud_v3](https://github.com/ljschmitt/hass-anycubic_cloud_v3), sous GPL-3.0, et leurs forks ont été comparés. La qualification locale du champ de pourcentage ACE 2 Pro suit les critères constructeur employés dans `AnycubicSpoolInfo.consumables_percent` au [commit stable étudié](https://github.com/ljschmitt/hass-anycubic_cloud_v3/tree/bef29d737edf431fb78a3a0619a971a0eaff7fb8), avec reconnaissance du travail des contributeurs amont; elle est réimplémentée dans un helper local. Aucun composant Home Assistant, bundle généré ou binaire tiers supplémentaire n’est embarqué. La revue et les décisions figurent dans `docs/UPSTREAM-FORKS.md`.

## QR de connexion à deux facteurs

[Segno 1.6.6](https://pypi.org/project/segno/), Copyright (c) 2016 - 2025, Lars Heuer, encodeur Python sous licence BSD à trois clauses. Le paquet installé conserve l’avis complet dans son dossier de métadonnées. La dépendance n’est utilisée que pour la génération locale du QR. Aucun service externe ne reçoit la clé.

Le contenu de `web/vendor/` reste soumis aux conditions de ses auteurs et n’est pas couvert par la licence GPL du projet.

## Commandes Uiverse

- [Curseur des boutons radio par chase2k25](https://uiverse.io/chase2k25/slimy-chipmunk-97). Copyright © 2026 chase2k25 (chandu.exe).
- [Interrupteur par njesenberger](https://uiverse.io/njesenberger/rude-stingray-22). Copyright © 2026 njesenberger (Nicolas Jesenberger).
- [Bouton de téléchargement par nazar-gavrylyk](https://uiverse.io/nazar-gavrylyk/evil-dragon-24). Copyright © 2026 nazar-gavrylyk (Nazar).

- [Étoiles par SelfMadeSystem](https://uiverse.io/SelfMadeSystem/selfish-starfish-40). Copyright © 2026 SelfMadeSystem (SelfMadeSystem).

Les adaptations CSS sont distribuées avec l’avis MIT suivant.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
