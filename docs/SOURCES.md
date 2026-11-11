# Registre des sources

## Effets de l’atelier

| Ressource | Origine | Date | Archive d’origine | Utilisation dans l’atelier |
| --- | --- | --- | --- | --- |
| Parrilla · Moxen | [Démo et téléchargement](https://moxen.cl/recursos/parrilla/) | 2026-11-11 | `web/vendor/moxen/parrilla/` | `web/js/workshop-layout.mjs` et `web/css/workshop-layout.css`. Ressort de déplacement, soulèvement, cible d’insertion et retour d’une tuile pendant l’édition. Intégration retirée avec les dispositions modulables (#284). |
| Lote · Moxen | [Démo et téléchargement](https://moxen.cl/recursos/lote/) | 2026-11-11 | `web/vendor/moxen/lote/` | `web/js/workshop-selection.mjs`, `web/js/workshop-files.mjs` et `web/css/interactions.css`. Compteur à rouleaux, entrée de la barre et cascade de sélection. |
| Arrastre · Moxen | [Démo et téléchargement](https://moxen.cl/recursos/arrastre/) | 2026-11-11 | `web/vendor/moxen/arrastre/` | `web/js/workshop-upload-motion.mjs` et `web/css/interactions.css`. Inclinaison et lumière de la zone de dépôt. |
| Remesa · Moxen | [Démo et téléchargement](https://moxen.cl/recursos/remesa/) | 2026-11-11 | `web/vendor/moxen/remesa/` | `web/js/workshop-upload-motion.mjs` et `web/css/interactions.css`. Contour animé pendant un transfert. |
| Burbuja · Moxen | [Démo et téléchargement](https://moxen.cl/recursos/burbuja/) | 2026-11-11 | `web/vendor/moxen/burbuja/` | `web/js/workshop-notification-motion.mjs`. Ouverture et fermeture à partir de la cloche. |
| Esqueleto · Moxen | [Démo et téléchargement](https://moxen.cl/recursos/esqueleto/) | 2026-11-11 | `web/vendor/moxen/esqueleto/` | `web/css/visual-states.css` et `web/js/workshop-ui.mjs`. Bande synchronisée et formes de chargement pour Fichiers et Historique. Les photos de la démo restent dans l’archive avec leurs crédits. |
| Instrumental · Moxen | [Démo et téléchargement](https://moxen.cl/recursos/instrumental/) | 2026-11-11 | `web/vendor/moxen/instrumental/` | `web/js/workshop-monitoring.mjs`. Ressort du détail, interpolation du masque et synthèse des relevés. Les valeurs de l’atelier proviennent de sa propre collecte. |
| Canica · Moxen | [Démo et téléchargement](https://moxen.cl/recursos/canica/) | 2026-11-11 | `web/vendor/moxen/canica/` | `web/js/workshop-monitoring.mjs` et `web/css/monitoring.css`. Impulsion, frottement et rebond du témoin de suspension locale. |
| Curseur · Uiverse | [chase2k25](https://uiverse.io/chase2k25/slimy-chipmunk-97) | 2026-11-11 | CSS affiché sur la page | Ressort et curseur commun adaptés sous MIT dans `web/css/interactions.css` pour les trois sources de fichiers. |
| Interrupteur · Uiverse | [njesenberger](https://uiverse.io/njesenberger/rude-stingray-22) | 2026-11-11 | [Galaxy adbd2ad](https://github.com/uiverse-io/galaxy/blob/adbd2adde0a299a3956ea288fb444ec01891ca41/Toggle-switches/njesenberger_rude-stingray-22.html) | Rail en creux et bouton en relief adaptés sous MIT dans `web/css/interactions.css` pour le formulaire ACE. |
| Téléchargement · Uiverse | [nazar-gavrylyk](https://uiverse.io/nazar-gavrylyk/evil-dragon-24) | 2026-11-11 | [Galaxy adbd2ad](https://github.com/uiverse-io/galaxy/blob/adbd2adde0a299a3956ea288fb444ec01891ca41/Toggle-switches/Na3ar-17_evil-dragon-24.html) | Icône et pulsation adaptées sous MIT pour l’attente réelle de l’export CSV. |
| Étoiles · Uiverse | [SelfMadeSystem](https://uiverse.io/SelfMadeSystem/selfish-starfish-40) | 2026-11-11 | [Galaxy adbd2ad](https://github.com/uiverse-io/galaxy/blob/adbd2adde0a299a3956ea288fb444ec01891ca41/Radio-buttons/SelfMadeSystem_selfish-starfish-40.html) | Tracé SVG et rebond adaptés sous MIT pour l’évaluation d’une impression. |

## Sources de clôture

Les [révisions et licences amont](UPSTREAM-COMPARISON.md#lectures-retenues-pour-la-clôture-260) et les [guides du wiki](ANYCUBIC-WIKI-S1.md) documentent les études et l’aide de l’atelier. Les [notices](../THIRD_PARTY_NOTICES.md) identifient les composants distribués. Les archives Moxen gardent leur propre licence et restent hors de l’image du conteneur.


## Ventilation et température de chambre

- [Anycubic Cloud Client, description des ordres et de la télémétrie](https://github.com/Nino6689/anycubic-cloud-client/blob/6ea79c733ac3909f7bc1ca4970f2f75fe8d302b7/docs/PROTOCOL.md#545-order-1221--set-fan-speed-data). L’ordre `1221` utilise le champ `box_fan_level` pour la circulation et un seul champ par ordre.
- [Banc de travail officiel Anycubic Slicer Next](https://cloud-universe.anycubic.com/w/p/AcOrcaWeb/workbench/). Le profil S1 du client fixe les limites de `box_fan_level` de 0 à 100. La vue Cloud lit cette valeur en pourcentage et l’envoie telle quelle dans les réglages d’impression.
- [MineTech13, paquets Linux d’Anycubic Slicer Next](https://github.com/MineTech13/anycubic-slicer-next). Le dépôt reconditionne le client officiel. Il ne contient pas le code de la commande Cloud. Sur la Kobra S1 en mode Cloud, le client installé affiche la circulation en pourcentage et un champ Chambre à 0 °C / 0 °C. Ce dernier ne constitue pas une mesure de chambre exploitable.
- [OrcaCubic, périmètre de son étude Cloud](https://github.com/marcodiniz/OrcaCubic/blob/main/docs/FUTURE_ANYCUBIC_CLOUD_PRINTING.md). L’intégration testée du projet concerne la Kobra X en réseau local. L’étude Cloud ne valide aucun ordre de ventilation sur la S1.
- [Wiki Anycubic, chauffage de chambre du modèle S1 Max](https://wiki.anycubic.com/en/fdm-3d-printer/kobra-s1-max-combo/cavity-control-feature-introduction). La limite de 65 °C appartient à cette fonction du S1 Max et ne permet pas de déduire une commande ou une mesure sur la S1.
