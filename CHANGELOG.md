# Changements

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
