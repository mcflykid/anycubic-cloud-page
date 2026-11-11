# Feuille de route

Mise à jour le 11 novembre 2026. Voir les [versions publiées](https://github.com/mcflykid/anycubic-cloud-page/releases).

## Décisions du propriétaire

- L’atelier utilise le Cloud Anycubic. Les protocoles réseau locaux sont étudiés pour leurs formats et leurs idées.
- Le stockage du mot de passe web reste celui de l’installation actuelle.
- Le catalogue conserve Par défaut, Aurore et Laboratoire. Voir le [guide des styles](THEMES.md).
- Les essais sur la Kobra S1 Combo suivent le cadre [#214](https://github.com/mcflykid/anycubic-cloud-page/issues/214), avec vérification de l’état et remise en état après chaque essai. Toute impression complète, mise à jour de firmware ou réinitialisation est exclue.

## Livré dans la 1.10.0

Prisme, la connexion à deux facteurs, les corrections d’affichage et le découpage du serveur sont détaillés dans le [journal des changements](../CHANGELOG.md).

## En cours

Les critères sont regroupés dans [Prochaine livraison](https://github.com/mcflykid/anycubic-cloud-page/milestone/9).

| Sujet | Suivi |
| --- | --- |
| Discord | [#205 Notifications](https://github.com/mcflykid/anycubic-cloud-page/issues/205), [#312 Bilans programmés](https://github.com/mcflykid/anycubic-cloud-page/issues/312) |
| Suite de l’interface | [#248 Animations](https://github.com/mcflykid/anycubic-cloud-page/issues/248) |
| Annotations en français | [#223](https://github.com/mcflykid/anycubic-cloud-page/issues/223), à intégrer après les autres changements. |

## Ensuite

[Livraison suivante](https://github.com/mcflykid/anycubic-cloud-page/milestone/13) regroupe l’[audit des styles #257](https://github.com/mcflykid/anycubic-cloud-page/issues/257), l’[étude des seize dépôts #258](https://github.com/mcflykid/anycubic-cloud-page/issues/258), le [catalogue d’erreurs #259](https://github.com/mcflykid/anycubic-cloud-page/issues/259), le [registre des sources #260](https://github.com/mcflykid/anycubic-cloud-page/issues/260), les [README #261](https://github.com/mcflykid/anycubic-cloud-page/issues/261) et les [captures #262](https://github.com/mcflykid/anycubic-cloud-page/issues/262).

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
