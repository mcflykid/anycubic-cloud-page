# Recherche sur les réponses de coordonnées S1

## Périmètre et conclusion

Cette note sépare l’examen hors ligne du flux local et de Slicer Next des deux essais sur l’installation 1.7.1. Aucun client MQTT supplémentaire n’a été créé.

Les éléments consultés confirment la forme d’ordre `1214` actuellement implémentée et le chemin de corrélation des réponses. Ils ne permettent pas d’établir pourquoi la machine concernée n’a pas répondu. Aucun élément vérifiable dans les ressources statiques examinées ne confirme une variante du protocole attendue par Slicer Next. Il n’y a donc pas de base suffisante pour changer l’ordre ou assouplir la validation de réponse.

## Contrat local et chemin de corrélation

- `app/printer_axes.py:52-96` vérifie le modèle S1, l’état libre et la connexion; construit `AnycubicBaseProjectOrderRequest(order_id=1214, printer_id=..., project_id=0)`; demande `axis/query` avec un délai de 10 secondes; puis exige une réponse de type/action attendus, `state: done`, `code: 200` et trois coordonnées finies.
- `app/anycubic_cloud_api/data_models/orders.py:10-35,49-69` sérialise les champs de base et ajoute `project_id`. La forme ne contient donc pas `data`.
- `app/anycubic_cloud_api/api/functions.py:408-425` transmet ces champs au point de terminaison d’ordre Cloud et attend le `msgid` de l’accusé HTTP Cloud. Cette étape précède l’attente de la réponse MQTT.
- `app/server.py:190-224` associe le message reçu à son propriétaire à partir de la clé d’imprimante du topic; pour un topic correspondant, il remet les réponses non retenues de type `axis` au corrélateur de cette cible. `axis/query` est ensuite soustrait au traitement générique.
- `app/printer_files.py:18-76` corrèle la réponse par `(type, action, msgid)`. Il conserve aussi un bref tampon borné pour le cas où la réponse MQTT arrive avant l’accusé HTTP, puis supprime l’attente après réponse ou délai.
- `app/server.py:1044-1051` expose cette opération sur une route déclenchée à la demande; elle est protégée par le verrou de la cible et ne déclenche pas de lecture périodique.
- `app/test_printer_axes.py:28-61,198-208` vérifie avec doublures la charge utile exacte, la réponse corrélée, l’ignorance d’un `msgid` étranger et le nettoyage après délai. Ces tests attestent le comportement local, pas l’interopérabilité physique.
- `docs/IDLE-AXES.md:19-27` consigne le contrat retenu depuis la documentation de captures du client indépendant référencée dans ce fichier et les limites de validation matérielle.

## Point de diagnostic concret

Le délai de 10 secondes dans `MQTTReplies.ask` ne couvre que l’attente après `await send()` (`app/printer_files.py:51-74`). Ici, `send()` appelle `_send_anycubic_order`, qui attend d’abord l’API Cloud pour obtenir le `msgid` (`app/anycubic_cloud_api/api/functions.py:408-425`). Le délai de réponse MQTT commence donc après cet accusé Cloud; il ne constitue pas un plafond de durée pour toute l’opération. C’est une caractéristique vérifiée du code, mais pas une explication prouvée des délais rapportés.

Pour distinguer les phases lors d’un prochain diagnostic autorisé, les événements applicatifs peuvent enregistrer uniquement des durées monotoniques et des résultats catégorisés : début de requête, accusé Cloud reçu/refusé/exception, réponse MQTT corrélée reçue ou expiration, puis validation de forme. Ne pas journaliser les payloads, identifiants, topics, coordonnées ou exceptions brutes. Ne jamais réémettre l’ordre après un délai ambigu. Ces mesures permettraient de séparer une lenteur de l’API Cloud, un accusé sans réponse MQTT, une réponse non corrélable, et une réponse reçue mais invalide sans inventer une cause.

## Inspection statique de Slicer Next

