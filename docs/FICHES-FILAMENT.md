# Créer une fiche filament

Une fiche personnelle se consulte depuis **ACE et filaments** en cliquant sur le nom d’un emplacement, par exemple **Emplacement 3 · PLA Marble**. Les caractéristiques de la fiche décrivent le filament. Le restant et l’identification RFID affichés dans la fenêtre proviennent de l’ACE.

## Préparer la fiche

1. Ouvrez la fiche technique de la bobine et relevez les valeurs applicables à sa référence exacte. Utilisez une adresse HTTPS publique sans paramètres d’accès.
2. Copiez l’exemple ci-dessous dans un fichier texte UTF-8 nommé `mon-filament.json`. Remplacez le nom, le lien et les valeurs par ceux de votre bobine. Supprimez les champs inconnus. Les nombres utilisent un point comme séparateur décimal.
3. Ouvrez un emplacement dans l’atelier, dépliez **Créer sa fiche filament**, puis choisissez le fichier dans **Importer une fiche JSON**.
4. Vérifiez le nom et les valeurs affichées. La fiche reste disponible dans le sélecteur de ce navigateur. Réimporter le même nom remplace sa version précédente. Gardez le fichier JSON pour le réimporter sur un autre appareil.

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
