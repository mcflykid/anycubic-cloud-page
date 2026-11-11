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
| [Parrilla](https://moxen.cl/recursos/parrilla/) | Widgets qui se réorganisent et disposition mémorisée | Ancienne disposition modulable, retirée lors de la refonte. |
| [Bento Grid](https://builder.atheros.ai/) et capture fournie | Zones qui changent de colonnes selon la largeur utile | Inspiration pour la composition des neuf sections, les cartes de mesures et le panneau de notifications |
| [Portada](https://moxen.cl/recursos/portada/) | Un panneau de menu évolue avec le choix courant | Navigation adaptative et repère de section actif |
| [Pasarela](https://moxen.cl/recursos/pasarela/) | Indicateur qui voyage, gestion du clavier | Navigation horizontale actuelle, repère sous l’onglet. Inspiration. |
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

## Revue des sept styles

| Référence | Mécanisme retenu | Emplacement | Usage |
| --- | --- | --- | --- |
| [Moxen Esqueleto](https://moxen.cl/recursos/esqueleto/) | Reprendre le rythme d’une liste dans ses formes d’attente | Fichiers et Historique | Inspiration |
| [Moxen Demora](https://moxen.cl/recursos/demora/) | Différer l’indication pour les réponses rapides | Fichiers et Historique | Inspiration |
| [Carbon Loading](https://carbondesignsystem.com/patterns/loading-pattern/) | Réserver la place du premier résultat et conserver les résultats pendant un rafraîchissement | Fichiers et Historique | Inspiration |
| [Moxen Instrumental](https://moxen.cl/recursos/instrumental/) | Agrandir le détail depuis la carte actionnée | Parc et santé | Inspiration |
| [Moxen Pulso](https://moxen.cl/recursos/pulso/) | Réagir à une évolution de la mesure | Mesure CPU de la supervision | Inspiration |
| [Grafana Stat](https://grafana.com/docs/grafana/latest/visualizations/panels-visualizations/visualizations/stat/) | Maintenir la dernière valeur lisible et traiter l’historique à part | Détail de supervision | Inspiration |
| [Moxen Insignia](https://moxen.cl/recursos/insignia/) | Signaler une augmentation du compteur | Cloche des notifications | Inspiration |
| [Moxen Duermevela](https://moxen.cl/recursos/duermevela/) | Appliquer le mode mémorisé dès l’ouverture et faire une bascule sans flash | Réglages → Apparence | Inspiration |
| [Apple HIG Motion](https://developer.apple.com/design/human-interface-guidelines/motion) | Donner une origine spatiale à un détail et respecter la réduction du mouvement | Navigation et fenêtres | Inspiration |
| [Material Motion](https://m2.material.io/design/motion/the-motion-system.html) | Réserver le fondu aux contenus qui changent et garder une courbe partagée | Sections et changement explicite du mode clair ou sombre | Inspiration |
| [MDN prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-reduced-motion) | Suivre la préférence système et appliquer immédiatement les états | Atelier entier | Inspiration |
| [Chrome Motion](https://developer.chrome.com/docs/modern-web-guidance/guides/ui-behaviors/motion) | Faire du fondu de rendu une amélioration progressive | Réglages → Apparence | Inspiration |
| [Apple Human Interface Guidelines — Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars) | Libellés stables, repère de section active et destinations de premier niveau | Navigation de l’atelier | Inspiration |
| [Moxen Parrilla](https://moxen.cl/recursos/parrilla/) | Grille de cartes qui suit les déplacements et mémorise l’ordre | Cadenas et disposition de l’atelier dans les dix styles | Inspiration |
| [MDN Auto-placement in grid layout](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Grid_layout/Auto-placement) | Placement adaptatif dans l’ordre de lecture, selon la largeur disponible | Cartes personnalisées de l’atelier | Inspiration |
| [Uiverse · chase2k25](https://uiverse.io/chase2k25/slimy-chipmunk-97) | Curseur à ressort commun aux trois choix | Fichiers | Code repris sous licence MIT |
| [Uiverse · njesenberger](https://uiverse.io/njesenberger/rude-stingray-22) | Interrupteur à glissière en relief | Relais des bobines ACE | Code repris sous licence MIT |
| [Uiverse · nazar-gavrylyk](https://uiverse.io/nazar-gavrylyk/evil-dragon-24) | Pulsation de l’icône pendant la requête | Export CSV | Code repris sous licence MIT |
| [Uiverse · SelfMadeSystem](https://uiverse.io/SelfMadeSystem/selfish-starfish-40) | Remplissage de la note et rebond de l’étoile choisie | Évaluation depuis Historique | Code repris sous licence MIT |
| [Flowbite Footer](https://flowbite.com/docs/components/footer/) | Regroupement des liens et passage à la ligne sur téléphone | Pied de page de l’atelier | Inspiration |
| [CodePen · transparent iPhone](https://codepen.io/editor/k3ch0o/pen/01a19a50-72df-791e-90da-2846eba6254a) | Révéler progressivement le sujet lorsque son image est disponible | Aperçu de l’impression dans Prisme | Inspiration |

Esqueleto et Demora associent une forme stable à une attente différée. Un indicateur animé dès le clic ajoute un clignotement aux réponses rapides. La liste précédente reste visible pendant une actualisation du même contenu. Instrumental guide le regard vers le détail choisi. Pour la mesure elle-même, la valeur reste stable comme dans Grafana Stat. Une réaction discrète marque une valeur reçue qui change. Le fondu court pour le mode évite la grande révélation circulaire. Pour la navigation, le repère de section et le panneau de tuiles existant permettent de suivre la sélection en gardant toutes les destinations atteignables.

Les conditions [Moxen](https://moxen.cl/terminos.html) encadrent la redistribution des ressources. [Apple](https://developer.apple.com/support/terms/), [Google](https://developers.google.com/terms/site-policies) et [MDN](https://developer.mozilla.org/en-US/docs/MDN/Writing_guidelines/Attrib_copyright_license) publient leurs propres conditions. [Carbon](https://github.com/carbon-design-system/carbon/blob/main/LICENSE) est sous Apache-2.0 et le dépôt [Grafana](https://github.com/grafana/grafana/blob/main/LICENSE) sous AGPL-3.0. Cette revue implémente ses mécanismes dans le projet avec du CSS et du JavaScript natifs.

## Scène de connexion imprimée

Les captures de formulaires translucides fournies par le propriétaire servent d’inspiration pour la lisibilité de la carte au premier plan. La scène de dépôt couche par couche, son tracé SVG et ses animations CSS sont des créations du projet. La pièce terminée sert de variante fixe et le navigateur suspend la scène quand la page est masquée.
