import { $, fmt, formatText, message, mins, node, set, tr } from './workshop-ui.mjs';
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

  /** Affiche les références de la cible et les entrées à vérifier après redémarrage. */
  function render() {
    next.hidden = !rows.length;
    next.disabled = pending || !nextEntry() || queueTarget !== workshopState.selectedPrinter ||
      workshopState.snapshot?.printer?.is_available !== true;
    $('queue-empty').hidden = pending || rows.length > 0 || Boolean($('queue-state').textContent);
    $('queue-count').hidden = !rows.length;
    set('queue-count', rows.length || '');
    const totals = rows.map(row => row.details?.seconds).filter(Number.isFinite);
    const grams = rows.flatMap(row => row.details?.filaments || []).map(row => row.grams).filter(Number.isFinite);
    set('queue-totals', rows.length ? [
      rows.length === 1 ? tr('1 impression') : formatText('{0} impressions', rows.length),
      totals.length ? mins(totals.reduce((sum, value) => sum + value, 0) / 60) : '',
      grams.length ? fmt(grams.reduce((sum, value) => sum + value, 0), ' g') : '',
    ].filter(Boolean).join(' · ') : '');
    $('queue-list').replaceChildren(...rows.map((row, index) => {
      const item = node('li');
      const position = node('span', String(index + 1), 'queue-position');
      position.setAttribute('aria-hidden', 'true');
      const identity = node('div', null, 'queue-identity');
      const meta = [
        Number.isFinite(row.details?.seconds) ? mins(row.details.seconds / 60) : '',
        ...(row.details?.filaments || []).map(filament => [filament.material, Number.isFinite(filament.grams) ? fmt(filament.grams, ' g') : ''].filter(Boolean).join(' ')),
        ...(row.slots || []).map(slot => formatText('Emplacement {0}', slot)),
      ].filter(Boolean).join(' · ');
      identity.append(node('strong', row.name), node('span', meta, 'muted'));
      const warning = !row.available ? tr('Actualisez les fichiers Cloud pour vérifier cette entrée.')
        : !matchesAce(row) ? tr('Une bobine sélectionnée est indisponible.') : '';
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
      for (const [action, label, symbol, disabled] of [
        ['up', 'Monter', '↑', index === 0], ['down', 'Descendre', '↓', index === rows.length - 1],
        ['remove', 'Retirer', '×', false],
      ]) {
        const button = node('button', symbol, 'atelier-control atelier-control-icon');
        button.type = 'button';
        button.disabled = disabled;
        button.setAttribute('aria-label', formatText('{0} « {1} »', tr(label), row.name));
        button.title = tr(label);
        button.onclick = () => void load({action, handle:row.handle}, queueTarget);
        actions.append(button);
      }
      item.append(position, identity, actions);
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
      if (dialog.open && !pending) next.disabled = !nextEntry() || queueTarget !== target || printer?.is_available !== true;
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
