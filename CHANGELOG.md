# Changements

## 2.2.0 — 2026-11-14

- Ajoute une chronologie interactive dans l’onglet Imprimante. Les repères de la frise ouvrent les événements dans la carte, qui affiche leurs heures et leurs durées (#459).
- Réunit températures et ventilation dans un seul tableau et adapte la Vue mur au paysage et au portrait, avec un bouton de sortie à droite de l’heure.
- Retravaille la recherche rapide, l’évaluation d’une impression, les réglages de détection IA et les confirmations de séchage et de suppression de fichiers.
- Ajoute un aperçu fictif des alertes ACE dans les réglages Discord et regroupe les règles d’apparence dans un seul document HTML.

## 2.1.1 — 2026-11-14

- Préserve les compteurs MQTT récents face aux instantanés REST. Une valeur `-1` n’écrase plus le suivi de l’impression (#444).
- Affiche l’espace utilisé par les originaux et permet de retirer un fichier archivé. Les copies partagées restent disponibles pour les autres tâches (#446).
- Inclut le temps restant de l’impression active dans « Fin si enchaînée ». L’heure est masquée si une durée manque (#447).
- Corrige les températures et complète les couleurs, les propriétés et les références des fiches PLA Basic (#450).
- Ajoute un carnet d’entretien de la Kobra S1 en français, avec neuf fiches et des schémas originaux (#452).
- Rend les écrans ACE, Fichiers, Historique et Réglages plus compacts. Aligne le contenu de Sécurité et Discord sur Apparence et recentre le bouton de suppression du journal (#454).

## 2.1.0 — 2026-11-14

- Indique la provenance et la fraîcheur des températures, de la ventilation et des mesures ACE (#412).
- Suit les demandes de séchage manuel jusqu’à un retour du boîtier ciblé ou un état à vérifier (#413).
- Ajoute la sauvegarde et la restauration privées d’`appdata` et le transfert des fiches personnelles du navigateur (#414).
- Explique les associations RFID et ajoute quatre références régionales PLA Basic confirmées par Anycubic (#415, #416).
- Détaille les incidents Cloud et MQTT dans le diagnostic expurgé et ajoute des états fictifs ACE à deux boîtiers (#417, #418).
- Permet d’importer et de télécharger les originaux tranchés depuis le détail d’une impression (#419).
- Documente les preuves attendues pour le séchage combiné et le timelapse (#421).
- Fiabilise la provenance des mesures, l’affichage des valeurs anciennes et la confirmation du séchage, avec des tests d’intégration (#424, #425, #426, #427, #428, #429, #430, #431, #432, #433).

- Regroupe le catalogue par gamme avec filtres et pastilles de couleur. Les fiches mettent en avant les réglages d’impression et la configuration des bobines indique le filament restant par emplacement (#434, #435, #436).
- Met le diagnostic en tête des détails d’une tâche, signale les métadonnées partielles et affiche une frise chronologique à l’échelle (#437, #439).
- Affiche les totaux de la file d’attente, les filaments manquants et le contrôle « Plateau libéré » (#438).
- Distingue les boutons désactivés même en contraste élevé et rapproche la fenêtre de lancement de Slicer Next avec des tuiles filament et des options visibles (#440, #442).

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
