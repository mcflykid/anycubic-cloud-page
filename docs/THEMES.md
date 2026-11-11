# Les sept styles de l’atelier

Suivi : #162.

Les sept styles partagent les fonctions, les données et les confirmations de l’atelier. Le mode clair, sombre ou système reste indépendant du style. Le choix est mémorisé dans ce navigateur; une ancienne préférence pour un style retiré revient à **Par défaut**.

Dans **Réglages → Apparence**, choisir l’un des sept styles dans la liste. La description sous la liste présente le style sélectionné. Les transitions signalent l’ouverture des sections et des fenêtres. Le Laboratoire anime aussi l’arrivée des cartes de statistiques en cascade. Dans le monitoring, la fenêtre de détail part de la carte ouverte. L’atelier s’inspire du détail animé d’[Instrumental](https://moxen.cl/recursos/instrumental/) et du réagencement des cartes de [Parrilla](https://moxen.cl/recursos/parrilla/).

| Style | Disposition | Interaction caractéristique |
|---|---|---|
| Par défaut | Vue directe, cartes de suivi équilibrées. | Navigation discrète, sans réorganisation automatique. |
| Apple Design | Navigation en pilules et surfaces translucides. | Un repère de verre glisse sous la section active. |
| Détaillé | Mesures groupées dans une grille dense. | Les sections compactes gardent les libellés et les séparations. |
| Blueprint | Index vertical numéroté, quadrillage et colonne de travail. | Le panneau latéral se replie en rail d’icônes; le nom complet reste accessible au focus et au pointeur. |
| Aurore | Tableau bento avec machine, travail, températures et détails. | Les cartes se déplacent par glissement ou par commandes haut/bas; l’ordre est mémorisé localement et peut être réinitialisé. |
| Océan | Cartes espacées et surfaces turquoise. | Le repère actif suit les sections avec un mouvement fluide. |
| Laboratoire | Les groupes d’onglets et les compositions expérimentales permettent de comparer plusieurs parcours. | Navigation par usage, avec variantes à explorer. |

Sur téléphone, les neuf sections s’ouvrent depuis un bouton **Sections** dans une grille de neuf tuiles. Elles entrent en vague puis se replient dans l’ordre inverse; le nom de la section choisie reste près du bouton. Le réglage système de réduction des animations retire ces effets et les déplacements de cartes.

Le tableau Aurore n’enregistre que l’ordre des quatre cartes de la page atelier, dans le stockage local du navigateur. Le bouton **Réinitialiser la disposition** restaure leur ordre d’origine. Le glissement fonctionne au pointeur ou au toucher; les boutons de déplacement permettent aussi la réorganisation au clavier.

Les comportements de grille réarrangeable s’inspirent de motifs d’interface comme les widgets qui se dégagent puis se replacent, décrits dans [Parrilla chez Moxen](https://moxen.cl/recursos/parrilla/). Aucun code ni composant du site n’a été repris; sa page indique que les téléchargements comprennent une licence propre à chaque animation.

## Comparaison avec la version 1.8.0

Les neuf onglets et la connexion ont été capturés dans les sept styles. Chaque vue utilise la même démonstration à 1 249 px en clair et en sombre, puis à 390 px en clair. Les [planches avant/après](../screenshots/README.md#comparaison-des-sept-styles) montrent un écran représentatif par style.

| Style | Point à corriger dans la version 1.8.0 | Direction et changements |
| --- | --- | --- |
| Par défaut | Les commandes des courbes et le résumé du parc occupaient plusieurs rangées. | Lecture directe. Période et CSV côte à côte, nom et disponibilité sur une ligne, graphiques regroupés par appareil. |
| Apple Design | La navigation passait sur deux rangées et la sélection manquait de contraste. | Pilules de verre lisibles. Une rangée sur ordinateur, repère contenu dans le menu, couleurs du libellé adaptées au fond. |
| Détaillé | Les détails de supervision perdaient leur lien visuel avec la mesure sélectionnée. | Densité orientée diagnostic. Valeur fixe, accent lors d’un changement réel, détail qui s’ouvre depuis sa carte. |
| Blueprint | Les libellés occupaient la colonne de l’index et se coupaient au milieu des mots. | Plan d’atelier. Colonnes numéro, icône et libellé, rail repliable au clavier, grille de tuiles sur téléphone. |
| Aurore | Une nouvelle réorganisation pouvait interrompre le mouvement des cartes avec un saut. | Tableau modulable. Continuité du mouvement lors d’une nouvelle action, ordre local mémorisé, réinitialisation accessible. |
| Océan | Le repère actif pouvait remonter dans l’en-tête. | Navigation fluide. Repère ancré au menu, trajet aligné sur la section, transitions courtes entre panneaux. |
| Laboratoire | La commande de relais touchait le bord de la fiche de séchage. | Groupes par tâche. Marges de formulaire cohérentes, disposition étroite contrôlée, entrée en cascade des cartes de statistiques. |

Le mouvement courant utilise 180 ms pour un signal et 240 ms pour un panneau, avec une courbe de décélération partagée. Le premier chargement d’une liste attend 240 ms avant de montrer une structure d’attente. Le formulaire de connexion utilise le même rythme et une surface plus opaque pour la lecture. Le changement de mode s’applique directement si le navigateur ou la préférence de réduction du mouvement le demande.
