/** Fiches rédigées pour l’atelier à partir du catalogue officiel Anycubic. */
export const notificationErrorCatalogue = {
  "10115": {
    "title": "L’imprimante ne peut pas lire ce fichier",
    "description": "Le fichier peut être endommagé à la suite d’un tranchage interrompu ou être dans un format incorrect.",
    "anchor": "code10115-the-device-cannot-parse-the-file",
    "steps": [
      "Vérifiez le fichier réellement sélectionné et sa provenance : Cloud, mémoire de l’imprimante ou clé USB. Un modèle brut doit être tranché avant d’être utilisé comme fichier d’impression.",
      "Retranchez le modèle avec le profil de votre imprimante et enregistrez le résultat sur l’ordinateur avant de le transférer.",
      "Si le problème revient, notez le format, la source et la version du micrologiciel pour le diagnostic."
    ]
  },
  "10114": {
    "title": "Action incompatible avec l’état de l’imprimante",
    "description": "L’imprimante a signalé que cette action n’était pas disponible dans son état actuel.",
    "anchor": "code10114-the-current-device-status-does-not-support-this-operation",
    "steps": [
      "Vérifiez l’état sur l’écran de l’imprimante et attendez la fin de la transition en cours avant de décider de relancer l’action."
    ]
  },
  "10801": {
    "title": "Téléchargement du micrologiciel échoué",
    "description": "Le téléchargement peut avoir expiré ou l’imprimante peut avoir perdu son accès à Internet.",
    "anchor": "code10801-firmware-download-failed",
    "steps": [
      "Vérifiez la connexion Cloud sur l’écran de l’imprimante et confirmez qu’aucune mise à jour n’est en cours."
    ]
  },
  "11402": {
    "title": "Délai réseau de la caméra dépassé",
    "description": "L’imprimante n’a pas pu établir la connexion vidéo dans le délai prévu.",
    "anchor": "code11402-network-connection-timed-out",
    "steps": [
      "Vérifiez séparément l’état de la connexion Cloud et le résultat de l’ouverture de la caméra. Une imprimante en ligne peut encore avoir un flux indisponible."
    ]
  },
  "11404": {
    "title": "Le flux vidéo n’a pas démarré",
    "description": "Anycubic indique qu’un délai réseau peut empêcher le démarrage du flux.",
    "anchor": "code11404-video-stream-startup-failed",
    "steps": [
      "Vérifiez si l’imprimante est connectée au Cloud, puis consultez l’état de la session dans l’onglet Caméra."
    ]
  },
  "11830": {
    "title": "Espace de stockage de l’imprimante insuffisant",
    "description": "Un espace local insuffisant peut empêcher une impression ou la création d’un timelapse.",
    "anchor": "code11830-the-device-may-not-have-enough-remaining-storage-space-which-may-cause-the-print-or-delayed-photo-video-generation-to-fail",
    "steps": [
      "Consultez le stockage local sur l’imprimante et sauvegardez les fichiers à conserver avant de libérer de l’espace."
    ]
  },
  "11801": {
    "title": "Anomalie de type spaghetti détectée",
    "description": "La caméra signale une accumulation de filament qui peut correspondre à une impression ratée. Une forme similaire peut aussi déclencher une fausse alerte.",
    "anchor": "code11801-detected-messy-printing-offried-noodles-task-has-been-paused",
    "steps": [
      "Vérifiez l’état réel de l’impression et observez la pièce avant de prendre une décision."
    ]
  },
  "11802": {
    "title": "Objet signalé sur le plateau",
    "description": "La caméra a signalé un objet possible avant l’impression. Un plateau inhabituel, sale ou mal éclairé peut aussi déclencher une fausse alerte.",
    "anchor": "code11802-foreign-object-detected-check-print-area-is-clean",
    "steps": [
      "Inspectez la zone d’impression à l’arrêt. Vérifiez qu’elle est dégagée et que la caméra voit correctement le plateau."
    ]
  },
  "11812": {
    "title": "Défaut d’impression possible détecté",
    "description": "La détection IA signale une forme qui peut correspondre à une accumulation de filament. Cette alerte ne confirme pas un arrêt.",
    "source": "https://wiki.anycubic.com/en/home/knowledge-sharing/ai-detection#h-33-relevant-error-codes",
    "steps": [
      "Vérifiez l’état réel de l’impression et observez la pièce avant de prendre une décision."
    ]
  }
};
