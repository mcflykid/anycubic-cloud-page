# Wiki officiel Kobra S1 : usages dans l’atelier

Relevé du 11 novembre 2026 : le texte des 60 guides anglais du [sommaire Kobra S1 Combo](https://wiki.anycubic.com/en/fdm-3d-printer/kobra-s1-combo) et des 61 fiches S1 ou ACE associées dans le [catalogue des erreurs](https://wiki.anycubic.com/en/error-codes) a été extrait et parcouru. Les guides couvrent la mise en route, le réseau, le firmware, les fichiers, la caméra, l’ACE, le dépannage et le remplacement de pièces. Les illustrations, les vidéos de démontage et les manuels traduits ne sont pas qualifiés ici. Aucun accès à un compte Cloud ni commande d’imprimante n’est nécessaire pour cet examen.

## Ce que l’application peut expliquer

| Sujet | Indication du constructeur | Application proposée et limite |
| --- | --- | --- |
| [Connexion réseau](https://wiki.anycubic.com/en/fdm-3d-printer/kobra-s1-combo/network-connection-guide-and-troubleshooting) | Sur la S1, l’icône Wi-Fi seule ne confirme pas l’accès au Cloud ; le guide recommande un réseau 2,4 GHz sans portail d’authentification. | Dans Parc et santé, séparer la disponibilité du Cloud, la connexion MQTT de l’application et la fraîcheur de la télémétrie. Une seule de ces observations ne prouve pas la cause côté imprimante. |
| [Code 10115](https://wiki.anycubic.com/en/error-codes/10115-code/s1) et [clé USB](https://wiki.anycubic.com/en/fdm-3d-printer/kobra-s1/usb-flash-driver) | Le guide 10115 indique qu’un fichier incorrect ou incomplet peut provoquer le refus ; il propose de retrancher et de vérifier le fichier USB. Les deux fiches ne donnent pas les mêmes limites de capacité et d’unité d’allocation. | Afficher une fiche locale et distinguer fichier source, résultat de tranchage et destination. Ne pas prescrire un formatage ni généraliser les contraintes USB au Cloud ou à la mémoire interne. Les chiffres contradictoires ne sont pas repris. |
| [Journaux de défaut de la S1](https://wiki.anycubic.com/en/fdm-3d-printer/kobra-s1-combo/fault-log-export) | Export depuis l’écran vers une clé USB ; le constructeur indique de le faire avant un redémarrage pour préserver les traces du défaut. | Distinguer l’export de l’imprimante des logs du conteneur. Aide possible avec référence, version et heure ; aucune collecte des archives brutes ni transmission automatique. Cet export de journaux ne prouve pas l’export Mesh. |
| [Timelapse](https://wiki.anycubic.com/en/fdm-3d-printer/kobra-s1-combo/timelapse-photography) et [versions du firmware](https://wiki.anycubic.com/en/fdm-3d-printer/kobra-s1-combo/firmware-update-guide) | Le guide décrit la vidéo enregistrée sur la machine et exportable vers USB ; les notes 2.5.9.9 annoncent aussi la gestion distante. | Documenter l’export manuel ; le chemin réseau de lecture et téléchargement reste à qualifier dans #30. Une annonce de firmware n’établit ni le protocole distant ni les formats admis pour chaque source de fichier. |
| [ACE Pro : chargement et configuration](https://wiki.anycubic.com/en/fdm-3d-printer/kobra-s1-combo/ace-pro-loading-steps-and-configuration-information) et [secours de filament](https://wiki.anycubic.com/en/fdm-3d-printer/kobra-s1-combo/automatic-feeding-guide) | Les indications de chargement et de relais dépendent du montage et des matériaux. | Mettre en contexte les états déjà connus et l’aide du relais. Le wiki ACE Pro ne suffit pas pour déduire les unités, capteurs ou commandes de l’ACE 2 Pro. |
| [Entretien](https://wiki.anycubic.com/en/fdm-3d-printer/kobra-s1-combo/maintenance-recommendations) | La maintenance couvre notamment les vis Z, le guidage, les courroies et le nettoyage. | Une bibliothèque de conseils à la demande est utile. Une échéance automatique exige un relevé fiable et une date d’entretien déclarée ; le compteur Cloud seul ne suffit pas. Les réparations restent dans les fiches constructeur. |

## Deux compléments pour la S1

- [Compensation de pression et calibration du débit](https://wiki.anycubic.com/en/home/knowledge-sharing/pressure-advance) : le réglage agit sur l’extrusion pendant les changements de vitesse. La page montre un essai S1 avec une buse, un filament et un firmware précis. Elle décrit une calibration avant impression qui chauffe et extrude du filament. Une calibration réussie prévaut sur la valeur manuelle ; en cas d’échec, la machine peut poursuivre avec la valeur manuelle ou celle par défaut sans avertissement. Une aide près de l’option serait utile. Ne pas afficher un succès sans retour explicite ni recommander une valeur K universelle.
- [Détection IA](https://wiki.anycubic.com/en/home/knowledge-sharing/ai-detection) : le constructeur distingue l’objet sur le plateau avant impression, le défaut de type spaghetti pendant l’impression et l’obscurité. Une optique masquée, un éclairage insuffisant ou un plateau non standard peuvent limiter la détection. Les codes 11801, 11802 et 11812 peuvent être expliqués localement sans déduire une pause ou un arrêt d’une alerte seule. L’analyse d’image constructeur peut dépendre du Cloud ; la présence d’un flux vidéo dans l’atelier ne démontre pas que la détection IA est active.

## Choix de présentation

La fiche d’erreur s’ouvre dans l’atelier et contient un résumé original, les premiers contrôles et la source officielle facultative. La notification reste intacte. Un code inconnu conserve son numéro et le message reçu, sans inventer de diagnostic. Le catalogue local ne télécharge pas le wiki à l’ouverture et les URL de suivi ne sont pas conservées.

Une prochaine étape possible : des conseils intégrés à la page qui en a besoin (Réseau, Fichiers, Caméra ou Calibrations), sans les mélanger aux alertes de la cloche. Les afficher à la demande ou dans un état pertinent, avec une option pour les masquer. Aucun conseil ne déclenche une commande.

## Accès depuis l’atelier

Les boutons **Aide** des fichiers, de la caméra, du module ACE et des événements de connexion ouvrent un conseil local. Le panneau Calibrations propose le guide de débit lorsque les réglages machine sont disponibles. Les liens ci-dessus permettent de consulter le document du constructeur séparément. Fermer le dialogue rend l’accès à la section en cours. Ces conseils ne sont pas des notifications et ne commandent pas la machine.

## Rappels d’entretien

Les opérations proposées pour la Kobra S1 suivent la page [Maintenance Recommendations](https://wiki.anycubic.com/en/fdm-3d-printer/kobra-s1-combo/maintenance-recommendations). Le wiki donne des durées calendaires et des bobines, pas des heures d’impression : chaque opération a donc son unité.

| Opération | Échéance par défaut | Source |
| --- | --- | --- |
| Nettoyer et graisser la vis de l’axe Z | 90 jours | Wiki : environ trois mois, ou plus tôt en cas de bruit |
| Nettoyer et graisser les tiges de l’axe Y | 30 jours | Wiki : contrôle mensuel |
| Nettoyer les tiges de l’axe X à l’alcool, sans graisse | 30 jours | Wiki : bagues en graphène, ne jamais graisser l’axe X |
| Dépoussiérer les ventilateurs de la tête et l’auxiliaire | 30 jours | Wiki : contrôle régulier ; fréquence choisie par l’atelier |
| Contrôler l’usure du coupe-filament | 3 kg de filament | Wiki : après trois à cinq bobines |
| Nettoyer la buse et contrôler la chaussette silicone | 50 h d’impression | Wiki : selon l’état constaté ; valeur de l’atelier |
| Nettoyer la plaque en acier | 50 h d’impression | Wiki : nettoyage régulier ; valeur de l’atelier |

Les courroies ne figurent pas sur cette page du wiki : l’ancienne opération n’est plus proposée par défaut, mais elle reste en place sur une installation existante. L’ancienne opération « Graisser les axes et tiges » est renommée pour rappeler que l’axe X ne se graisse pas.

Une opération calendaire démarre lorsqu’elle est marquée comme faite. Une opération en heures accepte le compteur de la dernière intervention ; une opération en kilogrammes suit le filament cumulé indiqué par le constructeur.
