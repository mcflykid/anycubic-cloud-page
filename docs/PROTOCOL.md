# Notes de protocole et adaptations

Cette note accompagne le code et la [connexion cloud](CLOUD-CONNECTION.md). Les observations ont été réalisées sur une Kobra S1 Combo et un ACE 2 Pro ; les autres modèles restent à tester.

L’[inventaire des capacités cloud](CLOUD-CAPABILITIES.md) distingue les fonctions utilisées, les possibilités non implémentées et les paramètres encore inconnus, avec leurs sources et leurs risques.

## Architecture

```mermaid
flowchart LR
    Browser[Navigateur web] -->|Mot de passe de la page| Web[Serveur aiohttp]
    Web --> Auth[User Center / PKCE]
    Auth --> Session[Session workbench]
    Web <-->|HTTP signé + MQTT| Cloud[Anycubic Cloud]
    Cloud <--> Printer[Kobra S1 / ACE]
    Browser <-->|Jeton caméra temporaire| Agora[Agora / caméra]
    Private[Fichiers appdata privés] --> Web
```

`app/anycubic_cloud_api/` dérive du client GPL existant ; `server.py`, `cloud_extras.py`, `account_auth.py`, `session_api.py`, les helpers et le frontend forment l’adaptation autonome. Le moteur reste côté serveur. La page web ne possède pas de token de compte et n’accède pas directement aux identifiants de l’imprimante.

## Plusieurs imprimantes

Le [registre de machines](../app/printer_registry.py) conserve un moteur, ses caches et ses verrous par cible. La sélection appartient au navigateur, pas à une variable globale partagée entre utilisateurs. Chaque requête de commande porte l’en-tête `X-Printer-Key`, référence opaque obtenue avec `/imprimante-api/printers`. La cible est contrôlée à nouveau sous verrou avant l’envoi ; une référence périmée ou absente ne déclenche aucun repli vers une autre machine. Les liens de téléchargement utilisent cette même référence dans leur paramètre `printer`.

Le protocole Slicer construit un identifiant MQTT fixe pour un compte. Les moteurs partagent donc une seule connexion et routent les rapports selon leur machine ; ils ne créent pas des clients concurrents de même nom. Le renouvellement de session conserve ce transport commun, les abonnements sont rétablis et les callbacks de fraîcheur restent associés au destinataire du rapport. Les courbes initiales gardent leur emplacement ; les machines supplémentaires utilisent des sous-dossiers privés sous `appdata/state/printers/`.

## Tendances thermiques

Chaque fichier d’imprimante contient jusqu’à 24 heures de points bruts (8 640 relevés à dix secondes) et des moyennes horaires pour 30 jours (720 créneaux). Les requêtes de 1 à 24 heures lisent les points bruts ; celles de 25 à 720 heures lisent les agrégats. Les compteurs propres à chaque mesure permettent d’ignorer les valeurs absentes sans transformer une température nulle en absence. Les boîtiers et emplacements ACE sont agrégés séparément. Les anciennes listes JSON sont migrées à la prochaine sauvegarde ; aucune donnée n’est reconstituée avant l’activation de la collecte. Le stockage par fichier est limité à 16 Mo. Le CSV reprend la même période et résolution que le graphe, avec date UTC, source si elle est connue, et cellules vides pour les mesures manquantes. L’effacement explicite vide les points, agrégats et fichier local de la cible concernée.

## Parcours utiles

