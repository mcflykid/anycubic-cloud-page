# Recherche protocole d’impression — 10 novembre 2026

## Portée et niveau de preuve

Recherche statique uniquement sur les contrats de lancement mémoire/USB, les fichiers `.gcode.3mf`, le séchage associé à la création d’une tâche et les refus de lancement. Aucun ordre d’impression ou de séchage n’a été envoyé. Le binaire Anycubic Slicer Next n’a pas été exécuté. Aucun compte, service Cloud, imprimante, journal privé ou configuration n’a été consulté.

Les contrats ci-dessous distinguent les faits décrits par une source publique, les observations de binaire et les questions qui restent ouvertes. Une sérialisation observée dans un client ne prouve pas son acceptation par chaque firmware ou modèle.

## Sources consultées

- Client public indépendant `Nino6689/anycubic-cloud-client`, version PyPI 0.1.0, code MIT et documentation protocolaire : [dépôt](https://github.com/Nino6689/anycubic-cloud-client), [PROTOCOL.md](https://github.com/Nino6689/anycubic-cloud-client/blob/main/docs/PROTOCOL.md), [QUESTIONS.md](https://github.com/Nino6689/anycubic-cloud-client/blob/main/docs/QUESTIONS.md), [printing.py](https://github.com/Nino6689/anycubic-cloud-client/blob/main/src/anycubic_cloud_client/printing.py), [client.py](https://github.com/Nino6689/anycubic-cloud-client/blob/main/src/anycubic_cloud_client/client.py). Le dépôt annonce des formes sérialisées et des fixtures; ses propres questions marquent explicitement les éléments non vérifiés.
- Sources officielles du slicer : [ANYCUBIC-3D/AnycubicSlicerNext](https://github.com/ANYCUBIC-3D/AnycubicSlicerNext). Elles documentent le traitement des projets 3MF et des données de tranche, mais ne publient pas le contrat complet Cloud de lancement observé dans l’application.
- Application locale observée par inspection statique : Anycubic Slicer Next 2.0.0.3, binaire macOS arm64. Empreinte SHA-256 du binaire principal : `618b3fc1b291f30a564c4df2e87df5e4e6598927ae061e3d9a90dd119754a58d`.
- Implémentation actuelle : `app/anycubic_cloud_api/data_models/orders.py`, `app/anycubic_cloud_api/api/functions.py`, `app/anycubic_cloud_api/data_models/printer.py`, `app/printer_commands.py`, `app/upload_formats.py`, `app/test_local_print_payload.py`, `app/test_print_preflight.py`.

## Lancement d’un fichier déjà stocké — #142 et #103

### Contrat visible et comparaison

Le client indépendant décrit la forme de l’ordre 1 pour un fichier interne comme `filetype: 1`, `filename` exact reçu dans la liste, `filepath` sous la forme `/` suivie du dossier, et `task_settings` avec `ai_detect: 0` et `camera_timelapse: 0`. Pour USB, le même schéma utilise `filetype: 2`. L’enveloppe met `project_id: 0`, `settings: null` et `ams_info: null` dans l’exemple du fichier local. Le chemin racine est `/`.

Le code du dépôt construit les mêmes champs de fichier et la même forme racine dans `AnycubicStartPrintRequestLocal` et `AnycubicStartPrintRequestUdisk` (`orders.py`). Les tests de `app/test_local_print_payload.py` figent ces champs. L’écart est que `printer_commands.py` demande une liste de slots pour les commandes locales avec ACE; `AnycubicPrinter.print_local_file()`/`print_udisk_file()` la transforme en mapping construit manuellement, puis `_send_order_start_print()` sérialise ce mapping sous `ams_info`.

La référence publique explique ce choix comme une compatibilité 2.x, mais précise en Q12 et dans ses points ouverts que l’affectation des slots pour un fichier déjà sur l’imprimante reste inconnue. Elle ne démontre pas que l’absence de mapping est requise par tous les firmwares. La divergence actuelle est donc un **risque de contrat vérifiable**, pas une cause prouvée de `cannotparse`.

L’interface publique documente `paint_index` et `ams_index` comme indices de mapping, mais la fonction locale du dépôt n’a pas la liste de couleurs du fichier stocké. Elle ne peut donc pas confirmer que le nombre ou l’ordre de slots choisis correspond aux matériaux réellement intégrés dans ce G-code. Pour un `.gcode.3mf` multicolore, la présence d’un mapping manuel doit être testée séparément de la simple référence de fichier.

### `.gcode.3mf`

Depuis la mémoire interne ou la clé USB, Cloud Page active le bouton Imprimer pour les fichiers dont le nom se termine par `.gcode`. Le serveur applique la même vérification avant de préparer l’ordre. Le blocage signalé sur un fichier `.gcode.3mf` intervient donc dans Cloud Page, avant tout envoi vers la machine. Le modèle d’ordre stocké contient la référence de fichier et le type de stockage, sans indice de plateau ni référence de contenu. Le téléversement accepte `.gcode`, `.stl` et `.3mf` pour l’enregistrement Cloud. Les modes qui lancent une impression après le transfert exigent un `.gcode`.

L’application Slicer Next 2.0.0.3 contient des messages et symboles indiquant un format `.gcode.3mf` pouvant contenir le G-code par plateau, ainsi que des erreurs du type « aucun plateau valide avec G-code » et « le fichier ne contient aucune donnée G-code ». Cela établit que le slicer distingue un paquet tranché d’un projet 3MF ordinaire, mais ne révèle pas que l’ordre direct Anycubic puisse sélectionner un plateau précis ni quel `filetype` le firmware attend pour chaque cas. Le protocole indépendant ne spécifie pas de variante `.gcode.3mf` dans l’ordre 1.

**Tests utiles, sans machine :**

- Figer la sérialisation exacte d’un fichier local et USB, racine et sous-dossier, en comparant mapping absent et mapping explicite.
- Vérifier qu’un fichier non G-code reste refusé au lancement si le type ne peut être établi à partir de la seule liste locale; ne pas déduire le nombre de couleurs depuis les slots choisis.
- Préparer des fixtures ZIP distinctes : `.3mf` projet sans G-code, `.gcode.3mf` mono-plate avec G-code et paquet multicolore avec métadonnées de couleurs. Les validations de conteneur ne doivent pas prétendre démontrer que l’imprimante peut les lancer.
- Figer le comportement applicatif après refus `cannotparse`: garder le refus comme échec de démarrage, ne pas renvoyer automatiquement une autre forme de commande.

## Séchage associé au lancement — #137

L’inspection statique du `libcloud_sdk_cpp.dylib` livré avec le slicer 2.0.0.3 révèle `object_to_json<CreateBulkTaskParam>` et `CloudClient::createBulkTask(CreateBulkTaskParam const*)`; Boost.PFR expose les noms et l’ordre des champs de cette structure sérialisée. Schéma observé :

```text
CreateBulkTaskParam {
  print_number, solt_color_material_match, printer_ids,
  data: {
    file_id, filetype, project_type, evoke_from,
    task_settings: {
      ai_detect, camera_timelapse, auto_leveling,
      vibration_compensation, flow_calibration, dry_mode,
      drying_settings: { duration, target_temp }
    }
  },
  ams_info: { use_ams, padding, padding1, order_id, ams_box_mapping },
  slice_result: { estimate, total_layers, supplies_usage, print_time }
}
```

Les noms compilés et le code de sérialisation indiquent donc plus qu’un simple dictionnaire de chaînes : `dry_mode` est un membre de `task_settings`, et `drying_settings` est un objet avec `duration` et `target_temp`. Les autres membres sérialisés associés à la création en lot sont listés ci-dessus pour éviter de prendre ce fragment isolément. Le binaire principal affiche ces champs à proximité des commandes de création de tâche en lot.

Cela dépasse la simple découverte des noms de champs du SDK : les symboles de sérialisation C++ Boost.PFR confirment que cette structure est convertie en JSON et que `CloudClient::createBulkTask` l’accepte. Toutefois, le nom `CreateBulkTaskParam` et les dialogues du slicer pointent vers un parcours de tâches en lot. Aucune preuve statique obtenue ici ne rattache ces champs à l’ordre direct `sendOrder` numéro 1, ne révèle les valeurs concrètes émises par l’interface, ne donne l’unité des valeurs, ni ne définit le séquencement, l’état, l’annulation ou les capacités par modèle. Le parcours d’ordre de séchage séparé du dépôt documente déjà la durée en minutes et la température en °C; ces unités ne doivent pas être transférées au champ du SDK de tâche en lot sans preuve.

**Tests utiles, sans machine :**

- Garder des tests de sérialisation séparés pour l’ordre de séchage 1207 et pour l’éventuelle structure de création de tâche en lot; interdire toute fusion implicite entre les deux formes.
- Tant que la source directe d’ordre n’est pas établie, vérifier que le lancement normal n’émet ni `dry_mode` ni `drying_settings`.
- Si le contrat direct est confirmé plus tard, couvrir la structure exacte, les champs absents/optionnels, les unités et les refus simulés avant d’exposer cette option.

## Refus de lancement — #136

Le code actuel bloque les trois types de lancement si le micrologiciel de l’imprimante ou d’un ACE confirme `is_updating is True` (`ensure_firmware_ready`). Les parcours local/USB et cloud vérifient également `is_available`. La suite `app/test_print_preflight.py` contrôle qu’un état de mise à jour confirmée n’envoie aucun ordre, et qu’une simple mise à jour proposée ou inconnue ne bloque pas.

Le binaire Slicer Next expose plusieurs refus côté interface — machine hors ligne/occupée, ACE absent pour le multicolore et incompatibilité de modèle — mais ces messages ne suffisent pas à identifier les champs exacts, les ordres de contrôle ou les refus firmware réels. Pour les fichiers stockés, la liste de fichiers ne fournit pas au dépôt la compatibilité de modèle ou le nombre de matériaux du G-code; la vérification locale de ces conditions n’est donc pas établie.

**Tests utiles, sans machine :**

- Étendre les tests aux refus hors ligne/occupé et aux ACE absents/incompatibles à partir d’états synthétiques explicites, puis vérifier zéro appel d’ordre.
- Tester le cas où l’état de mise à jour change entre le transfert temporaire et l’ordre final; le contrôle existant à l’envoi final doit rester effectif.
- Distinguer `order accepted`, refus explicite et résultat ambigu; aucun résultat ambigu ne doit être présenté comme impression commencée ni déclencher une seconde commande.

## Conclusion

Le contrat de base `filetype`/`filename`/`filepath` du lancement mémoire et USB concorde avec une référence indépendante. Le mapping `ams_info` ajouté aux fichiers stockés n’est pas documenté comme nécessaire et son effet reste inconnu; c’est le principal écart concret à qualifier pour #142/#103. Le `.gcode.3mf` est bien reconnu par le slicer comme un paquet tranché, mais son lancement via l’ordre direct n’est pas spécifié. Le binaire fournit un schéma JSON sérialisé de séchage pour les tâches en lot, sans établir qu’il s’applique au lancement direct. Les gardes actuelles de refus couvrent mise à jour confirmée et disponibilité signalée, pas toutes les incompatibilités montrées dans l’interface Slicer.

## Affectations et suivi du lancement (#331, #332)

| Source | Affectations en démonstration | Mesure et suivi |
| --- | --- | --- |
| Fichier G-code envoyé depuis le navigateur | Une ligne par filament lorsque les commentaires de tranche sont lisibles | Transfert indéterminé. L’annulation bloque l’envoi de l’ordre tant que le transfert est actif. |
| Fichier Cloud | Une ligne par filament lorsque la liste Cloud fournit les données de tranche. Saisie de l’ordre des emplacements si elles manquent. | Pourcentage uniquement si la machine rapporte un téléchargement pour le G-code attendu. |
| Mémoire imprimante ou USB | Saisie de l’ordre des emplacements avec les fichiers G-code pris en charge | Suivi par référence d’ordre. Les détails de tranche de ces sources restent à qualifier. |
| Historique | Confirmation commune ouverte directement. Les matières et couleurs proviennent de la fiche de tranche. | Même suivi de l’ordre que pour les fichiers Cloud. |

Les captures de démonstration couvrent la [confirmation](../screenshots/34-confirmation-impression.png), la [vue à 390 px](../screenshots/35-confirmation-impression-mobile.png), le [transfert indéterminé](../screenshots/36-impression-demande-en-cours.png), le [téléchargement mesuré](../screenshots/38-impression-telechargement-mesure.png) et le [rapport de démarrage corrélé](../screenshots/39-impression-demarrage-confirme.png).

- Le serveur recontrôle la présence des bobines sélectionnées avant le transfert éventuel puis à la construction de l’ordre. Le parcours d’envoi et la relance depuis une fiche détaillée affichent une affectation par filament lorsque leurs données de tranche sont disponibles. Les fichiers stockés sans cette information conservent la saisie de l’ordre des emplacements.
- Les écarts de matière et de couleur restent deux avertissements distincts. Le blocage d’un mélange de matières et les réglages de préparation ou de séchage liés au lancement demandent une qualification par modèle et par parcours.
- Le transfert et l’appel d’envoi affichent une progression indéterminée. Le message de démarrage exige un rapport MQTT non retenu avec la signature et la référence de l’ordre attendu, pour la même imprimante. Un relevé de préparation est indicatif et n’est affiché que si un nouveau projet possède la référence attendue du G-code. Au bout de cinq minutes sans rapport corrélé, la fenêtre indique que le démarrage reste non confirmé.
- La confirmation peut être annulée avant émission. Pendant un transfert actif, l’annulation empêche l’ordre de partir et laisse le transfert se terminer pour libérer la réservation normalement. Une fois l’ordre engagé, fermer son suivi n’envoie aucune commande à l’imprimante. La validation des rapports et de l’annulation sur une Kobra S1 reste à faire.

## Comparaison des refus 10115 (#394, #398)

| Observation | Ce qu’elle permet de vérifier |
| --- | --- |
| Le propriétaire signale que les fichiers stockés peuvent démarrer depuis l’écran, alors que Cloud Page reçoit un refus après son ordre de lancement mémoire. Le journal identifie un G-code d’exemple préinstallé. | Comparer le même fichier et les options ACE entre les deux parcours. Vérifier le nom et le dossier natifs avant d’examiner le contenu du G-code. |
| Sur une S1 avec Rinkhals, l’auteur obtient un refus à distance. L’écran avertit d’instructions manquantes sur le même fichier en USB, puis permet de continuer. [Discussion Rinkhals #61](https://github.com/rinkhals-community/Rinkhals/discussions/61) | La validation peut différer selon le lancement. Le résultat concerne un firmware et un profil modifiés. |
| SimplyPrint signale des refus de conteneurs tranchés sur la S1 et envoie du G-code brut. [Documentation SimplyPrint](https://help.simplyprint.io/en/article/my-print-didn-t-start-errors-the-printer-reports-a5w526/) | Garder un G-code brut comme témoin de transfert pour isoler la variable du format. |
| Un utilisateur du Slicer Next 1.3.9.4 attribue un refus à des paramètres M73 générés pour un projet précis. Les mainteneurs d’OrcaSlicer ont par ailleurs isolé une régression de métadonnées sur Kobra 3. [Retour Slicer Next](https://www.reddit.com/r/AnycubicOfficial/comments/1sw2mjs/unparsable_gcode_bug_with_certain_stl_and/) · [OrcaSlicer #12444](https://github.com/OrcaSlicer/OrcaSlicer/issues/12444) | Ces cas justifient de comparer les fichiers lorsque le lancement échoue dans plusieurs modes. |
| Sur Kobra 3 Max avec Rinkhals, un mainteneur rapporte un 10115 lorsque le lancement suit un transfert avant l’indexation du fichier. [Rinkhals #59](https://github.com/rinkhals-community/Rinkhals/issues/59) | Examiner cette piste lorsque le fichier vient d’être transféré et que son apparition en mémoire peut être observée. Le cas préinstallé de la S1 est déjà stocké. |

Le [code public de Slicer Next](https://github.com/ANYCUBIC-3D/AnycubicSlicerNext/blob/6103ed8b511609658d00d0538cc7f0609cdb57da/src/slic3r/GUI/Jobs/PrintJob.cpp#L498-L560) appelle une fonction dédiée au lancement depuis la vue du stockage et une autre pour l’envoi Cloud d’une plaque préparée. Les deux fonctions délèguent le transport à l’agent réseau. Cette lecture ne qualifie pas les données réellement envoyées pour la mémoire interne de la Kobra S1.

En mode LAN, [Rinkhals transmet la référence d’un G-code déjà stocké à l’imprimante](https://github.com/rinkhals-community/Rinkhals/blob/8cac7c49eac9ff96ea68e5c5c34c476c00a8d579/files/4-apps/%68ome/rinkhals/apps/40-moonraker/kobra.py#L348-L416) via le broker MQTT local, puis attend son rapport. Le lancement lui-même ne tranche et ne transfère aucun fichier. Le type de stockage interne et le chemin racine concordent avec ceux encodés par Cloud Page. Quand le module ACE est actif et dispose d’une correspondance, [Rinkhals ajoute les affectations au démarrage](https://github.com/rinkhals-community/Rinkhals/blob/8cac7c49eac9ff96ea68e5c5c34c476c00a8d579/files/4-apps/%68ome/rinkhals/apps/40-moonraker/mmu_ace.py#L3187-L3302). Le nom et l’emplacement de ce champ dans l’ordre LAN ne suffisent pas à déterminer le contrat Cloud.

L’implémentation de [Nino6689/anycubic-cloud-client](https://github.com/Nino6689/anycubic-cloud-client/blob/main/docs/QUESTIONS.md) envoie les lancements de fichiers stockés sans affectation ACE dans l’enveloppe. Cloud Page peut y joindre un mapping manuel. Ce champ reste à comparer sur un même fichier avec la même configuration ACE.

Le tranchage en ligne de commande a produit un G-code brut S1 identique à la préparation de référence pour les instructions. L’essai de transfert temporaire a exposé un défaut local avant appel réseau. Avec une seule matière, les valeurs masse, longueur et volume étaient des scalaires. La correction #398 normalise ces valeurs pour l’affectation ACE. Le résultat de l’ordre 10115 émis pour un fichier déjà stocké reste suivi dans #394.

### Essai discriminant pour #394

Sur la fenêtre de lancement d’une plaque préparée dans Slicer Next, le Socle apparaît avec un filament PLA et l’emplacement 1 présélectionné. Le menu affiche les quatre emplacements ACE avec leur couleur et le type PLA. Il indique que le choix doit correspondre au filament du projet. Cloud Page affiche déjà un sélecteur par filament quand les métadonnées du fichier sont disponibles. Pour un fichier mémoire sans ces données, la confirmation propose un premier sélecteur ACE et permet d’ajouter d’autres filaments dans l’ordre du G-code. Les captures établissent le comportement de l’interface avant envoi. La bobine effectivement chargée après l’envoi reste à observer.

Le propriétaire confirme que le lancement depuis Cloud Page fonctionne lorsque le champ « Ordre des bobines pour l’impression » est renseigné. Lors de l’essai sur un G-code déjà en mémoire, il a saisi l’emplacement 1. La machine a démarré avec la bobine 3, puis l’impression a été arrêtée. Le refus 10115 avait été constaté sur un autre fichier. L’effet du champ vide reste à vérifier en reprenant le même G-code.

Avec une doublure, la version de travail envoie le premier matériau vers l’indice ACE 0 pour la sélection 1 et vers l’indice 2 pour la sélection 3, même lorsqu’elle reçoit un état indiquant la bobine 3 chargée dans la tête. Elle envoie une affectation ACE nulle si le champ reste vide. La sérialisation ne confirme pas la façon dont le Cloud ou le micrologiciel utilise cette affectation.

1. Reprendre le G-code déjà lancé avec succès et comparer depuis Cloud Page le champ vide et la sélection 1. Garder les mêmes options de préparation et relever, avant chaque essai, la bobine déjà chargée. Observer le premier état machine et la bobine qui alimente réellement la tête, puis arrêter l’essai.
2. Si le démarrage réussit mais que l’emplacement diffère, lancer le même fichier depuis l’écran ou la vue du stockage de Slicer Next, si disponible, avec la même affectation. Cette observation permet de comparer la sélection de bobine entre les parcours.
3. Si le lancement mémoire échoue également dans le client officiel, tester l’envoi d’un G-code compatible déjà tranché via le parcours temporaire corrigé par #398.
