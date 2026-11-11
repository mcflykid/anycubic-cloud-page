# Références des interactions

La refonte 1.8.0 utilise les captures fournies par le propriétaire et le
[catalogue Moxen](https://moxen.cl/recursos.html) comme références de comportements.
Une palette de couleurs ne suffit pas : chaque mécanisme doit avoir une action,
un retour compréhensible et un fonctionnement au clavier et sur téléphone.

## Ressources examinées

| Référence | Mécanisme retenu | Application dans l’atelier |
| --- | --- | --- |
| [Lote](https://moxen.cl/recursos/lote/) | Peindre la sélection dans la colonne des cases, Maj+clic, barre contextuelle | Sélection des fichiers Cloud, volume connu et actions existantes avec confirmation |
| [Instrumental](https://moxen.cl/recursos/instrumental/) et capture 435 | Mesures en cartes, historique et agrandissement d’un détail | Monitoring local de l’application, avec unités, sources et absence de données explicites |
| [Parrilla](https://moxen.cl/recursos/parrilla/) | Widgets qui se réorganisent et disposition mémorisée | Cartes de l’accueil Aurore, déplacement et restauration de la disposition |
| [Portada](https://moxen.cl/recursos/portada/) | Un panneau de menu évolue avec le choix courant | Navigation adaptative et repère de section actif |
| [Pasarela](https://moxen.cl/recursos/pasarela/) | Indicateur qui voyage, gestion du clavier | Navigation en verre Apple et Océan |
| [Profil](https://moxen.cl/recursos/perfil/) | Détail dépliable et déplacement par transformation | Cartes de monitoring, transitions interrompables |
| [Acceso](https://moxen.cl/recursos/acceso/) | Écran de connexion traité comme une interface complète | Panneau translucide, affichage du mot de passe, attente et erreur serveur |
| [Mirada](https://moxen.cl/recursos/mirada/) | Contrôle explicite de visibilité du mot de passe | Bouton Afficher/Masquer accessible et compatible avec le remplissage automatique |
| [Confort](https://moxen.cl/recursos/confort/) | Réduction du mouvement et lisibilité | Respect de la préférence système, commandes utilisables sans animation |
| [Fichero](https://moxen.cl/recursos/fichero/) et captures de carrousels | Défilement avec repère de position et accès clavier | Piste pour la galerie ; ne pas remplacer une liste dense par une animation qui masque des fichiers |
| [Plisado](https://moxen.cl/recursos/plisado/) | Réorganisation des informations selon l’espace disponible | Réduire les débordements ; garder l’action et son nom accessibles |
| Captures des menus Tile Build | Construction en vague puis désassemblage des tuiles | Ouverture et fermeture du menu de sections, y compris en cas d’interruption |
| Captures Command Palette et Text Field | Recherche de section, résultats clavier, champ qui grandit | Accès rapide et zones de texte adaptatives |

Les détails d’Instrumental proviennent de la capture fournie : sa page n’a pas
pu être consultée de façon fiable lors de la recherche. Les autres mécanismes
décrits ci-dessus sont recoupés avec les descriptions publiques des ressources.

## Réalisation et limites

Le code de ces composants est écrit pour ce projet. Aucun script, illustration,
police ou fichier CSS Moxen n’est redistribué. La
[licence des ressources](https://moxen.cl/terminos.html) autorise leur adaptation
dans des projets mais encadre la redistribution des sources ; elle ne doit pas
être assimilée à la licence GPL du dépôt.

Les effets suivent l’état réel : une attente n’annonce pas un succès, une
sélection ne déclenche pas une suppression et un bouton animé ne contourne
aucune confirmation. Aucun compteur fictif n’est présenté comme une mesure du
serveur. Un historique commence à la collecte locale et reste borné en mémoire.

Les références OTP et paiement servent de repères visuels de saisie et de
feedback. Elles n’ajoutent ni authentification Cloud à code, ni formulaire de
paiement dans l’application. Toute animation a une variante sans mouvement.
