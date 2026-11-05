# Compatibilité et preuves

Référence initiale : observations du 2–3 novembre 2026 sur **Kobra S1 Combo + ACE 2 Pro**. Versions rapportées : imprimante 2.7.2.7, ACE 1.1.36. Ces valeurs décrivent le matériel d’essai, pas les dernières versions disponibles pour tout le monde.

| Fonction | Vérification |
| --- | --- |
| Connexion directe au compte sans slicer | Connexion User Center puis session workbench réussies dans le déploiement d’origine ; code exporté avec fichiers privés externalisés. |
| Token depuis les journaux du slicer | Extraction locale macOS vérifiée ; parsing couvert par tests synthétiques. Les chemins Windows/Linux sont à adapter. |
| Refresh OAuth | Tests simulés de refresh, rejet, repli et temporisation ; succès réel sur plusieurs semaines non établi. |
| Reprise de session interne cloud | Rejet de session provoqué par une connexion indépendante, reprise et MQTT reconnecté observés dans le déploiement d’origine. |
| Plusieurs imprimantes | Isolation des cibles, transport partagé, défaut retiré du compte et mémoire du navigateur testés sur machines fictives ; aucun essai de commande physique multi-machines. |
| État, ACE, RFID et températures | Données cloud/MQTT consultées ; les quantités restent celles rapportées par la machine. |
| Caméra | Flux Kobra S1 1280×720 observé dans le déploiement d’origine. Nouveaux diagnostics de session et étapes MQTT testés sur fixtures, sans nouvel essai de caméra réel. La capture publique reste une illustration. |
| Éclairage | Extinction de la lumière de l’enceinte confirmée ; autres canaux non certifiés physiquement. |
| Fichiers locaux | Navigation du dossier constructeur `test_model`, 14 fichiers observés ; miniatures Benchy/Dinosaur affichées. |
| Fichiers cloud | Téléchargement comparé octet par octet, renommage avec extensions et suppression vérifiés sur fichiers d’essai sans ordre d’impression. |
| Historique et détails | Lectures réelles et aperçus obtenus. Retrait d’une seule fiche explicitement désignée confirmé par relecture cloud, sans changement des autres références ; vérification dans les interfaces du fournisseur à la charge du propriétaire. Les sélections, lots et erreurs partielles sont testés sur fixtures. |
| Aperçus de notifications | Tests de résolution et interface avec données fictives ; journal réel vide au contrôle. |
| Lecture IA | Réponse réelle reçue après correction de corrélation MQTT ; formulaire modifiable vu dans Safari. |
| Écriture IA | Charges utiles testées par simulation ; aucune modification réelle appliquée pour cette publication. |
| Lancement/réimpression et mapping ACE | Parcours et garde-fous présents ; pas de validation physique complète par cette publication. |
| Axes, chauffe, chargement, séchage | Paramètres validés et commandes intégrées ; validation physique encore nécessaire. |
| Firmware | Versions et éligibilité lues ; aucune installation de firmware exécutée. |
| Calibration / options avancées | Ne sont proposées que si les capacités et propriétés nécessaires sont confirmées. Non confirmées sur cette S1. |
| Timelapse | Liste distante non obtenue ; panneau masqué lorsque l’information est indisponible. |
| Interface autonome exportée | Tests Python, contrôle JS, démonstration locale et captures des sept onglets. La CI vérifie les installations vides en mode hôte et réseau externe partagé, l’identité non root, les droits appdata et l’interface de démonstration. Aucun proxy intégré. Le cloud réel n’est pas contacté dans cette fixture. |

Une nouvelle contribution doit préciser le modèle, le firmware, la fonction testée, le type de preuve et les limites. Aucun numéro de série, token, identifiant de compte ou journal brut dans les issues.
