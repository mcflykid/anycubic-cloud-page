# Vérifications et limites de la version finale

Les tests automatiques utilisent la démonstration et des comptes fictifs. La qualification sur une installation réelle reste nécessaire pour les cas ci-dessous.

| Suivi | État des connaissances | Preuve à obtenir pour reprendre |
| --- | --- | --- |
| #30 · Timelapses | Le wiki S1 décrit l’enregistrement et l’export USB. Le parcours distant complet reste indéterminé. La galerie est désactivée. | Une vidéo existante, sa fiche Cloud et un téléchargement correspondant à la même vidéo. |
| #93 · États S1 et ACE | Les sources amont séparent identification RFID, pourcentage fabricant et masse. Les remontées disponibles gardent leurs unités et leur provenance. | Comparer des relevés Cloud à l’écran de la même S1 et du même ACE, au même instant. |
| #103 · G-code 3MF | Le stockage de projets 3MF et le lancement d’un G-code sont deux opérations distinctes. Le lancement de `.gcode.3mf` reste indisponible. | Un exemple confirmé sur S1 avec le type du fichier et la réponse de l’ordre. |
| #136 · Refus et séchage | Les codes connus ont une fiche locale. Les réglages de séchage restent indépendants du lancement. | Une preuve distincte pour la préparation, le début et la fin du séchage avant un lancement. |
| #142 · Fichier mémoire | Le code 10115 décrit un refus de lecture. Le fichier refusé signalé à l’origine n’a pas été identifié. | Le même fichier identifié dans la mémoire, son intégrité et deux résultats comparables depuis l’écran et le Cloud. |
| #145 · Maillage | Les références étudiées documentent des formats locaux ou des mesures. L’export S1 par le Cloud reste indéterminé. | Un export S1 récupéré avec dimensions, unités et provenance documentées. |
| #194 · Stockage | Les URL restent soumises aux garde-fous existants. Les aperçus réels consultés pour #290 n’ont pas fourni d’image exploitable pour compléter la liste d’hôtes. | Des hôtes expurgés obtenus pendant un aperçu ou un téléchargement autorisé sur chaque source. |
| #310 · Qualification | Les aperçus existants et les journaux ont été consultés en lecture seule pour la 1.11.0. Les essais réels de caméra, TOTP, pause et annulation restent à réaliser sur une instance de qualification. | Une instance de qualification et des cas désignés. Vérifier aussi les deux destinations Discord après configuration. |

Les détails techniques sont conservés dans la [comparaison amont](UPSTREAM-COMPARISON.md), le [relevé du wiki](ANYCUBIC-WIKI-S1.md) et les [notes de maillage](MESH.md).
