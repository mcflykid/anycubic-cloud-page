import { $, fmt, formatText, node, set, tr } from './workshop-ui.mjs';

/** Conserve le suffixe composé d’un fichier tranché dans le champ en lecture seule. */
function extension(name) {
  return name.match(/(?:\.gcode\.3mf|\.[^.]+)$/i)?.[0] || '';
}

/** Lie les fenêtres Cloud aux références opaques de la liste et aux tickets locaux temporaires. */
export function bindFileDialogs({request, command, getRows, getTarget, onRename}) {
  const renameDialog = $('cloud-rename-dialog'), renameForm = $('cloud-rename-form');
  const nameInput = renameForm.elements.name, save = $('cloud-rename-save');
  const downloadDialog = $('cloud-download-dialog'), list = $('cloud-download-links');
  let selected, saving = false, downloadGeneration = 0, timer;
  const downloads = new Map();

  /** Signale les doublons de la liste chargée et préserve l’extension choisie par Anycubic. */
  function validateName() {
    let value = nameInput.value.trim();
    const suffix = selected?.extension || '';
    while (suffix && value.toLowerCase().endsWith(suffix.toLowerCase()))
      value = value.slice(0, -suffix.length).trimEnd();
    const candidate = value + suffix;
    let error = '';
    if (!value || value === '.' || value === '..' || /[/\\\x00-\x1f]/.test(value)) error = 'Nom de fichier invalide';
    else if (candidate === selected?.file.name) error = 'Le nom est inchangé.';
    else if (getRows().some(file => file.handle !== selected?.file.handle &&
      file.name.toLowerCase() === candidate.toLowerCase())) error = 'Ce nom existe déjà dans le dossier.';
    set('cloud-rename-state', tr(error));
    nameInput.setAttribute('aria-invalid', String(!!error && error !== 'Le nom est inchangé.'));
    save.disabled = !!error || saving || selected?.target !== getTarget();
    return value;
  }

  /** Ouvre l’édition sur le nom de base afin de garder le format du fichier. */
  function renameCloud(file) {
    const suffix = extension(file.name);
    selected = {file, extension: suffix, target: getTarget()};
    set('cloud-rename-current', file.name);
    set('cloud-rename-extension', suffix);
    nameInput.value = suffix ? file.name.slice(0, -suffix.length) : file.name;
    validateName();
    renameDialog.showModal();
    nameInput.select();
  }

  nameInput.oninput = validateName;
  renameForm.onsubmit = async event => {
    event.preventDefault();
    const name = validateName();
    if (save.disabled) return;
    saving = true;
    save.disabled = true;
    try {
      const result = await command('cloud-rename', {handle: selected.file.handle, name});
      if (result && renameDialog.open) {
        renameDialog.close();
        await onRename();
      } else if (renameDialog.open) {
        set('cloud-rename-state', tr('Le renommage a échoué.'));
      }
    } finally {
      saving = false;
      if (renameDialog.open) save.disabled = false;
    }
  };

  /** Met à jour les échéances sans remplacer le lien ou son focus avant expiration. */
  function tick() {
    for (const entry of downloads.values()) {
      if (!entry.deadline) continue;
      const seconds = Math.max(0, Math.ceil((entry.deadline - Date.now()) / 1000));
      entry.clock.textContent = seconds
        ? formatText('Valable encore {0} min {1} s', Math.floor(seconds / 60), seconds % 60) : '';
      if (!seconds) {
        const focused = entry.link === document.activeElement;
        entry.deadline = 0;
        entry.link.hidden = true;
        entry.link.removeAttribute('href');
        entry.get.hidden = false;
        if (focused) entry.get.focus();
      }
    }
  }

  /** Demande des tickets locaux et ignore les réponses reçues après fermeture ou changement de cible. */
  async function fetchLinks(handles, generation, target) {
    const entries = handles.map(handle => downloads.get(handle)).filter(Boolean);
    entries.forEach(entry => { entry.get.disabled = true; });
    set('cloud-download-state', tr('Préparation des téléchargements…'));
    try {
      const result = await request('/cloud/downloads', {
        method: 'POST', printerKey: target,
        headers: {'Content-Type': 'application/json'}, body: JSON.stringify({handles}),
      });
      if (generation !== downloadGeneration || target !== getTarget() || !downloadDialog.open) return;
      const links = result.downloads;
      if (!Array.isArray(links) || links.length !== handles.length)
        throw new Error(tr('Les liens de téléchargement sont incomplets.'));
      links.forEach((file, index) => {
        const entry = downloads.get(handles[index]);
        if (!entry) return;
        entry.link.href = file.url;
        entry.deadline = Date.now() + (file.expires_in ?? 300) * 1000;
        entry.link.hidden = false;
        entry.get.hidden = true;
      });
      set('cloud-download-state', '');
      tick();
    } catch (error) {
      if (generation === downloadGeneration && downloadDialog.open)
        set('cloud-download-state', error.message);
    } finally {
      entries.forEach(entry => { entry.get.disabled = false; });
    }
  }

  /** Affiche les fichiers choisis même si la préparation de leurs liens échoue. */
  function downloadCloud(handles) {
    const generation = ++downloadGeneration, target = getTarget();
    downloads.clear();
    list.replaceChildren(...handles.map(handle => {
      const file = getRows().find(row => row.handle === handle);
      const item = node('li', null, 'download-file');
      const label = node('span', file?.name || tr('Fichier'), 'download-filename');
      label.tabIndex = 0;
      label.title = label.textContent;
      const icon = node('span', extension(file?.name || '').slice(1).toUpperCase() || '↓', 'download-format');
      icon.setAttribute('aria-hidden', 'true');
      const size = node('span', fmt(file?.size_mb, ' Mo'), 'download-size');
      const clock = node('small', '', 'download-expiry');
      const get = node('button', tr('Obtenir le lien'));
      get.type = 'button';
      get.onclick = () => void fetchLinks([handle], generation, target);
      const link = node('a', tr('Télécharger'), 'atelier-control');
      link.hidden = true;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      item.append(icon, label, size, clock, get, link);
      downloads.set(handle, {get, link, clock, deadline: 0});
      return item;
    }));
    if (!downloadDialog.open) downloadDialog.showModal();
    clearInterval(timer);
    timer = setInterval(tick, 250);
    if (handles.length) void fetchLinks(handles, generation, target);
    else set('cloud-download-state', tr('Aucun fichier à télécharger.'));
  }
  downloadDialog.addEventListener('close', () => {
    downloadGeneration++;
    clearInterval(timer);
    downloads.clear();
    list.replaceChildren();
  });
  return {downloadCloud, renameCloud};
}
