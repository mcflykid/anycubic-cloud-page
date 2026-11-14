# Qualification du séchage et du timelapse au lancement

La compatibilité est à relever pour un modèle et une version de micrologiciel donnés. La disponibilité de la caméra ou le retour HTTP positif d’un lancement ne prouvent pas que l’imprimante a créé un timelapse.

| Fonction | Signal à consigner | Disponibilité |
| --- | --- | --- |
| Séchage manuel | Rapport MQTT postérieur à la demande, du boîtier ciblé, avec état et paramètres concordants | Séparé du lancement |
| Séchage puis impression | Rapport du bon ACE, puis passage à l’impression après la fin observée du séchage | Désactivé en attendant l’essai |
| Impression avec séchage | Rapports concordants du bon ACE pendant l’impression, chauffage puis arrêt constatés | Désactivé en attendant l’essai |
| Timelapse au lancement mémoire | Capacité annoncée, option sérialisée, retour de l’imprimante, puis artefact timelapse observé | Option conditionnée à la capacité déclarée |
| Galerie timelapse | Artefact associé sans ambiguïté à la tâche | Désactivée en attendant l’essai |

Pour chaque essai autorisé, consigner le contrôle caméra du plateau, le modèle et les versions de micrologiciel, la source du fichier, le boîtier visé, l’ordre des observations et la remise en état. La recette courte s’arrête dès l’observation attendue. La preuve d’un artefact final peut provenir d’une impression normale effectuée par son propriétaire. Les essais automatisés utilisent des données fictives.
