# Captures de l’interface

Captures de la démonstration authentifiée, produites avec `scripts/capture_demo.cjs`. Toutes les données sont fictives. Aucun compte utilisateur, token, identifiant d’imprimante ou flux vidéo privé n’est visible.

| Capture | Onglet / détail |
| --- | --- |
| [00-connexion.jpg](00-connexion.jpg) | Formulaire français avant connexion, identifiant fictif et mot de passe vide. |
| [10-session.jpg](10-session.jpg) | Atelier authentifié de démonstration, fuseau et déconnexion visibles. |
| [01-imprimante.png](01-imprimante.png) | Vue imprimante, projet, températures et courbes. |
| [02-ace-filaments.png](02-ace-filaments.png) | ACE, emplacements, RFID et séchage. |
| [03-fichiers.png](03-fichiers.png) | Navigation et actions sur les fichiers. |
| [11-dossiers-cloud.png](11-dossiers-cloud.png) | Dossier Cloud, sélection de fichiers et destination fictifs. |
| [04-envoyer-imprimer.png](04-envoyer-imprimer.png) | Envoi de G-code et ordre des bobines. |
| [05-camera.png](05-camera.png) | Lecteur, éclairage et axes ; illustration de démonstration, pas un flux réel. |
| [06-historique.png](06-historique.png) | Cartes, statuts, dates, recherche et sélection de fiches. |
| [07-reglages.png](07-reglages.png) | Connexion, versions et réglages. |
| [08-notifications.png](08-notifications.png) | Cloche, compteurs, filtres, recherche et actions sur les messages. |
| [09-detection-ia.png](09-detection-ia.png) | Fenêtre de détection IA. |
| [12-resume.png](12-resume.png) | Résumé du projet et de l’ACE. |
| [13-parc-et-sante.png](13-parc-et-sante.png) | Indicateurs locaux et disponibilité. |
| [14-statistiques.png](14-statistiques.png) | Mesures par appareil et par emplacement. |
| [15-journal.png](15-journal.png) | Journal historique depuis l’onglet Historique. |
| [16-fiche-erreur.png](16-fiche-erreur.png) | Fiche locale du code 10115. |
| [17-six-styles.jpg](17-six-styles.jpg) | Comparaison des six styles avant Prisme. |
| [18-code-temporaire.png](18-code-temporaire.png) | Étape de vérification, formulaire vide. |
| [19-resume-sombre.png](19-resume-sombre.png) | Résumé en mode sombre. |
| [20-supervision-sombre.png](20-supervision-sombre.png) | Supervision en mode sombre. |
| [21-resume-mobile.png](21-resume-mobile.png) | Résumé sur téléphone. |
| [22-detail-supervision.png](22-detail-supervision.png) | Détail des relevés dans Parc et santé. |
| [23-prisme-sombre.png](23-prisme-sombre.png) | Prisme sur ordinateur, en mode sombre. |
| [24-prisme-mobile.png](24-prisme-mobile.png) | Prisme sur téléphone, en mode sombre. |

Pour les refaire : installer les dépendances de développement et Chromium Playwright, puis lancer `node scripts/capture_demo.cjs` depuis la racine. Le script démarre uniquement `app/demo.py --auth`, crée un fichier temporaire de mot de passe fictif et ferme ce serveur après capture. `UI_PYTHON` permet de choisir l’interpréteur Python du projet. Aucun moteur Docker n’est nécessaire.

La capture de session présente deux noms d’imprimantes fictifs pour illustrer le sélecteur. Le navigateur des captures utilise le français. Les captures de bureau mesurent 1 440 × 1 000 px. La vue mobile mesure 390 × 844 px. Ne jamais utiliser un compte réel pour produire les images publiques.

## Comparaison historique des styles conservés

Chaque planche compare la version 1.8.0 et la revue de l’interface, en clair, en sombre et à 390 px en clair. Les vues sont recadrées pour montrer les changements au même emplacement.

- [Par défaut · Statistiques](design/standard.jpg)
- [Apple Design · Imprimante](design/apple.jpg)
- [Blueprint · Imprimante](design/blueprint.jpg)
- [Aurore · Imprimante](design/aurora.jpg)
- [Laboratoire · ACE et filaments](design/lab.jpg)
