# Protocole de diagnostic évolutif

Chaque anomalie confirmée enrichit ce protocole, une issue et un test de
régression. Une hypothèse ne devient pas un résultat parce qu’un service a
accepté une requête. Les essais automatiques utilisent la démonstration et des
données fictives ; un essai réel demande une autorisation explicite et bornée.

## Avant un essai

1. Relever la version réellement installée et celle du code testé. Conserver
   l’heure, le contexte et l’issue, sans identifiant de compte ni adresse privée.
2. Écrire l’hypothèse et le résultat qui la confirmerait ou l’infirmerait.
3. Lire l’état courant : connexion, tâche en cours, disponibilité et fraîcheur.
   Distinguer un relevé local d’une nouvelle requête au fournisseur.
4. Définir une seule action, un délai maximal, le nombre de requêtes et la
   condition d’arrêt. Préférer code, fixtures et journaux déjà disponibles.
5. Pour une action physique, vérifier les effets possibles et utiliser la
   caméra quand elle permet de les observer. L’absence d’image interdit de
   conclure sur un effet mécanique. Prévoir un arrêt local quand nécessaire.

Une autorisation conditionnée à l’absence d’extrusion exige d’étudier aussi la
purge automatique. Le délai habituel de préparation et un bouton d’annulation
Cloud ne garantissent pas, seuls, le respect de cette condition.

## Pendant l’essai

- Ne modifier qu’une variable. Aucun balayage de commandes ou de paramètres.
- Corréler début, étape, résultat, durée et version dans les journaux filtrés.
  Les références de requête servent au rapprochement local ; jamais de jeton,
  d’URL signée, de contenu brut MQTT ou de données de compte dans une issue.
- Respecter la cadence partagée et les limitations fournisseur. Un délai,
  une réponse ambiguë ou une interruption n’autorise pas à rejouer une commande.
- Pour un fichier, distinguer réception HTTP, réservation, transfert, création
  de la référence Cloud, visibilité dans la liste et présence sur la machine.
- Pour une commande, distinguer l’acceptation Cloud, l’acquittement MQTT et
  l’effet observé à la caméra. Aucun de ces niveaux ne remplace les autres.

## Après l’essai

1. Relire l’état et les logs sur la fenêtre exacte ; noter les limites de
   collecte, les réponses manquantes et les effets non observés.
2. Fermer les sessions de caméra ouvertes pour le diagnostic. Préserver les
   fichiers et réglages préexistants ; identifier séparément tout fichier témoin.
3. Reproduire le défaut hors matériel et garder un test qui échoue avant la
   correction. Utiliser des fichiers réels temporaires lorsque le problème
   concerne le système de fichiers, plutôt qu’une doublure de toutes les lectures.
4. Vérifier la correction, ses annotations françaises, la confidentialité et
   l’interface complète. Les tests Docker restent réservés à GitHub Actions.
5. Mettre à jour l’issue avec preuve, résultat et prochaine étape. Fermer seulement
   les critères réellement satisfaits. Ne pas déployer implicitement une livraison.

## Leçons intégrées

| Cas | Observation | Amélioration du protocole |
| --- | --- | --- |
| Envoi de fichier 1.7.0, #166 | Erreur locale de mesure avant transfert | Mesurer un vrai fichier temporaire et tester le cycle de transfert simulé ; correctif 1.7.1 publié |
| Essai d’envoi 1.7.1 | Requête refusée faute de cible explicite | Contrôler le contexte avant le formulaire et distinguer un refus local d’un échec Cloud |
| Transfert et USB 1.7.1 | Après sélection de la cible, transfert accepté et fichier retrouvé dans la liste Cloud. Racine et sous-dossier USB lus séparément | Vérifier la destination dans son propre catalogue ; un transfert Cloud ne prouve pas l’écriture USB |
| Lecture de coordonnées en 1.8.0, #167 | Délai MQTT sans coordonnées exploitables | Séparer durée de l’accusé Cloud et durée de la réponse MQTT ; ne pas inventer une position |
| Caméra 1.7.1 | Flux réel reçu en 1280 × 720 puis fermeture acceptée | Vérifier une image décodée, puis fermer la session ; une session HTTP seule ne prouve pas la vidéo |
| Déconnexion avec caméra, #178 | Un second essai a décodé le flux mais la fermeture a reçu HTTP 401 pendant la déconnexion | Attendre la réponse de fermeture avant de révoquer la session web et vérifier cet ordre avec une réponse volontairement retardée |
| Sélection tactile, #163 | La barre flottante faisait remonter les lignes sous le doigt | Vérifier le geste tactile réel et réserver la place de la barre, au-delà du clic isolé |
| Version dans les logs, #173 | Les extraits hors démarrage manquaient de version | Ajouter la métadonnée embarquée à chaque ligne texte et JSON |

Les observations de cette table sont bornées à leurs essais. Elles ne constituent
ni une qualification de tous les firmwares, ni une garantie contre une limitation
de compte par le fournisseur.
