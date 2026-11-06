import { $, fmt, formatText, message, mins, node, set, tr } from './workshop-ui.mjs?v=7bd3fdd4bc0d';
import { workshopState } from './workshop-state.mjs?v=624f78b33a34';
import { definition, statusBadge } from './workshop-overview.mjs?v=5af065eebab4';

/** Illustre la bobine avec la couleur annoncée par l’ACE et des dégradés propres à chaque emplacement. */
function spoolIllustration(color, index) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 80 84');
  svg.setAttribute('class', 'spool-illustration');
  svg.setAttribute('aria-hidden', 'true');
  const channels = Array.isArray(color) && color.length >= 3 ? color.slice(0, 3) : [150, 150, 150];
  const rgb = channels.map((value) => Math.max(0, Math.min(255, Number(value) || 0))).join(',');
  const filament = 'M25 10h26c6 0 10 13 10 29S57 68 51 68H25z';
  svg.innerHTML = `
    <defs>
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
      <path d="${filament}" fill="rgb(${rgb})"/>
      <path d="${filament}" fill="url(#spool-wind-${index})"/>
      <path d="${filament}" fill="url(#spool-wire-${index})"/>
      <ellipse cx="26" cy="39" rx="13" ry="36" fill="#bfc6c3" stroke="#b0b9b5" stroke-width=".6"/>
      <ellipse cx="24" cy="39" rx="11.7" ry="35.3" fill="url(#spool-rim-${index})" stroke="#fbfcfc" stroke-width=".9"/>
      <path d="M24 12c2.4 0 4.4 4.2 5 9l-3 5-4-2-1-9zm-4 40 4-1 4 5-1 7-4 4-3-6z" fill="#aab4ae" opacity=".68"/>
      <ellipse cx="23.3" cy="39" rx="6.3" ry="12.2" fill="#c2cac5"/>
      <ellipse cx="23.5" cy="39" rx="4" ry="8.5" fill="#69746d"/>
      <path d="M17 16c-3.3 11.6-3.4 31.9-.4 44" fill="none" stroke="#fff" stroke-opacity=".65" stroke-width="1.25"/>
    </g>`;
  return svg;
}

