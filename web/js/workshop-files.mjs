import {
  $,
  beginListLoading,
  bytes,
  confirmAction,
  fmt,
  formatText,
  message,
  node,
  set,
  tr,
} from './workshop-ui.mjs';
import { workshopState, setBusy } from './workshop-state.mjs';
import { slots, filamentAdvice, filamentMetadata } from './workshop-commands.mjs';
import { createFileThumbnails } from './workshop-file-previews.mjs';
import { createUploadMotion } from './workshop-upload-motion.mjs';
import { closePrintConfirmation, confirmPrint, showPrintProgress, showPrintResult } from './workshop-print-confirmation.mjs';
import { bindFileDialogs } from './workshop-file-dialogs.mjs';

import { createSelectionCounter, initializePaintSelection } from './workshop-selection.mjs';

/** Gère la navigation dans les fichiers, les aperçus et l’envoi. */
export function createFiles(request, command) {
  let source = 'local',
    cloudPage = 1,
    cloudFolder = '',
    cloudRows = [],
    filePending = false,
    fileRows = null,
    cloudHasMore = false;
  const cloudSelected = new Set();
  const cloudCount = createSelectionCounter($('cloud-selection-digits'));
  cloudCount.pon(0);
  const isPainting = initializePaintSelection($('file-rows'), () => cloudSelectionState());
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
  /** La recherche et le tri ne portent que sur la liste déjà reçue, sans appel au stockage. */
  function visibleFiles(list) {
    const query = $('files-search').value.trim().toLocaleLowerCase();
    const sort = $('files-sort').value;
    const rows = list.filter((file) => file.name.toLocaleLowerCase().includes(query));
    if (sort === 'name') rows.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'size') rows.sort((a, b) => (b.size_mb ?? -1) - (a.size_mb ?? -1));
    return rows;
  }
  /** Les actions gardent la source et le chemin de la liste reçue, même après un changement de vue. */
  function renderFiles(refreshQuota = true) {
    fileThumbnails.reset();
    const context = fileContext,
      listedSource = context?.source,
      listedPath = context?.path;
    const list = currentFileContext(context)
      ? listedSource === 'cloud'
        ? cloudRows
        : fileRows
      : null;
    const rows = Array.isArray(list) ? visibleFiles(list) : [];
    const folderView = source === 'cloud' && !!cloudFolder;
    const isCloud = source === 'cloud';
    const parent = $('cloud-folder-parent');
    parent.hidden = !isCloud;
    parent.disabled = !currentFileContext(context) || !cloudParent();
    for (const id of ['file-path-label', 'parent-folder']) $(id).hidden = isCloud;
    for (const id of ['cloud-folder-label', 'file-selection-column', 'files-footer'])
      $(id).hidden = !isCloud;
    $('file-actions-column').hidden = folderView;
    set('files-title', tr({ local: 'Mémoire imprimante', usb: 'Clé USB', cloud: 'Cloud Anycubic' }[source]));
    if (!isCloud) $('files-state').hidden = false;
    $('file-rows').replaceChildren(
      ...rows.map((f) => {
        const row = node('tr'),
          name = node('td', null, 'files-identity-cell'),
          size = node('td', fmt(f.size_mb, tr(' Mo')), 'files-size'),
          actions = node('td', null, 'files-actions-cell'),
          wrap = node('div', null, 'files-row-actions');
        const identity = node('span', null, 'file-row-identity');
        if (!f.is_dir && !context.folder) identity.append(fileThumbnails.create(f, context));
        const caption = node('span', null, 'file-row-caption');
        caption.append(node('strong', f.name));
        // Les extensions et le statut imprimable restent distincts pour les modèles non tranchés.
        const extension = f.name.match(/\.([^.]+)$/)?.[1]?.toLowerCase();
        const format = f.is_dir ? tr('Dossier') : extension === 'gcode' ? 'G-code' : extension?.toUpperCase();
        const printable = !f.is_dir && (listedSource === 'cloud' ? f.printable === true || (f.printable !== false && extension === 'gcode') : extension === 'gcode');
        if (format) caption.append(node('span', printable ? formatText('{0} · imprimable', format) : format));
        identity.append(caption);
        name.append(identity);
        const add = (label, fn, cls) => {
          const textButton = label === 'Imprimer' || label === 'Ouvrir';
          const b = node('button', null, 'atelier-control');
          if (cls === 'danger') b.classList.add('atelier-control-danger');
          if (!textButton) b.classList.add('atelier-control-icon');
          b.setAttribute('aria-label', tr(label));
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
          if (textButton) b.textContent = tr(label);
          else b.append(svg);
          b.title =
            {
              Imprimer: tr('Préparer l’impression de ce fichier avec les bobines choisies.'),
              Supprimer: tr('Supprimer ce fichier après confirmation.'),
              Ouvrir: tr('Afficher le contenu de ce dossier.'),
            }[label] || tr(label);
          if (label === 'Imprimer') {
            if (listedSource !== 'cloud' && !String(f.name).toLowerCase().endsWith('.gcode')) {
              b.disabled = true;
              b.title = tr('Le lancement direct de ce format attend une validation de compatibilité.');
            } else if (listedSource === 'cloud' && f.printable === false) {
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
        if (isCloud) {
          const check = node('input');
          check.type = 'checkbox';
          check.dataset.selection = f.handle;
          check.checked = cloudSelected.has(f.handle);
          check.setAttribute('aria-label', tr('Sélectionner ') + f.name);
          check.onchange = () => {
            check.checked ? cloudSelected.add(f.handle) : cloudSelected.delete(f.handle);
            row.classList.toggle('file-selected', check.checked);
            if (!isPainting()) cloudSelectionState();
          };
          const gutter = node('span', null, 'file-selection-gutter');
          gutter.append(check);
          const selectCell = node('td', null, 'files-selection-cell');
          selectCell.append(gutter);
          row.append(selectCell);
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
                { ...f, path: listedPath },
                formatText(
                  'Imprimer « {0} » sur « {1} » ? Vérifiez que le plateau est libre.',
                  f.name,
                  workshopState.snapshot?.printer?.name || tr('Imprimante sélectionnée'),
                ),
                undefined,
                undefined,
                row.querySelector('img')?.currentSrc,
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
        const print = wrap.querySelector('button:not(.atelier-control-icon)');
        if (print) wrap.prepend(print);
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
    if (list === null) $('files-state').dataset.visualState = 'waiting';
    else if (rows.length === 0) $('files-state').dataset.visualState = 'empty';
    else delete $('files-state').dataset.visualState;
    $('cloud-tools').hidden = source !== 'cloud';
    if (source === 'cloud') {
      if (Array.isArray(list)) set('files-state', formatText(rows.length === 1 ? '{0} fichier' : '{0} fichiers', rows.length));
      cloudSelectionState();
      if (refreshQuota) loadCloudStorage();
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
    $('files-state').dataset.visualState = 'loading';
    renderFiles();
    const stopLoading = beginListLoading($('file-rows'), $('files-loading'), () => {
      if (generation !== fileGeneration || !currentFileContext(context)) return false;
      set('files-state', context.source === 'cloud'
        ? tr('Chargement du cloud…') : tr('Lecture du dossier sur l’imprimante…'));
    });
    try {
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
          const folders = result.folders.map((entry) => {
            const option = new Option(entry.reference === 'root' ? tr('Racine (/)') : entry.path, entry.reference);
            option.dataset.path = entry.path;
            return option;
          });
          $('cloud-folder').replaceChildren(new Option('/', ''), ...folders);
          $('cloud-folder').value = cloudFolder;
          $('cloud-destination').replaceChildren(
            new Option(tr('Choisir un dossier'), ''),
            ...folders.filter((entry) => entry.value !== cloudFolder && entry.value !== 'root')
              .map((entry) => entry.cloneNode(true)),
          );
        }
      } else fileRows = result.files;
      renderFiles();
      if (context.source !== 'cloud')
        set('files-state', formatText('{0} élément(s) dans {1}.', visibleFiles(fileRows).length, result.path));
    } catch (e) {
      if (generation === fileGeneration && currentFileContext(context)) {
        fileContext = null;
        renderFiles();
        message(e.message, true);
        set('files-state', tr('Liste indisponible.'));
        $('files-state').dataset.visualState = 'error';
      }
    } finally {
      stopLoading();
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
  $('files-search').oninput = () => {
    cloudSelected.clear();
    renderFiles(false);
  };
  $('files-sort').onchange = () => renderFiles(false);
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
  /** Trouve le parent parmi les références déjà validées par le serveur. */
  function cloudParent() {
    const select = $('cloud-folder');
    const path = select.selectedOptions[0]?.dataset.path;
    if (!path || path === '/') return '';
    const parentPath = path.slice(0, path.lastIndexOf('/')) || '/';
    return [...select.options].find((option) => option.dataset.path === parentPath)?.value || '';
  }
  /** Un changement de dossier invalide la sélection et revient à la première page. */
  function openCloudFolder(reference) {
    $('cloud-folder').value = reference;
    cloudFolder = reference;
    cloudPage = 1;
    cloudSelected.clear();
    void loadFiles();
  }
  $('cloud-folder').onchange = () => openCloudFolder($('cloud-folder').value);
  $('cloud-folder-parent').onclick = () => {
    const parent = cloudParent();
    if (parent) openCloudFolder(parent);
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
  const uploadDrop = uploadInput.closest('label');
  const setUploadPending = createUploadMotion(uploadDrop);
  /** Le serveur contrôle aussi le format et la taille avant toute transmission. */
  function validateUpload(files) {
    if (files.length !== 1 || !/\.(gcode|stl|3mf)$/i.test(files[0].name) || !files[0].size) {
      message(tr('Choisissez un seul fichier G-code, STL ou 3MF non vide.'), true);
      return false;
    }
    if (files[0].size > 100 * 1024 * 1024) {
      message(tr('Le fichier dépasse 100 Mo.'), true);
      return false;
    }
    return true;
  }

  uploadDrop.ondragover = (event) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = workshopState.busy ? 'none' : 'copy';
  };
  uploadDrop.ondrop = (event) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    if (workshopState.busy || !validateUpload(event.dataTransfer.files)) return;
    uploadInput.files = event.dataTransfer.files;
    updateUploadButton();
  };

  /** Refuse confirmation et transfert tant que la requête ne peut pas viser une imprimante explicite. */
  $('upload-form').onsubmit = async (e) => {
    e.preventDefault();
    if (workshopState.busy) return;
    if (!validateUpload(uploadInput.files)) return;
    updateUploadButton();
    if (!workshopState.selectedPrinter) return;
    const data = new FormData(e.target),
      file = data.get('file');
    try {
      data.set('slots', JSON.stringify(data.get('mode') === 'upload' ? [] : slots(data.get('slots'))));
    } catch (err) {
      message(err.message, true);
      return;
    }
    const target = workshopState.selectedPrinter;
    const printing = data.get('mode') !== 'upload';
    if (printing) {
      try {
        const {details, ...metadata} = await filamentMetadata(file);
        const mapping = JSON.parse(data.get('slots'));
        const advice = await filamentAdvice(request, {...metadata, slots: mapping}, target);
        if (target !== workshopState.selectedPrinter || file !== e.target.elements.file.files[0]) return;
        const confirmation = await confirmPrint({
          target, name: file.name, details, advice, question: tr('Vérifiez que le plateau est libre.'),
          mappingText: mapping.length ? formatText('Ordre des bobines pour l’impression : {0}', mapping.join(', ')) : '',
        });
        if (!confirmation) return;
      } catch (err) { message(err.message, true); return; }
    } else if (!(await confirmAction(formatText('Envoyer « {0} » dans votre espace cloud ?', file.name)))) return;
    if (target !== workshopState.selectedPrinter) {
      if (printing) closePrintConfirmation();
      message(tr('La cible a changé : commande annulée.'), true); return;
    }
    if (workshopState.busy || file !== e.target.elements.file.files[0] ||
        data.get('mode') !== e.target.elements.mode.value) {
      if (printing) closePrintConfirmation();
      return;
    }
    const intent = JSON.stringify([data.get('mode'), data.get('slots'), target]);
    if (!uploadAttempt || uploadAttempt.file !== file || uploadAttempt.intent !== intent)
      uploadAttempt = { file, intent, id: crypto.randomUUID() };
    data.set('request_id', uploadAttempt.id);
    setBusy(true);
    setUploadPending(true);
    set('upload-state', tr('Envoi en cours. Ne fermez pas cette page.'));
    if (printing) showPrintProgress(tr('Transfert et demande d’impression en cours…'));
    try {
      const result = await request('/upload', {
        method: 'POST',
        body: data, printerKey: target,
        timeoutMs: Math.min(7200000, 300000 + (file.size / 32768) * 2000),
      });
      uploadAttempt = null;
      set('upload-state', result.message);
      message(result.message);
      if (printing) showPrintResult(result.message || tr('Demande traitée. Vérifiez l’état de l’imprimante.'));
      void loadCloudStorage();
    } catch (err) {
      set('upload-state', err.message);
      message(err.message, true);
      if (printing) showPrintResult(err.message, err.errorSheet);
    } finally {
      setUploadPending(false);
      setBusy(false);
    }
  };
  /** Attend une clé imprimante : le serveur refuse toute mutation sans cible explicite. */
  function updateUploadButton() {
    const form = $('upload-form'), mode = form.elements.mode;
    const filename = uploadInput.files[0]?.name;
    set('upload-file-name', filename || tr('Aucun fichier choisi'));
    $('upload-file-name').dataset.state = filename ? 'normal' : 'unknown';
    const storageOnly = filename != null && !/\.gcode$/i.test(filename);
    let formatNote = $('upload-format-note');
    if (!formatNote) {
      formatNote = node('p', '', 'settings-help');
      formatNote.id = 'upload-format-note';
      (mode.closest('.upload-options') || mode.closest('label')).after(formatNote);
      mode.setAttribute('aria-describedby', formatNote.id);
    }
    formatNote.hidden = !storageOnly;
    formatNote.textContent = storageOnly ? tr('Ce fichier peut être stocké dans le Cloud. Les options d’impression sont disponibles pour les fichiers .gcode.') : '';
    if (storageOnly) mode.value = 'upload';
    for (const option of mode.options) option.disabled = storageOnly && option.value !== 'upload';
    const printing = mode.value !== 'upload', button = form.querySelector('[type=submit]');
    form.elements.slots.disabled = !printing;
    form.elements.slots.closest('label').hidden = !printing;
    const targetMissing = !workshopState.selectedPrinter,
      targetMessage = tr('Une imprimante explicite est requise. Actualisez la page.');
    button.textContent = printing ? tr('Envoyer et imprimer') : tr('Envoyer');
    button.disabled = targetMissing || (printing && workshopState.snapshot?.printer?.is_available === false);
    if (targetMissing) set('upload-state', targetMessage);
    else if ($('upload-state').textContent === targetMessage) set('upload-state', '');
    button.title = targetMissing
      ? targetMessage
      : button.disabled
        ? tr('Une impression est déjà en cours.')
      : printing
        ? tr('Envoyer le G-code et demander son impression après confirmation.')
        : tr('Conserver le fichier dans votre espace cloud sans lancer d’impression.');
  }
  $('upload-form').elements.mode.onchange = uploadInput.onchange = updateUploadButton;
  updateUploadButton();
  /** Synchronise la sélection cloud et l’état indéterminé de la case de page. */
  function cloudSelectionState() {
    const n = cloudSelected.size;
    for (const input of $('file-rows').querySelectorAll('input[data-selection]')) {
      const selected = cloudSelected.has(input.dataset.selection);
      input.checked = selected;
      input.closest('tr').classList.toggle('file-selected', selected);
    }
    $('cloud-tools').classList.toggle('has-selection', n > 0);
    $('files-state').hidden = n > 0;
    let total = 0, known = true;
    for (const file of cloudRows.filter(f => cloudSelected.has(f.handle))) {
      if (!Number.isFinite(file.size_mb)) known = false;
      else total += file.size_mb;
    }
    set('cloud-selected-size', n ? known ? fmt(total, tr(' Mo')) : tr('Taille inconnue') : '');
    const plural = n > 1 ? 's' : '';
    const [prefix, suffix] = tr('{0} sélection{1}').replace('{1}', plural).split('{0}');
    set('cloud-selected-count', formatText('{0} sélection{1}', n, plural));
    set('cloud-selection-prefix', prefix || '');
    set('cloud-selection-suffix', suffix || '');
    cloudCount.pon(n);
    for (const id of ['cloud-download-selected', 'cloud-delete-selected']) {
      $(id).hidden = !!cloudFolder;
      $(id).disabled = !n || !!cloudFolder;
    }
    $('cloud-clear-selection').disabled = !n;
    const canMove = !!cloudFolder && currentFileContext(fileContext);
    $('cloud-destination-label').hidden = $('cloud-move-selected').hidden = !canMove;
    $('cloud-move-selected').disabled = !canMove || !n || !$('cloud-destination').value;
    const visible = currentFileContext(fileContext) ? visibleFiles(cloudRows) : [];
    $('cloud-select-page').checked =
      visible.length > 0 && visible.every((f) => cloudSelected.has(f.handle));
    $('cloud-select-page').indeterminate =
      visible.some((f) => cloudSelected.has(f.handle)) && !$('cloud-select-page').checked;
  }
  /** Affiche le quota connu du cloud, sans déduire une capacité d’envoi d’une valeur absente. */
  async function loadCloudStorage() {
    try {
      const d = await request('/extras/storage');
      const quota = formatText('{0} sur {1}', bytes(d.used), bytes(d.total));
      const percentage = d.total && Number.isFinite(d.used) ? Math.min(100, (d.used / d.total) * 100) : 0;
      for (const id of ['cloud-quota', 'upload-cloud-quota']) {
        set(id, quota);
        $(id + '-bar').value = percentage;
      }
    } catch (e) {
      for (const id of ['cloud-quota', 'upload-cloud-quota']) set(id, e.message);
    }
  }
  const {downloadCloud, renameCloud} = bindFileDialogs({
    request, command,
    getRows: () => cloudRows,
    getTarget: () => workshopState.selectedPrinter,
    onRename: async () => {
      cloudSelected.clear();
      await loadFiles();
    },
  });
  $('cloud-select-page').onchange = (e) => {
    if (!currentFileContext(fileContext)) return;
    for (const f of visibleFiles(cloudRows))
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

  return { loadFiles, loadCloudStorage, renderFiles, updateUploadButton, update };
}
