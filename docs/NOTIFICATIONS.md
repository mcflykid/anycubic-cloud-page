# Notifications Discord

Dans **Réglages → Notifications Discord**, sélectionnez **Alertes**. Créez un webhook entrant pour un salon texte dans Discord, saisissez son adresse et le mot de passe web, puis utilisez **Envoyer un test**. Le test transmet un message fixe. Pour recevoir les notifications d’impression, cochez l’activation puis enregistrez. Si vous avez testé une adresse qui n’était pas encore enregistrée, renseignez-la de nouveau. Les notifications sont désactivées par défaut. Le nom du fichier est facultatif et masqué par défaut.

Le canal ne transmet que les résultats terminaux confirmés par le Cloud. L’atelier garde les pauses, les annulations manuelles et les alarmes sans preuve d’arrêt silencieuses. La première lecture après un démarrage, un changement de réglage ou de compte établit la référence d’historique. Les résultats déjà visibles à ce moment ne sont pas envoyés. Après une interruption de lecture Cloud, les résultats âgés de dix minutes ou plus sont écartés. Le journal du conteneur indique ces fenêtres avec `notification_observation_gap`, y compris lorsque le Cloud ne permet pas de compter les résultats manqués. En cas de réponse Discord ambiguë, l’atelier évite de renvoyer le message automatiquement.

L’adresse est conservée dans `APPDATA_DIR/private/discord-webhook`. Les anciennes adresses `discordapp.com` sont converties vers `discord.com` avant l’envoi. Quand une adresse est enregistrée, le formulaire l’indique et la garde masquée. Laissez le champ vide pour la conserver. Pour bloquer les nouveaux envois et les reprises, décochez l’activation. Une demande déjà transmise peut encore aboutir. Pour retirer aussi l’adresse, utilisez **Supprimer le webhook**. Cette action efface la configuration de l’atelier. Pour révoquer le webhook lui-même, utilisez les intégrations du salon Discord.

Pour interpréter le résultat d’un envoi, consultez le [dépannage Discord](TROUBLESHOOTING.md#notifications-discord).

## Bilans programmés

Dans **Réglages → Notifications Discord → Bilans**, renseignez un deuxième webhook et activez le canal. Le salon des bilans peut s’appeler `#logs` et celui des alertes `#alertes`. Désactiver ou retirer le webhook des bilans laisse les alertes actives. L’adresse des bilans est enregistrée dans `APPDATA_DIR/private/discord-reports-webhook`.

Les bilans sont prévus à **08 h et 21 h** dans le fuseau de l’atelier (`TZ`, Europe/Paris par défaut). Chaque bilan couvre le créneau depuis l’heure précédente et inclut les fins exactement à l’heure du bilan. Un démarrage pendant les dix minutes qui suivent le créneau peut encore permettre l’envoi. Après ce délai, l’atelier attend le créneau suivant. Une réservation durable évite les doublons après un redémarrage ou une réponse Discord ambiguë.

Le Cloud fournit les résultats, les durées disponibles, les codes d’arrêt et, lorsqu’elle est renseignée, la masse de filament. Les mesures partielles indiquent combien d’impressions disposent d’une valeur. Une lecture inaccessible ou tronquée est signalée dans le bilan. La collecte réutilise l’historique Cloud et reste limitée à quatre imprimantes, trois pages par imprimante et quinze secondes par créneau.
