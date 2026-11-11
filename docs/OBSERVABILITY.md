# Contrat Prometheus facultatif

Cette note définit un contrat pour une éventuelle exposition Prometheus. La [supervision locale JSON](MONITORING.md) est disponible dans Parc et santé ; aucun endpoint Prometheus n’est activé et aucun port supplémentaire n’est ouvert. Les journaux filtrés complètent ces mesures pour le diagnostic.

## Accès

Toute implémentation doit être désactivée par défaut. Si elle est activée, elle doit réutiliser le serveur HTTP existant et son contrôle d’accès, avec un chemin stable sous `/imprimante-api/metrics`. Aucun port distinct, socket Docker ou accès non authentifié ne doit être requis. L’endpoint ne doit jamais être accessible avant la vérification de session et du contrôle d’accès.

## Séries autorisées

Les noms sont préfixés `cloud_page_`. Les valeurs de durée sont en secondes. Les compteurs sont monotones pendant la vie du processus. Les valeurs absentes restent absentes : elles ne sont pas converties en zéro.

| Nom | Type Prometheus | Unité | Définition |
| --- | --- | --- | --- |
| `cloud_page_known_printers` | gauge | imprimantes | Nombre d’entrées de catalogue déjà connues localement. Aucun nouvel appel Cloud n’est déclenché pour le calcul. |
| `cloud_page_poll_age_seconds` | gauge | secondes | Âge du dernier relevé Cloud réussi le plus ancien parmi les moteurs déjà chargés. Pas de série si aucun relevé n’existe. |
| `cloud_page_poll_errors_total` | counter | erreurs | Échecs de collecte observés depuis le démarrage. |
| `cloud_page_mqtt_connected` | gauge | booléen 0/1 | État du transport MQTT local ; absent tant qu’il n’est pas connu. |
| `cloud_page_temperature_sample_age_seconds` | gauge | secondes | Âge du dernier relevé thermique local ; absent si aucun relevé n’a été reçu. |
| `cloud_page_cloud_request_duration_seconds` | histogram | secondes | Durée des appels Cloud connus, sans URL complète, paramètres, compte ou contenu de requête/réponse. |

Cardinalité cible : six noms fixes, sans étiquette. Si une future révision requiert une étiquette de résultat, seules des valeurs d’énumération fermées et documentées sont acceptables. Les clés d’imprimante, noms, comptes, adresses, chemins, fichiers, tâches et identifiants ne sont jamais des étiquettes.

## Compatibilité et tests requis

Une implémentation ultérieure doit tester le format Prometheus, les types et unités, l’absence des étiquettes interdites, l’accès non authentifié refusé, l’absence d’endpoint quand l’option est désactivée, et la non-création d’un moteur ou d’un appel de collecte pendant le scrapping. Les tests doivent utiliser des moteurs et données fictifs. La génération d’une métrique ne doit jamais appeler une commande d’imprimante.

## Historique thermique

Les relevés restent propres à chaque fichier d’imprimante déjà isolé par le registre. Le format v2 de `temperatures.json` contient au plus 8 640 points bruts sur 24 heures et jusqu’à 720 moyennes horaires sur 30 jours, avec un plafond dur de 16 000 000 octets par fichier. Une liste JSON historique est migrée en mémoire et remplacée par le format v2 lors de la prochaine sauvegarde. Aucun relevé avant l’activation n’est créé. `clear()` efface les deux résolutions et le fichier de cet historique uniquement.
