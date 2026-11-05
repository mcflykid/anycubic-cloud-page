# Contrôle avant publication

Exécuter `python scripts/check_publication.py` depuis une copie Git du projet.
Le contrôle examine les fichiers suivis et les nouveaux fichiers non ignorés,
y compris les images, les textes PNG compressés et les métadonnées JPEG. Il refuse les fichiers
privés de configuration, les données d'exécution, les clés, les jetons reconnus,
les chemins personnels et les adresses réseau privées. Les adresses de boucle
locale et les adresses réservées aux exemples restent autorisées.

Les valeurs propres à une installation ne doivent pas être écrites dans le
contrôle lui-même. Les fournir dans `.publication-private-patterns`, fichier
JSON local ignoré par Git et exclu de l'image, avec par exemple :

```json
[
  {"regex": "domaine-fictif\\.example"},
  {"regex": "identifiant-fictif"}
]
```

Chaque entrée contient une expression régulière ; une liste de chaînes est
également acceptée. Les correspondances sont insensibles à la casse.
Restreindre les droits de ce fichier à son propriétaire.

Dans GitHub Actions, enregistrer le même JSON dans le secret
`PUBLICATION_PRIVATE_PATTERNS`. Le workflow lance un contrôle générique puis
un contrôle avec ce secret. Sur une copie sans configuration privée, seul le
contrôle générique s'applique ; il ne peut pas deviner un domaine personnel.
Les deux sources de motifs sont cumulées lorsqu'elles sont disponibles.
Une configuration invalide bloque le contrôle sans afficher son contenu.

Les diagnostics indiquent seulement le fichier et la catégorie du problème ;
ils masquent aussi le nom de fichier si celui-ci contient une valeur privée.
Le contrôle automatique ne lit pas le texte dessiné dans les pixels et ne
remplace donc pas la relecture des captures et de leurs métadonnées avant
publication. Utiliser des données de démonstration pour les illustrations.

Pour JPEG, les commentaires, les champs textuels EXIF (dont Unicode) et les textes/attributs XMP sont décodés. Les XMP étendus sont reconstitués même si les segments sont réordonnés. Une métadonnée tronquée, un encodage non pris en charge, un offset incohérent ou une taille excessive bloque le contrôle. Les champs GPS EXIF/XMP sont refusés même lorsqu’ils ne contiennent aucun texte reconnu comme privé. Les entités XML externes ne sont jamais interprétées.

Ce contrôle porte sur les formats textuels reconnus ; il ne décode pas les formats propriétaires internes des fabricants et ne remplace pas l’audit visuel. Références : [Exif, CIPA](https://www.cipa.jp/std/documents/e/DC-X008-Translation-2019-E.pdf) et [stockage XMP, Adobe](https://github.com/adobe/xmp-docs).