| Besoin | Mécanisme |
| --- | --- |
| État | Polling cloud toutes les 60s et messages MQTT ; lecture du cache par le navigateur toutes les 3s. |
| Miniature d’un fichier local/USB | Ordre `1239`, référence au chemin et au plateau ; réponse MQTT corrélée, puis extraction de `file_details.thumbnail` ou `png_image`. |
| Historique natif | `GET /v2/project/printHistory`, distinct des messages de notification. |
| Détail d’une tâche | `/v5/project/printHistory/detail`, avec repli sur le détail projet lorsque disponible. |
| Aperçus d’historique | Référence de tâche/projet et image native ; aucun rapprochement approximatif par nom de fichier. |
| Notifications | `/v2/message/getMessages`, compteurs, lecture et suppression dédiés ; aperçu propre à la notification ou référence explicite de projet. |
| Téléchargement cloud | `/work/index/getDownloadUrls`, appelé par identifiant pour éviter une association incorrecte lorsque la réponse est réordonnée. |
| Détection IA | Ordre de lecture `1242`, écriture `1243` ; voir la différence de `msgid` dans le guide de connexion. |
| Firmware | Indicateur `update_available` du constructeur ; une simple version cible ne signifie pas qu’une mise à jour est disponible. |

Ces chemins désignent l’API du fournisseur, pas l’API locale du projet. L’API locale est sous `/imprimante-api/`.

## Fiabilité des actions

Le serveur valide les valeurs, la disponibilité de l’imprimante et les références connues avant les opérations. Les demandes portent un identifiant pour limiter les doubles soumissions. Les actions dangereuses de l’interface demandent une confirmation ; la réinitialisation, lorsqu’elle est annoncée par un modèle, possède une étape supplémentaire à code temporaire.

Les réponses « commande acceptée » signifient que le transport a accepté la demande. Elles ne prouvent ni le déplacement d’un axe, ni une température atteinte, ni une impression ou une mise à jour terminée. Aucun timeout ambigu ne déclenche une seconde commande automatique.

## Images et téléchargements

Les miniatures distantes sont récupérées côté serveur. Schéma HTTPS, domaines autorisés, type MIME, taille maximale et absence de redirection sont contrôlés. Les URLs signées d’images ne sont pas renvoyées au navigateur ; l’interface reçoit une image encodée. Les liens de téléchargement cloud sont temporaires et limités aux domaines fournisseur autorisés.

Le cache des aperçus est borné. Un aperçu indisponible est signalé ; une image d’un autre projet ne lui est pas substituée. Un code de diagnostic zéro ne devient pas un texte d’erreur ; les messages non vides et codes non nuls sont conservés.

## TLS MQTT

Le client d’origine utilise des certificats historiques signés en SHA-1. Le contexte fourni réduit localement le niveau de sécurité OpenSSL pour accepter ces certificats tout en conservant TLS1.2 minimum, la CA constructeur, la vérification de validité et la vérification du nom d’hôte. Cette compatibilité est limitée au client MQTT ; elle ne désactive pas les vérifications HTTPS globales.

## Ce qui reste inconnu

Les services étant privés et évolutifs, les noms de champs, capacités de firmware, conditions de connexion, disponibilité des vidéos et politiques de session peuvent changer. Les réglages avancés non confirmés sont masqués. Le timelapse annoncé par la machine n’a pas fourni de liste de vidéos exploitable via le cloud au contrôle. Les notifications réelles étaient absentes lors du test d’aperçu.

## Diagnostics MQTT sans contenu privé

Le statut expose `mqtt_diagnostics`, compteurs de la connexion commune au compte : rapports inconnus, types distincts, champs supplémentaires, décodages impossibles et erreurs de traitement. Aucun nom de type, topic, identifiant, payload ni texte brut d’exception n’est renvoyé ou journalisé par ce diagnostic. Les empreintes internes de types sont limitées à 256 ; `unknown_types_capped` indique que le nombre distinct affiché est alors une borne inférieure. Les compteurs repartent de zéro si le client cloud est recréé.

Un type inconnu ne rafraîchit pas artificiellement l’état de l’imprimante. Les champs connus d’un rapport reconnu restent exploitables même si des champs supplémentaires sont ignorés. Les fixtures couvrent notamment un rapport ACE arrivé avant la liste initiale et l’indépendance des boîtiers. Aucun ordre chronologique universel n’est déduit d’un identifiant de message ou d’un horodatage dont le contrat n’est pas établi.


