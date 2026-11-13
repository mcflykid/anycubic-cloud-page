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

Le dépôt accepte le suffixe `.gcode.3mf` dans la commande locale et le journalise sous le format `gcode_3mf`. Le modèle d’ordre, lui, envoie uniquement le nom/chemin et `filetype`; il n’ajoute ni indice de plateau ni référence de contenu. Le parcours de téléversement actuel permet `.gcode`, `.stl` et `.3mf` pour l’enregistrement, mais refuse tout mode `save-print`/`temp-print` dont l’extension n’est pas exactement `.gcode` (`server.py`).

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

- Le serveur recontrôle la présence des bobines sélectionnées avant le transfert éventuel puis à la construction de l’ordre. Le parcours d’envoi et la relance depuis une fiche détaillée affichent une affectation par filament lorsque leurs données de tranche sont disponibles. Les fichiers stockés sans cette information conservent la saisie de l’ordre des emplacements.
- Les écarts de matière et de couleur restent deux avertissements distincts. Le blocage d’un mélange de matières et les réglages de préparation ou de séchage liés au lancement demandent une qualification par modèle et par parcours.
- Le transfert et l’appel d’envoi affichent une progression indéterminée. Le message de démarrage exige un rapport MQTT non retenu avec la signature et la référence de l’ordre attendu, pour la même imprimante. Un relevé de préparation est indicatif et n’est affiché que si un nouveau projet possède la référence attendue du G-code. Au bout de cinq minutes sans rapport corrélé, la fenêtre indique que le démarrage reste non confirmé.
- La confirmation peut être annulée avant émission. Une fois l’ordre engagé, fermer son suivi n’envoie aucune commande à l’imprimante. La vérification du parcours d’annulation pendant le transfert et la validation des rapports sur une Kobra S1 restent à faire.
