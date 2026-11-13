# Créer une fiche filament

Dans **ACE et filaments**, cliquez sur le nom d’un emplacement, par exemple **Emplacement 3 · PLA Marble**. Si une fiche est associée à la bobine, ses caractéristiques s’affichent avec le restant et l’identification RFID rapportés par l’ACE. Si la référence est inconnue, l’atelier ouvre **Créer sa fiche filament**.

## Reconnaissance automatique

Pour une bobine chargée et reconnue par RFID, le serveur compare le SKU de l’emplacement courant aux références commerciales publiées dans les variantes des fiches produit Anycubic. La correspondance doit être exacte et pointer vers une seule fiche embarquée. Le navigateur reçoit le nom de la fiche. Un SKU absent ou inconnu mène à la création d’une fiche personnelle, sauf si une fiche personnelle a déjà été associée dans ce navigateur.

Le [catalogue des SKU](../app/filament-profile-skus.json) reprend les variantes publiques des [fiches produit référencées](../web/js/filament-profiles-data.mjs). Les caractéristiques sont livrées avec Anycubic Cloud Page et consultables sans requête vers une base tierce. Lorsqu’un PDF constructeur a été vérifié, la fenêtre propose aussi **Fiche technique du fabricant (PDF)**. Pour le PLA Glow, la page produit et la fiche technique v3.0 présentent des plages distinctes pour le plateau et la vitesse. Les valeurs affichées suivent la page produit indiquée dans la fenêtre.

## Préparer la fiche

1. Ouvrez la fiche technique de la bobine et relevez les valeurs applicables à sa référence exacte. Utilisez une adresse HTTPS publique sans paramètres d’accès.
2. Copiez l’exemple ci-dessous dans un fichier texte UTF-8 nommé `mon-filament.json`. Remplacez le nom, le lien et les valeurs par ceux de votre bobine. Supprimez les champs inconnus. Les nombres utilisent un point comme séparateur décimal.
3. Cliquez sur l’emplacement de la bobine. Dans **Créer sa fiche filament**, choisissez le fichier dans **Importer une fiche JSON**.
4. Vérifiez le nom et les valeurs affichées. Le prochain clic sur cet emplacement ouvre la fiche enregistrée dans ce navigateur. Gardez le fichier JSON pour le réimporter sur un autre appareil.

L’association tient compte de l’imprimante, du module ACE, de l’emplacement et des données d’identification visibles. Si vous remplacez une bobine par une autre qui a la même matière, la même couleur et le même état RFID, ces données seules ne permettent pas de distinguer les deux bobines.

```json
{
  "name": "Mon PLA Basic Refill Anycubic",
  "url": "https://store.anycubic.com/products/pla-basic-refill",
  "density": 1.24,
  "nozzle": [190, 230],
  "bed": [55, 56],
  "drying": [45, 50],
  "hours": [6, 8],
  "speed": [50, 200],
  "flow": 12,
  "minNozzle": 0.2
}
```

| Champ | Valeur |
| --- | --- |
| `name`, `url` | Nom et lien source, obligatoires |
| `density` | Densité en g/cm³ |
| `nozzle`, `bed`, `drying` | Températures minimale et maximale en °C |
| `hours` | Durée de séchage minimale et maximale en heures |
| `speed` | Vitesse d’impression minimale et maximale en mm/s |
| `flow` | Débit volumique maximal en mm³/s |
| `minNozzle` | Diamètre minimal de la buse en mm |

Pour une valeur unique dans un intervalle, saisissez deux fois le même nombre, par exemple `[50, 50]`. Les fiches sont consultatives. L’atelier conserve ses contrôles habituels pour les commandes d’impression et de séchage. Le [catalogue communautaire](https://3dfilamentprofiles.com/filaments/anycubic) permet de repérer une référence. Les fiches incluses dans l’atelier citent leur source fabricant.
