# Diagnostic de maillage local

## Décision pour la Kobra S1 Combo

Cloud Page ne propose pas encore de lecteur ni de guide d’import de maillage pour la Kobra S1 Combo. La Kobra X et la S1 n’utilisent pas la même base logicielle, mais cela ne signifie pas qu’aucune donnée ni méthode ne soit commune : la S1 possède bien un maillage de nivellement documenté. En revanche, le parseur de journaux Kobra X ne prouve pas qu’un export S1 ait la même structure.

Le manuel S1 confirme l’auto-nivellement depuis `Tools → Calibration → Auto Level` et un plateau de 250 × 250 mm. Le guide de commandes officiel G9111 pour la S1 utilise `BED_MESH_CLEAR` et `BED_MESH_PROFILE LOAD="default"`, ce qui confirme le profil de mesh nommé `default`; il ne décrit pas son export. Un outil communautaire consacré à la S1 sous Rinkhals indique que le mesh par défaut est une grille 5 × 5 et montre des valeurs de grille exploitables.

Le dépôt public Rinkhals apporte une piste de lecture plus précise : son adaptation Moonraker lit `/userdata/app/gk/printer_mutable.cfg`, entrée JSON `bed_mesh default`, avec `points`, bornes X/Y et dimensions, puis expose ces valeurs via l’objet `bed_mesh`. Son script de démarrage expose ce fichier dans `printer_data/config/printer_mutable.cfg`; son outil de debug bundle copie les fichiers de ce dossier dans un ZIP généré sur une clé USB. Cela laisse penser qu’un debug bundle Rinkhals d’une S1 peut contenir les valeurs mesh dans `config/printer_mutable.cfg`. Ce chemin nécessite Rinkhals et n’est pas l’export natif `AC LOG.pack` / `AC CONF.pack` d’Anycubic. Je n’ai trouvé aucune preuve primaire que les packs stock de la S1 Combo contiennent le mesh.

Le dépôt [Kobra Mesh Lab](https://github.com/GOODvinD/kobra-mesh-lab/tree/4c3b3c10e94ee81b88b85ecfe6e9e642a4abd34) vise la Kobra X. Son parseur attend une archive `.pack` ZIP contenant `avata_main*.log` et reconnaît notamment les lignes `Bed Leveling: Regions:`, `The adaptive Bed region` et `The adaptive Bed points`. Il ne lit pas la représentation JSON `bed_mesh default` de Rinkhals. Les calculs génériques sur une grille régulière pourraient être réutilisés après parsing/validation d’une source S1, mais ce n’est pas une compatibilité d’export ni de parseur.

## Conditions avant toute intégration

Une interface S1 reste absente tant qu’un fichier réellement disponible pour la Kobra S1 Combo stock de l’utilisateur n’a pas été identifié. La voie Rinkhals est une piste documentée, mais elle dépend d’un firmware alternatif déjà installé et de son debug bundle; elle ne justifie pas de demander une installation ni de charger des journaux privés. Un échantillon S1 explicitement fourni ou un fichier de configuration public stable devra confirmer la sérialisation effective, les axes, unités, ordre des points, dimensions, couverture, date et provenance avant d’activer un lecteur.

Après cette preuve, les tests devront couvrir un échantillon synthétique dérivé du schéma établi, les grilles partielles, les données invalides, les limites de fichiers et de décompression, ainsi qu’une comparaison A/B limitée à la couverture commune. Les différences brutes, centrées et retirées d’un plan resteront des valeurs relatives. Aucune sortie ne représentera un écart absolu buse-plateau ni ne déclenchera une commande d’imprimante.

## Sources consultées

- [Manuel officiel Kobra S1 Combo](https://wiki.anycubic.com/kobra-s1/anycubic_kobra_s1_combo_user_manual-en-v1.3.pdf) : dimensions et parcours Auto-Level.
- [Dépannage officiel Kobra S1 Combo](https://wiki.anycubic.com/en/fdm-3d-printer/kobra-s1-combo/layer-shift) : export du journal de panne pour le support, sans description d’un export mesh.
- [Guide officiel de commandes G9111](https://wiki.anycubic.com/en/software-and-app/new-page-anycubic-slicer-beta%28orca-version%29/g9111-command-customization-guide) : profil de maillage `default` mentionné dans les commandes de la Kobra S1, sans méthode d’export des points.
- [Guide officiel d’export des logs Kobra S1 Max](https://wiki.anycubic.com/en/fdm-3d-printer/kobra-s1-max-combo/log-export-guide) : fichiers `AC CONF.pack` et `AC LOG.pack` dans le parcours documenté pour le modèle Max; cela ne démontre pas la compatibilité mesh de la S1 Combo.
- [Documentation officielle Rinkhals — debug bundle](https://jbatonnet.github.io/Rinkhals/guides/generate-debug-bundle/) et [configuration](https://jbatonnet.github.io/Rinkhals/Rinkhals/printer-configuration/) : contenu général de l’archive et rôle de `printer_mutable.cfg`.
- [Code Rinkhals au commit étudié](https://github.com/jbatonnet/Rinkhals/tree/04c690017459a8b4cdceee2eb03125b705bdda1e) : [`start.sh`](https://github.com/jbatonnet/Rinkhals/blob/04c690017459a8b4cdceee2eb03125b705bdda1e/files/3-rinkhals/start.sh) expose le fichier muté, [`debug-bundle.sh`](https://github.com/jbatonnet/Rinkhals/blob/04c690017459a8b4cdceee2eb03125b705bdda1e/files/3-rinkhals/opt/rinkhals/tools/debug-bundle.sh) copie le dossier de configuration et [`kobra.py`](https://github.com/jbatonnet/Rinkhals/tree/04c690017459a8b4cdceee2eb03125b705bdda1e) décode `bed_mesh default`.
- [Documentation officielle Rinkhals de la Kobra S1](https://jbatonnet.github.io/Rinkhals/printers/kobra-s1/) et [Kobra X](https://jbatonnet.github.io/Rinkhals/printers/kobra-x/) : S1 sur GoKlipper et compatible avec Rinkhals; X sur KlipperC++/K4 et non prise en charge par Rinkhals.
- [Outil communautaire de nivellement S1](https://github.com/hkiam/kobra-s1-screws-tilt-adjust) : mention du mesh natif 5 × 5 et référence à son usage sous Rinkhals, sur une seule machine de test.
- [README Kobra Mesh Lab au commit étudié](https://github.com/GOODvinD/kobra-mesh-lab/blob/4c3b3c10e94ee81b88b85ecfe6e9e642a4abd34/README.md) et [parseur au même commit](https://github.com/GOODvinD/kobra-mesh-lab/blob/4c3b3c10e94ee81b88b85ecfe6e9e642a4abd34/app.js).

Aucun code, dépendance, image ou habillage de Kobra Mesh Lab n’est embarqué par cette décision; aucun nouvel avis de licence n’est donc requis.
