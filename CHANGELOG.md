# Changements

## À publier

- Diagnostics caméra distincts pour identifiants absents, format invalide et transport non pris en charge ; étapes MQTT corrélées et diagnostics sans références privées (#21).

- Sélecteur multi-imprimantes avec choix mémorisé, cible explicite par requête, états et courbes séparés, et connexion MQTT unique au compte (#32).

- Historique en cartes avec statuts, recherche, dates sur 90 jours, sélection et retrait réel des fiches cloud après confirmation ; arrêt sans répétition sur résultat incertain (#15, #28).

- Inventaire sourcé des capacités cloud, de leur couverture et des paramètres inconnus, établi sans essai sur le cloud (#29).

- Notifications déplacées dans une cloche accessible, avec filtres, recherche et compteur actualisé par le statut habituel (#16).

- Bouton de déconnexion accessible dans la barre du haut ; HOME_URL ne pilote plus que le lien de marque (#14).

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