Une recherche locale limitée aux ressources statiques pertinentes présentes dans `/Applications/AnycubicSlicerNext.app/Contents/Resources` a trouvé notamment `tooltip/main.js`, des fiches imprimantes JSON et des profils. La recherche de chaînes `query-axis`, `axis-position`, `axis query` et `1214` dans ces ressources n’a fourni aucun résultat. Les ressources web repérées sous `Resources/web/anycubic` étaient des éléments HTML/CSS/images, sans implémentation du protocole de coordonnées visible dans ce sous-arbre. Une recherche binaire antérieure dans Workbench, le SDK Cloud et MachMQTT n’avait pas trouvé de chaîne `query-axis` ou `1214`.

Cette absence de chaîne n’est pas une preuve que Slicer Next n’utilise pas ce contrat : le code peut être compilé, chiffré, généré ou livré ailleurs. Les ressources inspectées ne donnent simplement pas de preuve positive d’une variante. Aucun fichier de l’application n’a été modifié.

## Capture locale complémentaire

Les journaux texte locaux disponibles pour Slicer Next ont été parcourus en mémoire : 30 fichiers, environ 398 Ko au total, couvrant les dates présentes dans leurs noms du 6 au 8 novembre 2026. Aucun ne contient de libellé `axis`, `axes` ou `query`; aucun enregistrement structuré avec `order_id: 1214` ou enveloppe `axis/query` n’a été trouvé. Une ligne de débogage contient la séquence de chiffres `1214`, mais ce n’est pas un objet JSON ou une enveloppe de requête et aucun champ exploitable n’y est discernable. Les journaux ne fournissent donc aucun élément positif sur `project_id`, `data`, `msgid`, `state`, `code` ou les clés de coordonnées. Aucune version fiable du logiciel n’a pu être extraite de cette capture.

Cette capture ne permet pas d’attribuer la ligne isolée à une imprimante S1 ni à une requête d’axes. Elle ne confirme pas le contrat du firmware et ne fournit pas de cause au timeout; elle borne seulement la recherche aux journaux textuels locaux disponibles lors de cet examen.

## Suite sûre

Sur la Kobra S1 observée (firmware 2.7.2.7), une lecture à l’arrêt, caméra fermée, puis une seule lecture avec un flux vidéo décodé ont toutes deux expiré sans coordonnées (HTTP 400 en 1.7.1). La caméra active ne suffit donc pas à obtenir la réponse. Aucun déplacement, chauffage ou démarrage d’impression n’a été demandé. La 1.8.0 expose des événements de phase et renvoie HTTP 504 lorsque l’attente MQTT expire ; le diagnostic de la cause reste ouvert dans #167.

Conserver l’ordre `1214` et la validation stricte tant qu’une capture de réponse documentée ou une observation autorisée ne contredit pas le contrat. Si un diagnostic ultérieur est mené, relever des horodatages de phase sans données sensibles et vérifier le routage par cible à partir des journaux expurgés. Toute nouvelle connexion MQTT, émission d’ordre, ou action physique nécessite une autorisation distincte; cette note n’en effectue aucune.

## Rejets distingués dans les journaux

L’événement `axis_query_mqtt_rejected` émet une catégorie bornée dans
`reply_rejection`. Il aide à lire les phases existantes sans afficher les
coordonnées, le sujet MQTT ou les identifiants du Cloud.

| Catégorie | Observation |
| --- | --- |
| `target` | Le routeur ne retrouve pas la machine du rapport. |
| `retained` | MQTT marque le rapport comme conservé par le courtier. |
| `kind_action` | L’enveloppe attendue diffère de celle du rapport associé à la consultation. |
| `identifier` | L’identifiant est inutilisable ou diffère de celui de l’accusé Cloud pendant l’attente. |
| `outside_window` | Le rapport arrive sans attente active ou hors de sa fenêtre. |

Les fixtures incluent un rapport plausible reçu avant l’accusé Cloud avec un
identifiant différent. Le corrélateur laisse expirer la consultation dans ce
cas. Une telle divergence est donc une cause possible, à distinguer des
autres catégories sur des observations. La fenêtre et les critères
d’acceptation sont inchangés.