## Rapports récents et client amont 0.4.5 (#63)
Les rapports synthétiques couvrent les champs ACE omis (`temp`, `feed_status`), les phases de préparation et de changement de filament, `fan/query`, `extrudeControl/getInfo`, `properties/report`, `extfilbox/auto|getInfo` et `video/startCapture/pushFailed`. Les préparations marquent la machine occupée sans réactiver un projet terminé après un rapport tardif. Les réglages globaux de trajet du filament ne créent aucune bobine.

La Kobra X est reconnue par le type constructeur 20030 ou son nom exact. Ses phases 19/26/27/29/30 et son décompte de séchage restent spécifiques à ce modèle ; la conversion secondes/minutes suit les conditions du client amont 0.4.5, pas une hypothèse appliquée aux S1. Cette couverture est simulée : aucun matériel supplémentaire ni commande physique n’a été validé.


## Fraîcheur avant pause, reprise ou arrêt (#19)
L’interface transmet la référence opaque du projet affiché au moment de demander confirmation. Sous les verrous d’opération et de lecture, le serveur exige la même référence, relit le modèle par HTTP avec une limite de dix secondes et contrôle de nouveau identité, état actif et pause avant l’envoi. La méthode constructeur reçoit explicitement le projet vérifié. Une lecture échouée, une tâche remplacée ou une transition de pause annule l’envoi ; une activité MQTT sans rapport ne constitue pas une preuve de fraîcheur. Aucun ordre n’est répété automatiquement après un résultat incertain.

## Ouverture et fermeture Agora (#20, #64)

