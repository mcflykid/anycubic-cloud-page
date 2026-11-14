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

Pour ajouter une référence personnelle depuis la fiche d’un emplacement, suivre le [tutoriel des fiches filament](FICHES-FILAMENT.md).
## Quantité avant le lancement

Le contrôle compare les grammes par filament fournis par la tranche aux pourcentages qualifiés des bobines affectées. En l’absence de masse nominale précise, il estime le restant sur la base d’une bobine de 1 kg. Une mesure inconnue ou non qualifiée ne déclenche aucune alerte. Lorsque le relais est activé, seules les bobines du même ACE dont la matière et la couleur correspondent, et qui ne sont pas déjà affectées, peuvent contribuer à l’estimation.

En cours d’impression, l’estimation utilise la progression globale uniquement pour une tâche monofilament dont l’atelier identifie une seule bobine engagée de la bonne matière. Le calcul suppose une consommation proportionnelle à la progression. Il ne répartit pas la consommation d’une tâche multicolore sans données par filament.

## Conseil de séchage

L’atelier utilise une fenêtre d’au moins quinze minutes et les préréglages de l’installation. Par défaut, le conseil se déclenche au-delà de 40 % pour le PLA et de 30 % pour les autres matières prises en charge. Le champ « Seuil d’humidité (%) » du préréglage permet de modifier cette valeur. En le laissant vide, on retrouve le seuil par défaut. La fiche Anycubic indique que l’humidité peut remonter après l’arrêt du séchage et indique une limite de 65 °C pour l’ACE 2 Pro. Le conseil ouvre la fenêtre de réglage. Le lancement demande toujours une confirmation. [Conseils Anycubic ACE 2 Pro](https://wiki.anycubic.com/en/fdm-3d-printer/ace-2-pro/warm-tips)
