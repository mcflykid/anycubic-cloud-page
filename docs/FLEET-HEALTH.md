# Parc et alertes de santé

Le panneau **Parc et santé** résume les moteurs déjà suivis par l’application. Son endpoint authentifié `GET /imprimante-api/fleet` ne résout aucune cible, n’ouvre aucun client MQTT et ne lance aucun appel Cloud. Une machine du compte qui n’a pas encore de moteur est « Pas encore suivie ». La sélection habituelle de l’imprimante reste explicite et séparée. Les cartes n’offrent aucune commande physique.

## Disponibilité et fraîcheur

- **En ligne** : lecture Cloud réussie, état `printer_online=true`, mesure datée de moins de 120 secondes.
- **Hors ligne** : même fraîcheur, état explicite `printer_online=false`.
- **Cloud indisponible** : moteur en erreur; aucune conclusion sur l’alimentation de la machine.
- **Données périmées** : lecture trop ancienne ou date absente/invalide/future.
- **État inconnu** : source fraîche sans état booléen utilisable.

L’âge est calculé à partir de la plus récente date Cloud/MQTT valide. Les ISO horodatés doivent préciser leur fuseau; aucune date locale sans fuseau n’est interprétée. Une machine lente ou en erreur ne bloque pas le résumé des autres. Aucun nom de fichier, compte, numéro de série ou URL de caméra n’est inclus; les clés restent opaques comme dans le sélecteur existant.

## Alertes et rétablissement

Une anomalie de connexion observée pendant 180 secondes produit une seule ouverture par machine et état. Une nouvelle anomalie change d’état sans dupliquer l’ancienne ouverture. Un état confirmé en ligne produit un rétablissement; un état inconnu ne vaut pas rétablissement. Le journal conserve au maximum 32 transitions en mémoire du processus, dont huit sont affichées. Les machines retirées du catalogue ne sont plus exposées. Le redémarrage remet cette mémoire à zéro.

L’observation est à la demande, toutes les 30 secondes seulement quand le panneau est affiché. Une interruption d’observation de plus de 60 secondes remet à zéro une alerte encore en attente; un état inconnu interrompt aussi cette attente. Elle ne constitue pas une surveillance permanente ni une notification poussée en arrière-plan. Le seuil porte sur les observations disponibles, pas sur une garantie de disponibilité entre deux mesures. Aucune correction automatique n’est envoyée à l’imprimante.

## Codes connus et notifications

Les alarmes constructeur restent dans les notifications existantes, avec leur date et leur source historique. Elles ne sont pas présentées comme des alarmes encore actives. La table exacte `ERROR_CATALOGUE` de `notification_service.py` reconnaît `10115`; elle reprend la signification publiée par le [catalogue officiel Anycubic](https://wiki.anycubic.com/en/error-codes). Le code de succès `200` est exclu. Un code inconnu peut être affiché numériquement avec le catalogue officiel, sans explication inventée. Les traductions française, anglaise et espagnole ainsi que les liens autorisés sont couverts par les tests de notifications.

Un futur événement d’alarme active exigera une source par machine, une date fraîche et une confirmation de fin du même code. L’arrivée d’un ancien historique ou le seul acquittement de lecture d’une notification ne constituent pas cette confirmation. Aucun seuil thermique ni diagnostic matériel n’est déduit des températures sans spécification constructeur.

## Vérification

Les tests fictifs couvrent les dates ISO, les dates invalides/futures, les machines absentes, les états périmés, le seuil, le dédoublonnage, le rétablissement et la mémoire bornée. Les contrôles d’interface vérifient l’absence de commande, les sources non suivies et le retrait des anciennes cartes après erreur HTTP. Aucun de ces contrôles ne démarre de collecteur supplémentaire ou d’impression.
