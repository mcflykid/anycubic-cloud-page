# Supervision locale de l’application

La page **Parc et santé** regroupe les connexions déjà suivies et neuf cartes de
supervision : débit HTTP, latence, erreurs, CPU du processus, mémoire locale,
espace libre du volume de données, durée de fonctionnement, Cloud et MQTT.
Cliquer sur une carte ouvre son détail, ses unités, sa source et son historique
disponible. Le clavier et la touche Échap fonctionnent aussi dans le détail.

`GET /imprimante-api/monitoring` utilise la session web existante. Il ne résout
aucune nouvelle imprimante, n’ouvre aucun port et n’utilise ni socket Docker ni
nouvelle connexion Cloud. Les cartes ne donnent aucune commande à une machine.

## Mesures et limites

| Mesure | Interprétation |
| --- | --- |
| Débit HTTP | Moyenne de la fenêtre locale de 300 secondes, raccourcie après démarrage. La courbe utilise les différences des compteurs entre relevés. |
| Latence | Moyenne des durées HTTP observées dans la fenêtre, pas la durée réseau d’un appel Anycubic individuel. |
| Erreurs | Compteur des réponses HTTP à partir de 400 ; le détail distingue le cumul du démarrage et la fenêtre récente. |
| CPU | Temps CPU du processus entre deux relevés. Première mesure inconnue ; plusieurs cœurs peuvent produire plus de 100 %. Ce n’est pas la charge globale de l’hôte. |
| Mémoire | Usage courant du cgroup s’il est disponible, sinon RSS courant du processus sous Linux. Absence de lecteur fiable : donnée inconnue. Aucun maximum historique n’est présenté comme usage courant. |
| Espace libre | Octets libres sur le volume contenant les données de l’application. Ce n’est pas la taille propre de l’application ni le quota Cloud. |
| Durée | Temps monotone écoulé depuis le démarrage du processus serveur. |
| Cloud / MQTT | États déjà connus du moteur. Aucun historique de ces états n’est inventé. |

La mémoire conserve au plus 120 relevés demandés par les visiteurs. Avec un
seul onglet visible, une lecture a lieu environ toutes les cinq secondes.
Plusieurs visiteurs raccourcissent donc la durée représentée par les 120 points.
Ce suivi ne remplace pas l’historique thermique persistant. Les courbes gardent
leurs lacunes : elles ne joignent pas artificiellement des mesures absentes.

Le sélecteur **30 / 120 relevés** ne provoque pas de requête Cloud. **Suspendre
les mesures** arrête la relecture locale de cet onglet jusqu’à reprise ; les
autres clients et les collectes applicatives existantes ne sont pas modifiés.
Un échec de lecture est annoncé, sans faire passer les dernières valeurs pour
de nouvelles mesures. Les démonstrations portent explicitement la mention
**Données fictives de démonstration**.

L’exposition Prometheus reste un [contrat distinct](OBSERVABILITY.md) ; aucun
endpoint Prometheus n’est activé par cette page.

## Cadence du Cloud

Le transport partagé du compte espace les départs HTTP d’au moins une seconde.
C’est un plafond local prudent, pas une connaissance du quota fournisseur ni
une garantie contre une limitation. Les imprimantes partagent le même budget,
y compris après renouvellement du client. Une réponse HTTP 429 est classée
avant lecture du corps et impose la durée `Retry-After`, en secondes ou en date
HTTP ; en l’absence de valeur valide, la pause est de 60 secondes.

Pendant cette pause, les nouveaux parcours sont refusés localement sans appel
Anycubic. Aucune commande n’est rejouée et la session n’est pas renouvelée pour
contourner le refus. L’interface respecte le `Retry-After` retourné par le
serveur et ne fait pas sa reprise de lecture habituelle sur cette réponse.

Les données lentes et les mises à jour MQTT restent des pistes d’optimisation
séparées de cette protection. La [comparaison des intégrations](UPSTREAM-COMPARISON.md)
documente notamment la resynchronisation REST configurable d’ioBroker.


## Fraîcheur des mesures sur l’atelier

Les températures et la ventilation de l’imprimante ainsi que les mesures des boîtiers ACE indiquent l’origine et l’âge du relevé quand ils sont connus. Un champ absent d’un message ne reçoit pas l’horodatage du message. Au-delà de deux minutes, ou après la perte de la connexion MQTT d’origine, la dernière valeur est indiquée comme périmée. Un relevé Cloud reste identifié séparément. Un vrai zéro est conservé.

Le séchage manuel attend jusqu’à trente secondes un nouveau rapport MQTT du module ciblé. Au démarrage, la température et la durée doivent aussi correspondre. Si le retour manque ou si la connexion change, la fenêtre demande de vérifier l’état. Une demande incertaine n’est jamais renvoyée automatiquement.
