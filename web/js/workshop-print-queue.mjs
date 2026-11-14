import { $, fmt, formatText, locale, message, mins, node, set, timeZone, tr } from './workshop-ui.mjs';

const QUEUE_ICONS = {
  up: 'm6 15 6-6 6 6', down: 'm6 9 6 6 6-6', remove: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
};

/** Pictogramme décoratif : le bouton porte déjà son nom accessible. */
function queueIcon(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const icon = document.createElementNS(ns, 'svg'), path = document.createElementNS(ns, 'path');
  for (const [key, value] of Object.entries({class:'ui-icon', 'aria-hidden':'true', viewBox:'0 0 24 24', fill:'none',
    stroke:'currentColor', 'stroke-width': name === 'grip' ? '3' : '1.8', 'stroke-linecap':'round', 'stroke-linejoin':'round'}))
    icon.setAttribute(key, value);
  path.setAttribute('d', QUEUE_ICONS[name]);
  icon.append(path);
  return icon;
}
import { workshopState } from './workshop-state.mjs';

/** La file ne lance rien seule. Son premier fichier ouvre la confirmation d’impression habituelle. */
export function bindPrintQueue(request, command) {
  const dialog = $('queue-dialog'), next = $('queue-next');
  let rows = [], pending = false, queueTarget;
  const observed = new Map();
  const nextEntry = () => rows.find(row => row.available === true && matchesAce(row));

  /** Les emplacements mémorisés restent liés aux bobines observées sur la cible. */
  function matchesAce(row) {
    if (!row.slots?.length) return true;
    const printer = workshopState.snapshot?.printer;
    const boxes = printer?.boxes || [];
    return row.slots.every((slot, index) => {
      const spool = boxes.flatMap(box => box.spools || []).find(item => (item.display_slot ?? item.slot) === slot);
      const material = row.details?.filaments?.[index]?.material;
      return spool?.spool_loaded === true && (!material || !spool.material_type ||
        material.toUpperCase() === spool.material_type.toUpperCase());
    });
  }

  /** Matériaux du fichier absents de toutes les bobines chargées : l’entrée reste lançable, mais signalée. */
  function missingMaterials(row) {
    if (row.slots?.length) return [];
    const loaded = new Set((workshopState.snapshot?.printer?.boxes || []).flatMap(box => box.spools || [])
      .filter(spool => spool.spool_loaded === true && spool.material_type).map(spool => spool.material_type.toUpperCase()));
    if (!loaded.size) return [];
    return [...new Set((row.details?.filaments || []).map(filament => filament.material).filter(Boolean))]
      .filter(material => !loaded.has(material.toUpperCase()));
  }

  /** Le bandeau dit toujours pourquoi « Plateau libéré » est indisponible. */
  function renderReady() {
    const printer = workshopState.snapshot?.printer, entry = nextEntry();
    const reason = queueTarget !== workshopState.selectedPrinter ? tr('Cette file appartient à une autre imprimante.')
      : printer?.is_available !== true ? tr('L’imprimante est occupée ou hors ligne.')
        : !entry ? tr('Aucune entrée prête : vérifiez les avertissements ci-dessous.') : '';
    $('queue-ready').hidden = !rows.length;
    $('queue-ready').dataset.state = reason ? 'waiting' : 'ready';
    set('queue-ready-title', entry ? formatText('Suivante : {0}', entry.name) : tr('Prochaine impression'));
    set('queue-ready-text', reason || tr('Retirez la pièce, puis confirmez : la fenêtre de lancement s’ouvrira.'));
    next.disabled = pending || Boolean(reason);
  }

  /** Affiche les références de la cible et les entrées à vérifier après redémarrage. */
  function render() {
    renderReady();
    $('queue-empty').hidden = pending || rows.length > 0 || Boolean($('queue-state').textContent);
    $('queue-count').hidden = !rows.length;
    set('queue-count', rows.length || '');
    const totals = rows.map(row => row.details?.seconds).filter(Number.isFinite);
    const grams = rows.flatMap(row => row.details?.filaments || []).map(row => row.grams).filter(Number.isFinite);
    const seconds = totals.reduce((sum, value) => sum + value, 0);
    // L’heure de fin n’a de sens que si toutes les durées sont connues.
    const finish = totals.length === rows.length && seconds
      ? new Intl.DateTimeFormat(locale, {timeStyle:'short', timeZone}).format(Date.now() + seconds * 1000) : '';
    $('queue-totals').hidden = !rows.length;
    $('queue-totals').replaceChildren(...[
      [rows.length === 1 ? tr('1 impression') : formatText('{0} impressions', rows.length)],
      totals.length ? [tr('Durée'), mins(seconds / 60)] : null,
      grams.length ? [tr('Filament'), fmt(grams.reduce((sum, value) => sum + value, 0), ' g')] : null,
      finish ? [tr('Fin si enchaînée'), finish] : null,
    ].filter(Boolean).map(([label, value]) => {
      const part = node('span', value ? label + ' ' : label);
      if (value) part.append(node('b', value));
      return part;
    }));
    $('queue-list').replaceChildren(...rows.map((row, index) => {
      const item = node('li');
      const grip = node('span', null, 'queue-grip');
      grip.append(queueIcon('grip'));
      const position = node('span', String(index + 1), 'queue-position');
      position.setAttribute('aria-hidden', 'true');
      if (index === 0) position.dataset.first = 'true';
      const identity = node('div', null, 'queue-identity');
      const meta = node('span', null, 'queue-meta');
      for (const filament of row.details?.filaments || []) {
        const part = node('span', [filament.material, Number.isFinite(filament.grams) ? fmt(filament.grams, ' g') : ''].filter(Boolean).join(' '));
        if (filament.color?.length === 3) {
          const swatch = node('i', null, 'queue-swatch');
          swatch.style.setProperty('--swatch', `rgb(${filament.color.join(',')})`);
          part.prepend(swatch);
        }
        meta.append(part);
      }
      if (Number.isFinite(row.details?.seconds)) meta.append(node('span', mins(row.details.seconds / 60)));
      for (const slot of row.slots || []) meta.append(node('span', formatText('Emplacement {0}', slot)));
      identity.append(node('strong', row.name), meta);
      const missing = missingMaterials(row);
      const warning = !row.available ? tr('Actualisez les fichiers Cloud pour vérifier cette entrée.')
        : !matchesAce(row) ? tr('Une bobine sélectionnée est indisponible.')
          : missing.length ? formatText('Aucune bobine {0} chargée : chargez-la avant le lancement.', missing.join(', ')) : '';
      if (warning) {
        identity.append(node('span', warning, 'queue-warning'));
        item.dataset.state = 'warning';
      }
      item.draggable = true;
      item.ondragstart = event => event.dataTransfer.setData('text/plain', row.handle);
      item.ondragover = event => event.preventDefault();
      item.ondrop = event => {
        event.preventDefault();
        const handle = event.dataTransfer.getData('text/plain');
        if (rows.some(entry => entry.handle === handle) && handle !== row.handle)
          void load({action:'move', handle, before:row.handle}, queueTarget);
      };
      const actions = node('div', null, 'queue-actions');
      for (const [action, label, disabled] of [
        ['up', 'Monter', index === 0], ['down', 'Descendre', index === rows.length - 1],
        ['remove', 'Retirer', false],
      ]) {
        const button = node('button', null, 'atelier-control atelier-control-icon');
        button.append(queueIcon(action));
        button.dataset.action = action;
        button.type = 'button';
        button.disabled = disabled;
        button.setAttribute('aria-label', formatText('{0} « {1} »', tr(label), row.name));
        button.title = tr(label);
        button.onclick = () => void load({action, handle:row.handle}, queueTarget);
        actions.append(button);
      }
      item.append(grip, position, identity, actions);
      return item;
    }));
  }

  /** Sérialise les changements de file et signale les refus dans le panneau actif. */
  async function load(data, target = workshopState.selectedPrinter) {
    if (pending || target !== workshopState.selectedPrinter) return;
    pending = true;
    next.disabled = true;
    try {
      const result = await request('/print-queue', {
        printerKey: target,
        ...(data ? {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)} : {}),
      });
      if (target !== workshopState.selectedPrinter) return;
      queueTarget = target;
      rows = result.items;
      set('queue-state', '');
      if (data?.action === 'add') message(tr('Fichier ajouté à la file d’attente.'));
    } catch (error) {
      if (dialog.open) set('queue-state', error.message);
      else message(error.message, true);
    } finally {
      pending = false;
      render();
    }
  }

  $('queue-open').onclick = () => {
    $('queue-open').classList.remove('primary');
    rows = [];
    set('queue-state', '');
    // L’état vide n’apparaît qu’après la lecture, pour ne pas clignoter à l’ouverture.
    $('queue-empty').hidden = true;
    $('queue-list').replaceChildren();
    dialog.showModal();
    void load();
  };
  next.onclick = async () => {
    if (pending || next.disabled || !nextEntry() || queueTarget !== workshopState.selectedPrinter) return;
    const row = nextEntry(), target = queueTarget;
    next.disabled = true;
    dialog.close();
    const result = await command('print-cloud', {handle:row.handle, name:row.name, details:row.details, slots:row.slots, fromQueue:true},
      formatText('Vérifiez que le plateau est libre avant d’imprimer « {0} ».', row.name));
    if (result) await load({action:'remove', handle:row.handle}, target);
  };
  return {
    add: handle => load({action:'add', handle}),
    async observe(printer, target) {
      if (dialog.open && !pending) renderReady();
      if (!target || !printer?.command_project || printer.printer_online !== true) return;
      const previous = observed.get(target);
      const current = {project:printer.command_project, active:printer.job_in_progress === true};
      observed.set(target, current);
      if (!previous?.active || previous.project !== current.project || printer.job_complete !== true) return;
      try {
        const result = await request('/print-queue', {printerKey:target});
        if (target !== workshopState.selectedPrinter) return;
        const row = result.items.find(item => item.available === true && matchesAce(item));
        if (row) {
          $('queue-open').classList.add('primary');
          message(formatText('Vérifiez que le plateau est libre avant d’imprimer « {0} ».', row.name));
        }
      } catch {
        // La file reste accessible si la lecture de fin échoue.
      }
    },
  };
}