/** Affiche l’ACE et relie les formulaires aux commandes de la machine. */
export function createAce(command, refresh) {
  let presetsReady = false, dryingPending = false;
  const lastDryingSettings = new Map();
  /** Renvoie le premier ACE connu, ou null ; cette interface ne propose pas de sélection de second boîtier. */
  function selectedBox() {
    return workshopState.snapshot?.printer?.boxes?.[0] || null;
  }
  /** Renvoie l’identifiant de l’ACE affiché pour cibler les commandes de bobines et de séchage. */
  function boxData() {
    return { box: selectedBox()?.box_id ?? 0 };
  }
  /** Affiche les bobines et le séchage ; distingue la lecture RFID de la saisie manuelle. */
  function renderAce(p) {
    const box = selectedBox();
    updateDryToggle(box, p.printer_online);
    if (!box) {
      statusBadge('ace-status', tr('Aucun module ACE détecté.'), false);
      $('spools').replaceChildren();
      return;
    }
    statusBadge(
      'ace-status',
      !p.printer_online
        ? tr('Hors ligne')
        : box.drying?.is_drying
          ? tr('Séchage en cours')
          : tr('Disponible'),
      !!p.printer_online,
    );
    definition('ace-stats', [
      ['Température', fmt(box.temperature, ' °C')],
      ['Humidité', fmt(box.humidity, ' %')],
      ['Relais automatique', box.auto_feed ? tr('Activé') : tr('Désactivé')],
    ]);
    $('spools').replaceChildren(
      ...(box.spools || []).map((s, index) => {
        const art = node('article', null, 'slot');
        art.append(
          spoolIllustration(s.color, index),
          node('h3', s.material_type || tr('Non renseigné')),
          node('p', formatText('Emplacement {0}', s.display_slot ?? s.slot)),
          node(
            'p',
            Number.isInteger(box.loaded_slot) &&
              box.loaded_slot >= 0 &&
              box.loaded_slot === (s.local_slot ?? s.slot) - 1
              ? tr('● Bobine engagée')
              : s.spool_loaded
                ? tr('Filament présent')
                : tr('Filament absent ou non détecté'),
            Number.isInteger(box.loaded_slot) &&
              box.loaded_slot >= 0 &&
              box.loaded_slot === (s.local_slot ?? s.slot) - 1
              ? 'engaged-spool'
              : '',
          ),
          node(
            'p',
            s.remaining_percent == null
              ? tr('Quantité non renseignée')
              : formatText('{0} % restants', s.remaining_percent),
          ),
        );
        if (s.rfid === true) art.append(node('p', tr('RFID reconnu'), 'rfid-badge'));
        else if (s.rfid === false) art.append(node('p', tr('Configuration manuelle'), 'muted'));
        const edit = node('button', s.rfid === true ? 'Voir' : 'Modifier');
        edit.type = 'button';
        edit.title =
          s.rfid === true
            ? tr('Consulter les informations RFID et gérer le chargement de cette bobine.')
            : tr('Modifier le matériau, la couleur et le chargement de cet emplacement.');
        edit.onclick = () => openSpool(s.local_slot || s.slot);
        const actions = node('div', null, 'spool-actions');
        actions.append(edit);
        art.append(actions);
        return art;
      }),
    );
    const dry = box.drying || {};
    const drying = typeof dry.is_drying === 'boolean' ? dry.is_drying : null;
    statusBadge(
      'drying-state',
      drying === true
        ? tr('Séchage actif')
        : drying === false
          ? tr('Séchage inactif')
          : tr('État du séchage inconnu'),
      drying,
    );
    $('drying-detail').hidden = drying !== true;
    if (drying)
      set(
        'drying-detail',
        formatText(
          '{0} · Durée restante {1}',
          fmt(dry.target_temperature, ' °C'),
          mins(dry.remaining_time),
        ),
      );
    if (document.activeElement !== $('auto-feed')) $('auto-feed').checked = !!box.auto_feed;

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
            input.value = pr[key];
            input.type = key === 'name' ? 'text' : 'number';
            input.required = true;
            fs.append(l);
            l.append(input);
          }
          return fs;
        }),
      );
    }
    $('dry-presets').replaceChildren(
      ...workshopState.snapshot.presets.map((pr) => {
        const b = node('button', `${pr.name} ${pr.temperature} °C · ${pr.hours} h`);
        b.type = 'button';
        b.onclick = () => startDrying(
          { temperature: pr.temperature, hours: pr.hours },
          formatText('Démarrer le séchage {0} à {1} °C pendant {2} h ?', pr.name, pr.temperature, pr.hours),
        );
        return b;
      }),
    );
  }
  $('go-spool').onclick = () => openSpool($('spool-form').elements.slot.value);
  /** Rend l’état signalé par le module, sans anticiper la réponse à une commande. */
  function updateDryToggle(box, online) {
    const toggle = $('dry-toggle'), drying = box?.drying?.is_drying;
    toggle.disabled = !online || typeof drying !== 'boolean' || dryingPending;
    toggle.setAttribute('aria-checked', String(drying === true));
    set('dry-toggle-state', typeof drying !== 'boolean' ? '—' : tr(drying ? 'Actif' : 'Inactif'));
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
    const form = $('dry-form'), settings = dryingSettings();
    form.elements.temperature.value = settings.temperature;
    form.elements.hours.value = settings.hours;
    if (!$('dry-dialog').open) $('dry-dialog').showModal();
    form.elements.temperature.focus({ preventScroll: true });
  };
  $('dry-toggle').onclick = async () => {
    const printer = workshopState.snapshot?.printer, box = selectedBox();
    const drying = box?.drying?.is_drying;
    if (!printer?.printer_online || typeof drying !== 'boolean' || dryingPending) return;
    dryingPending = true;
    updateDryToggle(box, true);
    try {
      if (drying) {
        await command('dry-stop', boxData(), tr('Arrêter le séchage du module sélectionné ?'));
      } else {
        const {temperature, hours} = dryingSettings();
        await startDrying(
          {temperature, hours},
          formatText('Démarrer le séchage à {0} °C pendant {1} h ?', temperature, hours),
        );
      }
    } finally {
      dryingPending = false;
      updateDryToggle(selectedBox(), workshopState.snapshot?.printer?.printer_online);
    }
  };
  $('spool-color').oninput = () => set('spool-color-value', $('spool-color').value.toUpperCase());
  $('spool-form').onsubmit = (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    if (!d.material) {
      message(tr('Choisissez un matériau compatible avant d’enregistrer cette bobine.'), true);
      return;
    }
    command(
      'slot',
      { ...d, ...boxData() },
      tr('Enregistrer ce matériau et cette couleur dans l’ACE ?'),
    );
  };
  for (const [id, action, extra, question] of [
    ['feed', 'feed', {}, tr('Charger le filament sélectionné ?')],
    ['feed-finish', 'feed', { finish: true }, tr('Terminer le chargement ?')],
    ['retract', 'retract', {}, tr('Rétracter le filament ?')],
  ])
    $(id).onclick = () =>
      command(
        action,
        { ...boxData(), slot: $('spool-form').elements.slot.value, ...extra },
        question,
      );
  $('dry-form').onsubmit = (e) => {
    e.preventDefault();
    startDrying(
      Object.fromEntries(new FormData(e.target)),
      tr('Démarrer le séchage avec ces paramètres ?'),
    );
  };
  $('dry-stop').onclick = () =>
    command('dry-stop', boxData(), tr('Arrêter le séchage du module sélectionné ?'));
  $('auto-feed-save').onclick = () =>
    command(
      'auto-feed',
      { ...boxData(), enabled: $('auto-feed').checked },
      tr('Modifier le relais automatique des bobines ?'),
    );
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
    }
  };
  /** Préremplit la bobine sélectionnée ; les valeurs RFID restent consultables sans modification manuelle. */
  function fillSpool(slot) {
    const form = $('spool-form'),
      data = selectedBox()?.spools?.find((s) => Number(s.local_slot || s.slot) === Number(slot));
    if (!data) return;
    form.elements.slot.value = String(slot);
    const material = form.elements.material;
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
    /* Les données RFID sont la référence de l’ACE et ne doivent pas être remplacées par le formulaire. */ const automatic =
      data.rfid === true;
    form.elements.material.disabled = automatic;
    form.elements.color.disabled = automatic;
    form.querySelector('[type=submit]').hidden = automatic;
    set('spool-rfid-note', automatic ? tr('Bobine RFID · matière et couleur détectées.') : '');
    $('spool-rfid-note').hidden = !automatic;
  }
  /** Ouvre les données du numéro local de bobine et place le focus sur sa sélection. */
  function openSpool(slot) {
    fillSpool(slot);
    if (!$('spool-dialog').open) $('spool-dialog').showModal();
    $('spool-form').elements.slot.focus({ preventScroll: true });
  }
  $('spool-form').elements.slot.onchange = (e) => fillSpool(e.target.value);

  return { selectedBox, boxData, renderAce };
}
