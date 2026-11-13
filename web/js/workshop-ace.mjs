import { $, fmt, formatText, locale, message, mins, node, set, timeZone, tr } from './workshop-ui.mjs';
import { workshopState } from './workshop-state.mjs';
import { definition, statusBadge } from './workshop-overview.mjs';

// Le même hexadécimal peut désigner deux produits, par exemple PLA blanc et PLA Marble blanc.
const filamentVariants = new Map([
  ['pla glow:236,236,231', { name: 'Blanc à lueur bleue', band: [0, 174, 239] }],
  ['pla glow:215,217,210', { name: 'Blanc à lueur verte' }],
  ['pla marble:239,240,241', { name: 'Blanc marbre' }],
  ['pla marble:157,72,21', { name: 'Rouge brique' }],
]);

/** Associe une couleur unie au catalogue sans remplacer une palette fournie par l’ACE. */
function filamentVariant(spool) {
  if (typeof spool.material_type !== 'string' || !Array.isArray(spool.color) || spool.color.length !== 3)
    return null;
  return filamentVariants.get(`${spool.material_type.trim().toLowerCase()}:${spool.color.join(',')}`);
}

/** Utilise uniquement les triplets RVB valides reçus avec la bobine. */
function spoolColors(color) {
  const colors = [];
  if (Array.isArray(color)) {
    for (let offset = 0; offset + 2 < color.length; offset += 3) {
      const rgb = color.slice(offset, offset + 3);
      if (!rgb.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) break;
      colors.push(`rgb(${rgb.join(',')})`);
    }
  }
  return [...new Set(colors)];
}

/** Illustre la bobine avec les couleurs annoncées par l’ACE et un repère pour les bobines RFID. */
function spoolIllustration(color, index, rfid) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 80 84');
  svg.setAttribute('class', 'spool-illustration');
  svg.setAttribute('aria-hidden', 'true');
  const palette = spoolColors(color);
  const banded = palette.length > 1;
  const winding = banded ? `url(#spool-colors-${index})` : palette[0] || 'rgb(150,150,150)';
  const filament = 'M25 10h26c6 0 10 13 10 29S57 68 51 68H25z';
  svg.innerHTML = `
    <defs>
      ${banded ? `<linearGradient id="spool-colors-${index}">
        ${palette.map((rgb, i) => `<stop offset="${i / palette.length}" stop-color="${rgb}"/><stop offset="${(i + 1) / palette.length}" stop-color="${rgb}"/>`).join('')}
      </linearGradient>` : ''}
      <linearGradient id="spool-wind-${index}" x2="0" y2="1">
        <stop stop-color="#fff" stop-opacity=".36"/><stop offset=".40" stop-color="#fff" stop-opacity=".04"/>
        <stop offset=".72" stop-color="#1a1d22" stop-opacity=".10"/><stop offset="1" stop-color="#151719" stop-opacity=".33"/>
      </linearGradient>
      <linearGradient id="spool-rim-${index}" x2="1" y2="1">
        <stop stop-color="#f7f8f8"/><stop offset=".50" stop-color="#e3e5e4"/><stop offset="1" stop-color="#b8c0be"/>
      </linearGradient>
      <pattern id="spool-wire-${index}" width="1.9" height="8" patternUnits="userSpaceOnUse">
        <path d="M0 0v8" stroke="#182325" stroke-opacity=".17" stroke-width=".43"/>
      </pattern>
    </defs>
    <g transform="rotate(12 39 41)">
      <ellipse cx="53" cy="39" rx="11" ry="35" fill="url(#spool-rim-${index})" stroke="#bec5c2" stroke-width=".7"/>
      <path d="${filament}" fill="${winding}"/>
      <path d="${filament}" fill="url(#spool-wind-${index})"/>
      <path d="${filament}" fill="url(#spool-wire-${index})"/>
      <ellipse cx="26" cy="39" rx="13" ry="36" fill="#bfc6c3" stroke="#b0b9b5" stroke-width=".6"/>
      <ellipse cx="24" cy="39" rx="11.7" ry="35.3" fill="url(#spool-rim-${index})" stroke="#fbfcfc" stroke-width=".9"/>
      <path d="M24 12c2.4 0 4.4 4.2 5 9l-3 5-4-2-1-9zm-4 40 4-1 4 5-1 7-4 4-3-6z" fill="#aab4ae" opacity=".68"/>
      ${rfid === true ? '<g class="spool-rfid-mark" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="21.5" cy="18" r="1.35" fill="currentColor" stroke="none"/><path d="M24 15.2a4 4 0 0 1 0 5.6M26.7 12.8a7.5 7.5 0 0 1 0 10.4"/></g>' : ''}
      <ellipse cx="23.3" cy="39" rx="6.3" ry="12.2" fill="#c2cac5"/>
      <ellipse cx="23.5" cy="39" rx="4" ry="8.5" fill="#69746d"/>
      <path d="M17 16c-3.3 11.6-3.4 31.9-.4 44" fill="none" stroke="#fff" stroke-opacity=".65" stroke-width="1.25"/>
    </g>`;
  if (rfid === true) {
    svg.removeAttribute('aria-hidden');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', tr('Identification RFID'));
  }
  return svg;
}

