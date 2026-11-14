import { $, message, node, tr } from './workshop-ui.mjs';

const storageKey = 'cloud-page-spool-inventory';

/** Lie une bobine physique identifiée manuellement à une référence indépendante. */
export function bindSpoolInventory() {
  const dialog = $('spool-inventory-dialog');
  const form = $('spool-inventory-form');
  const list = $('spool-inventory-list');
  let editing;

  function read() {
    try {
      const rows = JSON.parse(localStorage.getItem(storageKey) || '[]');
      return Array.isArray(rows) ? rows.filter(row => row && typeof row.id === 'string' &&
        typeof row.label === 'string' && typeof row.filament === 'string' &&
        (row.spoolman_id == null || Number.isSafeInteger(row.spoolman_id))) : [];
    } catch {
      return [];
    }
  }

  function save(rows) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(rows));
      return true;
    } catch {
      message(tr('Stockage local indisponible.'), true);
      return false;
    }
  }

  function edit(row) {
    editing = row?.id;
    form.elements.label.value = row?.label ?? '';
    form.elements.filament.value = row?.filament ?? '';
    form.elements.spoolman.value = row?.spoolman_id ?? '';
  }

  function show() {
    list.replaceChildren(...read().map(row => {
      const item = node('li');
      const modify = node('button', tr('Modifier'), 'atelier-control');
      const remove = node('button', tr('Supprimer'), 'atelier-control');
      modify.type = remove.type = 'button';
      modify.onclick = () => { edit(row); form.elements.label.focus(); };
      remove.onclick = () => {
        if (save(read().filter(saved => saved.id !== row.id))) {
          if (editing === row.id) edit();
          show();
        }
      };
      item.append(node('span', [row.label, row.filament, row.spoolman_id && 'Spoolman #' + row.spoolman_id]
        .filter(Boolean).join(' · ')), modify, remove);
      return item;
    }));
  }

  $('spool-inventory-open').onclick = () => {
    edit();
    show();
    dialog.showModal();
  };
  form.onsubmit = event => {
    event.preventDefault();
    const label = form.elements.label.value.trim();
    const filament = form.elements.filament.value.trim();
    const spoolman_id = form.elements.spoolman.valueAsNumber || null;
    if (!label || !filament || (spoolman_id !== null && !Number.isSafeInteger(spoolman_id))) return;
    const rows = read();
    if (rows.some(row => row.id !== editing && (row.label.toLocaleLowerCase() === label.toLocaleLowerCase() ||
        (spoolman_id !== null && row.spoolman_id === spoolman_id)))) {
      message(tr('Cette bobine est déjà enregistrée.'), true);
      return;
    }
    if (rows.length >= 500 && !editing) {
      message(tr('Inventaire limité à 500 bobines.'), true);
      return;
    }
    const row = {id:editing ?? crypto.randomUUID(), label, filament, spoolman_id};
    const updated = rows.some(item => item.id === editing) ? rows.map(item => item.id === editing ? row : item) : [...rows, row];
    if (save(updated)) { edit(); show(); }
  };
  $('spool-inventory-export').onclick = () => {
    const rows = read().map(({label, filament, spoolman_id}) => ({label, filament, spoolman_id}));
    const blob = new Blob([JSON.stringify({schema:1, spools:rows}, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const link = node('a');
    link.href = url;
    link.download = 'inventaire-spoolman.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
}
