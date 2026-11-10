# Profil du client Cloud

Cloud Page utilise le mode d’authentification Slicer : type d’appareil `pcf`, signature, nonce et horodatage du protocole, session du compte et identité MQTT prévue par le client embarqué. Une version de protocole n’est pas le numéro de version de Cloud Page ni nécessairement le numéro commercial du slicer. Les valeurs configurées par le fournisseur ne sont pas remplacées par des versions inventées.

Le transport HTTP n’ajoute plus automatiquement un `User-Agent` contenant les versions de Python et d’aiohttp. Les parcours de connexion web qui exigent un `User-Agent` ou un `Origin` explicites les conservent. Aucun en-tête de nom Cloud Page ou de corrélation HTTP locale n’est ajouté aux requêtes Cloud. Les cookies de session restent propres au transport du compte.

Les identités MQTT restent stables. Un second client avec le même identifiant peut déconnecter le premier; l’application partage donc son transport entre les machines plutôt que d’ouvrir des clients concurrents. Le hachage de l’identifiant ne rend pas le compte anonyme : les données de connexion nécessaires sont toujours présentées au fournisseur, sous TLS. Aucun mécanisme de rotation ou de contournement n’est ajouté.

## Vérification

Un serveur HTTP fictif capture les requêtes effectivement émises par la session applicative. Les tests vérifient l’absence de l’en-tête automatique du moteur HTTP et d’en-têtes locaux de diagnostic, ainsi que la préservation d’en-têtes web fournis explicitement. L’authentification de ce test est une doublure locale, sans connexion à Anycubic ni secret réel.

L’examen statique du SDK Slicer Next distingue l’agent du navigateur embarqué de celui du transport HTTP natif; il ne fournit pas de preuve suffisante pour copier un agent natif exact. L’empreinte TLS, la compression, les sessions et le rythme des accès peuvent rester différents. Cette mesure minimise les métadonnées inutiles; elle ne promet ni identité parfaite avec Slicer Next ni indétectabilité. Les refus et limites du fournisseur ne sont pas contournés.

Référence de protocole : [client indépendant, version étudiée](https://github.com/Nino6689/anycubic-cloud-client/blob/6ea79c733ac3909f7bc1ca4970f2f75fe8d302b7/docs/PROTOCOL.md), sections 2–3 et 6.15. Aucun code de ce client n’est repris par cette modification.