L’ouverture conserve l’ordre numérique 1001 et `shengwang_rtc_support` au premier niveau. Les fixtures vérifient une session Agora, un refus et un format mal formé. Le [client Bob-41](https://github.com/Bob-41/anycubic-plugin/blob/e3c5370efad625658e40d6fe5beb19a2597936f6/plugin/plugin.py#L3408-L3414) sérialise `1001` comme une chaîne. Faute de comparaison sur la même machine, l’atelier conserve la forme numérique déjà utilisée sur la Kobra S1. Un refus ou une réponse incertaine ne déclenche aucun nouvel ordre sous une autre forme.

La fermeture 1002 reprend la forme du client communautaire RespawnDespair (commit 53c406b). Elle est programmée après le départ du dernier onglet suivi par l’atelier et annulée de fait si un spectateur revient pendant le délai. Un départ reçu avant une ouverture encore en transit empêche cette ouverture tardive. Les clients externes et les onglets qui disparaissent sans notifier le serveur ne peuvent pas être recensés de façon fiable. Ce comportement a été testé sans ordre physique.

## Investigations du 10 novembre 2026

La lecture statique du SDK empaqueté de Slicer Next **2.0.0.3** complète les sources déjà identifiées. Les noms de champs compilés indiquent des possibilités ; ils n’établissent ni les unités, ni le schéma complet d’un ordre. Aucun essai Cloud ou ordre physique n’a été envoyé pour cette investigation.

| Issue | Éléments établis | Preuve encore nécessaire |
|---|---|---|
| #30 | Liste MQTT `file/listVideo` paginée sur fixtures ; SDK `POST /v3/printer/getVideoThumbnailList`, champs `device_id`, `video_file_keys` ; résultat `filename`, `file_key`, `thumbnail_url`. | Relation vérifiée liste → clé → vidéo et droit de téléchargement. Une miniature n’est pas un fichier vidéo. La galerie reste désactivée. |
| #93 | Les rapports 0/1/2, quantités positives et inconnues restent séparés. L’identification RFID ne renseigne aucune marque. Le propriétaire a confirmé la concordance de ses bobines RFID testées. | Signification d’un zéro selon modèle et comportement avec puce réécrite ou sans puce. Le zéro non qualifié reste inconnu. Pour un ACE 2 Pro identifié, le champ est qualifié seulement avec `status=5` et `edit_status=0`, et accepte alors 0..100 comme valeurs déclarées, sans preuve de masse physique. |
| #95 | Parcours manuel S1 implémenté : `1216`/`1221`, limites de préchauffage strictes, confirmation et relecture avant envoi. Voir [garanties et limites](IDLE-AXES.md). | Validation matérielle après installation séparée; unité du ventilateur d’enceinte encore à qualifier. Aucun profil de matériau automatique. |
| #96 | Consultation manuelle S1 implémentée à partir du contrat capturé : `1214`, réponse `axis/query`, corrélation de cible/msgid et date de réception. | Les autres modèles restent désactivés; la capacité de mouvement seule ne prouve pas la lecture. Aucun mouvement ou référencement n’est déclenché. |
| #103 | Stockage STL/3MF confirmé par le propriétaire. Validation locale ZIP classique et Zip64 bornée, sans extraction. | Parcours d’un `.gcode.3mf` tranché et de ses métadonnées multicolores, stockage et lancement vérifiés séparément. L’impression reste réservée au `.gcode`. |
| #105 | Compteur de la route `GET /v5/printer/home`, repli de base de la même cible, zéro distinct d’une valeur absente ; aucun recalcul depuis l’historique. | Comparaison simultanée, même compte/région/machine/source/fraîcheur, des deux clients. Le code seul ne détermine pas l’origine de l’écart observé. |
| #137 | SDK : chaînes `dry_mode`, `drying_settings`, `duration`, `target_temp`, `use_ams`, `ams_box_mapping`, `ams_index`, `ams_color`. Le séchage séparé a un parcours existant. | Enveloppe, unité, séquence d’états, capacités par modèle, délai et annulation du séchage associé au lancement. Aucune option combinée n’est activée. |

Les contrôles de lancement (#136) séparent une mise à jour proposée de l’état confirmé `is_updating`, qui empêche l’envoi ou la réimpression. Un état « mise à jour requise » reste inconnu tant qu’aucun champ ou refus constructeur fiable n’est identifié. La consultation locale `/imprimante-api/preflight` compare les métadonnées disponibles aux emplacements ACE, sans lancer d’ordre ; les différences de matière, de couleur et de groupe thermique sont des avertissements. L’en-tête G-code lu pour cette aide est limité à 64 Kio et les métadonnées absentes sont signalées. Les métadonnées n’accordent aucune autorisation supplémentaire au serveur.

L’historique multi-imprimantes (#132) réutilise les pages lues pendant quinze secondes, avec un plafond de 400 pages par moteur. Le cache est séparé par cible et session API et invalidé lors d’une actualisation explicite, d’une suppression ou d’un envoi accepté. Les nouveaux objets API ne réutilisent jamais les pages d’une session précédente.

Les relevés sont pris en instantané dans la boucle puis écrits hors de celle-ci, avec sérialisation des sauvegardes et remplacement atomique (#133). Un HTTP 401 sur un appel authentifié ne déclenche la reprise que si aucune donnée utile ne contredit le refus ; le corps n’est pas conservé. Les réponses ambiguës ne sont pas rejouées (#135).

## Recherches complémentaires du 11 novembre 2026

Le contrôle en lecture seule d’une même S1 dans une même fenêtre confirme que `base.print_count` du détail et `printer.statistics.print_count` de la synthèse Cloud peuvent différer. Le compteur affiché privilégie la synthèse dont l’identité correspond, garde zéro et affiche maintenant sa provenance; aucun total n’est calculé depuis l’historique. La comparaison avec l’affichage simultané de Slicer Next reste un contrôle distinct suivi dans l’issue des états S1/ACE.

Le support `gcode_3mf_support` est annoncé par la S1 examinée. Cette annonce ne documente pas le choix de plateau ni l’enveloppe de lancement d’un paquet. Le lancement direct mémoire/USB applique donc la même restriction au `.gcode` qualifié que le téléversement; les autres fichiers restent listables sans envoi d’un ordre d’impression non établi.

Les éléments nouveaux et limites sont détaillés dans [l’étude des lancements et du séchage](PRINT-PROTOCOL-RESEARCH.md), [celle des timelapses](TIMELAPSE-RESEARCH.md) et [celle des exports Mesh](MESH.md). Les fonctions non établies restent suivies dans les issues, sans les présenter comme corrigées.