/** Affiche l’ACE et relie les formulaires aux commandes de la machine. */
export function createAce(command, refresh) {
  let presetsReady = false, dryingPending = false, selectedBoxId = null, selectedPrinter = null;
  let spoolInitial;
  const spoolForm = $('spool-form'), spoolSave = $('spool-save');
  const dryForm = $('dry-form'), presetForm = $('presets-form'), relayButton = $('ace-relay-open');
  const endTime = new Intl.DateTimeFormat(locale, {timeZone, hour: '2-digit', minute: '2-digit'});
  const selectorLabel = node('label', tr('Module ACE'));
  const selector = node('select');
  selector.id = 'ace-selector';
  selectorLabel.className = 'atelier-field';
  selectorLabel.append(selector);
  $('ace-module-name').after(selectorLabel);
  selector.onchange = () => {
    selectedBoxId = selector.value;
    for (const id of ['spool-dialog', 'dry-dialog', 'confirm-dialog']) if ($(id).open) $(id).close();
    renderAce(workshopState.snapshot.printer);
  };
  const lastDryingSettings = new Map();
  /** Conserve le boîtier choisi tant qu’il appartient à la machine sélectionnée. */
  function selectedBox() {
    const boxes = workshopState.snapshot?.printer?.boxes || [];
    if (selectedPrinter !== workshopState.selectedPrinter) {
      selectedPrinter = workshopState.selectedPrinter;
      selectedBoxId = null;
    }
    return boxes.find(box => String(box.box_id) === selectedBoxId) || boxes[0] || null;
  }
  /** Renvoie l’identifiant de l’ACE affiché pour cibler les commandes de bobines et de séchage. */
  function boxData() {
    return { box: selectedBox()?.box_id ?? 0 };
  }
  /** Affiche les bobines et le séchage ; distingue la lecture RFID de la saisie manuelle. */
  function renderAce(p) {
    const box = selectedBox();
    const model = box?.model || tr(box ? 'Module ACE' : 'Aucun module ACE');
    set('ace-model', model);
    set('ace-module-name', model);
    const picture = $('ace-illustration');
    picture.hidden = !box;
    if (box) {
      const src = '/imprimante-api/ui/icons/' + ({ 'ACE 2 Pro': 'ace2pro.png', 'ACE Pro': 'ace-pro.svg' }[box.model] || 'ace.svg');
      if (picture.dataset.illustration !== src) {
        picture.dataset.illustration = src;
        picture.onerror = () => {
          picture.onerror = null;
          picture.src = '/imprimante-api/ui/icons/ace.svg';
        };
        picture.src = src;
      }
    }
    const relayKnown = typeof box?.auto_feed === 'boolean';
    relayButton.disabled = !box || !p.printer_online || !relayKnown;
    relayButton.title = tr(!box ? 'Aucun module ACE détecté.' : !p.printer_online ? 'Hors ligne'
      : !relayKnown ? 'État inconnu' : '');
    set('ace-relay-open', tr(box?.auto_feed ? 'Désactiver' : 'Activer'));
    $('go-drying').disabled = $('go-spool').disabled = !box;
    const previous = selectedBoxId;
    selectedBoxId = box ? String(box.box_id) : null;
    if (previous !== null && previous !== selectedBoxId) {
      for (const id of ['spool-dialog', 'dry-dialog', 'confirm-dialog']) if ($(id).open) $(id).close();
    }
    selector.replaceChildren(...(p.boxes || []).map((entry, index) =>
      new Option(`${tr('Module ACE')} ${index + 1} · ${entry.model || tr('Non renseigné')}`, String(entry.box_id)),
    ));
    selector.value = selectedBoxId || '';
    selectorLabel.hidden = (p.boxes || []).length < 2;
    selector.disabled = dryingPending;
    renderDrying(box, p.printer_online);
    const status = $('ace-status');
    status.classList.toggle('offline', !box || !p.printer_online);
    status.dataset.state = box?.drying?.is_drying ? 'running' : '';
    set('ace-status', tr(!box ? 'Aucun module ACE détecté.' : !p.printer_online ? 'Hors ligne' :
      box.drying?.is_drying ? 'Séchage en cours' : 'Disponible'));
    if (!box) {
      $('spools').replaceChildren(node('p', tr('Aucun module ACE détecté.'), 'muted'));
      $('ace-stats').replaceChildren();
      $('ace-drying-progress').hidden = true;
      set('ace-loaded-count', '');
      set('ace-relay-state', '—');
      return;
    }
    const spools = box.spools || [];
    const loaded = spools.filter(spool => spool.spool_loaded === true).length;
    set('ace-loaded-count', formatText(loaded === 1 ? '{0} bobine chargée' : '{0} bobines chargées', loaded));
    set('spool-dialog-count', $('ace-loaded-count').textContent);
    if ($('spool-dialog').open) updateSpoolActions();
    set('ace-relay-state', tr(!relayKnown ? 'Inconnu' : box.auto_feed ? 'Activé' : 'Désactivé'));
    definition('ace-stats', [
      ['Température', fmt(box.temperature, ' °C')],
      ['Humidité', fmt(box.humidity, ' %')],
    ]);
    $('spools').replaceChildren(
      ...spools.map((spool, index) => {
        const row = node('article', null, 'ace-spool-row'),
          copy = node('div', null, 'ace-spool-copy'),
          remaining = node('div', null, 'ace-spool-remaining'),
          edit = node('button', tr(spool.rfid === true ? 'Voir' : 'Modifier'), 'atelier-control');
        const variant = filamentVariant(spool);
        const winding = variant?.band ? [...spool.color, ...variant.band] : spool.color;
        const illustration = spool.spool_loaded === true
          ? spoolIllustration(winding, `ace-row-${index}`, false)
          : node('span', '—', 'ace-spool-empty');
        illustration.setAttribute('aria-hidden', 'true');
        const title = formatText('Emplacement {0}', spool.display_slot ?? spool.slot);
        copy.append(node('strong', title + ' · ' + (spool.material_type || tr('Non renseigné'))));
        if (typeof spool.rfid === 'boolean')
          copy.append(node('p', tr(spool.rfid ? 'RFID reconnu' : 'Configuration manuelle')));
        if (Number.isInteger(box.loaded_slot) && box.loaded_slot >= 0 && box.loaded_slot === (spool.local_slot ?? spool.slot) - 1)
          copy.append(node('p', tr('Bobine engagée'), 'engaged-spool'));
        remaining.append(node('strong', fmt(spool.remaining_percent, ' %')));
        if (Number.isFinite(spool.remaining_percent)) {
          const progress = node('progress');
          progress.max = 100;
          progress.value = spool.remaining_percent;
          progress.setAttribute('aria-label', title + ' · ' + tr('Filament restant'));
          remaining.append(progress);
        }
        edit.type = 'button';
        edit.onclick = () => openSpool(spool.local_slot || spool.slot);
        row.append(illustration, copy, remaining, edit);
        return row;
      }),
    );
    const dry = box.drying || {};
    const drying = typeof dry.is_drying === 'boolean' ? dry.is_drying : null;
    const progressKnown = drying === true && Number.isFinite(dry.total_duration) && dry.total_duration > 0 && Number.isFinite(dry.remaining_time);
    $('ace-drying-progress').hidden = !progressKnown;
    if (progressKnown) {
      $('ace-drying-bar').value = Math.max(0, Math.min(100, 100 * (1 - dry.remaining_time / dry.total_duration)));
      set('ace-drying-title', dry.target_temperature == null ? tr('Séchage en cours') : formatText('Séchage à {0}', fmt(dry.target_temperature, ' °C')));
      set('ace-drying-remaining', formatText('{0} restantes', mins(dry.remaining_time)));
    }
    if (!presetsReady) {
      presetsReady = true;
      $('preset-fields').replaceChildren(
        ...workshopState.snapshot.presets.map((pr, i) => {
          const fs = node('fieldset');
          fs.append(node('legend', formatText('Préréglage {0}', i + 1)));
          for (const [key, label] of [
            ['name', tr('Nom')],
            ['temperature', tr('Température (°C)')],
            ['hours', tr('Durée (heures)')],
          ]) {
            const l = node('label', label),
              input = node('input');
            input.name = `${i}-${key}`;
            input.defaultValue = pr[key];
            input.type = key === 'name' ? 'text' : 'number';
            input.required = true;
            if (key !== 'name') {
              input.min = key === 'temperature' ? 35 : 1;
              input.max = key === 'temperature' ? 70 : 24;
            }
            fs.append(l);
            l.append(input);
          }
          return fs;
        }),
      );
      $('dry-presets').replaceChildren(...workshopState.snapshot.presets.map((preset, index) => {
        const card = node('label', null, 'spool-slot-option');
        const radio = node('input');
        radio.type = 'radio';
        radio.name = 'dry-preset';
        radio.value = index;
        radio.onchange = () => {
          dryForm.elements.temperature.value = preset.temperature;
          dryForm.elements.hours.value = preset.hours;
          updateDryFields();
        };
        card.append(radio, node('strong', preset.name), node('small', `${preset.temperature} °C · ${preset.hours} h`));
        return card;
      }));
      updateDryFields();
    }
  }
  $('go-spool').onclick = () => openSpool((selectedBox()?.loaded_slot ?? -1) + 1 || 1);
  /** Associe les valeurs saisies aux préréglages sans émettre de commande. */
  function updateDryFields() {
    const temperature = Number(dryForm.elements.temperature.value), hours = Number(dryForm.elements.hours.value);
    const index = workshopState.snapshot?.presets?.findIndex(preset =>
      Number(preset.temperature) === temperature && Number(preset.hours) === hours);
    $('dry-presets').querySelectorAll('input').forEach((radio, position) => { radio.checked = position === index; });
    const printer = workshopState.snapshot?.printer, drying = selectedBox()?.drying?.is_drying;
    const blocked = !printer?.printer_online || typeof drying !== 'boolean' || dryingPending;
    $('dry-start').disabled = blocked || !dryForm.elements.temperature.validity.valid || !dryForm.elements.hours.validity.valid;
    $('dry-stop').disabled = blocked;
    set('dry-start', drying === true ? formatText('Appliquer {0} °C · {1} h', temperature, hours) : tr('Démarrer le séchage'));
  }
  /** Calcule la progression et l’échéance seulement si l’ACE a fourni les durées. */
  function renderDrying(box, online) {
    const dry = box?.drying, active = dry?.is_drying;
    const progress = active === true && Number.isFinite(dry.remaining_time) && Number.isFinite(dry.total_duration) && dry.total_duration > 0;
    statusBadge('drying-state', tr(active === true ? 'Séchage en cours' : active === false
      ? 'Séchage inactif' : 'État du séchage inconnu'), typeof active === 'boolean' ? active : null);
    set('drying-detail', active === true
      ? formatText('Séchage à {0}', fmt(dry.target_temperature, ' °C'))
      : tr(active === false ? 'Aucun séchage en cours' : 'État du séchage inconnu'));
    $('dry-remaining').hidden = $('dry-progress').hidden = !progress;
    if (progress) {
      set('dry-remaining', formatText('{0} restantes', mins(dry.remaining_time)));
      $('dry-progress').value = Math.max(0, Math.min(100, 100 * (1 - dry.remaining_time / dry.total_duration)));
    }
    definition('dry-measurements', [
      ['Température', fmt(box?.temperature, ' °C')],
      ['Humidité', fmt(box?.humidity, ' %')],
      ...(progress ? [['Fin prévue', endTime.format(Date.now() + dry.remaining_time * 60000)]] : []),
    ]);
    $('dry-stop').hidden = active !== true;
    updateDryFields();
    $('dry-edit-presets').disabled = !online;
  }
  /** Retient le dernier réglage accepté séparément pour chaque imprimante et boîtier. */
  async function startDrying(settings, question) {
    const target = workshopState.selectedPrinter, box = boxData();
    const result = await command('dry-start', { ...settings, ...box }, question);
    if (result) lastDryingSettings.set(`${target}:${box.box}`, settings);
  }
  /** Choisit le réglage en cours, le dernier accepté, puis le préréglage du filament chargé. */
  function dryingSettings() {
    const box = selectedBox(), dry = box?.drying;
    const known = lastDryingSettings.get(`${workshopState.selectedPrinter}:${boxData().box}`);
    const reported = {temperature: dry?.target_temperature, hours: Math.ceil(dry?.total_duration / 60)};
    const valid = Number.isInteger(reported.temperature) && reported.temperature >= 35 &&
      reported.temperature <= 70 && reported.hours >= 1 && reported.hours <= 24;
    if (valid && dry?.is_drying) return reported;
    if (known) return known;
    if (valid) return reported;
    const spool = box?.spools?.find((entry) => (entry.local_slot ?? entry.slot) === box.loaded_slot + 1);
    const material = String(spool?.material_type || '').trim().toUpperCase();
    return workshopState.snapshot?.presets?.find((entry) =>
      material && entry.name.toUpperCase().split('/').some((name) => name.trim() === material),
    ) || {
      temperature: Number($('dry-form').elements.temperature.defaultValue),
      hours: Number($('dry-form').elements.hours.defaultValue),
    };
  }
  $('go-drying').onclick = () => {
    const settings = dryingSettings();
    dryForm.elements.temperature.value = settings.temperature;
    dryForm.elements.hours.value = settings.hours;
    updateDryFields();
    if (!$('dry-dialog').open) $('dry-dialog').showModal();
    dryForm.elements.temperature.focus({ preventScroll: true });
  };
  relayButton.onclick = () => {
    const enabled = selectedBox()?.auto_feed;
    if (relayButton.disabled || typeof enabled !== 'boolean') return;
    command('auto-feed', { ...boxData(), enabled: !enabled },
      tr('Modifier le relais automatique des bobines ?'));
  };
  /** L’édition des préréglages reste dans la même fenêtre, avec retour du focus. */
  function editPresets(open) {
    presetForm.hidden = !open;
    $('dry-presets').hidden = $('dry-edit-presets').hidden = open;
    if (open) presetForm.querySelector('input')?.focus();
    else $('dry-edit-presets').focus();
  }
  $('dry-edit-presets').onclick = () => editPresets(true);
  $('dry-cancel-presets').onclick = () => { presetForm.reset(); editPresets(false); };
  $('dry-dialog').addEventListener('close', () => {
    presetForm.reset();
    presetForm.hidden = true;
    $('dry-presets').hidden = $('dry-edit-presets').hidden = false;
  });
  $('spool-color').oninput = () => {
    const value = $('spool-color').value;
    set('spool-color-value', value.toUpperCase());
    const color = [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
    $('spool-dialog-preview').replaceChildren(spoolIllustration(color, 'dialog', false));
  };
  /** Autorise l’enregistrement quand les valeurs manuelles diffèrent de la fiche ouverte. */
  function updateSpoolSave() {
    const {material, color} = spoolForm.elements;
    const rgb = [1, 3, 5].map(offset => Number.parseInt(color.value.slice(offset, offset + 2), 16));
    const variant = filamentVariant({material_type: material.value, color: rgb});
    $('spool-catalog-color').hidden = !variant;
    set('spool-catalog-color', variant ? tr(variant.name) : '');
    spoolSave.disabled = material.disabled || !material.value ||
      (material.value === spoolInitial?.material && color.value === spoolInitial?.color);
  }
  /** Interdit les actions de filament pendant une impression ou une perte de connexion. */
  function updateSpoolActions() {
    const printer = workshopState.snapshot?.printer;
    const reason = !printer?.printer_online ? 'Hors ligne'
      : printer.job_in_progress ? 'Indisponible pendant une impression' : '';
    for (const id of ['feed', 'retract', 'feed-finish']) $(id).disabled = !!reason;
    set('spool-action-state', tr(reason));
    $('spool-action-state').hidden = !reason;
  }
  spoolForm.addEventListener('input', event => {
    if (event.target.name !== 'slot') updateSpoolSave();
  });
  spoolForm.onsubmit = async (e) => {
    e.preventDefault();
    if (spoolSave.disabled) return;
    const d = Object.fromEntries(new FormData(e.target));
    if (!d.material) {
      message(tr('Choisissez un matériau compatible avant d’enregistrer cette bobine.'), true);
      return;
    }
    const result = await command(
      'slot',
      { ...d, ...boxData() },
      tr('Enregistrer ce matériau et cette couleur dans l’ACE ?'),
    );
    if (result && spoolForm.elements.slot.value === d.slot) fillSpool(d.slot);
  };
  for (const [id, action, extra, question] of [
    ['feed', 'feed', {}, tr('Charger le filament sélectionné ?')],
    ['feed-finish', 'feed', { finish: true }, tr('Terminer le chargement ?')],
    ['retract', 'retract', {}, tr('Retirer le filament sélectionné ?')],
  ])
    $(id).onclick = () =>
      command(
        action,
        { ...boxData(), slot: $('spool-form').elements.slot.value, ...extra },
        question,
      );
  dryForm.oninput = updateDryFields;
  dryForm.onsubmit = async (e) => {
    e.preventDefault();
    if ($('dry-start').disabled) return;
    const settings = Object.fromEntries(new FormData(dryForm));
    dryingPending = true;
    updateDryFields();
    try {
      await startDrying(settings, tr('Démarrer le séchage avec ces paramètres ?'));
    } finally {
      dryingPending = false;
      updateDryFields();
    }
  };
  $('dry-stop').onclick = async () => {
    if ($('dry-stop').disabled) return;
    dryingPending = true;
    updateDryFields();
    try {
      await command('dry-stop', boxData(), tr('Arrêter le séchage du module sélectionné ?'));
    } finally {
      dryingPending = false;
      updateDryFields();
    }
  };
  $('presets-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target),
      presets = Array.from({ length: 4 }, (_, i) =>
        Object.fromEntries(['name', 'temperature', 'hours'].map((k) => [k, f.get(`${i}-${k}`)])),
      );
    const d = await command('presets', { presets });
    if (d) {
      presetsReady = false;
      await refresh();
      editPresets(false);
    }
  };
  /** Préremplit la fiche du numéro local, y compris un emplacement absent de la télémétrie. */
  function fillSpool(slot) {
    const form = spoolForm,
      data = selectedBox()?.spools?.find((s) => Number(s.local_slot || s.slot) === Number(slot)) || {};
    form.elements.slot.value = String(slot);
    const material = form.elements.material;
    const editable = workshopState.snapshot?.printer?.editable_materials;
    if (Array.isArray(editable) && editable.every(value => typeof value === 'string'))
      material.replaceChildren(...editable.map(value => new Option(value, value)));
    for (const option of [...material.options]) if (option.dataset.detected) option.remove();
    if (data.material_type && ![...material.options].some((o) => o.value === data.material_type)) {
      const option = new Option(data.material_type + tr(' (détecté)'), data.material_type);
      option.dataset.detected = 'true';
      option.disabled = true;
      material.add(option);
    }
    material.value = data.material_type || 'PLA';
    form.elements.color.value =
      '#' +
      (data.color || [150, 150, 150])
        .slice(0, 3)
        .map((v) =>
          Math.max(0, Math.min(255, Number(v) || 0))
            .toString(16)
            .padStart(2, '0'),
        )
        .join('');
    set('spool-color-value', form.elements.color.value.toUpperCase());
    const automatic = data.rfid === true;
    form.elements.material.disabled = automatic;
    form.elements.color.disabled = automatic;
    $('spool-material-edit').hidden = $('spool-color-edit').hidden = automatic;
    $('spool-material-read').hidden = $('spool-color-read').hidden = !automatic;
    set('spool-material-value', data.material_type || '—');
    set('spool-color-read-value', form.elements.color.value.toUpperCase());
    set('spool-remaining', fmt(data.remaining_percent, ' %'));
    $('spool-remaining-progress').hidden = !Number.isFinite(data.remaining_percent);
    $('spool-remaining-progress').value = data.remaining_percent ?? 0;
    set('spool-action-title', formatText('Filament de l’emplacement {0}', slot));
    set('spool-selected-state', selectedBox()?.loaded_slot === Number(slot) - 1 ? tr('Bobine engagée') : '');
    // La fiche indique la couleur de base, même si la liste représente plusieurs composantes.
    $('spool-dialog-preview').replaceChildren(spoolIllustration(data.color?.slice(0, 3), 'dialog', automatic));
    set('spool-rfid-note', tr(automatic
      ? 'RFID reconnu. Matériau et couleur sont lus sur la bobine.'
      : data.rfid === false
        ? 'Réglage manuel de la bobine. Matériau et couleur modifiables.'
        : 'Statut RFID inconnu. Les champs restent modifiables.'));
    $('spool-rfid-note').hidden = false;
    $('spool-rfid-note').dataset.state = automatic ? 'normal' : data.rfid === false ? 'manual' : 'unknown';
    spoolInitial = { material: material.value, color: form.elements.color.value };
    updateSpoolSave();
    updateSpoolActions();
  }
  /** Ouvre les données du numéro local de bobine et place le focus sur sa sélection. */
  function openSpool(slot) {
    const box = selectedBox();
    $('spool-slot-options').replaceChildren(...[1, 2, 3, 4].map(number => {
      const data = box?.spools?.find(spool => Number(spool.local_slot ?? spool.slot) === number);
      const label = node('label', null, 'spool-slot-option');
      const input = node('input');
      input.type = 'radio';
      input.name = 'slot';
      input.value = String(number);
      const dot = node('span', null, 'spool-slot-dot');
      dot.setAttribute('aria-hidden', 'true');
      dot.style.backgroundColor = spoolColors(data?.color)[0] || 'transparent';
      const title = data?.spool_loaded === false || !data ? tr('Vide') : data.material_type || tr('Non renseigné');
      const origin = data?.rfid === true ? 'RFID' : data?.rfid === false ? tr('Manuel') : tr('Inconnu');
      label.append(input, dot, node('strong', number + ' · ' + title), node('small', origin));
      return label;
    }));
    fillSpool(slot);
    if (!$('spool-dialog').open) $('spool-dialog').showModal();
    spoolForm.querySelector('[name=slot]:checked')?.focus({ preventScroll: true });
  }
  $('spool-slot-options').onchange = (e) => fillSpool(e.target.value);

  return { selectedBox, boxData, renderAce };
}
