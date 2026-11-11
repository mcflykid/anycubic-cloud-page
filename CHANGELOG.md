# Changements

## 1.12.2 — 2026-11-12

- Reprend la maquette des commandes courantes avec le schéma de la Kobra S1. Affiche et transmet le réglage de Circulation sur une échelle de 0 à 100 %, au repos et en impression. Partage les détails de la tâche entre Imprimante et Historique (#323).
- Aligne les formulaires Discord des alertes et des bilans sur la maquette. L’adresse du webhook est masquée par défaut. Son affichage exige une nouvelle confirmation du mot de passe web et sa valeur est retirée du champ lorsqu’on la masque ou qu’on quitte la page (#324).

## 1.12.1 — 2026-11-11

- Clarifie l’état des alertes et des bilans Discord. Le formulaire confirme qu’une adresse est enregistrée et la garde masquée (#319).
- Sépare les mesures et l’éclairage, les réglages au repos et les réglages d’impression. Chaque ventilateur affiche sa mesure, sa cible et son bouton d’application, avec confirmation avant l’envoi (#319).
- Supprime le double trait sous les températures, centre l’aide de la caméra et corrige les alignements de la carte ACE. Les emplacements chargés affichent de petites bobines aux couleurs détectées (#319).
- Utilise l’icône du projet comme avatar des alertes et des bilans Discord, y compris pour les messages de test (#320).
- Actualise les captures de démonstration à 1 920 px sur ordinateur et ajoute les vues des réglages au repos et du séchage ACE (#321).

## 1.12.0 — 2026-11-11

- Ajoute dans **Réglages** les alertes Discord de fin et d’échec ainsi que des bilans à 08 h et 21 h, avec deux webhooks distincts (#205, #312).
- Partage quinze fiches d’erreur entre les notifications, l’historique, les commandes et Discord. Ajoute l’aide contextuelle en français, anglais et espagnol (#181, #259).
- Retire Verrière, stabilise la barre latérale Laboratoire et actualise les crédits (#314).
- Uniformise les derniers styles, vérifie le cache des ressources et exclut les archives de référence de l’image (#309).
- Actualise les annotations, les guides, les captures, le registre des sources et la feuille de route (#223, #260, #261, #263).
- Consigne les limites et les preuves restantes pour la validation matérielle et les investigations (#30, #93, #103, #136, #142, #145, #194, #310).

### À vérifier après mise à jour

- Ouvrir **Réglages → Notifications Discord** et configurer deux webhooks distincts si ces canaux sont utilisés. Envoyer un test depuis chaque réglage et vérifier le fuseau du conteneur pour les bilans.
- Consulter les journaux du conteneur et confirmer le retour de la télémétrie et des notifications après reconnexion.

## 1.11.0 — 2026-11-11

### Atelier

- Recompose les dix onglets à partir des maquettes HTML de référence. Aligne les commandes, les cartes et les titres de navigation. Les quatre styles partagent la même mise en page et les mêmes règles de présentation en clair et en sombre. Le menu latéral de Laboratoire reste repliable (#287, #288, #293, #295, #296).
- Retire le cadenas, les dispositions personnalisables et les styles Apple Design, Prisme et Blueprint. Les anciennes préférences de style reviennent à **Par défaut** (#284, #294).
- Illustre le Résumé avec les modèles détectés, identifie les emplacements des bobines et place l’aperçu à droite de la progression dans **Imprimante** (#291, #292).
- Centre les commandes d’axes et maintient le flux dans le cadre de **Caméra**. Aligne les cartes et les commandes de **Statistiques**, avec des courbes distinctes par appareil et par emplacement (#285, #286).

### Notifications

- Affiche une seule fois le résultat traduit de fin d’impression et conserve les diagnostics distincts (#289).
- Retrouve les impressions locales dans l’historique par machine, chemin et seconde de fin. Cherche l’image dans le détail de la tâche et affiche le pictogramme centré quand aucune image exploitable n’est disponible (#290).

## 1.10.0 — 2026-11-11

### Atelier

- Ajoute **Prisme**, un style graphite avec une palette claire, des relevés en tuiles et des onglets regroupés en capsules sur ordinateur (#277, #281).
- Affiche les aperçus après le chargement réel de l’image. Les listes de fichiers et l’historique montrent un état d’attente lorsque les données tardent (#248).
- Réorganise les fichiers Cloud et ajoute un curseur entre mémoire, USB et Cloud. La sélection groupée fonctionne par glissement ou avec Maj + clic. Le formulaire d’envoi présente le fichier en premier et affiche l’ordre des bobines lors d’une demande d’impression (#241, #242, #248).
- Affiche la grille et la cible pendant le déplacement des cartes. Les dispositions sont mémorisées dans le navigateur (#247, #248).
- Place le journal des notifications dans **Historique**. La cloche présente les messages Cloud (#243, #248).
- Corrige la sélection des onglets Apple Design et Aurore, agrandit l’image de l’imprimante et retire les styles Détaillé, Océan, Studio et Observatoire. Une préférence pour un style retiré revient à **Par défaut** (#244, #245, #246).
- Sépare les courbes Buse et Plateau, aligne les quatre courbes de filament par ACE sur ordinateur, corrige les fiches d’historique sous Safari et rapproche la caméra de ses commandes (#238, #239, #240, #264).
- Affiche la moyenne, le 95e centile et le nombre de relevés dans le détail de **Parc et santé**. L’export CSV indique l’attente de la requête. Le relais des bobines et l’évaluation d’une impression ont de nouveaux contrôles visuels (#248).
- Illustre la connexion par une impression couche par couche. Les animations de l’atelier respectent la préférence de mouvement réduit. Les archives des effets adaptés sont référencées dans le registre des sources (#215, #248, #265).

### Sécurité et exploitation

- Ajoute la connexion facultative à deux facteurs par code temporaire, avec dix codes de secours à usage unique et une procédure de récupération. Centre les écrans de sécurité sur ordinateur et téléphone (#221, #273).
- Applique des quotas distincts au mot de passe et aux codes temporaires. Lorsque le seuil global est atteint, les demandes de connexion attendent une vérification séquentielle (#212, #249, #250, #251).
- Enrichit les journaux du conteneur avec les étapes de la caméra et des transferts, ainsi qu’une référence de requête pour le diagnostic (#218).
- Sépare le moteur, les sessions caméra, les transferts et le journal HTTP. Documente l’ordre des verrous et vérifie que la pause et l’annulation restent disponibles pendant les opérations Cloud prévues (#213, #255, #256).
- Calcule les empreintes des ressources web au démarrage et documente le cadre des essais manuels ainsi que le diagnostic historique de lecture des coordonnées (#211, #214, #237).

### À vérifier après mise à jour

- **Réglages → Apparence** propose Prisme. Le journal des notifications se trouve dans **Historique**.
- **Réglages → Sécurité** permet d’activer le code temporaire. Conservez les codes de secours à l’activation. Réservez `WEB_TOTP_RESET=true` à la procédure de récupération et remettez-le à `false` ensuite.
- Pour les journaux du conteneur, `LOG_LEVEL` vaut `INFO` et `LOG_FORMAT` vaut `text` par défaut. Le format `json` est disponible pour la collecte structurée.

## 1.9.0 — 2026-11-11

### Atelier

- Ouvre l’atelier sur **Résumé**, qui réunit l’impression en cours, les températures et l’état de l’ACE. Regroupe les dix onglets par usage et place **Statistiques** avant **Réglages** (#227).
- Ajoute **Studio**, **Observatoire** et **Verrière** aux sept styles existants. Tous donnent accès aux mêmes données et commandes en clair comme en sombre (#230).
- Permet de déplacer et de redimensionner les cartes après ouverture du cadenas. La disposition est mémorisée par onglet dans le navigateur et peut être exportée, importée ou réinitialisée depuis **Réglages** (#229).
- Réorganise la cloche, rapproche l’aperçu du nom de fichier en style **Par défaut** et aère les graphiques de **Parc et santé** dans **Laboratoire** sur grand écran (#216).
- Distingue les aperçus absents ou indisponibles, les listes vides et les états de chargement ou d’erreur de la caméra (#228).
- Harmonise les transitions, les chargements de listes et les signaux de changement réel. Respecte la préférence de réduction des animations (#195, #196, #197, #198, #199, #200).

### Fiabilité et sécurité

- Expire les sessions de visionnage caméra abandonnées et laisse passer pause et annulation pendant les lectures longues et les transferts de stockage. Les ordres physiques restent sérialisés (#183, #184).
- Nettoie les transferts STL et 3MF abandonnés, valide les paramètres avant appel au Cloud et exige une impression active pour modifier les réglages d’une tâche (#185, #187, #188).
- Renforce les quotas IPv6 derrière un proxy, fiabilise les réponses de notification et invalide les aperçus des fichiers mémoire ou USB modifiés (#186, #189, #190).
- Suit les échecs de reconnexion MQTT, compare sans distinction de casse l’adresse du compte enregistré et épingle les actions GitHub externes par empreinte (#191, #192, #193).

- Retire la lecture des coordonnées dans Caméra → Déplacer ainsi que sa route et son diagnostic. Les commandes de déplacement restent disponibles (#167).
- Archive les résultats de la recherche sur les délais de lecture des coordonnées et les rattache au dernier commit qui contenait le diagnostic (#211).
- L’ouverture et la fermeture de la caméra laissent passer pause et annulation pendant l’attente d’une lecture. Le verrou d’envoi continue de sérialiser les ordres machine (#206).
- Les mutations du compte Cloud sont sérialisées séparément des ordres machine. Une pause ou une annulation reste disponible pendant un retrait de fiches ou une autre mutation Cloud (#213).
- Le journal des commandes garde l’adresse IPv6 du client. Seul le quota de connexion regroupe les adresses par préfixe /64 (#207).
- Les spectateurs caméra sans signal expirent en trois minutes, au plus tard à la fin de leur session web. Le navigateur renouvelle la présence localement pendant l’affichage de la vidéo (#208).
- La chaîne des proxys est lue jusqu’au premier client identifié ou élément illisible. Un plafond temporaire s’applique aux refus de connexion répartis entre les adresses (#209).
- Lorsque le seuil global est atteint, les tentatives de connexion sont vérifiées l’une après l’autre avec une seconde d’attente. Les identifiants valides restent acceptés et le quota par adresse reste prioritaire (#212).
- Les statistiques affichent le nom de la machine et regroupent les courbes sous le nom de chaque ACE. Les commandes CSV et le résumé du parc tiennent sur une ligne.
- Corrige l’alignement du menu Apple Design, les libellés Blueprint et le repère de sélection Océan. Le style se choisit dans la liste Apparence.
- Anime les ouvertures de sections et de fenêtres selon le style et la préférence de mouvement. Corrige les marges du séchage dans Laboratoire.

## 1.8.0 — 2026-11-11

- Six styles conservés et quatorze retirés, avec migration des préférences ; Blueprint et Aurore sont retravaillés. Aurore propose des cartes réordonnables et mémorisées ; Apple et Océan ont un repère de navigation animé. Un septième thème Laboratoire réorganise les neuf sections par usage et explore les compositions de toutes les pages (#162, #174).
- Navigation sans barre horizontale : les sections restent visibles sur ordinateur et s’ouvrent en tuiles sur téléphone. Construction en vague, désassemblage, interruptions et réduction du mouvement sont gérés ; l’accès rapide ajoute une recherche de sections au clavier (#160, #162).
- Sélection des fichiers Cloud par glissement souris ou tactile et Maj+clic, avec volume connu et barre contextuelle. La place de la barre est réservée pour éviter que les lignes bougent sous le doigt ; les actions gardent leurs confirmations (#163).
- Connexion en verre avec affichage du mot de passe, attente réelle et erreurs accessibles. Le formulaire conserve le POST serveur et le remplissage automatique ; le thème Laboratoire accompagne aussi la connexion et les notices (#165, #174).
- Neuf cartes de monitoring local avec détail, courbes, pauses et fenêtres de relevés, sans nouvelle collecte Cloud. Les sources, unités, données absentes et valeurs de démonstration sont explicites (#164).
- Marquage RFID intégré au flasque de la bobine ; les états identifié, manuel et inconnu restent distincts. Température et humidité ACE sont côte à côte sur ordinateur, empilées sur mobile, avec le même nom de module (#161, #171).
- Chaque ligne de log texte ou JSON porte la version embarquée. Un protocole de diagnostic évolutif relie hypothèses, état initial, logs, observations, limites et tests de régression ; les annotations du nouveau code sont en français (#173, #175).
- Budget HTTP partagé du compte, conservé après reconnexion : départs espacés et pause sur HTTP 429/Retry-After, sans nouvelle authentification ni rejeu automatique. L’interface respecte aussi le délai annoncé (#169).
- L’envoi reste désactivé tant qu’une imprimante explicite n’est pas sélectionnée. Une explication visible accompagne les modes d’impression grisés selon le format ; le stockage Cloud reste disponible (#176, #177).
- L’export CSV ignore toute réponse devenue obsolète après changement de période ou de cible. Son état est séparé de celui des courbes afin qu’une lecture concurrente n’efface pas l’annulation (#159).
- Les codes de notification ouvrent une fiche de diagnostic dans l’atelier. Neuf codes ont une explication et des vérifications ; les autres conservent le message constructeur. Le wiki officiel reste une source facultative (#180).
- La déconnexion attend la libération de la session caméra et ferme le flux local avant de révoquer la session web (#178).
- Revue indépendante backend et frontend, tests de régression et comparaison des intégrations externes, dont MMM-Anycubic et les forks publics Wares. Les limites de couverture et les hypothèses matérielles sont documentées (#158, #170).
- Diagnostics de lecture des coordonnées enrichis : phases Cloud/MQTT, durées, réponse manquante distincte et HTTP 504 sans relance. La cause des délais observés sur S1 était alors suivie dans #167 et n’a pas été établie.

## 1.7.1 — 2026-11-11

- Répare l’envoi des fichiers locaux vers le Cloud : la mesure de taille utilisait une fonction inexistante et échouait avant le transfert. Le chemin réel de lecture et le cycle de réservation, transfert simulé et libération sont couverts par des tests sans commande physique (#166).

## 1.7.0 — 2026-11-11

- Catalogue exploratoire de vingt styles, avec galerie et descriptions traduites, palettes et compositions différentes. Anchor Pop, Turn Over, Card Deal, Drum Roll, Outline Trace et Tile Build proposent six effets CSS ; Tile Build adopte une grille bento adaptative. Les animations réduites et le mode clair/sombre sont respectés (#143).
- Journaux de conteneur uniformes dès le démarrage : format texte ou JSON, niveaux INFO/DEBUG, références de requête, étapes et durées. Les échanges privés, secrets et identifiants bruts restent exclus (#139).
- Notifications avec code d’erreur, explication au survol ou au clavier et lien officiel Anycubic. Le code 10115 est expliqué ; le code 200 de fin normale n’est pas une erreur. Une fiche fournie par le Cloud est conservée, sinon le lien indique explicitement le catalogue général (#140).
- L’aperçu courant privilégie l’image et la référence exactes du projet, conserve le nom natif du fichier et ignore les réponses d’un ancien projet. Les notifications conservent côté serveur leurs références d’images ; une absence temporaire est réessayable après cinq secondes (#141).
- Étude documentée des idées de Kobra Mesh Lab et HomeLab Monitor, sans reprise de code ni activation de protocole. Le refus d’un fichier en mémoire signalé par le propriétaire reste non reproduit ; sa sérialisation est couverte et ses prochains cas disposent de diagnostics de format et source (#142). L’étude est suivie dans #144 et ses pistes dans #145 à #152.

- Réorganisation des grilles Détaillé et Apple Design, navigation sur une seule ligne avec défilement mobile, avertissement des axes ancré en bas et statistiques regroupées par imprimante, ACE et filament (#122, #123, #125, #126, #127).
- Retrait du style Minimaliste et retour au style par défaut sans perdre le mode clair/sombre enregistré (#124). Fond Apple Design, surfaces translucides et parallaxe légère respectant la réduction des animations (#129).
- Treize illustrations SVG originales supplémentaires suivent les modèles reconnus, avec repli générique pour les appareils inconnus (#128).
- Catalogue de lecture des matériaux élargi, distinct des neuf valeurs de commande ACE établies. Le formulaire reçoit la liste acceptée par le serveur (#130). Sélecteur du second ACE, cibles de bobines et séchage conservées et dialogues annulés lors d’un changement de module (#131).
- Glossaire ACE et séchage original en français, anglais et espagnol, avec correction des boutons et du vocabulaire de retrait (#138).
- Pages Cloud de l’historique mises en cache avec limites de durée, de taille et de session (#132). Sauvegarde des mesures hors de la boucle asynchrone, sous verrou et par remplacement atomique (#133).
- Champs MQTT informatifs consommés sans modifier les températures et état Kobra X cohérent avec sa phase (#134). HTTP 401 qualifiés avec une seule reprise sérialisée ; aucun rejeu si des données contredisent le refus (#135).
- Avancées #136 : avertissements de matière/couleur et métadonnées manquantes avant envoi ou réimpression ; un firmware en cours confirmé empêche le lancement et le quota connu insuffisant est signalé avant transfert. L’identification des refus constructeur et d’une mise à jour obligatoire reste à établir.
- Avancée #103 : validation du stockage 3MF Zip64 avec bornes et cas malformés. Le lancement des `.gcode.3mf` attend toujours des preuves de protocole. Les autres investigations non conclues sont détaillées dans les notes de protocole (#30, #93, #95, #96, #105, #137).

- Courbes thermiques : export CSV UTC de la période affichée, provenance connue, points sur 24 h et moyennes horaires sur 30 jours, migration et stockage bornés par imprimante (#148, #149).
- Vue Parc et santé sans nouveau collecteur ni commande : disponibilité, fraîcheur et transitions de connexion dédoublonnées; contrat des alarmes connues et des métriques facultatives documenté (#150, #151, #152).
- Étude Mesh : aucune compatibilité Kobra S1 n’est déduite des exports Kobra X; aucune interface ajoutée sans preuve de récupération des mesures (#145, #146, #147).

- Commandes au repos pour la Kobra S1 : températures manuelles bornées par les limites Cloud (y compris JSON encodé), un ventilateur par requête, identité et disponibilité relues avant envoi; aucune présélection de matériau (#95).
- Consultation manuelle des coordonnées S1, sans mouvement ni suivi supplémentaire : réponse MQTT corrélée, positions absentes ou invalides explicites, date visible (#96).
- Provenance du compteur d’impressions affichée pour distinguer le cumul Cloud du détail constructeur de repli (#105). Les lancements mémoire/USB de formats non qualifiés sont refusés avant envoi comme dans le parcours Cloud (#103, #142).
- Recherches de protocole approfondies : exports mesh S1, structure du séchage en création de tâches en lot et distinction entre miniature et média timelapse. Les parcours non établis restent suivis dans les issues regroupées (#30, #93, #103, #136, #142, #145).

- Le transport Cloud n’ajoute plus les versions Python/aiohttp dans son User-Agent; les en-têtes explicitement requis restent préservés. Profil Slicer audité et limites d’identification documentées, sans promesse d’indétectabilité (#155).
- Revue des versions amont 0.4.5–0.4.8, de la bêta et des cinq forks directs, avec références de branches et décisions. Qualification ACE 2 Pro des pourcentages selon les états constructeur : les valeurs manuelles ou non chargées restent inconnues, zéro reconnu conservé, sans déduction de marque ou de masse (#93, #156).

## 1.6.0 — 2026-11-06

- L’onglet Statistiques rassemble les courbes de température, d’humidité de l’ACE et de filament restant sur 24 h. Les relevés sont séparés par imprimante et par boîtier, et les courbes de filament indiquent les lacunes et les changements de matière ou de couleur détectés (#120).
- Le compteur d’impressions privilégie le total cumulé utilisé par Anycubic Slicer Next et revient à la valeur de base lorsque le total est absent (#105).
- Apple Design adopte des commandes arrondies, des surfaces translucides et des cartes alignées. Les styles Minimaliste et Détaillé sont disponibles dans Réglages → Apparence.
- L’envoi de fichiers est plus compact. Les commandes de nom et de détection IA sont alignées dans Réglages, et le titre de l’ACE et son état de séchage sont remontés.

## 1.5.0 — 2026-11-06

- Les réglages s’organisent sur deux colonnes sur grand écran. Le style par défaut, Apple Design, Halloween et Noël se choisissent séparément du mode clair, sombre ou système (#102, #118).
- La vue Imprimante aligne le résumé, les mesures et les courbes. Les métriques indiquent leurs unités et la fenêtre de détail garde son en-tête accessible sur un écran court.
- L’Espace Cloud et les fichiers de l’imprimante partagent la recherche et le tri. La navigation Cloud distingue la racine, le dossier courant et la vue de tous les fichiers (#112).
- L’envoi Cloud accepte le stockage de modèles STL et 3MF avec contrôle de structure côté serveur. Le lancement direct reste réservé aux fichiers .gcode (#103).
- L’historique adopte des cartes harmonisées et un calendrier de période utilisable au clavier (#114, #115).
- Les illustrations suivent le matériel reconnu. Les images Kobra S1 et ACE 2 Pro sont servies via le préfixe de l’atelier et disposent d’un repli (#37, #111).
- Le PLA Glow reconnu en blanc à lueur bleue affiche une bande indicative. Les variantes PLA Marble sont identifiées par matière et couleur. Les matières et couleurs reconnues par RFID sont protégées côté serveur (#117, #93).
- Les mesures récentes de température et d’humidité de l’ACE sont conservées indépendamment entre deux relevés HTTP. La pastille de séchage s’aligne à droite.
- L’atelier applique le même relevé HTTP au modèle de l’imprimante et à ses capacités. L’écart de compteur entre clients reste à comparer (#105).
- Le pavé d’axes dispose de pas visibles et d’un avertissement. Le format de l’ordre d’ouverture Agora est confirmé par le module officiel (#20).

## 1.4.2 — 2026-11-06

- Une redirection ou une coupure après l’envoi d’un ordre sensible ne rejoue pas la demande. Une erreur après le début d’un transfert Cloud conserve un résultat inconnu et la protection contre les doublons (#77).
- Les mesures ACE suivent l’identifiant du boîtier. Le support interne Kobra X reste distinct de l’ACE (#93, #37).
- Deux demandes simultanées de miniature ne confondent plus une recherche en cours avec un aperçu absent (#36).
- Si l’illustration du matériel ne charge pas, l’atelier affiche une silhouette de secours (#111).
- L’Espace Cloud affiche le quota une seule fois et masque le chemin réservé au stockage de l’imprimante (#112).
- Les libellés du pavé des axes sont centrés dans leurs secteurs (#113).

## 1.4.1 — 2026-11-06

- Pause, Reprendre et Arrêter restent désactivés jusqu’à la réception de l’état de l’impression. Une confirmation ouverte conserve la référence du projet affiché à son ouverture (#109).
- Cette première publication de la série 1.4 inclut les changements de la 1.4.0 détaillés ci-dessous.

## 1.4.0 — 2026-11-06

- La cloche lit directement les notifications du Cloud utilisées par Anycubic Slicer Next, avec filtre des non-lus, compteur et aperçus. Le journal historique conserve ses actions de lecture et de suppression (#104).
- Navigation dans les dossiers Cloud et déplacement de fichiers vers un dossier existant après confirmation (#31).
- Mode clair, sombre ou automatique dans Réglages. Cartes Imprimante et ACE moins hautes, grand aperçu d’impression à droite, bobines colorées et raccourci de séchage. Réglages réorganisés et fenêtres de détails moins hautes (#106).
- Glisser-déposer des G-code, détails de fichiers et liens d’aperçu contrôlés. Nettoyage des fichiers temporaires d’envoi (#81, #82, #97).
- Requêtes MQTT corrélées et mises à jour de l’atelier sérialisées. Le renouvellement du jeton vidéo vérifie le canal Agora actif (#79, #80, #87).
- Actualisation et journal des commandes plus robustes, écritures de préréglages atomiques et contrôle des requêtes centralisé (#84, #85, #86, #88, #89, #92).
- Historique paginé après fusion des imprimantes. La pause et le nivellement sont distingués, une estimation nulle reste inconnue et le badge RFID indique la reconnaissance de la puce (#90, #91, #93, #94).
- Diagnostic exportable lorsque le Cloud est indisponible, échéance du jeton visible et chemin des journaux Flatpak documenté (#83, #98, #99, #100). Le séchage peut reprendre le préréglage du matériau chargé (#101).

- Chaque nouvelle release ouvre une discussion dans la catégorie Annonces (#108).

Les parcours de notifications et de dossiers Cloud ont été vérifiés sur des réponses fictives. La galerie Timelapse, la chauffe au repos et la lecture des coordonnées étaient alors suivies dans #30, #95 et #96.

## 1.3.1 — 2026-11-06

- Ouverture caméra envoyée une seule fois par clic, y compris après une coupure réseau ou une réponse HTTP temporaire (#76).
- Refus avant envoi distingué d’un résultat incertain après transmission. Le même identifiant de demande conserve ce résultat sans nouvel envoi (#77).
- Collecte des températures maintenue après une erreur inattendue sur un relevé (#78).

## 1.3.0 — 2026-11-06

- Sélecteur français, anglais et espagnol, avec repli automatique en français si le catalogue de traduction manque ou tarde à répondre (#55).
- Commandes de température, ventilation et éclairage regroupées dans l’onglet Imprimante. Pavé de déplacement arrondi (#43, #44).
- Illustrations choisies selon le modèle signalé et la génération d’ACE détectée. Un visuel générique couvre les modèles inconnus (#37).
- Miniatures des notifications associées à la bonne imprimante et chargées à la demande. Les recherches simultanées partagent une lecture des projets (#36).
- Fermeture du flux caméra au départ du dernier onglet suivi. Les réponses tardives sont ignorées (#64).
- Session renforcée et nouvelle vérification du mot de passe avant les actions sensibles (#69).
- Journal des commandes avec export filtré et rapprochement des confirmations MQTT (#70).
- Interface découpée en modules et transport de compte partagé explicitement entre les imprimantes. Le contrôle de formatage Python fait partie de la CI (#66, #67, #68).

La caméra et les miniatures de notifications ont été validées sur des réponses simulées. La galerie Timelapse reste désactivée. La validation selon le micrologiciel, les références de téléchargement vidéo et les dossiers cloud restent suivis dans #20, #30 et #31.

## 1.2.10 — 2026-11-06

- Les scripts, styles, illustrations et notices empruntent le préfixe déjà utilisé par l’atelier. Les proxys qui transmettent `/imprimante-api/*` servent ces ressources avec leurs règles existantes.
- La pastille d’état du module ACE s’ajuste à son libellé.
- Un indicateur discret s’affiche pendant le chargement des miniatures dans Fichiers.

## 1.2.9 — 2026-11-06

- Rétablissement des illustrations d’origine dans Imprimante, ACE et filaments, et la carte Imprimante des Réglages pour la Kobra S1 Combo, même lorsque la génération de l’ACE n’est pas fournie. La génération est détectée via le nom de boîtier fourni par Anycubic dans les données de micrologiciel (#37).
- États imprimante, ACE et séchage sous forme de pastilles, texte RFID raccourci et aide sur le relais des bobines. Barre de navigation plus compacte et pastilles de fin centrées dans l’historique. Le panneau de notifications vide reprend le logo du projet.
- Miniatures directement devant les noms dans Fichiers, avec agrandissement au clic.
- Retrait temporaire du choix de langue et de sa dépendance JavaScript. La localisation complète reste suivie dans #55.
- Galerie Timelapse désactivée temporairement en attendant une vidéo de validation (#30).
- Guide reverse proxy complété pour les ressources statiques et les notices introduites en 1.2.8.

## 1.2.8 — 2026-11-06

- Conservation de l’imprimante par défaut pendant la reconnexion du compte et reprise des relevés de température des imprimantes secondaires (#48, #56).
- Transfert des G-code depuis un fichier temporaire avec lecture bornée. Un envoi signé refusé déclenche la demande de libération du quota (#58, #24).
- Diagnostic des réponses d’ouverture vidéo et demande de fermeture au départ du dernier spectateur connu de l’atelier. Le protocole a été vérifié sur des échanges simulés (#20, #64).
- Déplacement des sessions historiques vers le dossier privé, refus du changement de compte sur un dossier déjà associé, et lecture des journaux du slicer par fenêtres de taille fixe (#62, #61, #51).
- Pagination des fichiers cloud, disponibilité des actions d’impression et nouvelles tentatives bornées pour l’aperçu du projet courant (#54).
- Aperçus de notifications préservés lors du rafraîchissement de l’historique, et message explicite lorsque la connexion empêche une suppression (#36, #52).
- Préréglage de la durée de séchage si la valeur est valide et gestion des réponses cloud incomplètes (#53, #50).
- Calcul de la période de 90 jours de l’historique en jours calendaires, y compris autour des changements d’heure.
- Détails d’historique par groupe, consommation estimée, présentation compacte sur mobile, évaluation et réimpression depuis les fiches éligibles (#39, #40, #42, #49).
- Sélecteur déroulant du pas de déplacement, croix XY et commandes Z séparées. Les boutons d’éclairage se trouvent dans l’onglet Caméra (#44).
- Compteurs du constructeur, visuels adaptés aux modèles explicitement identifiés et pictogrammes sur les libellés (#37, #38, #41).
- Motifs connus et regroupement des notifications qui partagent une machine, une tâche et un motif explicites (#45).
- Version installée et liens Confidentialité, Conditions, Cookies et Crédits dans le pied de page. Boutons de connexion centrés (#35, #71, #72, #73, #74, #75).
- Recherche et pagination des timelapses lorsque le firmware fournit la liste. Les références de miniatures et les liens de téléchargement restent à confirmer (#30).
- Choix français, anglais ou espagnol mémorisé. La connexion, la navigation et une partie des libellés et confirmations sont traduites. La couverture complète reste suivie dans #55.
- Les dossiers cloud et les déplacements restent suivis dans #31. Le lien entre les références de fichiers et l’arborescence reste à confirmer.

## 1.2.5 — 2026-11-05

- Les réponses de fichiers périmées sont écartées ; les actions restent liées à leur source et à leur dossier (#47).
- Rapports MQTT récents repris de l’amont 0.4.5, avec états ACE partiels, préparation, ventilation, échec vidéo et particularités Kobra X (#63).
- Pause, reprise et arrêt vérifient par HTTP le même projet et son état avant tout envoi (#19).
- Le client MQTT reste récupérable après rejet d’authentification pour permettre sa fermeture puis la reconnexion (#46).
- Compteurs de connexion bornés sans blocage global ; séparation des clients derrière des proxys explicitement fiables via TRUSTED_PROXIES (#59).
- Suspension des connexions après refus explicite du compte et reprise progressive après panne temporaire (#60).
- Délais d’envoi adaptés à la taille ; résultat incertain explicite et identifiant conservé lors d’un nouvel essai manuel dans la même page (#57).

## 1.2.0 — 2026-11-05

Suivi de livraison : #33.

- Fixtures MQTT connues, inconnues et reçues avant initialisation ; compteurs bornés dans le statut, sans payload, topic ni exception brute dans les diagnostics (#23).

- Tests de renouvellement concurrent, repli et refus de changement de compte ; validation des JWT mal formés et diagnostics de session sans réponse privée (#22).

- Diagnostics caméra distincts pour identifiants absents, format invalide et transport non pris en charge ; étapes MQTT corrélées et diagnostics sans références privées (#21).

- Sélecteur multi-imprimantes avec choix mémorisé, cible explicite par requête, états et courbes séparés, et connexion MQTT unique au compte (#32).

- Historique en cartes avec statuts, recherche, dates sur 90 jours, sélection et retrait réel des fiches cloud après confirmation ; arrêt sans répétition sur résultat incertain (#15, #28).

- Inventaire sourcé des capacités cloud, de leur couverture et des paramètres inconnus, établi sans essai sur le cloud (#29).

- Notifications déplacées dans une cloche accessible, avec filtres, recherche et compteur actualisé par le statut habituel (#16).

- Bouton de déconnexion accessible, assorti aux autres actions de la barre du haut ; HOME_URL ne pilote plus que le lien de marque (#14).

- Guides complétés pour domaine partagé, rechargement Caddy, contrôles authentifiés, réseau externe, sondes filtrées, recréation et secrets persistants (#6, #7, #8, #9, #10, #11, #12, #13).

- Compose unique avec réseau local ou proxy externe sélectionné par PROXY_NETWORK, image latest par défaut et données sous ./appdata sans réglage (#27).

- Actions GitHub mises à jour après validation individuelle des CI Dependabot, sans publication d’image sur les fusions (#26).

- Nom de téléchargement du modèle d’environnement précisé pour les pièces jointes de release (#25).

- Liens de suivi, règles de contribution et badges de release, issues, milestone et dernier commit dans les README (#18).

- Publication des images et releases réservée aux tags de version, après validation du numéro, du changelog et de tous les tests (#17).

## 1.1.0 — 2026-11-05

- Connexion française par formulaire, sessions limitées, déconnexion, limitation des échecs et protection Origin.
- Atelier autonome : suivi cloud et MQTT, fichiers, ACE et filaments, caméra, historique et réglages.
- Un service Compose unique, avec préparation intégrée et lancement du serveur sans droits root sous PUID/PGID.
- Données persistantes regroupées dans appdata ; secrets conservés pour permettre le redémarrage avec les mots de passe retirés de l’environnement.
- Paramètres visibles, identifiant web modifiable, mot de passe de six caractères minimum et liens HOME_URL configurables.
- Accès local ou réseau externe partagé avec un proxy HTTPS existant, sans port hôte dans ce dernier cas.
- Limites de ressources, racine en lecture seule, initialisation des processus et fuseau horaire configurable.
- Contrôles de confidentialité génériques et privés, tests Python/JavaScript et installations Docker vérifiées dans GitHub Actions.

- Arrêt du séchage correctement ciblé sur chaque ACE, avec conservation de l’arrêt global et du cas mono-ACE.
- Fin de l’état de mise à jour ACE sur succès explicite, y compris pour une version identique.
- Demandes caméra limitées à une seule nouvelle tentative sur panne de transport reconnue, sans délai cloud supposé.
- Annotations de protocole précisées et contrôle JPEG étendu aux commentaires, EXIF et XMP.
