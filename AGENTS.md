## Annotations du code
- Langue : français.
- Python : une docstring courte pour chaque module, classe et fonction publique (rôle, paramètres non évidents, valeur de retour, exceptions levées).
- JavaScript (web/js) : un commentaire JSDoc court pour chaque fonction exportée ou appelée depuis le HTML.
- Les commentaires expliquent POURQUOI : une contrainte, un comportement du cloud Anycubic, un piège, une décision. Un commentaire qui répète ce que fait le code est interdit.
- Modifier du code, c'est mettre à jour ses annotations dans le même changement. Une annotation devenue fausse est un bug.
- Les annotations restent courtes : une ligne si possible, trois au maximum hors docstring.

## Publication d'une version
Chaque livraison terminée et testée reçoit un numéro inédit. Une livraison peut regrouper plusieurs commits avant sa publication finale.
1. Numéro : correctif ou commentaires → correctif suivant ; nouvelle fonction → version mineure suivante. Demander en cas de doute.
2. Mettre à jour les références de version et le changelog en français.
3. En local : tests Python, contrôle JavaScript et contrôle de publication. Les tests Docker s'exécutent uniquement dans GitHub Actions ; ne pas installer de moteur Docker pour les lancer localement.
4. Respecter les branches et les validations demandées. Une branche de travail ne doit pas publier d'image ni déclencher de déploiement.
5. Lors d'une publication explicitement autorisée : commit et tag de version, suivi des workflows avec `gh run watch`, puis vérification de l'image publiée. Arrêter la procédure en cas d'échec.

## Confidentialité et périmètre public
- Ne publier ni identifiant privé, ni domaine d'exploitation, ni adresse privée, ni chemin personnel. Les documents et données propres à une installation restent hors du dépôt public et de l'image.
- Ne jamais afficher de secret, de jeton, de mot de passe ou le contenu d'un fichier d'environnement.
- Contrôler les fichiers, les images et leurs métadonnées avant publication. Les valeurs privées à rechercher sont fournies localement ou par un secret CI ; elles ne figurent jamais dans le code ni dans les sorties de tests.
- Les tests d'interface utilisent les données fictives de `app/demo.py`. Ne jamais envoyer de commande physique à une imprimante pour tester ce projet.
- Conserver les licences et avis des composants tiers ; documenter toute reprise de code.
