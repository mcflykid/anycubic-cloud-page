# Feuille de route

Mise à jour le 11 novembre 2026. Dernière version publiée [1.9.0](https://github.com/mcflykid/anycubic-cloud-page/releases/tag/v1.9.0).

## Décisions du propriétaire

- L’atelier utilise le Cloud Anycubic. Les protocoles réseau locaux sont étudiés pour leurs formats et leurs idées.
- Le stockage du mot de passe web reste celui de l’installation actuelle.
- Le catalogue conserve Par défaut, Apple Design, Blueprint, Aurore, Laboratoire et Verrière. [#245](https://github.com/mcflykid/anycubic-cloud-page/issues/245)
- Les essais sur la Kobra S1 Combo suivent le cadre [#214](https://github.com/mcflykid/anycubic-cloud-page/issues/214), avec vérification de l’état et remise en état après chaque essai. Toute impression complète, mise à jour de firmware ou réinitialisation est exclue.

## En cours

Les critères sont regroupés dans [Prochaine livraison](https://github.com/mcflykid/anycubic-cloud-page/milestone/9).

| Sujet | Suivi |
| --- | --- |
| Ressources web stables | [#237](https://github.com/mcflykid/anycubic-cloud-page/issues/237) est livré sur `main` depuis `239c6fc`. |
| Régressions d’affichage | [#238 Graphiques](https://github.com/mcflykid/anycubic-cloud-page/issues/238), [#239 Historique Safari](https://github.com/mcflykid/anycubic-cloud-page/issues/239), [#240 Caméra](https://github.com/mcflykid/anycubic-cloud-page/issues/240) vérifiés dans les six styles sous Chromium et WebKit. [#264 Courbes du filament](https://github.com/mcflykid/anycubic-cloud-page/issues/264) place les quatre emplacements sur une rangée par ACE sur ordinateur. |
| Journaux, connexion et code temporaire | [#218 Journaux](https://github.com/mcflykid/anycubic-cloud-page/issues/218), [#215 Connexion](https://github.com/mcflykid/anycubic-cloud-page/issues/215), [#221 TOTP](https://github.com/mcflykid/anycubic-cloud-page/issues/221), [#249 File](https://github.com/mcflykid/anycubic-cloud-page/issues/249), [#250 Quota TOTP](https://github.com/mcflykid/anycubic-cloud-page/issues/250), [#251 Confirmation](https://github.com/mcflykid/anycubic-cloud-page/issues/251) |
| Discord | [#205 Notifications](https://github.com/mcflykid/anycubic-cloud-page/issues/205), [#252 Écritures](https://github.com/mcflykid/anycubic-cloud-page/issues/252), [#253 Événements manqués](https://github.com/mcflykid/anycubic-cloud-page/issues/253), [#254 Qualification S1](https://github.com/mcflykid/anycubic-cloud-page/issues/254) |
| Parcours et mouvements | [#241 Envoyer](https://github.com/mcflykid/anycubic-cloud-page/issues/241), [#242 Fichiers](https://github.com/mcflykid/anycubic-cloud-page/issues/242), [#243 Journal historique](https://github.com/mcflykid/anycubic-cloud-page/issues/243), [#244 Apple Design](https://github.com/mcflykid/anycubic-cloud-page/issues/244), [#246 Aurore](https://github.com/mcflykid/anycubic-cloud-page/issues/246), [#247 Grille](https://github.com/mcflykid/anycubic-cloud-page/issues/247), [#248 Animations](https://github.com/mcflykid/anycubic-cloud-page/issues/248) |
| Annotations en français | [#223](https://github.com/mcflykid/anycubic-cloud-page/issues/223), à intégrer après les autres changements. |

## Ensuite

[Livraison suivante](https://github.com/mcflykid/anycubic-cloud-page/milestone/13) regroupe le [découpage serveur #255](https://github.com/mcflykid/anycubic-cloud-page/issues/255), la [documentation des verrous #256](https://github.com/mcflykid/anycubic-cloud-page/issues/256), l’[audit des styles #257](https://github.com/mcflykid/anycubic-cloud-page/issues/257), l’[étude des seize dépôts #258](https://github.com/mcflykid/anycubic-cloud-page/issues/258), le [catalogue d’erreurs #259](https://github.com/mcflykid/anycubic-cloud-page/issues/259), le [registre des sources #260](https://github.com/mcflykid/anycubic-cloud-page/issues/260), les [README #261](https://github.com/mcflykid/anycubic-cloud-page/issues/261) et les [captures #262](https://github.com/mcflykid/anycubic-cloud-page/issues/262).

## À l’étude

[Milestone des investigations](https://github.com/mcflykid/anycubic-cloud-page/milestone/14).

| Sujet | Prochaine preuve et responsable |
| --- | --- |
| [#30 Timelapses](https://github.com/mcflykid/anycubic-cloud-page/issues/30) | Codex vérifie la correspondance liste, miniature et téléchargement avec une vidéo existante. |
| [#93 Données S1 et ACE](https://github.com/mcflykid/anycubic-cloud-page/issues/93) | Codex compare les unités et états reçus aux valeurs de l’écran, notamment l’RFID et la quantité. |
| [#103 Lancement G-code 3MF](https://github.com/mcflykid/anycubic-cloud-page/issues/103) | Codex identifie le format et les paramètres requis pour distinguer stockage et lancement. |
| [#136 Refus et séchage](https://github.com/mcflykid/anycubic-cloud-page/issues/136) | Codex documente les refus constructeurs et vérifie les options de séchage à partir de retours observés. |
| [#142 Fichier mémoire](https://github.com/mcflykid/anycubic-cloud-page/issues/142) | Codex compare un refus depuis la mémoire avec la lecture du même fichier depuis l’écran de la S1. |
| [#145 Maillage S1](https://github.com/mcflykid/anycubic-cloud-page/issues/145) | Codex cherche un export de maillage S1 effectivement récupérable et documente son format. |
| [#181 Aide Fichiers](https://github.com/mcflykid/anycubic-cloud-page/issues/181) | Le propriétaire donne son avis sur la [maquette #203](https://github.com/mcflykid/anycubic-cloud-page/pull/203). |
| [#194 Hôtes de stockage](https://github.com/mcflykid/anycubic-cloud-page/issues/194) | Codex établit une liste de destinations Anycubic étayée par la documentation ou des observations expurgées. |

## Idées non planifiées

Deuxième canal de notification, événements de filament ou de séchage, notifications hors ligne, inventaire et liaison Spoolman, statistiques mensuelles, vue mur plein écran, installation sur téléphone, file d’impressions avec confirmations, export de métriques, sauvegarde et restauration d’`appdata`, page d’état et rapport de compatibilité par modèle.

## Écarté

- Mode réseau local, conformément au choix de conserver l’intégration Cloud.
- Modification du stockage du mot de passe web, conformément à la décision du propriétaire.
- Lecture des coordonnées de la tête. La fonction a été retirée après des délais sans réponse exploitable. [#167](https://github.com/mcflykid/anycubic-cloud-page/issues/167)

## En attente du propriétaire

- Souhaites-tu conserver la maquette d’aide dans Fichiers pour la suite ? [#181](https://github.com/mcflykid/anycubic-cloud-page/issues/181) · [#203](https://github.com/mcflykid/anycubic-cloud-page/pull/203)
