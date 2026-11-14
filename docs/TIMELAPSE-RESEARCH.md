# Recherche timelapse #30 — 11 novembre 2026

## Périmètre

Recherche statique sur les réponses `file/listVideo`, les métadonnées de timelapse et les possibilités de récupération d’une vraie vidéo. Aucun accès Cloud ou imprimante, aucune requête réseau au fournisseur et aucun ordre n’ont été exécutés. L’application Slicer Next n’a pas été lancée; ses bibliothèques ont été inspectées statiquement.

## Références

- Spécification indépendante publique [`Nino6689/anycubic-cloud-client`](https://github.com/Nino6689/anycubic-cloud-client/blob/main/docs/PROTOCOL.md), section « Timelapse » : le client ne connaît pas de point d’accès de liste ou de téléchargement des vidéos.
- Code et documentation publics du même projet : [`QUESTIONS.md`](https://github.com/Nino6689/anycubic-cloud-client/blob/main/docs/QUESTIONS.md) et [dépôt](https://github.com/Nino6689/anycubic-cloud-client).
- Bibliothèques livrées avec Anycubic Slicer Next 2.0.0.3 macOS arm64 : `libcloud_sdk_cpp.dylib`, `libcloud_mqtt.dylib` et `libmach_mqtt.dylib`. Les structures citées ci-dessous sont déduites des symboles de sérialisation Boost.PFR et des appels désassemblés, sans exécution.
- Code du dépôt : `app/cloud_extras.py`, `app/test_cloud_extras.py`, `app/native_controls.py`, `docs/CLOUD-CAPABILITIES.md`.

## Résultats

### 1. Liste locale des timelapses par MQTT

Le SDK Anycubic conserve un modèle de requête `VideoListQuery` dont les champs sont `page_num`, `page_size`, `path` et `keyword`. L’enveloppe `BaseCtrl` expose `type`, `action`, `msgid`, `timestamp` et `data`. L’application envoie cette requête sous `type: "file"`, `action: "listVideo"`; `app/cloud_extras.py` utilise actuellement `page_num`, `page_size: 20`, `path: "/"` et `keyword`. C’est une consultation de liste, sans mutation de fichier.

Les modèles compilés des réponses déclarent `VideoListResponse.records`. Dans `libcloud_mqtt.dylib`, un `VideoRecord` contient les champs sérialisés `filename`, `fileKey`, `file_image`, `size`, `duration`, `padding`, `createTime`. Le modèle LAN parallèle dans `libmach_mqtt.dylib` déclare le même ensemble de noms, dans un ordre de membres différent : `duration`, `createTime`, `size`, `filename`, `fileKey`, `file_image`. Ces schémas sont des attentes de parseur compilées, pas une capture réelle de la réponse d’un firmware.

Le traitement actuel dans `CloudExtras.videos()` lit `data.records` et n’expose que nom, taille, durée et date. Il ignore `fileKey`/`file_key` et `file_image`, ce qui évite de présenter une clé interne comme un lien. `app/test_cloud_extras.py` vérifie seulement des fixtures synthétiques. Le drapeau `TIMELAPSE_GALLERY_ENABLED` reste `False`, donc la route web n’expose pas cette consultation.

### 2. Route HTTP du slicer : liste de miniatures

Le SDK fournit `CloudClient::getTimelapseDownloadUrls(char const*, char const**, unsigned int)`. Le désassemblage de cette seule méthode montre la construction JSON suivante avant l’appel au client HTTP :

```json
{
  "device_id": "…",
  "video_file_keys": ["…"]
}
```

La méthode utilise `POST /v3/printer/getVideoThumbnailList`. Son type de réponse est `ResponseBase<vector<VideoThumbnailResponse>>`; chaque entrée est sérialisée sous les seuls champs `filename`, `file_key` et `thumbnail_url`. La même bibliothèque contient aussi le point `/v5/printer/file/thumbnail/list` et un type `DeviceFileThumbnailResponse` avec `filename`, `file_key`, `thumbnail_url`.

Le nom `getTimelapseDownloadUrls` est donc trompeur : le schéma typé retourne une **URL de miniature** (`thumbnail_url`) et une clé de fichier, pas de champ URL vidéo. Le corps inspecté ne demande que `video_file_keys`, et aucun endpoint vidéo dédié ou champ de téléchargement vidéo n’a été trouvé parmi les routes, symboles et chaînes du SDK examiné. Il existe un téléchargeur HTTP générique dans la bibliothèque, mais aucune preuve ne le relie à une URL de flux vidéo issue de cet appel.

### 3. Lecture seule disponible pour une validation ultérieure

Le seul parcours de liste connu est `file/listVideo` avec `page_num`, `page_size`, `path`, `keyword`. Le code possède déjà `CloudExtras.videos()` et un test synthétique qui vérifie exactement cette requête. Si une validation réelle est autorisée ultérieurement, elle doit rester une lecture de liste; le journal d’observation devrait comparer les noms de champs et les clés sans publier les valeurs de `fileKey` ni les URLs signées. Cette recherche n’a déclenché aucun appel réel.

Les éléments qui nécessiteraient encore une preuve indépendante sont :

- la réponse réellement renvoyée par `file/listVideo` selon modèle et firmware;
- si `fileKey` identifie un artefact vidéo téléchargeable, une miniature, ou seulement un enregistrement interne;
- si `getVideoThumbnailList` exige une identité particulière de `device_id`, et si `thumbnail_url` est accessible publiquement ou signée;
- l’existence d’un autre service ou protocole d’accès aux octets vidéo, distinct de l’API de miniatures.

## Conséquence pour #30

L’enquête établit deux mécanismes distincts : une liste MQTT de timelapses qui expose des métadonnées et références internes, et une route HTTP Anycubic qui retourne des URLs de miniatures. Elle ne révèle pas de contrat de téléchargement du média vidéo lui-même. Une galerie de miniatures pourrait éventuellement réutiliser le second mécanisme après validation des références, mais elle ne doit pas être décrite comme une galerie de vidéos téléchargeables.

La référence publique indépendante déclare ne connaître aucun endpoint de liste ou de téléchargement; l’inspection du binaire ajoute une preuve plus directe que la méthode portant le nom « DownloadUrls » sérialise un appel de miniature et reçoit seulement `thumbnail_url`. Cela réduit la piste d’un téléchargement vidéo via cette méthode, sans démontrer qu’aucune route inconnue ou aucun autre transport n’existe.
