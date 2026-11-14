# Issue 462 : durées historiques et provenance

## Contrat retenu
Pour une tâche terminale (2 ou 3), préférer l’intervalle valide début-fin de v2 et le nommer ainsi. Sinon conserver uniquement le compteur valide de v2 comme durée principale. Une tâche active n’utilise jamais une ancienne date de fin. Le complément getProjects ne choisit pas la durée principale : sa disponibilité limitée à vingt éléments ne doit pas modifier la liste selon la page. Préserver séparément les compteurs v2, getProjects et détail v5/repli, l’intervalle et le champ estimé du détail. Un désaccord est explicite ; aucune conversion arbitraire, aucune assimilation à du temps d’extrusion.

Approches examinées : conserver le compteur fusionné laisserait le défaut de pagination ; remplacer toutes les durées par les dates masquerait les compteurs et inventerait une durée pour les tâches actives. Le contrat ci-dessus garde les données et rend la durée principale stable.

## Exécution native
1. Tests synthétiques rouges : compteur contradictoire, absent/zéro/négatif/non fini, dates invalides, états actif/terminé/arrêté, priorité v2, complément présent/absent et détail v5/repli.
2. Normalisateur pur des durées, provenance conservée avant fusion ; raccorder liste et détail. Préserver le contrat numérique elapsed_minutes pour les consommateurs existants.
3. Affichage des libellés de nature dans liste/galerie et des valeurs sourcées dans le détail ; conserver les actions, autres métriques et traductions.
4. Vérifier les consommateurs : bilans Discord (libellé et agrégation), statistiques, CSV, file et estimation apprise. Aucun changement des compteurs temps réel.
5. Tests Python/scripts/UI, Ruff, syntaxe JS, ressources, publication et diff ; revue indépendante finale.
6. Préparer localement description et patch du lot avec limites et preuves. Ne pas publier, pousser, créer une PR distante, commenter une issue ni fusionner.

## Isolation et limites
Le worktree existant contient la refonte non commitée. Un instantané initial privé permet de distinguer le diff 462 des changements antérieurs. Ne pas inclure implicitement les autres lots dans la PR. Aucune donnée de compte, appel Cloud réel ou commande appareil dans les tests. Les observations historiques réelles concernent trois tâches arrêtées ; les états actif/terminé sont couverts par fixtures, sans prétendre à une qualification matérielle.

## Validation à consigner
Tests ciblés red/green, résultats globaux et revue à compléter après exécution. Les documents de PR restent locaux jusqu’à l’accord explicite du propriétaire.


## Journal de validation
- Tests ciblés rouges puis verts : provenance/pagination, état inconnu non terminal, libellé du repli par nom et agrégation Discord.
- Revue indépendante : état absent désormais exclu de l’intervalle ; estimation par nom distincte du champ Cloud. Seconde relecture sans constat concret restant.
- Arbre de PR isolé construit à partir de la base, sans les changements de refonte déjà présents. Le module partagé ne reprend que les deux paramètres facultatifs nécessaires au lot.
- 497 tests applicatifs et 63 tests de scripts réussis sur l’arbre isolé ; contrôles Ruff, syntaxe JS et ressources réussis. Suite navigateur : 270 parcours réussis, un nouveau test a révélé une fixture de nom invalide. Fixture corrigée selon le format réel, assertion renforcée sur la durée, puis les trois tests ciblés réussissent. Le code de production est inchangé entre ces deux exécutions.
- Bilans Discord concernés ; CSV thermique, statistiques matérielles et métadonnées de file ne consomment pas la durée de liste. Aucun compteur temps réel changé.
- Aucune nouvelle observation Cloud réelle pendant cette correction ; les cas terminés avec succès/actifs sont des fixtures.
