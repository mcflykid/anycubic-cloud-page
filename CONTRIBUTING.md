# Contribuer

Les contributions utiles incluent les résultats sur d’autres modèles, les changements de protocole documentés, les correctifs de session et les améliorations d’accessibilité.

1. Ouvrir une issue avec le modèle/firmware et un parcours précis, sans identifiant personnel.
2. Limiter la modification à la fonction concernée et préserver les crédits amont.
3. Ajouter un test lorsqu’il protège une règle de protocole, une association de fichiers ou un garde-fou.
4. Exécuter les commandes de test du README et `python scripts/update_assets.py` après une modification CSS/JS.
5. Vérifier l’interface sur ordinateur et téléphone ; régénérer les captures avec `app/demo.py` pour éviter toute publication de données privées.
6. Décrire ce qui est simulé et ce qui a été réellement observé. Une commande acceptée n’est pas une preuve physique.

Les scripts de préparation récupèrent les dépendances depuis des sources épinglées. Ne recopiez pas les fichiers de `runtime/` dans le code pour simplifier une installation. Une pull request ne doit pas rendre les commandes réelles accessibles sans authentification.
