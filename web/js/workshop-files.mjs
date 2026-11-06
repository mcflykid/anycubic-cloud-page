import {
  $,
  bytes,
  confirmAction,
  fmt,
  formatText,
  message,
  node,
  set,
  tr,
} from './workshop-ui.mjs?v=7bd3fdd4bc0d';
import { workshopState, setBusy } from './workshop-state.mjs?v=624f78b33a34';
import { slots } from './workshop-commands.mjs?v=6b2fda31cc66';
import { createFileThumbnails } from './workshop-file-previews.mjs?v=13e3de636905';

/** Gère la navigation dans les fichiers, les aperçus et l’envoi. */
export function createFiles(request, command) {
  let source = 'local',
    cloudPage = 1,
    cloudFolder = '',
    cloudRows = [],
    filePending = false,
    fileRows = null,
    cloudHasMore = false,
    renameHandle = null;
  const cloudSelected = new Set();
  let fileContext = null,
    fileGeneration = 0,
    fileReload = false,
    uploadAttempt = null;
  const fileThumbnails = createFileThumbnails(
    request,
    (context) =>
      fileContext === context &&
      currentFileContext(context) &&
      workshopState.currentTab === 'files',
  );
  /** Empêche une ancienne liste de fournir des actions pour une autre source ou un autre dossier. */
  function currentFileContext(context) {
    return (
      !!context &&
      context.source === source &&
      context.path === $('file-path').value &&
      context.page === cloudPage &&
      context.folder === cloudFolder &&
      context.printer === workshopState.selectedPrinter
    );
  }
  /** Les actions gardent la source et le chemin de la liste reçue, même après un changement de vue. */
  function renderFiles() {
    fileThumbnails.reset();
    const context = fileContext,
      listedSource = context?.source,
      listedPath = context?.path;
    const list = currentFileContext(context)
      ? listedSource === 'cloud'
        ? cloudRows
        : fileRows
      : null;
    const rows = Array.isArray(list) ? list : [];
    const folderView = source === 'cloud' && !!cloudFolder;
    for (const id of ['file-path-label', 'parent-folder', 'file-actions-column', 'file-mapping-form'])
      $(id).hidden = folderView;
    $('file-rows').replaceChildren(
      ...rows.map((f) => {
        const row = node('tr'),
          name = node('td'),
          size = node('td', fmt(f.size_mb, tr(' Mo'))),
          actions = node('td'),
          wrap = node('div', null, 'actions');
        const identity = node('span', null, 'file-row-identity');
        if (!f.is_dir && !context.folder) identity.append(fileThumbnails.create(f, context));
        identity.append(node('span', f.name));
        name.append(identity);
        const add = (label, fn, cls) => {
          const b = node('button', null, cls);
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('viewBox', '0 0 24 24');
          svg.setAttribute('class', 'ui-icon');
          svg.setAttribute('fill', 'none');
          svg.setAttribute('stroke', 'currentColor');
          svg.setAttribute('stroke-width', '1.7');
          svg.setAttribute('aria-hidden', 'true');
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute(
            'd',
            {
              Télécharger: 'M12 3v12m-4-4l4 4 4-4M4 17v4h16v-4',
              Renommer: 'M4 20l4-1L20 7l-3-3L5 16z',
              Ouvrir: 'M3 7V5h7l2 3h9v12H3z',
              Imprimer: 'M6 8V3h12v5M6 17H3V8h18v9h-3M6 14h12v7H6z',
              Supprimer: 'M3 6h18M8 6V3h8v3M5 6l1 15h12l1-15',
            }[label] || '',
          );
          svg.append(path);
          b.append(svg, node('span', tr(label)));
          b.title =
            {
              Imprimer: tr('Préparer l’impression de ce fichier avec les bobines choisies.'),
              Supprimer: tr('Supprimer ce fichier après confirmation.'),
              Ouvrir: tr('Afficher le contenu de ce dossier.'),
            }[label] || tr(label);
          if (label === 'Imprimer') {
            if (listedSource === 'cloud' && f.printable === false) {
              b.disabled = true;
              b.title = tr('Ce fichier ne contient pas de G-code imprimable.');
            } else if (workshopState.snapshot?.printer?.is_available === false) {
              b.disabled = true;
              b.title = tr('L’imprimante est occupée.');
            }
          }
          b.type = 'button';
          b.onclick = fn;
          wrap.append(b);
        };
        if (source === 'cloud') {
          const check = node('input');
          check.type = 'checkbox';
          check.checked = cloudSelected.has(f.handle);
          check.setAttribute('aria-label', tr('Sélectionner ') + f.name);
          check.onchange = () => {
            check.checked ? cloudSelected.add(f.handle) : cloudSelected.delete(f.handle);
            cloudSelectionState();
          };
          name.prepend(check);
          name.classList.add('cloud-file-name');
          if (!context.folder) {
            add('Télécharger', () => downloadCloud([f.handle]));
            add('Renommer', () => renameCloud(f));
          }
        }
        if (f.is_dir)
          add('Ouvrir', () => {
            $('file-path').value = listedPath.replace(/\/$/, '') + '/' + f.name;
            loadFiles();
          });
        else if (!context.folder) {
          add('Imprimer', async () => {
            try {
              await command(
                `print-${listedSource}`,
                { ...f, path: listedPath, slots: slots($('file-slots').value) },
                formatText('Imprimer « {0} » avec la sélection de bobines indiquée ?', f.name),
              );
            } catch (e) {
              message(e.message, true);
            }
          });
          add(
            'Supprimer',
            async () => {
              const ok = await command(
                `delete-${listedSource}`,
                { ...f, path: listedPath },
                formatText(
                  'Supprimer définitivement « {0} » de {1} ?',
                  f.name,
                  listedSource === 'cloud'
                    ? tr('votre espace cloud')
                    : listedSource === 'usb'
                      ? tr('la clé USB')
                      : tr('la mémoire de l’imprimante'),
                ),
              );
              if (ok) loadFiles();
            },
            'danger',
          );
        }
        actions.append(wrap);
        row.append(name, size);
        if (!folderView) row.append(actions);
        return row;
      }),
    );
    if (source !== 'cloud')
      set(
        'files-state',
        list == null
          ? tr('Liste non reçue. Actualisez ; les résultats arrivent par MQTT.')
          : rows.length
            ? formatText('{0} élément(s).', rows.length)
            : tr('Ce dossier est vide.'),
      );
    $('cloud-tools').hidden = source !== 'cloud';
    if (source === 'cloud') {
      cloudSelectionState();
      loadCloudStorage();
    }
    $('prev-page').hidden = $('next-page').hidden = source !== 'cloud';
    set('cloud-page', source === 'cloud' ? formatText('Page {0}', cloudPage) : '');
    $('prev-page').disabled = cloudPage <= 1;
    $('next-page').disabled = !cloudHasMore || !currentFileContext(context);
  }
  /** Sérialise les lectures MQTT et relance le dernier choix en ignorant toute réponse périmée. */
  async function loadFiles() {
    const generation = ++fileGeneration;
    if (filePending) {
      fileReload = true;
      renderFiles();
      return;
    }
    const context = {
      source,
      path: $('file-path').value,
      page: cloudPage,
      folder: cloudFolder,
      printer: workshopState.selectedPrinter,
    };
    filePending = true;
    renderFiles();
    try {
      set(
        'files-state',
        context.source === 'cloud'
          ? tr('Chargement du cloud…')
          : tr('Lecture du dossier sur l’imprimante…'),
      );
      const result = await request(
        context.source === 'cloud'
          ? `/files/cloud?page=${context.page}` +
            (context.folder ? `&folder=${encodeURIComponent(context.folder)}` : '')
          : `/files/${context.source}?path=${encodeURIComponent(context.path)}`,
        { printerKey: context.printer },
      );
      if (generation !== fileGeneration || !currentFileContext(context)) return;
      fileContext = context;
      if (context.source === 'cloud') {
        cloudRows = result.files;
        cloudHasMore = result.has_more === true;
        if (Array.isArray(result.folders)) {
          const folders = result.folders.map((entry) => new Option(entry.path, entry.reference));
          $('cloud-folder').replaceChildren(new Option(tr('Vue sans dossier'), ''), ...folders);
          $('cloud-folder').value = cloudFolder;
          $('cloud-destination').replaceChildren(
            new Option(tr('Choisir un dossier'), ''),
            ...folders.filter((entry) => entry.value !== cloudFolder && entry.value !== 'root')
              .map((entry) => entry.cloneNode(true)),
          );
        }
      } else fileRows = result.files;
      renderFiles();
      set(
        'files-state',
        context.source === 'cloud'
          ? formatText(
              '{0} fichier(s). Espace utilisé : {1} sur {2}.',
              cloudRows.length,
              fmt(result.store.used_bytes / 1e6, tr(' Mo')),
              fmt(result.store.total_bytes / 1e6, tr(' Mo')),
            )
          : formatText('{0} élément(s) dans {1}.', fileRows.length, result.path),
      );
    } catch (e) {
      if (generation === fileGeneration && currentFileContext(context)) {
        fileContext = null;
        renderFiles();
        message(e.message, true);
        set('files-state', tr('Liste indisponible.'));
      }
    } finally {
      filePending = false;
      if (fileReload) {
        fileReload = false;
        void loadFiles();
      }
    }
  }
  document.querySelectorAll('[data-source]').forEach(
    (b) =>
      (b.onclick = () => {
        source = b.dataset.source;
        cloudSelected.clear();
        if (source !== 'cloud') {
          cloudFolder = '';
          $('cloud-folder').value = '';
        }
        cloudPage = 1;
        fileRows = null;
        document
          .querySelectorAll('[data-source]')
          .forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        $('file-path').disabled = source === 'cloud';
        $('parent-folder').disabled = source === 'cloud';
        renderFiles();
        loadFiles();
      }),
  );
  $('files-form').onsubmit = (e) => {
    e.preventDefault();
    loadFiles();
  };
  $('parent-folder').onclick = () => {
    const parts = $('file-path').value.split('/').filter(Boolean);
    parts.pop();
    $('file-path').value = '/' + parts.join('/');
    loadFiles();
  };
  $('prev-page').onclick = () => {
    if (cloudFolder) cloudSelected.clear();
    cloudPage = Math.max(1, cloudPage - 1);
    loadFiles();
  };
  $('next-page').onclick = () => {
    if (cloudFolder) cloudSelected.clear();
    cloudPage++;
    loadFiles();
  };
  $('cloud-folder').onchange = () => {
    cloudFolder = $('cloud-folder').value;
    cloudPage = 1;
    cloudSelected.clear();
    void loadFiles();
  };
  $('cloud-destination').onchange = cloudSelectionState;
  $('cloud-move-selected').onclick = async () => {
    const context = fileContext, destination = $('cloud-destination');
    if (!currentFileContext(context) || !context.folder || !destination.value) return;
    const ok = await command(
      'cloud-move',
      { source: context.folder, destination: destination.value, handles: [...cloudSelected] },
      formatText(
        'Déplacer {0} fichier(s) de « {1} » vers « {2} » ?',
        cloudSelected.size,
        $('cloud-folder').selectedOptions[0].text,
        destination.selectedOptions[0].text,
      ),
    );
    if (ok && currentFileContext(context)) {
      cloudSelected.clear();
      await loadFiles();
    }
  };
  const uploadInput = $('upload-form').elements.file;
  function validateUpload(files) {
    if (files.length !== 1 || !/\.gcode$/i.test(files[0].name) || !files[0].size) {
      message(tr('Choisissez un seul fichier .gcode non vide.'), true);
      return false;
    }
    if (files[0].size > 100 * 1024 * 1024) {
      message(tr('Le fichier dépasse 100 Mo.'), true);
      return false;
    }
    return true;
  }

  const dropTarget = uploadInput.closest('label');
  dropTarget.ondragover = (event) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = workshopState.busy ? 'none' : 'copy';
  };
  dropTarget.ondrop = (event) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    if (workshopState.busy || !validateUpload(event.dataTransfer.files)) return;
    uploadInput.files = event.dataTransfer.files;
  };

  $('upload-form').onsubmit = async (e) => {
    e.preventDefault();
    if (workshopState.busy) return;
    if (!validateUpload(uploadInput.files)) return;
    const data = new FormData(e.target),
      file = data.get('file');
    try {
      data.set('slots', JSON.stringify(slots(data.get('slots'))));
    } catch (err) {
      message(err.message, true);
      return;
    }
    if (
      !(await confirmAction(
        formatText(
          data.get('mode') === 'upload'
            ? tr('Envoyer « {0} » dans votre espace cloud ?')
            : tr('Envoyer « {0} » et lancer son impression ?'),
          file.name,
        ),
      ))
    )
      return;
    const chosen = e.target.elements.file.files[0],
      intent = JSON.stringify([data.get('mode'), data.get('slots'), workshopState.selectedPrinter]);
    if (!uploadAttempt || uploadAttempt.file !== chosen || uploadAttempt.intent !== intent)
      uploadAttempt = { file: chosen, intent, id: crypto.randomUUID() };
    data.set('request_id', uploadAttempt.id);
    setBusy(true);
    set('upload-state', tr('Envoi en cours. Ne fermez pas cette page.'));
    try {
      const result = await request('/upload', {
        method: 'POST',
        body: data,
        timeoutMs: Math.min(7200000, 300000 + (file.size / 32768) * 2000),
      });
      uploadAttempt = null;
      set('upload-state', result.message);
      message(result.message);
    } catch (err) {
      set('upload-state', err.message);
      message(err.message, true);
    } finally {
      setBusy(false);
    }
  };
  /** Distingue un simple stockage cloud d’un lancement d’impression, bloqué si la machine est occupée. */
  function updateUploadButton() {
    const form = $('upload-form'),
      printing = form.elements.mode.value !== 'upload',
      button = form.querySelector('[type=submit]');
    button.textContent = printing ? tr('Envoyer et imprimer') : tr('Envoyer');
    button.disabled = printing && workshopState.snapshot?.printer?.is_available === false;
    button.title = button.disabled
      ? tr('Une impression est déjà en cours.')
      : printing
        ? tr('Envoyer le G-code et demander son impression après confirmation.')
        : tr('Conserver le G-code dans votre espace cloud sans lancer d’impression.');
  }
  $('upload-form').elements.mode.onchange = () => updateUploadButton();
  /** Synchronise la sélection cloud et l’état indéterminé de la case de page. */
  function cloudSelectionState() {
    const n = cloudSelected.size;
    set('cloud-selected-count', formatText('{0} sélection{1}', n, n > 1 ? 's' : ''));
    for (const id of ['cloud-download-selected', 'cloud-delete-selected']) {
      $(id).hidden = !!cloudFolder;
      $(id).disabled = !n || !!cloudFolder;
    }
    $('cloud-clear-selection').disabled = !n;
    const canMove = !!cloudFolder && currentFileContext(fileContext);
    $('cloud-destination-label').hidden = $('cloud-move-selected').hidden = !canMove;
    $('cloud-move-selected').disabled = !canMove || !n || !$('cloud-destination').value;
    $('cloud-select-page').checked =
      cloudRows.length > 0 && cloudRows.every((f) => cloudSelected.has(f.handle));
    $('cloud-select-page').indeterminate =
      cloudRows.some((f) => cloudSelected.has(f.handle)) && !$('cloud-select-page').checked;
  }
  /** Affiche le quota connu du cloud, sans déduire une capacité d’envoi d’une valeur absente. */
  async function loadCloudStorage() {
    try {
      const d = await request('/extras/storage');
      set(
        'cloud-quota',
        formatText(
          '{0} utilisés sur {1} · {2} disponibles',
          bytes(d.used),
          bytes(d.total),
          bytes(d.free),
        ),
      );
      $('cloud-quota-bar').value = d.total ? Math.min(100, (d.used / d.total) * 100) : 0;
    } catch (e) {
      set('cloud-quota', e.message);
    }
  }
  /** Demande des tickets de téléchargement serveur afin de garder les URL cloud privées côté navigateur. */
  async function downloadCloud(handles) {
    try {
      const result = await request('/cloud/downloads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handles }),
      });
      $('cloud-download-links').replaceChildren(
        ...result.downloads.map((f) => {
          const li = node('li'),
            a = node('a', f.name);
          a.href = f.url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          li.append(a);
          return li;
        }),
      );
      $('cloud-download-dialog').showModal();
    } catch (e) {
      message(e.message, true);
    }
  }
  /** Prépare le renommage de la référence opaque du fichier, sans envoyer de requête avant validation. */
  function renameCloud(f) {
    renameHandle = f.handle;
    $('cloud-rename-form').elements.name.value = f.name;
    $('cloud-rename-dialog').showModal();
    $('cloud-rename-form').elements.name.focus();
  }
  $('cloud-rename-form').onsubmit = async (e) => {
    e.preventDefault();
    const result = await command('cloud-rename', {
      handle: renameHandle,
      name: e.target.elements.name.value,
    });
    if (result) {
      $('cloud-rename-dialog').close();
      cloudSelected.clear();
      await loadFiles();
    }
  };
  $('cloud-select-page').onchange = (e) => {
    for (const f of cloudRows)
      e.target.checked ? cloudSelected.add(f.handle) : cloudSelected.delete(f.handle);
    renderFiles();
  };
  $('cloud-clear-selection').onclick = () => {
    cloudSelected.clear();
    renderFiles();
  };
  $('cloud-download-selected').onclick = () => downloadCloud([...cloudSelected]);
  $('cloud-delete-selected').onclick = async () => {
    const ok = await command(
      'cloud-delete-many',
      { handles: [...cloudSelected] },
      formatText(
        'Supprimer définitivement les {0} fichiers sélectionnés du Cloud Anycubic ?',
        cloudSelected.size,
      ),
    );
    if (ok) {
      cloudSelected.clear();
      await loadFiles();
      await loadCloudStorage();
    }
  };

  function update() {
    if (source !== 'cloud' && workshopState.currentTab === 'files') renderFiles();
  }

  return { loadFiles, renderFiles, updateUploadButton, update };
}
