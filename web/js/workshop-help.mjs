import { $, node, tr } from './workshop-ui.mjs?v=f51999168421';

const helpById = {
  'camera-start': tr('Démarrer la vidéo en direct de l’imprimante.'),
  'camera-stop': tr('Fermer la vidéo sans interrompre l’impression.'),
  'light-on': tr('Allumer l’éclairage intérieur de l’imprimante.'),
  'light-off': tr('Éteindre l’éclairage intérieur de l’imprimante.'),
  'zoom-reset': tr('Revenir au zoom initial de la vidéo.'),
  fullscreen: tr('Afficher la vidéo en plein écran.'),
  'go-spool': tr('Choisir un emplacement, son matériau et sa couleur.'),
  'go-drying': tr('Configurer la température et la durée de séchage de l’ACE.'),
  feed: tr('Charger le filament de l’emplacement sélectionné.'),
  'feed-finish': tr('Valider la fin du chargement après la sortie du filament.'),
  retract: tr('Retirer le filament de l’emplacement sélectionné.'),
  'parent-folder': tr('Remonter d’un niveau dans les fichiers de l’imprimante.'),
  'history-read-all': tr('Synchroniser toutes les notifications comme lues dans Anycubic.'),
  'temperature-hours': tr(
    'Choisir la période affichée, parmi les relevés des dernières 24 heures.',
  ),
  'file-slots': tr(
    'Un numéro d’emplacement de l’ACE par couleur du G-code, dans l’ordre. Laissez vide pour utiliser la bobine externe.',
  ),
};
for (const [id, help] of Object.entries(helpById)) if ($(id)) $(id).title = help;
const commandHelp = {
  pause: tr('Mettre l’impression en cours en pause.'),
  resume: tr('Reprendre une impression qui est en pause.'),
  cancel: tr('Arrêter l’impression en cours après confirmation.'),
  firmware: tr('Installer une nouvelle version lorsque l’imprimante est libre.'),
  'ace-firmware': tr('Mettre à jour l’ACE lorsque l’imprimante est libre.'),
};
for (const b of document.querySelectorAll('[data-command]'))
  if (commandHelp[b.dataset.command]) b.title = commandHelp[b.dataset.command];
const fieldHelp = {
  target_nozzle_temp: tr('Température cible de la buse, entre 0 et 320 °C.'),
  target_hotbed_temp: tr('Température cible du plateau, entre 0 et 120 °C.'),
  fan_speed_pct: tr('Ventilation de la pièce, entre 0 et 100 %. '),
  aux_fan_speed_pct: tr('Ventilateur auxiliaire, entre 0 et 100 %. '),
  box_fan_level: tr('Niveau de ventilation de l’enceinte accepté par Anycubic, de 0 à 3.'),
  print_speed_mode: tr('Mode de vitesse appliqué à l’impression en cours.'),
  slots: tr('Numéros des bobines de l’ACE, dans l’ordre des couleurs du G-code.'),
  mode: tr('Choisir entre conserver le fichier dans le cloud et lancer son impression.'),
};
for (const e of document.querySelectorAll('input[name],select[name]'))
  if (fieldHelp[e.name]) e.title = fieldHelp[e.name];
const helpBubble = node('div', null, 'help-bubble');
helpBubble.id = 'ui-help-bubble';
helpBubble.setAttribute('role', 'tooltip');
helpBubble.hidden = true;
document.body.append(helpBubble);
let helpTarget = null,
  helpPinned = false;
/** Ferme l’aide et restaure les autres associations accessibles de l’élément ciblé. */
function hideHelp() {
  if (helpTarget) {
    const previous = helpTarget.getAttribute('aria-describedby') || '';
    const cleaned = previous
      .split(' ')
      .filter((x) => x !== 'ui-help-bubble')
      .join(' ');
    if (cleaned) helpTarget.setAttribute('aria-describedby', cleaned);
    else helpTarget.removeAttribute('aria-describedby');
  }
  helpTarget = null;
  helpPinned = false;
  helpBubble.hidden = true;
}
/** Affiche une aide textuelle dans le dialogue actif ; pinned la maintient jusqu’à une fermeture explicite. */
function showHelp(target, pinned = false) {
  const text = target.dataset.tooltip || target.getAttribute('title');
  if (!text) return;
  if (target.hasAttribute('title')) {
    target.dataset.tooltip = text;
    target.removeAttribute('title');
  }
  if (helpTarget !== target) hideHelp();
  helpTarget = target;
  helpPinned = pinned;
  const parent = target.closest('dialog') || document.body;
  if (helpBubble.parentElement !== parent) parent.append(helpBubble);
  helpBubble.textContent = text;
  helpBubble.hidden = false;
  target.setAttribute('aria-describedby', 'ui-help-bubble');
  const r = target.getBoundingClientRect(),
    b = helpBubble.getBoundingClientRect();
  helpBubble.style.left =
    Math.max(10, Math.min(innerWidth - b.width - 10, r.left + r.width / 2 - b.width / 2)) + 'px';
  helpBubble.style.top =
    (r.top >= b.height + 12
      ? r.top - b.height - 9
      : Math.min(innerHeight - b.height - 8, r.bottom + 9)) + 'px';
}
document.addEventListener('pointerover', (e) => {
  const target = e.target.closest('[title],[data-tooltip]');
  if (target && !helpPinned) showHelp(target);
});
document.addEventListener('pointerout', (e) => {
  if (!helpPinned && helpTarget && !helpTarget.contains(e.relatedTarget)) hideHelp();
});
document.addEventListener('focusin', (e) => {
  if (e.target.matches('[title],[data-tooltip]')) showHelp(e.target);
});
document.addEventListener('focusout', () => {
  if (!helpPinned) hideHelp();
});
document.addEventListener('click', (e) => {
  const help = e.target.closest('[data-tooltip-trigger]');
  if (help) {
    e.preventDefault();
    showHelp(help, true);
  } else if (helpPinned && !helpBubble.contains(e.target)) hideHelp();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideHelp();
});
document.addEventListener(
  'scroll',
  () => {
    if (helpTarget) hideHelp();
  },
  true,
);
