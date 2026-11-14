# Changements

## 2.0.0 — 2026-11-14

Première version publique de référence d’Anycubic Cloud Page. Cette édition présente les fonctions disponibles dans l’application.

### Atelier et impression

- Suivi en direct de la progression, des couches, des températures et de la ventilation. L’heure de fin prévue suit le temps restant annoncé par l’imprimante (#383, #384).
- Chronologie des phases de l’impression, commandes de pause, reprise et arrêt selon l’état de la machine. Sur Kobra S1, le lancement d’un paquet tranché depuis la mémoire avec affectation ACE a été observé. Le nivellement est proposé par défaut et peut être décoché. La détection IA apparaît comme bêta (#389, #394, #408).
- Vue mur dédiée avec retour à l’atelier. Interface adaptée au téléphone et à l’ordinateur, avec cinq langues et trois styles (#387).

### ACE et filaments

- Affichage des emplacements, du filament engagé, du niveau restant rapporté, du relais automatique, de la température et de l’humidité.
- Catalogue Anycubic consultable à tout moment. Les SKU reconnus ouvrent leur fiche et les références inconnues peuvent recevoir une fiche personnelle. Les fiches indiquent leurs sources quand elles sont disponibles (#392, #405).
- Conseil de séchage au repos après une humidité durable, avec seuil modifiable. Le séchage manuel reste une commande distincte. Les modes combinés de séchage et de lancement restent indisponibles (#331, #344).

### Fichiers, historique et alertes

- Navigation dans la mémoire, la clé USB et le Cloud. Actions adaptées à chaque source et format, aperçu des fichiers et indications de tranchage (#407).
- Historique filtrable avec détails des impressions. Caméra en direct, journal de notifications, aide sur les codes d’erreur connus et alertes Discord configurables (#405).
- Alertes de chauffe avec courbe récente, masquage par épisode et envoi Discord facultatif. Réglages de mises à jour du micrologiciel et notes Anycubic quand le Cloud les fournit (#356, #359).

### Installation

- Un service Docker Compose pour Linux amd64 et arm64, avec données persistantes dans `appdata`, interface authentifiée et option de connexion à deux facteurs.
- Mode de démonstration avec données fictives pour explorer l’atelier. Le projet s’appuie sur les capacités déclarées par chaque modèle. Voir la [compatibilité](docs/COMPATIBILITY.md) et le [guide d’installation](docs/INSTALLATION.md).
