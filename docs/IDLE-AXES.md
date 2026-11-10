# Commandes au repos et coordonnées S1

## Périmètre

Ces parcours concernent la Kobra S1 identifiée par son modèle constructeur. Ils n’étendent aucune permission aux machines inconnues. La source de protocole est la [description de captures S1 du client indépendant](https://github.com/Nino6689/anycubic-cloud-client/blob/6ea79c733ac3909f7bc1ca4970f2f75fe8d302b7/docs/PROTOCOL.md), sections 5.1, 5.4.4, 5.4.5 et 4.9. Les enveloppes sont réimplémentées et testées localement; aucun code du client n’est embarqué.

Un contrôle Cloud en lecture seule sur une S1 2.7.2.7 confirme que `free_temp_limit` peut être une chaîne JSON et annonce des bornes pour la buse et le plateau. Le décodeur accepte une structure numérique stricte et bornée; il ne transforme pas un profil absent ou invalide en autorisation. Les limites du modèle sont aussi plafonnées à 320 °C pour la buse et 120 °C pour le plateau.

## Températures et ventilation

Dans **Commandes courantes → Mesures et éclairage**, les réglages au repos apparaissent seulement si la S1 est libre, en ligne et fournit ses limites. Les champs vides ne changent rien. Le zéro coupe la chauffe de la cible choisie. Aucun profil de matériau ni préchauffage automatique n’est proposé.

Le formulaire de température envoie l’ordre `1216` sous la forme imprimante : `order_id` texte, `printer_id` numérique, `data`, sans `project_id`. `type` vaut 0 pour la buse seule, 1 pour le plateau seul et 2 pour les deux. Les champs de la cible non choisie sont nuls selon ce contrat; `type` détermine les cibles modifiées. Les températures respectent les limites `free_temp_limit`, distinctes des limites d’impression `temp_limit`.

Un autre formulaire règle un seul ventilateur par ordre `1221` : pièce ou auxiliaire, en pourcentage de 0 à 100. Le ventilateur d’enceinte reste exclu de ce nouveau parcours tant que son unité n’est pas établie pour le modèle : les références consultées divergent entre niveau et pourcentage.

La confirmation précède le POST et son absence est refusée côté serveur. Sous les verrous existants, le serveur relit la machine et ses limites, refuse une identité modifiée, une activité ou une mise à jour, puis envoie au maximum un ordre. Une réponse HTTP acceptée ne prouve pas son application matérielle; l’interface le dit. Aucun délai ou refus n’entraîne un rejeu. Les réglages du projet actif gardent leur parcours distinct.

## Coordonnées

Dans **Caméra → Déplacer**, **Lire les coordonnées** effectue une consultation manuelle hors impression. Il n’existe aucun polling automatique supplémentaire. L’ordre `1214` utilise `order_id` numérique, `printer_id`, `project_id: 0`, sans `data`. La réponse `axis/query` doit être corrélée au même `msgid`, à la même machine, avec `state: done` et `code: 200`.

Les trois coordonnées doivent être présentes et finies; zéro reste une valeur valide, contrairement à une valeur absente. La date de réception est affichée. Une réponse absente, partielle, refusée, tardive ou reçue après changement de cible ne devient jamais une position actuelle inventée. Une erreur efface l’ancien affichage. Cette consultation ne déclenche ni mouvement, ni origine, ni réinitialisation. Elle ne prouve pas que chaque axe a été référencé; notamment, l’origine de Z reste une opération distincte.

## Validation et limites

Les tests utilisent exclusivement des doublures et la démonstration. Ils couvrent les enveloppes, les valeurs limites, la confirmation, les limites JSON encodées, les changements de cible ou de disponibilité après attente, les messages MQTT étrangers, les coordonnées invalides, les délais et l’absence de rejeu. Les tests d’interface vérifient qu’une lecture de position n’envoie aucune commande de déplacement.

Aucune chauffe, ventilation, origine, impression ni modification du firmware n’a été effectuée sur la machine pour valider ce lot. La lecture Cloud confirme le profil annoncé; elle ne vaut pas essai matériel de ces nouveaux parcours. L’application déjà installée n’a pas été modifiée.
