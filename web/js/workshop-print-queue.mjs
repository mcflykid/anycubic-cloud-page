import { $, formatText, message, mins, node, set, tr } from './workshop-ui.mjs';
import { workshopState } from './workshop-state.mjs';

/** La file ne lance rien seule. Son premier fichier ouvre la confirmation d’impression habituelle. */
export function bindPrintQueue(request, command) {
  const dialog = $('queue-dialog'), next = $('queue-next');
  let rows = [], pending = false, queueTarget;
  const observed = new Map();
  const nextEntry = () => rows.find(row => row.available === true);

  /** Affiche les références de la cible et les entrées à vérifier après redémarrage. */
  function render() {
    next.disabled = pending || !nextEntry() || queueTarget !== workshopState.selectedPrinter ||
      workshopState.snapshot?.printer?.is_available !== true;
    $('queue-list').replaceChildren(...rows.map((row, index) => {
      const item = node('li');
      item.append(node('strong', row.name));
      if (Number.isFinite(row.details?.seconds))
        item.append(node('p', tr('Durée estimée') + ' · ' + mins(row.details.seconds / 60)));
      if (!row.available) item.append(node('p', tr('Actualisez les fichiers Cloud pour vérifier cette entrée.')));
      for (const [action, label, disabled] of [
        ['up', 'Monter', index === 0], ['down', 'Descendre', index === rows.length - 1],
        ['remove', 'Retirer', false],
      ]) {
        const button = node('button', tr(label));
        button.type = 'button';
        button.disabled = disabled;
        button.onclick = () => void load({action, handle:row.handle});
        item.append(button);
      }
      return item;
    }));
  }

  /** Sérialise les changements de file et signale les refus dans le panneau actif. */
  async function load(data, target = workshopState.selectedPrinter) {
    if (pending) return;
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
      set('queue-state', rows.length ? '' : tr('La file d’attente est vide.'));
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
    dialog.showModal();
    void load();
  };
  next.onclick = async () => {
    if (pending || next.disabled || queueTarget !== workshopState.selectedPrinter) return;
    const row = nextEntry(), target = queueTarget;
    next.disabled = true;
    dialog.close();
    const result = await command('print-cloud', {handle:row.handle, name:row.name, details:row.details},
      formatText('Vérifiez que le plateau est libre avant d’imprimer « {0} ».', row.name));
    if (result) await load({action:'remove', handle:row.handle}, target);
  };
  return {
    add: handle => load({action:'add', handle}),
    async observe(printer, target) {
      if (!target || !printer?.command_project || printer.printer_online !== true) return;
      const previous = observed.get(target);
      const current = {project:printer.command_project, active:printer.job_in_progress === true};
      observed.set(target, current);
      if (!previous?.active || previous.project !== current.project || printer.job_complete !== true) return;
      try {
        const result = await request('/print-queue', {printerKey:target});
        if (target !== workshopState.selectedPrinter) return;
        const row = result.items.find(item => item.available === true);
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
