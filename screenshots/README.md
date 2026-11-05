# Captures de l’interface

Captures du mode `python app/demo.py`, avec actualisation de la connexion et de la session le 5 novembre 2026. Toutes les données sont fictives. Aucun compte utilisateur, token, identifiant d’imprimante ou flux vidéo privé n’est visible.

| Capture | Onglet / détail |
| --- | --- |
| [00-connexion.jpg](00-connexion.jpg) | Formulaire français avant connexion, identifiant fictif et mot de passe vide. |
| [10-session.jpg](10-session.jpg) | Atelier authentifié de démonstration, fuseau et déconnexion visibles. |
| [01-imprimante.png](01-imprimante.png) | Vue imprimante, projet, températures et courbes. |
| [02-ace-filaments.png](02-ace-filaments.png) | ACE, emplacements, RFID et séchage. |
| [03-fichiers.png](03-fichiers.png) | Navigation et actions sur les fichiers. |
| [04-envoyer-imprimer.png](04-envoyer-imprimer.png) | Envoi de G-code et ordre des bobines. |
| [05-camera.png](05-camera.png) | Lecteur, éclairage et axes ; illustration de démonstration, pas un flux réel. |
| [06-historique.png](06-historique.png) | Tâches et aperçus. |
| [07-reglages.png](07-reglages.png) | Connexion, versions et réglages. |
| [08-notifications.png](08-notifications.png) | Notifications et aperçu associé. |
| [09-detection-ia.png](09-detection-ia.png) | Fenêtre de détection IA. |

Pour les refaire : lancer le mode démonstration, parcourir chaque onglet dans un navigateur, attendre les aperçus visibles puis enregistrer une capture de page entière. Utiliser une capture de fenêtre pour les modales. Ne pas utiliser le compte réel pour produire les images publiques.

Les deux nouvelles captures utilisent `python app/demo.py --auth` avec un fichier de mot de passe fictif passé par `WEB_PASSWORD_FILE` et `PUBLIC_ORIGIN` égal à l’origine locale du navigateur. Elles n’utilisent aucun compte réel. Le mode sans `--auth` reste disponible pour explorer les données fictives.
