# Capacités du cloud Anycubic

Première version de l’inventaire, fondée sur une lecture statique des sources disponibles le 5 novembre 2026. Elle sert à choisir des travaux ultérieurs ; elle ne promet ni une disponibilité sur tous les comptes, ni une compatibilité avec toutes les imprimantes. **Aucune requête d’essai vers le cloud, aucune commande à une imprimante et aucune suppression n’ont été exécutées pour cet inventaire.** Les téléchargements de sources publiques ne nécessitaient aucune connexion de compte. Une validation distincte, explicitement autorisée ensuite, du retrait d’une unique fiche d’historique est consignée plus bas ; elle ne transforme pas les autres lignes en fonctions testées.

La colonne **implémenté dans le projet : oui/non** désigne une fonction raccordée au serveur ou à l’interface de l’atelier dans la branche de développement. La présence d’une constante ou d’une méthode dans la bibliothèque embarquée ne suffit pas. Les limites des fonctions partiellement couvertes sont précisées dans la même cellule. Cet inventaire n’est pas une annonce de livraison.

## Lecture des preuves et des risques

- **Code — appel** : chemin, méthode ou message effectivement construit par une fonction examinée. Cela ne prouve pas que le fournisseur l’accepte aujourd’hui.
- **Code — route** : chaîne présente dans le SDK installé ; méthode HTTP, paramètres et portée restent **inconnus** sans autre preuve.
- **Code — réception** : branche du routeur MQTT ; aucun rapport réel n’a été collecté pendant l’inventaire.
- **Supposé** : interprétation d’un nom, signalée comme telle. Ne pas transformer cette interprétation en commande.
- **Journaux** : aucune trace exploitable de requête cloud dans les journaux locaux examinés. Aucune ligne ci-dessous n’est présentée comme une observation réseau ou une validation en conditions réelles.

Risques : **lecture seule**, **modifie des données du cloud**, **ordre physique à l’imprimante**. La dernière catégorie inclut aussi une commande adressée à la machine pour ses fichiers, sa caméra ou sa configuration, même sans mouvement mécanique. Une lecture envoyée sous forme d’ordre de consultation reste indiquée « lecture seule ». Acquittement du cloud et réalisation par la machine sont distincts.

Les chemins HTTP ci-dessous sont ceux du fournisseur, pas ceux de `/imprimante-api/`. La base internationale observée dans le JavaScript officiel est `https://cloud-universe.anycubic.com/p/p/workbench/api`. Les chemins des autres services et régions ne doivent pas être déduits de cette base. **« inconnu » interdit de fabriquer un corps ou de lancer une sonde pour compléter le tableau.**

## Sources et repères

