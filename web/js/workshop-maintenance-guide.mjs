import { maintenanceGuide, MAINTENANCE_SOURCE } from './maintenance-guide-data.mjs';
import { maintenanceFigure } from './maintenance-guide-figures.mjs';
import { $, formatText, node, tr } from './workshop-ui.mjs';

/**
 * Fiche du carnet liée à une opération du registre, ou undefined pour une opération personnelle.
 * @param {string} operation identifiant de l’opération d’entretien
 */
export function guideForOperation(operation) {
  return maintenanceGuide.find(entry => entry.operations.includes(operation));
}

/** Liste à puces ou numérotée ; une section vide n’est pas affichée. */
function section(title, items, ordered = false) {
  if (!items?.length) return null;
  const block = node('section', null, 'maintenance-guide-section');
  const list = node(ordered ? 'ol' : 'ul');
  list.append(...items.map(text => node('li', tr(text))));
  block.append(node('h4', tr(title)), list);
  return block;
}

/**
 * Lie la fenêtre du carnet. Elle ne lit aucune donnée de l’imprimante et n’envoie aucune commande.
 * @returns {(id?: string, reminder?: string) => void} ouvre l’index ou une fiche
 */
export function bindMaintenanceGuide() {
  const dialog = $('maintenance-guide-dialog'), index = $('maintenance-guide-index'), entry = $('maintenance-guide-entry');
  $('maintenance-guide-source').href = MAINTENANCE_SOURCE;

  function showIndex() {
    entry.hidden = true;
    index.hidden = false;
    index.replaceChildren(...maintenanceGuide.map(item => {
      const button = node('button', null, 'maintenance-guide-card');
      button.type = 'button';
      button.append(maintenanceFigure(item.figure, ''), node('strong', tr(item.title)), node('span', tr(item.when), 'muted'));
      // Le titre de la carte nomme déjà le point : le schéma reste décoratif ici.
      const figure = button.querySelector('svg');
      figure.removeAttribute('role');
      figure.removeAttribute('aria-label');
      figure.setAttribute('aria-hidden', 'true');
      button.onclick = () => showEntry(item.id);
      const row = node('li');
      row.append(button);
      return row;
    }));
  }

  function showEntry(id, reminder) {
    const item = maintenanceGuide.find(candidate => candidate.id === id);
    if (!item) return showIndex();
    index.hidden = true;
    entry.hidden = false;
    const back = node('button', tr('Tous les points'), 'atelier-control');
    back.type = 'button';
    back.onclick = () => {
      showIndex();
      index.querySelector('button')?.focus();
    };
    const heading = node('h3', tr(item.title));
    heading.id = 'maintenance-guide-entry-title';
    heading.tabIndex = -1;
    const when = node('p', null, 'maintenance-guide-when');
    when.append(node('strong', tr('Quand')), ' ', tr(item.when));
    entry.replaceChildren(...[
      back,
      heading,
      maintenanceFigure(item.figure, formatText('Schéma : {0}', tr(item.title))),
      when,
      // Le repère constructeur et le rappel réglé dans l’atelier peuvent différer.
      reminder ? node('p', formatText('Rappel réglé dans l’atelier : {0}', reminder), 'muted') : null,
      section('Signes à surveiller', item.signs),
      section('Matériel', item.tools),
      section('Étapes', item.steps, true),
      section('Précautions', item.cautions),
    ].filter(Boolean));
    entry.setAttribute('aria-labelledby', heading.id);
    heading.focus();
  }

  return (id, reminder) => {
    if (id) showEntry(id, reminder);
    else showIndex();
    if (!dialog.open) dialog.showModal();
    if (id) $('maintenance-guide-entry-title')?.focus();
  };
}
