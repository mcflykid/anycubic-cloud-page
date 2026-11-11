# Commandes au repos de la Kobra S1

## Périmètre

Ces parcours concernent la Kobra S1 identifiée par son modèle constructeur. Ils n’étendent aucune permission aux machines inconnues. La source de protocole est la [description de captures S1 du client indépendant](https://github.com/Nino6689/anycubic-cloud-client/blob/6ea79c733ac3909f7bc1ca4970f2f75fe8d302b7/docs/PROTOCOL.md), sections 5.1, 5.4.4, 5.4.5 et 4.9. Les enveloppes sont réimplémentées et testées localement; aucun code du client n’est embarqué.

Un contrôle Cloud en lecture seule sur une S1 2.7.2.7 confirme que `free_temp_limit` peut être une chaîne JSON et annonce des bornes pour la buse et le plateau. Le décodeur accepte une structure numérique stricte et bornée; il ne transforme pas un profil absent ou invalide en autorisation. Les limites du modèle sont aussi plafonnées à 320 °C pour la buse et 120 °C pour le plateau.

## Températures et ventilation

La fenêtre **Commandes courantes** affiche les mêmes lignes au repos et pendant une impression. Les lignes Pièce et Auxiliaire affichent chacune leur vitesse actuelle et leur cible. Le bouton commun confirme les champs renseignés. Au repos, il envoie les températures puis chaque ventilateur séparément, et s’arrête au premier refus. Le zéro coupe la chauffe de la cible choisie.

Le formulaire de température envoie l’ordre `1216` sous la forme imprimante : `order_id` texte, `printer_id` numérique, `data`, sans `project_id`. `type` vaut 0 pour la buse seule, 1 pour le plateau seul et 2 pour les deux. Les champs de la cible non choisie sont nuls selon ce contrat; `type` détermine les cibles modifiées. Les températures respectent les limites `free_temp_limit`, distinctes des limites d’impression `temp_limit`.

Un ordre `1221` règle un seul ventilateur, pièce ou auxiliaire, en pourcentage de 0 à 100. Pour le ventilateur **Circulation**, le parcours d’impression existant conserve son champ Cloud `box_fan_level` et l’atelier convertit le pourcentage vers le niveau le plus proche. L’envoi au repos reste à vérifier. La température de chambre reste absente de l’atelier tant qu’aucune mesure Cloud exploitable n’a été identifiée sur la S1.

La confirmation précède le POST et son absence est refusée côté serveur. Sous les verrous existants, le serveur relit la machine et ses limites, refuse une identité modifiée, une activité ou une mise à jour, puis envoie au maximum un ordre. Une réponse HTTP acceptée ne prouve pas son application matérielle; l’interface le dit. Aucun délai ou refus n’entraîne un rejeu. Les réglages du projet actif gardent leur parcours distinct.

## Validation et limites

Les tests utilisent des doublures et la démonstration. Ils couvrent les enveloppes, les limites JSON encodées, la confirmation et les changements de cible ou de disponibilité après attente.

La consultation des coordonnées a été retirée après la 1.8.0. L’onglet Caméra conserve les commandes de déplacement. L’[historique du diagnostic](AXIS-QUERY-RESEARCH.md) décrit les observations Cloud.
