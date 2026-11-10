# Vocabulaire ACE et filaments

Le même vocabulaire est employé dans les trois langues de l’atelier. Ces traductions sont originales. Les catalogues du slicer servent uniquement à identifier les fonctions ; aucune chaîne de son catalogue compilé n’est redistribuée.

| Fonction | Français | Anglais | Espagnol |
|---|---|---|---|
| Boîtier de gestion des bobines | Module ACE | ACE unit | Módulo ACE |
| Position locale dans un boîtier | Emplacement | Slot | Ranura |
| Acheminer le filament vers la tête | Charger | Load | Cargar |
| Sortir le filament de la tête | Retirer | Unload | Retirar |
| Court mouvement de rétraction de tranche | Rétraction | Retraction | Retracción |
| Traitement de la bobine par air chauffé | Séchage | Drying | Secado |
| Mesure d’humidité relative | Humidité | Humidity | Humedad |
| Passage à une autre bobine | Relais automatique | Automatic refill | Relevo automático |
| Identification par puce, sans preuve de marque | RFID reconnu | RFID detected | RFID detectado |

« Retirer » concerne le déchargement de la bobine ; « Rétraction » désigne un paramètre de tranche. Les températures sont exprimées en °C, l’humidité en %, la durée réglée en heures et la durée reçue du boîtier en minutes. Le sélecteur de module conserve les commandes dans le boîtier affiché ; un changement de boîtier ferme les dialogues de commande ouverts.

## Catalogue à prévoir pour une langue supplémentaire

Traduire les termes du tableau, les états disponible/hors ligne/inconnu, les confirmations de chargement et retrait, démarrage et arrêt du séchage, les durées restantes, les avertissements RFID, les libellés de couleur, les préréglages et leurs paramètres. Les noms de matières, les modèles et le sigle RFID restent invariants. Vérifier les dialogues et les libellés générés, en plus du texte HTML. Le catalogue `web/js/workshop-translations.json` contient les textes originaux français et leurs traductions anglaises et espagnoles. Une langue non reconnue ou un catalogue indisponible utilise le français.

## Profils et matériaux

Le catalogue de lecture de l’atelier distingue la famille et les variantes commerciales (par exemple PLA, PLA+, PLA Glow). Il reconnaît les noms établis dans les profils S1, notamment PEBA, PET-CF et PA6-CF, sans recopier les profils. PAHT-CF est limité à l’identification du S1 Max. Une matière affichable n’est pas nécessairement modifiable dans l’ACE : les neuf valeurs éditables restent celles dont le client possède un parcours établi. Le serveur transmet cette même liste au formulaire. Une nouvelle valeur de commande attend une preuve de compatibilité ; la présence d’un profil de tranche ne suffit pas.
