# Feuille de route

Mise à jour le 13 novembre 2026. Voir les [versions publiées](https://github.com/mcflykid/anycubic-cloud-page/releases).

## Décisions du propriétaire

- L’atelier utilise le Cloud Anycubic. Les protocoles réseau locaux sont étudiés pour leurs formats et leurs idées.
- Le stockage du mot de passe web reste celui de l’installation actuelle.
- Le catalogue conserve Par défaut, Aurore et Laboratoire. Voir le [guide des styles](THEMES.md).
- Les essais sur la Kobra S1 Combo suivent le cadre [#214](https://github.com/mcflykid/anycubic-cloud-page/issues/214), avec vérification de l’état et remise en état après chaque essai. Toute impression complète, mise à jour de firmware ou réinitialisation est exclue.

## Version 1.13.0

Les [changements](../CHANGELOG.md) détaillent les nouvelles fenêtres de l’atelier. Le [guide des fiches filament](FICHES-FILAMENT.md) explique comment consulter le catalogue et ajouter ses propres fiches. Le [suivi des versions](https://github.com/mcflykid/anycubic-cloud-page/issues/347) détaille les lots suivants. Les [essais de clôture](CLOSURE.md) documentent les validations et les preuves à réunir si une investigation reprend.

| Sujet | Référence |
| --- | --- |
| Discord | [Alertes et bilans](NOTIFICATIONS.md) |
| Aide et catalogue | [Wiki officiel Kobra S1](ANYCUBIC-WIKI-S1.md) |
| Lectures amont et crédits | [Registre des sources](SOURCES.md) |
| Limites et validation réelle | [Dossier de clôture](CLOSURE.md) |

## Idées non planifiées

Notifications hors ligne, inventaire et liaison Spoolman, statistiques mensuelles, installation sur téléphone, export de métriques, sauvegarde et restauration d’`appdata`, page d’état et rapport de compatibilité par modèle.

## Écarté

- Mode réseau local, conformément au choix de conserver l’intégration Cloud.
- Modification du stockage du mot de passe web, conformément à la décision du propriétaire.
- Lecture des coordonnées de la tête. La fonction a été retirée après des délais sans réponse exploitable. [#167](https://github.com/mcflykid/anycubic-cloud-page/issues/167)
