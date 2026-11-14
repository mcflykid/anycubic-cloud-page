## Annotations du code
- Langue : français.
- Python : une docstring courte pour chaque module, classe et fonction publique (rôle, paramètres non évidents, valeur de retour, exceptions levées).
- JavaScript (web/js) : un commentaire JSDoc court pour chaque fonction exportée ou appelée depuis le HTML.
- Les commentaires expliquent POURQUOI : une contrainte, un comportement du cloud Anycubic, un piège, une décision. Un commentaire qui répète ce que fait le code est interdit.
- Modifier du code, c'est mettre à jour ses annotations dans le même changement. Une annotation devenue fausse est un bug.
- Les annotations restent courtes : une ligne si possible, trois au maximum hors docstring.

## Apparence de l’atelier
- La référence unique pour les critères d’apparence est [Règles communes de l’atelier](docs/regles.html).

## Publication d'une version
Chaque livraison terminée et testée reçoit un numéro inédit. Une livraison peut regrouper plusieurs commits avant sa publication finale.
1. Numéro : correctif ou commentaires → correctif suivant ; nouvelle fonction → version mineure suivante. Demander en cas de doute.
2. Mettre à jour les références de version dans package.json, le CHANGELOG et les guides de livraison, ainsi que le changelog en français avec les issues fermées. Exclure les dépendances installées et package-lock.json des remplacements globaux.
3. En local : tests Python, contrôle JavaScript et check_publication.py, comme dans la CI. Les tests Docker s’exécutent uniquement dans GitHub Actions ; ne pas installer de moteur Docker local pour les lancer. Arrêter en cas d’échec.
4. Un push sur main lance uniquement les tests. Une branche de travail, une pull request ou une fusion ne doit publier aucune image.
5. Pour une livraison explicitement autorisée : commit « Version X.Y.Z : <résumé> », puis tag inédit vX.Y.Z correspondant exactement à package.json et à une entrée unique du CHANGELOG. Ne jamais déplacer un tag publié ni réutiliser un numéro d’image.
6. Pousser main et suivre ses tests avec gh run watch ; une fois verts, pousser le tag. Seul le tag déclenche Publish Docker image, qui valide la version, exécute tous les tests puis construit et publie l’image. Arrêter en cas d’échec.
7. Suivre ce workflow avec gh run watch. Il vérifie l’accès anonyme à l’image amd64/arm64, puis crée la release GitHub à partir du CHANGELOG et joint compose.yaml et .env.example.
8. Vérifier la release, ses pièces jointes et le téléchargement public de l’image. Après un simple push sur main, vérifier qu’aucune publication n’a eu lieu. Les changements de présentation explicitement demandés sans tag restent destinés à la prochaine livraison.

## Suivi des travaux
- Tout travail technique public est suivi dans une issue GitHub, rattachée à la milestone de la prochaine version.
- Un commit qui règle une issue contient « Fixes #N » pour sa fermeture automatique sur main. Si une issue est réglée sans commit, la fermer avec un commentaire qui explique pourquoi.
- Chaque nouveau bug ou nouvelle idée découvert en travaillant donne une issue, pas une note dans le code.
- Le CHANGELOG de chaque version cite les issues fermées (#N).
- Les notes de travail locales ne contiennent que les informations qui ne peuvent pas être publiques ; le suivi public reste dans les issues.

## Confidentialité et périmètre public
- Ne publier ni identifiant privé, ni domaine d'exploitation, ni adresse privée, ni chemin personnel. Les documents et données propres à une installation restent hors du dépôt public et de l'image.
- Ne jamais afficher de secret, de jeton, de mot de passe ou le contenu d'un fichier d'environnement.
- Contrôler les fichiers, les images et leurs métadonnées avant publication. Les valeurs privées à rechercher sont fournies localement ou par un secret CI ; elles ne figurent jamais dans le code ni dans les sorties de tests.
- Tous les tests automatisés, y compris en local et en CI, utilisent des doublures ou les données fictives de `app/demo.py`. Ils n’accèdent à aucun compte Cloud ou appareil réel.
- Conserver les licences et avis des composants tiers ; documenter toute reprise de code.


## Essais manuels sur une imprimante réelle

- Réserver ces essais à l’installation et à l’appareil explicitement autorisés par leur propriétaire. Une autorisation locale ne s’applique pas aux autres appareils ni à la CI.
- Avant un mouvement, une chauffe ou un lancement, contrôler à la caméra que le plateau est dégagé et que l’état de la machine permet l’essai. En cas de doute, attendre la décision du propriétaire. Préserver toute impression déjà en cours.
- Exécuter une commande à la fois. Un essai de lancement, pause, reprise ou annulation s’arrête dès l’observation attendue. Une impression complète, une mise à jour de firmware, une réinitialisation d’usine et la suppression de données antérieures à l’essai sont exclues.
- Après un résultat incertain, vérifier l’état réel avant toute autre commande. Remettre la machine dans l’état constaté au départ, notamment chauffage, séchage, éclairage et caméra.
- Consigner dans la pull request les commandes de l’essai, les observations et l’état final. Les journaux du conteneur peuvent être lus avec l’autorisation du propriétaire. Expurger les secrets, références et données de l’installation avant de publier une observation.
