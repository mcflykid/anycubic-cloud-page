# Architecture des commandes et des rapports

Le serveur aiohttp exécute les requêtes sur une boucle asyncio. Un compte partage son client HTTP, son budget de requêtes et son fil MQTT. Chaque imprimante a un moteur distinct avec son état, ses attentes de réponse et ses verrous. Le navigateur envoie une cible explicite. Le serveur la vérifie à nouveau après toute attente qui pourrait la rendre caduque.

## Verrous

| Verrou | Portée | Rôle |
| --- | --- | --- |
| `UPLOAD_STAGING` | Processus | Réserve la réception et la validation locale d’un seul fichier multipart à la fois. |
| `engine.command_request_lock` | Imprimante | Réserve la demande pendant qu’elle attend la fin d’une lecture. |
| `engine.upload_lock` | Imprimante | Réserve un transfert destiné au seul stockage Cloud. |
| `engine.lock` | Imprimante | Protège les lectures et la vérification de la cible. Une commande ordinaire borne son attente sur ce verrou. |
| `engine.command_lock` | Imprimante | Sérialise l’envoi d’un ordre physique et la création ou fermeture d’une session caméra. |
| `transport.cloud_mutation_lock` | Compte | Sérialise les mutations du compte entre toutes ses imprimantes. |
| `transport.mqtt_auth_lock` | Compte | Empêche deux reconnexions MQTT de remplacer le fil simultanément. |

Les flèches ci-dessous désignent des acquisitions imbriquées, dans l’ordre extérieur vers intérieur. Les verrous se libèrent dans l’ordre inverse.

- Commande ordinaire : `command_request_lock → engine.lock → command_lock`. Une demande déjà réservée est refusée. Si une lecture dépasse le délai, la commande s’arrête avant l’envoi.
- Pause et annulation : `command_lock` seul. Ces ordres peuvent passer pendant une lecture ou une mutation Cloud. Un ordre machine ou une session caméra qui tient déjà ce verrou peut encore les faire refuser.
- Commande qui modifie le compte : `command_request_lock → engine.lock → cloud_mutation_lock`. La suppression directe d’une notification commence à `engine.lock`. Ces parcours ne prennent pas `command_lock`.
- Envoi pour impression : `UPLOAD_STAGING`, puis les verrous d’une commande ordinaire. Stockage sans impression : `UPLOAD_STAGING → upload_lock`, avec `engine.lock` le temps de valider la cible. La lecture est libérée **avant** d’acquérir `cloud_mutation_lock`. Le transfert peut ainsi durer sans bloquer les consultations de l’imprimante.
- Caméra : `engine.lock → command_lock` pour ouvrir ou fermer la session. Le suivi des spectateurs et la planification de la fermeture utilisent `engine.lock` seul. La fermeture vérifie de nouveau la présence et la cible avant son envoi différé.
- Reconnexion : `mqtt_auth_lock` protège le remplacement du fil MQTT. L’arrêt du fil est attendu dans un travail hors boucle avec un délai borné.

Un parcours ne doit jamais acquérir `engine.lock` après `command_lock` ou `cloud_mutation_lock`. Le verrou machine et le verrou de mutation Cloud ne doivent jamais être acquis ensemble. Les tests dans `app/test_command_lock.py` contrôlent l’ordre observé des acquisitions et des libérations sur les principales routes sans réseau ni imprimante.

## Trajet d’une commande

1. Le serveur choisit le moteur, lit le JSON et consulte le résultat associé à l’identifiant de demande. Une répétition connue renvoie le résultat mémorisé.
2. La route réserve les verrous adaptés, vérifie la cible et, pour les actions sensibles, consomme le ticket de confirmation. Une requête déconnectée avant l’envoi s’arrête.
3. Le gestionnaire valide les paramètres. Juste avant un envoi, le journal marque le résultat comme inconnu. Un échec après cet instant demande une vérification de l’état plutôt qu’un nouvel envoi automatique.
4. Le résultat HTTP distingue l’acceptation du refus ou d’un résultat incertain. Les actions qui disposent d’un acquittement MQTT peuvent ensuite obtenir une confirmation corrélée. L’acceptation HTTP seule ne prouve pas l’exécution physique.

## Trajet d’un rapport MQTT

1. Le fil MQTT du compte reçoit le rapport. Le routeur rattache le sujet à l’imprimante du registre, puis transmet les rapports d’état admissibles au client de la machine.
2. Les réponses qui attendent une confirmation sont filtrées par cible et par type. Un rapport conservé par le broker ne peut pas acquitter une commande récente dans le journal.
3. Les attentes de lecture de fichiers et le journal de commandes remettent les événements à la boucle asyncio avec `call_soon_threadsafe`. Le fil MQTT n’acquiert pas les verrous des commandes. Les fichiers corrèlent type, action et identifiant. Un petit tampon accueille la réponse arrivée avant l’identifiant HTTP.
4. La boucle réveille l’attente, applique le délai ou met à jour le journal. Les rapports ordinaires rafraîchissent l’état du moteur de la cible. Les mesures peuvent ainsi progresser indépendamment de la réponse HTTP.
