# Recherche sur les réponses de coordonnées S1

**Archive du diagnostic de lecture des coordonnées S1.** La consultation et
ses événements de journal ont été retirés dans #210. La cause du délai reste
indéterminée. Le commit [`78e1fa0`](https://github.com/mcflykid/anycubic-cloud-page/tree/78e1fa0c6822002f6a6785c97de8e27828f35397)
est le dernier état de `main` qui contient l’implémentation, le routeur et les
tests de la consultation décrits ici.

## Périmètre et conclusion

Cette note sépare l’examen hors ligne du flux local et de Slicer Next des deux essais sur l’installation 1.7.1. Aucun client MQTT supplémentaire n’a été créé.

Les éléments consultés confirment la forme d’ordre `1214` implémentée en 1.8.0 et le chemin de corrélation des réponses. Ils ne permettent pas d’établir pourquoi la machine concernée n’a pas répondu. Aucun élément vérifiable dans les ressources statiques examinées ne confirme une variante du protocole attendue par Slicer Next. Il n’y a donc pas de base suffisante pour changer l’ordre ou assouplir la validation de réponse.

## Fonctionnement observé dans l’archive

Dans l’état conservé au commit `78e1fa0`, le serveur vérifiait que la S1 était
connectée et au repos avant de demander la position. Il exigeait une réponse
MQTT de la machine ciblée, avec les références de la consultation et trois
coordonnées valides. Les réponses reçues avant l’accusé HTTP étaient conservées
brièvement pour pouvoir les comparer à cet accusé.

Le délai de dix secondes commençait après l’accusé du Cloud. Les tests sur
doublures couvraient la requête, la corrélation, le rejet d’un autre identifiant
et la libération de l’attente après expiration. Ils n’établissaient pas la
cause des délais observés sur la machine.

## Inspection statique de Slicer Next

Une recherche locale limitée aux ressources statiques pertinentes présentes dans `/Applications/AnycubicSlicerNext.app/Contents/Resources` a trouvé notamment `tooltip/main.js`, des fiches imprimantes JSON et des profils. La recherche de chaînes `query-axis`, `axis-position`, `axis query` et `1214` dans ces ressources n’a fourni aucun résultat. Les ressources web repérées sous `Resources/web/anycubic` étaient des éléments HTML/CSS/images, sans implémentation du protocole de coordonnées visible dans ce sous-arbre. Une recherche binaire antérieure dans Workbench, le SDK Cloud et MachMQTT n’avait pas trouvé de chaîne `query-axis` ou `1214`.

Cette absence de chaîne n’est pas une preuve que Slicer Next n’utilise pas ce contrat : le code peut être compilé, chiffré, généré ou livré ailleurs. Les ressources inspectées ne donnent simplement pas de preuve positive d’une variante. Aucun fichier de l’application n’a été modifié.

## Capture locale complémentaire

Les journaux texte locaux disponibles pour Slicer Next ont été parcourus en mémoire : 30 fichiers, environ 398 Ko au total, couvrant les dates présentes dans leurs noms du 6 au 8 novembre 2026. Aucun ne contient de libellé `axis`, `axes` ou `query`; aucun enregistrement structuré avec `order_id: 1214` ou enveloppe `axis/query` n’a été trouvé. Une ligne de débogage contient la séquence de chiffres `1214`, mais ce n’est pas un objet JSON ou une enveloppe de requête et aucun champ exploitable n’y est discernable. Les journaux ne fournissent donc aucun élément positif sur `project_id`, `data`, `msgid`, `state`, `code` ou les clés de coordonnées. Aucune version fiable du logiciel n’a pu être extraite de cette capture.

Cette capture ne permet pas d’attribuer la ligne isolée à une imprimante S1 ni à une requête d’axes. Elle ne confirme pas le contrat du firmware et ne fournit pas de cause au timeout; elle borne seulement la recherche aux journaux textuels locaux disponibles lors de cet examen.

## Résultats des essais sur la S1

Sur la Kobra S1 observée (firmware 2.7.2.7), une lecture à l’arrêt, caméra fermée, puis une seule lecture avec un flux vidéo décodé ont toutes deux expiré sans coordonnées (HTTP 400 en 1.7.1). La caméra active ne suffit donc pas à obtenir la réponse. Aucun déplacement, chauffage ou démarrage d’impression n’a été demandé. La 1.8.0 journalisait les phases et renvoyait HTTP 504 à l’expiration de l’attente MQTT. La cause du délai n’a pas été confirmée avant le retrait suivi dans #167.

La branche de diagnostic conservait l’ordre `1214` et la validation stricte faute de capture établissant un autre contrat.

## Rejets distingués dans les essais hors ligne

Les diagnostics archivés au commit `78e1fa0` distinguaient les catégories
ci-dessous sans enregistrer les coordonnées, les sujets MQTT ou les
identifiants Cloud.

| Catégorie | Observation |
| --- | --- |
| `target` | Le routeur ne retrouve pas la machine du rapport. |
| `retained` | MQTT marque le rapport comme conservé par le courtier. |
| `kind_action` | L’enveloppe attendue diffère de celle du rapport associé à la consultation. |
| `identifier` | L’identifiant est inutilisable ou diffère de celui de l’accusé Cloud pendant l’attente. |
| `outside_window` | Le rapport arrive sans attente active ou hors de sa fenêtre. |

Une fixture reproduisait un rapport reçu avant l’accusé Cloud avec un
identifiant différent. La consultation expirait alors. Cette divergence
est une cause possible dans la simulation. Sa présence sur la S1 n’a pas
été établie.