| Référence | Source examinée | Portée de la preuve |
| --- | --- | --- |
| S1 | [Atelier officiel du slicer](https://cloud-universe.anycubic.com/w/p/AcOrcaWeb/workbench/), [bundle app.ab009854.js](https://cloud-universe.anycubic.com/w/p/AcOrcaWeb/js/app.ab009854.js) et ses modules différés | Adaptateurs HTTP et interface publique, téléchargés sans session ; les fonctions exportées ne sont pas forcément accessibles dans chaque vue. |
| S2 | AnycubicSlicerNext 2.0.0.3 installé : `Resources/web/anycubic/anycubic_workbench.html` et `Frameworks/libcloud_sdk_cpp.dylib` | Lecture des chaînes, symboles et du désassemblage arm64 ; aucune exécution du SDK. SHA256 de la bibliothèque : `87c26042a6f3d775d219c6147a842fe3c1184ad7e264ed1dfa88c8ee275a3954`. |
| S3 | [ljschmitt/hass-anycubic_cloud_v3, version examinée](https://github.com/ljschmitt/hass-anycubic_cloud_v3/tree/2051298aebb73bdc059e96dac638dc9424cfc8b1), notamment `anycubic_cloud_api/const/api_endpoints.py` | Méthodes HTTP, modèles et routeur MQTT ; projet GPL-3.0. |
| S4 | [Bob-41/anycubic-plugin, version examinée](https://github.com/Bob-41/anycubic-plugin/tree/e3c5370efad625658e40d6fe5beb19a2597936f6), `mqtt_auth_protocol.md` et `plugin_design.md` | Autre client, notamment protocole caméra ; ses validations rapportées ne sont pas des validations de cet atelier. Projet MIT. |
| S5 | [Nino6689/anycubic-cloud-api, version examinée](https://github.com/Nino6689/anycubic-cloud-api/tree/5663f5bf33584a5cf9abcdf6ff53acca924934bd), `const/api_endpoints.py` | Confirmation de routes de consultation et de mutations connues. |
| S6 | [Nino6689/anycubic-cloud-client, version examinée](https://github.com/Nino6689/anycubic-cloud-client/tree/6ea79c733ac3909f7bc1ca4970f2f75fe8d302b7), `client.py`, `orders.py` et `docs/PROTOCOL.md` | Autre modélisation des ordres ; ne pas transposer automatiquement les enveloppes d’envoi. |
| S7 | Anycubic Slicer Next 2.0.0.3, interface embarquée dans `libWorkbench.dylib` | Lecture du module de l’atelier et de son adaptateur pour la vue Cloud. |
| P1 | [Serveur de l’atelier](../app/server.py), [fonctions complémentaires](../app/cloud_extras.py), [connexion de compte](../app/account_auth.py) | Appels raccordés, filtrage et protections propres au projet. |
| P2 | [Routeur MQTT](../app/anycubic_cloud_api/api/mqtt.py), [modèle imprimante](../app/anycubic_cloud_api/data_models/printer.py) et [interface](../web/js/imprimante.js) | État consommé, messages ignorés et fonctions réellement présentées. |

Aucun code des projets examinés, du JavaScript officiel ou du SDK n’est repris dans ce document ou ajouté à l’application. Les noms de protocole constituent des repères factuels, pas une autorisation d’utiliser un service privé ni une garantie de stabilité.

## Impression et parc de machines

| Fonction | Adresse / message et paramètres établis | Source | Confiance | Risque | Implémenté dans le projet : oui/non |
| --- | --- | --- | --- | --- | --- |
| État d’une imprimante et capacités | `GET /v2/printer/info` ; référence d’imprimante fournie côté serveur | S3, S5, P1 | Code — appel | Lecture seule | Oui : état filtré, disponibilité, options annoncées. |
| Nombre cumulé d’impressions | `GET /v5/printer/home?printer_id=…`, champ `data.printer.statistics.print_count` | S7, P1 | Code — appel et affichage | Lecture seule | Oui : compteur cumulé de la machine sélectionnée, repli sur `base.print_count` si la mesure est absente. Aucun total reconstruit depuis l’historique. |
| Liste des imprimantes du compte | `GET /work/printer/getPrinters` | S1, S3, P1 | Code — appel | Lecture seule | Oui : sélecteur masqué avec une seule machine, choix mémorisé dans le navigateur, repli sur le défaut puis la première machine ; moteurs indépendants et transport partagé (#32). |
| Vue de parc plus récente | `GET /v3/printer/getList` ; paramètres inconnus | S1 | Code — appel | Lecture seule | Non. |
| Démarrer, suspendre, reprendre, arrêter | `POST /work/operation/sendOrder`, ordres `1`, `2`, `3`, `4` | S6, P1 | Code — appel | Ordre physique à l’imprimante | Oui ; références, disponibilité et confirmation contrôlées. |
| Réimprimer un G-code conservé | Même route, ordre `1`, référence de G-code connue | P1 | Code — appel | Ordre physique à l’imprimante | Oui ; ce n’est pas une suppression d’historique. |
| Températures, ventilateurs et vitesse | Même route, ordres `1216`, `1221`, `6` ; MQTT `tempature`, `fan`, `print` | S6, P1, P2 | Code — appel / réception | Ordre physique à l’imprimante pour les réglages ; lecture seule pour les rapports | Oui pour les fonctions exposées en cours d’impression. Le client amont 0.4.36 documente les réglages au repos par `1216` (type 0 buse, 1 plateau, 2 les deux) et `1221` (une clé de ventilation par ordre). Le marqueur de compatibilité au repos reste à établir (#95). L’orthographe MQTT `tempature` vient du fournisseur. |
| Position des axes | Même route, ordre `1214` avec `project_id: 0` ; retour MQTT `axis/query`, état `done` et `data.coordinates` | S6 et client amont 0.4.36 | Code — appel et réception | Lecture seule | Non : le marqueur annonçant cette consultation reste à établir (#96). |
| Déplacer les axes / libérer les moteurs | Même route, ordres `201` / `1213` | S6, P1 | Code — appel | Ordre physique à l’imprimante | Oui, sous conditions de disponibilité. |
| Calibrations et assistance | Même route, ordres `1259` / `1253` ; options autorisées par les capacités reçues | P1 | Code — appel | Ordre physique à l’imprimante | Oui, seulement lorsque le modèle les annonce. |
| Tâches groupées et groupes de machines | `/farm/group/list`, `/farm/printer/createBulkTask`, `/farm/device/createBulkTask` ; méthodes et paramètres inconnus | S2 | Code — route ; rôle groupé supposé d’après les noms | Lecture seule pour la liste ; ordre physique à l’imprimante pour les créations de tâches | Non. |
| Plateau déclaré nettoyé | `/farm/printer/setCleanPlate` ; méthode et paramètres inconnus | S2 | Code — route ; effet exact inconnu | Ordre physique à l’imprimante, par prudence : peut libérer un enchaînement de tâches | Non. |

## Fichiers et stockage

| Fonction | Adresse / message et paramètres établis | Source | Confiance | Risque | Implémenté dans le projet : oui/non |
| --- | --- | --- | --- | --- | --- |
| Espace utilisé / disponible | `POST /work/index/getUserStore` | S1, S3, P1 | Code — appel | Lecture seule | Oui. |
| Fichiers du compte | `POST /work/index/files` dans le client embarqué ; S1 déclare aussi `/v3/index/userFiles`, S2 `/work/index/userFiles` | S1, S2, S3, P1 | Code — appel ; variantes non validées | Lecture seule | Oui via le client existant ; non pour une migration générale aux variantes récentes. |
| Envoi d’un fichier et réservation d’espace | `/v2/cloud_storage/lockStorageSpace`, `/v2/profile/newUploadFile`, `/v2/cloud_storage/unlockStorageSpace` | S1, S3, P1 | Code — appel | Modifie des données du cloud | Oui ; envoi simple, avec ou sans lancement explicitement demandé. |
| Formats de stockage du slicer | Le sélecteur natif accepte `.3mf`, `.gcode`, `.stl`, `.obj` et `.off`. Un essai utilisateur a confirmé le stockage de STL et 3MF dans l’Espace Cloud. | S2 et essai utilisateur | Filtre du sélecteur confirmé par lecture statique ; seuls STL et 3MF ont été observés dans la liste du slicer | Modifie des données du cloud | L’atelier stocke les STL et 3MF validés et envoie les `.gcode` à l’impression. La qualification des archives tranchées pour l’impression reste suivie dans #103. |
| Renommer / supprimer des fichiers cloud | `POST /work/index/renameFile` : `id`, `name` ; `POST /work/index/delFiles` : `idArr` | S1, P1 | Code — appel | Modifie des données du cloud | Oui ; distinct des fiches d’impression. |
| Télécharger des fichiers cloud | `POST /work/index/getDownloadUrls` ; identifiant de fichier | S1, P1 | Code — appel | Lecture seule | Oui, via tickets locaux temporaires. |
| Dossiers cloud, déplacement et arborescence | `GET /v5/cloud-file/folder/list` (`parent_folder_id`, `all`) ; POST formulaire `folder/create` (`parent_folder_id`, `name`) / `folder/rename` (`folder_id`, `name`) ; POST JSON `folder/delete` (`folder_ids`) / `item/move` (`target_folder_id`, `file_ids`, `folder_ids`), sous le même préfixe `/v5/cloud-file/` ; le slicer utilise le parent `0` et la liste `POST /work/index/userFiles` avec `folder_id` | S2 | Code — appel ; racine établie dans les vues natives | Lecture seule pour la liste ; modifie des données du cloud pour les mutations | Navigation dans les dossiers existants et déplacement de fichiers validés sur réponses fictives (#31). Création, suppression et déplacement de dossiers exclus de ce parcours. |
| Détails récents d’un fichier machine | `POST /v3/printer/getPrinterFileDetails` ; paramètres inconnus | S1 | Code — appel | Lecture seule | Non via cette route ; aperçus couverts autrement. |
| Fichiers locaux / USB et suppression | `sendOrder` : `103` / `101` pour lister, `104` / `102` pour supprimer ; réponses MQTT `file/listLocal`, `file/listUdisk`, `file/deleteLocal`, `file/deleteUdisk` | S6, P1, P2 | Code — appel / réception | Lecture seule pour les listes ; ordre physique à l’imprimante pour effacer son stockage | Oui. |
| Aperçu d’un fichier machine | Ordre `1239`, réponse `file/fileDetails` ; paramètres de chemin et plateau dans P1 | P1, P2 | Code — appel | Lecture seule | Oui, aperçu différé et corrélé à sa demande. |
| Progression d’un envoi / analyse du modèle | `/work/index/getUploadStatus`, `/work/index/getModelFileInfo` ; méthodes et paramètres inconnus | S2 | Code — route | Lecture seule | Non comme suivi détaillé autonome. |
| Émission d’un fichier vers une machine, variante récente | `/v3/printer/sendFile` ; méthode, paramètres et garanties inconnus | S2 | Code — route | Ordre physique à l’imprimante, conservativement : un lancement associé n’est pas exclu | Non via cette variante. |

## ACE, matières et matériel

| Fonction | Adresse / message et paramètres établis | Source | Confiance | Risque | Implémenté dans le projet : oui/non |
| --- | --- | --- | --- | --- | --- |
| État ACE, bobines et séchage | `sendOrder` : `1206` consultation, `1207` séchage ; MQTT `multiColorBox/getInfo`, `multiColorBox/autoUpdateInfo` | S6, P1, P2 | Code — appel / réception | Lecture seule pour l’état ; ordre physique à l’imprimante pour le séchage | Oui. |
| Charger / retirer et configurer une bobine | `sendOrder` : `1208`, `1211` ; paramètres selon le client embarqué | S6, P1 | Code — appel | Ordre physique à l’imprimante | Oui. |
| Remplacement automatique de bobine | `sendOrder` : `1212` ; MQTT `multiColorBox/setAutoFeed` | S6, P1, P2 | Code — appel / réception | Ordre physique à l’imprimante | Oui. |
| Support externe de filament | `/v2/printer/getExternalShelves` ; MQTT `extfilbox/reportInfo` ; corps HTTP inconnu | S2, P2 | Code — route / réception | Lecture seule | Oui pour une partie de l’état fourni par la bibliothèque ; non pour une vue complète dédiée. |
| Catalogue officiel de matières / références | `/v3/material/getTypeNameAndSkuListByVerNum` ; méthode et paramètres inconnus | S2 | Code — route | Lecture seule | Non comme catalogue complet synchronisé. |
| Groupes personnels de couleurs | `/v5/machine_material/getColorGroupListByUser`, `addUserColorGroup`, `editUserColorGroup`, `deleteUserColorGroup` ; méthodes et paramètres inconnus | S2 | Code — route ; rôle supposé d’après les noms | Lecture seule pour la liste ; modifie des données du cloud pour les mutations | Non. |
| Profil matériel / buse / plateau | `POST /v5/printer/properties/query`, ordre `1253` ; MQTT `hardwareProfile` | P1, P2 | Code — appel / réception | Lecture seule pour les propriétés ; ordre physique à l’imprimante pour la configuration | Oui pour les champs explicitement autorisés ; non pour tous les rapports spontanés. |
| Firmware imprimante / ACE | `/work/printer/update_version`, `/v2/printer/update_multi_color_box_version` ; MQTT `ota` | S1, S3, P1, P2 | Code — appel / réception | Ordre physique à l’imprimante pour une mise à jour | Oui ; disponibilité annoncée et progression, sans supposer une fin physique à l’acquittement. |

## Caméra et vidéos

| Fonction | Adresse / message et paramètres établis | Source | Confiance | Risque | Implémenté dans le projet : oui/non |
| --- | --- | --- | --- | --- | --- |
| Vidéo directe Agora | `sendOrder` : `1001` ouverture / `1002` fermeture ; réponse avec session caméra temporaire | S4, P1 | Code — appel | Ordre physique à l’imprimante, limité à la caméra | Oui pour Agora ; les identifiants absents, formats invalides et transport KVS sont distingués sans exposer leurs données (#21). |
| Vidéo directe KVS sur d’autres modèles | Ordre `1001`, AWS Kinesis Video Signaling ; MQTT `video/startCapture`, `video/stopCapture` | S4 | Code du client communautaire ; fonctionnement rapporté par ce projet, non vérifié ici | Ordre physique à l’imprimante, limité à la caméra | Non : transport distinct, pas une simple URL vidéo à réutiliser. |
| Liste des timelapses présents | MQTT `file/listVideo`, demande `{page_num, page_size, path, keyword}` dans P1 | P1 | Code — appel ; disponibilité dépendante du firmware | Lecture seule | La liste paginée et la recherche sont testées sur des réponses fictives. La galerie reste désactivée en attendant une vidéo de validation. |
| Miniatures / téléchargement des vidéos, variante cloud | `POST /v3/printer/getVideoThumbnailList` ; SDK `getTimelapseDownloadUrls` construit `device_id` et `video_file_keys` ; réponse `filename`, `file_key`, `thumbnail_url` ; le modèle MQTT de liste contient `fileKey` et `file_image` ; sens exact de `device_id` et lien vidéo inconnus | S2 | Code — construction native et champs du modèle ; ce nom de méthode ne prouve pas un téléchargement vidéo | Lecture seule | Non pour un téléchargement vidéo fiable ; recherche suivie dans #30. |
| Miniatures de fichiers, variante récente | `/v5/printer/file/thumbnail/list` ; méthode et paramètres inconnus | S2 | Code — route | Lecture seule | Non via cette variante. |
| Éclairage | Ordres `1232` lecture / `1233` réglage ; MQTT `light/control` | S6, P1, P2 | Code — appel / réception | Lecture seule pour l’état ; ordre physique à l’imprimante pour le réglage | Oui. |

Pour l’ouverture caméra (#20), le [module officiel](https://cloud-universe.anycubic.com/w/p/AcOrcaWeb/js/790.c5d070ef.js) envoie l’entier `1001` à `/work/operation/sendOrder` dans son parcours principal. Sa fonction de jeton KVS utilise la chaîne `"1001"` sur une autre route, `/api/work/operation/sendOrder?checkSign=false`. Les deux formes appartiennent à des parcours distincts. L’atelier conserve l’entier et le drapeau Agora au niveau supérieur. Les réponses acceptées, refusées et mal formées sont couvertes par des fixtures.

## Historique et notifications

| Fonction | Adresse / message et paramètres établis | Source | Confiance | Risque | Implémenté dans le projet : oui/non |
| --- | --- | --- | --- | --- | --- |
| Fiches d’impression natives | `GET /v2/project/printHistory` ; `printer_id`, `page`, `limit` dans P1 | S3, S5, S6, P1 | Code — appel | Lecture seule | Oui : cartes, sous-onglets, filtres, recherche et chargement progressif dans la branche de développement ; le filtre Appareil peut agréger les machines du compte sans modifier la cible des commandes. |
| Détail et diagnostic d’une fiche | `GET /v5/project/printHistory/detail` ; `task_id`, puis repli projet si disponible | S2, P1 | Code — appel | Lecture seule | Oui, champs filtrés et aperçus corrélés. |
| Suppression d’une fiche native | `POST /work/project/unsetprojects` ; SDK `historyDelete(id)` sérialise `{"id": <entier>, "checkSign": false}` | S1, S2 | Élevée : code et retrait d’une fiche observé lors d’un unique essai autorisé | Modifie des données du cloud | Oui dans la branche de développement : sélection, confirmation et une requête par fiche ; limites et succès partiels testés sur données fictives. L’effet sur les données associées reste inconnu. Ne pas confondre `id` avec celui d’une notification. |
| Liste / source de projets, variantes récentes | `/v5/project/list`, `/v5/project/source`, `/v5/project/info` ; méthodes et paramètres inconnus | S2 | Code — route | Lecture seule, sous réserve de la sémantique de `source` | Non via ces variantes. Le projet possède déjà des consultations plus anciennes. |
| Évaluer une impression | `/v3/work/getProjectCommentInfo` et `/v3/work/sumbitComment` dans P1 ; la graphie vient du fournisseur | S1, P1 | Code — appel | Lecture seule pour la disponibilité ; modifie des données du cloud pour la note | Oui. |
| Signaler un problème d’impression et motifs structurés | `/v3/work_project/feedback`, `/v3/work_project/getErrorList` ; méthodes et paramètres inconnus | S2 | Code — route ; détails du retour utilisateur inconnus | Lecture seule pour la liste ; modifie des données du cloud pour le signalement | Non comme formulaire de diagnostic structuré. |
| Messages, compteurs et non-lus | `POST /v2/message/getMessages`, `/v2/message/getMessageCount` ; type `1`, pagination dans P1 | S2, P1 | Code — appel | Lecture seule | Oui ; la cloche de la branche de développement réutilise le rafraîchissement habituel. |
| Marquer les messages comme lus | `POST /v2/message/setRead`, `/v2/message/setReadById` | S2, P1 | Code — appel | Modifie des données du cloud | Oui. |
| Supprimer des messages | `POST /v2/message/delete` ; `ids` est une liste d’identifiants de notifications | S2, P1 | Code — appel | Modifie des données du cloud | Oui, avec confirmation ; ne supprime pas les fiches natives par cette route. |
| Messagerie de ferme / alertes groupées | `POST /farm/message/list` dans la cloche du slicer, avec `page`, `limit`, `status`, `aggregate_mode`, `update_status`, `keyword` ; réponse `pageData` et `data` | S2 | Code — appel de la cloche native, distinct du journal simple | Lecture seule pour les consultations ; modifie des données du cloud pour lire/effacer | Oui en consultation, avec `POST /farm/message/statistics` pour le nombre de non-lus et repli sur le journal historique. Les actions de lecture et de suppression du journal historique restent séparées. Contrats vérifiés sur des réponses fictives (#104). |

## Compte, préférences et gestion des appareils

| Fonction | Adresse / message et paramètres établis | Source | Confiance | Risque | Implémenté dans le projet : oui/non |
| --- | --- | --- | --- | --- | --- |
| Connexion de compte et session workbench | User Center / PKCE puis `/v3/public/getoauthToken`, `/v3/public/loginWithAccessToken` | S1, S3, P1 | Code — appel | Modifie des données du cloud : création / renouvellement de session | Oui ; secrets conservés côté serveur. |
| Informations du compte | `GET /user/profile/userInfo` | S3, S5 | Code — appel | Lecture seule | Oui pour les besoins internes de la connexion ; non comme page publique de profil. |
| Enregistrer / retirer une imprimante du compte | `POST /work/work/addprinter`, `GET /work/printer/unsetprinters` ; paramètres inconnus | S1 | Code — appel ; l’effet est une mutation malgré GET | Modifie des données du cloud | Non. Aucun appel exploratoire ne doit employer le GET de retrait. |
| Renommer une imprimante | `POST /work/printer/Info` ; paramètres selon le client embarqué | S1, P1 | Code — appel | Modifie des données du cloud | Oui. |
| Préférences du slicer synchronisées | `/v3/user/getSlicerConfig`, `/v3/user/setSlicerConfig` ; méthodes et paramètres inconnus | S2 | Code — route | Lecture seule pour obtenir ; modifie des données du cloud pour enregistrer | Non. |
| Enregistrer des options d’impression d’un appareil | `/v2/device/getPrintOption`, `/v2/device/save` ; méthodes, portée et paramètres inconnus | S2 | Code — route ; sémantique précise supposée | Lecture seule pour obtenir ; modifie des données du cloud pour enregistrer, effet futur sur les impressions à vérifier | Non via ces routes. |
| Inscription / réinitialisation / code de vérification | `/user/public/register`, `/user/public/passwordReset`, `/user/verification_code/newSend` ; méthodes et paramètres inconnus | S2 | Code — route ; il peut s’agir de parcours historiques | Modifie des données du cloud | Non ; aucune preuve de validité actuelle ni de nécessité de les réimplémenter. |
| Signalement général au fournisseur | `/portal/index/feedback` ; méthode et paramètres inconnus | S2 | Code — route | Modifie des données du cloud | Non. |
| Découverte réseau local du slicer | `GET /v3/lan_network/index` et pont natif `search_device` dans les ressources examinées ; paramètres du service inconnus | S1 | Code — appel | Lecture seule | Non ; mode LAN distinct du fonctionnement cloud de l’atelier. |

## Rapports MQTT déjà reconnus mais peu ou pas exploités

Les identifiants dans les topics sont volontairement remplacés par des descriptions. Ce tableau décrit le **code de réception**, pas un inventaire de rapports reçus depuis un compte réel.

| Fonction / état potentiel | Message ou topic logique | Source | Confiance | Risque | Implémenté dans le projet : oui/non |
| --- | --- | --- | --- | --- | --- |
| Progression d’un calcul de tranche cloud | Topics de compte terminant par `slice/report` et `fdmslice/report` ; schéma des paramètres inconnu | P2 : `_build_mqtt_user_subscription`, `_mqtt_message_router` | Code — réception : abonnements construits, contenu seulement diagnostiqué | Lecture seule | Non comme progression utilisateur ou conversion cloud pilotable ; déclenchement du calcul inconnu. |
| Recommandations de fichiers cloud | `type=file`, `action=cloudRecommendList`, `state=done` ; format inconnu | P2 : `_process_mqtt_update_file` | Code — réception : rapport consommé puis ignoré | Lecture seule | Non. |
| Miniatures de vidéos spontanées | `file/videoThumbnailList/done` ; format complet inconnu | P2 ; capture intermédiaire dans P1 | Code — réception : données reconnues sans galerie | Lecture seule | Non comme galerie ou téléchargement vidéo validé. |
| Cycle de vie vidéo détaillé | `video/startCapture` : `initSuccess`, `joinSuccess`, `pushStarted`, `pushStoped`, `done` | P2 : `_process_mqtt_update_video` | Code — réception : transitions consommées sans état affiché dédié | Lecture seule | Oui pour les étapes corrélées à la machine et à la session courante ; rapports périmés et étapes régressives ignorés. La lecture vidéo Agora reste distincte. |
| Rapports matériels spontanés | `type=hardwareProfile` et `type=info` ; actions, champs et garanties inconnus | P2 : `process_mqtt_update` | Code — réception : contenu ignoré | Lecture seule | Non comme mise à jour spontanée complète ; consultation explicite de propriétés déjà présente. |
| Réglages IA spontanés | `type=aiSettings` | P1 : `receive_ai_reply`, P2 | Code — réception : réponse corrélée conservée, autres rapports ignorés | Lecture seule | Oui pour une consultation explicite ; non pour exploiter tout rapport spontané. |
| Télémétrie constructeur | `type=buried`, `state=done` ; signification du contenu inconnue | P2 : `_process_mqtt_update_buried` | Code — réception ; fonction exacte supposée | Lecture seule pour sa réception | Non ; aucun intérêt utilisateur établi, ne pas republier les données brutes. |
| Messages encore inconnus et champs supplémentaires | Rejet ou diagnostic `AnycubicMQTTUnknownUpdate` / `AnycubicMQTTUnhandledData` ; noms et schémas inconnus jusqu’à observation autorisée | P2 | Code — réception : mécanisme d’alerte, aucune capacité précise déduite | Lecture seule pour le diagnostic | Oui : compteurs de types et rapports inconnus exposés dans le statut, mémoire bornée et diagnostics sans contenu privé (#23). Aucune interprétation arbitraire ni archive brute. |

## Suppression de l’historique : limite actuelle de la preuve

La bibliothèque native possède une fonction `CloudClient::historyDelete(unsigned int)` distincte de `deleteMessage`. Son indice d’URL `0x28` mène à `/work/project/unsetprojects` ; la sérialisation de `DeleteHistory` contient l’entier `id` et le booléen `checkSign`, initialisé à `false`. Le JavaScript public S1 confirme POST.

Après l’inventaire initial, un unique test sur une fiche explicitement désignée a renvoyé **HTTP 200**, avec le corps `{"code":1,"msg":"Delete successful","data":{}}`. Une relecture de `printHistory` a confirmé le retrait de cette seule fiche, les autres identifiants étant inchangés. Les références et données de l’essai restent privées. Cette preuve établit un retrait de la liste cloud ; elle ne permet pas de conclure à un effacement physique définitif des objets, ni de garantir un effet sur leurs fichiers associés. La vérification dans les interfaces du fournisseur appartient au propriétaire.

La sélection multiple de l’atelier envoie une demande par fiche : aucun paramètre de suppression groupée n’est inventé. Toute la sélection est validée avant la première mutation ; un résultat incertain arrête le lot sans répétition automatique et les réussites déjà confirmées sont annoncées. Les scénarios de lot, d’annulation et d’échec partiel sont testés avec des données fictives, sans nouvel essai cloud réel.

## Limites et exploration ultérieure

Cette première passe a examiné quatre projets communautaires, la page locale du slicer, son atelier JavaScript public et neuf modules différés, les symboles et routes de son SDK, les journaux locaux disponibles et les branchements du code du projet. Les journaux n’ont donné aucune trace exploitable de requête cloud. L’examen des caches système des vues web, de toutes les fonctions natives et de tous les modèles de machines reste hors périmètre de cette passe limitée.

Restent à établir : les méthodes et schémas des routes signalées « inconnu », les appels exacts de certains boutons de l’interface native, les variantes régionales, les droits nécessaires aux fonctions de ferme, la différence entre miniatures et téléchargements de timelapse et les messages MQTT supplémentaires. Aucune de ces incertitudes ne justifie un essai automatique contre le cloud. Les évolutions de protocole ou de firmware peuvent invalider ces repères.

## Suivi des cinq pistes retenues

1. **Suppression réelle de fiches d’impression** : nettoyer le même historique que dans le slicer, sans masquer localement une fiche encore présente dans le cloud.
2. **Galerie et téléchargement des timelapses** : rendre accessibles les vidéos enregistrées, une fois la liste, les références et les droits établis.
3. **Vue de plusieurs imprimantes** : consulter plusieurs machines du même compte sans changer la configuration du serveur ; commencer par la lecture seule.
4. **Dossiers et rangement du stockage cloud** : organiser les fichiers existants plutôt que les retrouver dans une seule liste ; les mutations demanderaient confirmation.
5. **Diagnostic détaillé de la caméra** : distinguer l’ouverture, la jonction et l’arrêt du flux à partir des rapports reconnus, sans afficher de secrets temporaires.

Le retrait d’historique (#15, #28), le diagnostic caméra (#21) et le sélecteur multi-imprimantes (#32) sont retenus pour la 1.2.0. Les timelapses (#30) et les dossiers cloud (#31) sont reportés à la 1.3.0. Les autres lignes de cet inventaire ne créent aucune issue automatiquement ; leurs priorités restent au choix du propriétaire.
