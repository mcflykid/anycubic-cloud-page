# Règles communes de l’atelier

Le même vocabulaire visuel s’applique au Résumé, aux Réglages, aux Fichiers, à la Caméra et aux autres écrans. Les valeurs de référence se trouvent dans [atelier-tokens.css](../web/css/atelier-tokens.css). La police Inter est servie avec l’application, avec les graisses 400 et 600 et une police système de secours.

| Usage | Taille et interligne |
| --- | --- |
| Nom de la machine | 28 / 36 px |
| Titre d’onglet | 20 / 28 px |
| Titre de carte | 16 / 24 px |
| Texte, valeur, bouton | 14 / 20 px |
| Libellé, aide | 13 / 20 px |
| Groupe, mention | 12 / 16 px |

Les mesures utilisent des chiffres tabulaires. Leur valeur suit le libellé à 8 px. Les mesures voisines sont espacées de 24 px. Les pas d’espacement sont 4, 8, 12, 16, 24 et 32 px. Les cartes ont un trait de 1 px, un rayon de 10 px et une marge intérieure de 16 px. L’en-tête et le pied partagent les mêmes séparations entre cartes voisines. Une action seule est centrée dans le pied.

Les commandes mesurent 36 px de haut, ou 44 px au toucher. Le rayon des champs, boutons et vignettes est de 6 px. Les pictogrammes mesurent 18 px et leur trait 1,8 px. Les groupes d’onglets ont des titres centrés et un trait de 2 px indique l’onglet actif. Un mot accompagne le repère d’état, dont la forme varie selon l’état.

Les neuf rôles sont le fond, la surface, le texte, le texte secondaire, le trait, l’accent, l’état normal, l’attention et l’erreur. Le mode sombre redéfinit les mêmes rôles. Les couleurs de texte respectent un contraste de 4,5:1. L’accent identifie l’action principale et l’onglet actif. Les ombres sont réservées aux fenêtres et menus ouverts.

Les styles redéfinissent les couleurs, la police et les deux rayons. Le Laboratoire peut utiliser une navigation latérale repliable. Les cartes s’empilent sur téléphone. La réduction des animations du système est respectée.

## Maquettes de référence

Ouvrir [les règles communes](design/maquette/regles.html) et [le Résumé](design/maquette/resume.html) dans un navigateur à 1 440 px. Les onglets du Résumé ouvrent les autres maquettes. Les données de ces pages sont des exemples. Les fichiers utilisent la police Inter locale du projet.

| Écran | Fichier de référence |
| --- | --- |
| Résumé | [resume.html](design/maquette/resume.html) |
| Imprimante | [imprimante.html](design/maquette/imprimante.html) |
| ACE | [ace.html](design/maquette/ace.html) |
| Fichiers | [fichiers.html](design/maquette/fichiers.html) |
| Envoyer | [envoyer.html](design/maquette/envoyer.html) |
| Caméra | [camera.html](design/maquette/camera.html) |
| Historique | [historique.html](design/maquette/historique.html) |
| Parc et santé | [parc.html](design/maquette/parc.html) |
| Statistiques | [statistiques.html](design/maquette/statistiques.html) |
| Réglages | [reglages.html](design/maquette/reglages.html) |
| Commandes courantes | [commandes-courantes.html](design/maquette/commandes-courantes.html) |
| Détails de la tâche | [details-tache.html](design/maquette/details-tache.html) |
| Notifications Discord | [notifications-discord.html](design/maquette/notifications-discord.html) |
| Séchage conseillé | [sechage-conseille.html](design/maquette/sechage-conseille.html) |
| Chauffe anormale | [chauffe-anormale.html](design/maquette/chauffe-anormale.html) |
| Notes de version | [notes-version.html](design/maquette/notes-version.html) |

Les [captures des maquettes à 1 440 px](design/maquette/images/) complètent les pages HTML.

## Vérification

Le test de mise en page ouvre les dix sections du jeu de démonstration à 1 366 × 768 et 1 920 × 1 080, dans les trois styles et les deux modes de couleur. Il vérifie que la page tient dans la fenêtre. Les tests sur téléphone vérifient l’absence de débordement horizontal. Les [captures](../screenshots/README.md) sont produites à partir d’un serveur de démonstration.

Le contrôle CI couvre toutes les feuilles CSS de l’atelier. Les tailles de texte de l’interface, les marges et écarts de l’échelle commune, les rayons fixes, les ombres et les palettes claire et sombre passent par le référentiel. Les composants peuvent garder leurs dimensions propres, par exemple pour les illustrations et les zones de tracé. Les exceptions de priorité CSS sont recensées et justifiées dans le test. Les nouvelles feuilles `atelier-*.css` ont aussi un contrôle de leurs autres longueurs et couleurs littérales.

L’inventaire compare les déclarations de `web/css/` avant la refonte et après l’adoption du référentiel. Les références de variables, les seuils de média et les couleurs des SVG incorporés sont exclus.

| Valeurs distinctes | Avant | Après |
| --- | ---: | ---: |
| Tailles et interlignes écrits dans les déclarations de texte | 75 | 6 |
| Rayons | 28 | 3 |
| Marges et écarts | 56 | 24 |
| Marges intérieures | 58 | 15 |
| Ombres | 50 | 11 |
| Couleurs littérales | 301 | 69 |
