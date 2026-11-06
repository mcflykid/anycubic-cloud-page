import { $, fmt, formatText, message, mins, node, set, tr } from './workshop-ui.mjs?v=1f94d1ca2939';
import { workshopState } from './workshop-state.mjs?v=b83c95878022';
import { definition, statusBadge } from './workshop-overview.mjs?v=8791fd1d4eda';

/** Affiche l’ACE et relie les formulaires aux commandes de la machine. */
export function createAce(command, refresh) {
  let presetsReady = false;
  /** Renvoie le premier ACE connu, ou null ; cette interface ne propose pas de sélection de second boîtier. */
  function selectedBox() {
    return workshopState.snapshot?.printer?.boxes?.[0] || null;
  }
  /** Renvoie l’identifiant de l’ACE affiché pour cibler les commandes de bobines et de séchage. */
  function boxData() {
    return { box: selectedBox()?.box_id ?? 0 };
  }
  /** Affiche les bobines et le séchage ; préserve une quantité nulle et distingue RFID d’une configuration manuelle. */
  function renderAce(p) {
    const box = selectedBox();
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
      ...(box.spools || []).map((s) => {
        const art = node('article', null, 'slot'),
          sw = node('div', null, 'swatch');
        if (Array.isArray(s.color))
          sw.style.backgroundColor = `rgb(${s.color
            .slice(0, 3)
            .map((v) => Math.max(0, Math.min(255, Number(v) || 0)))
            .join(',')})`;
        art.append(
          sw,
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
        if (s.rfid === true) art.append(node('p', 'Anycubic · RFID reconnu', 'rfid-badge'));
        else if (s.rfid === false) art.append(node('p', tr('Configuration manuelle'), 'muted'));
        const edit = node('button', s.rfid === true ? 'Voir' : 'Modifier');
        edit.type = 'button';
        edit.title =
          s.rfid === true
            ? tr('Consulter les informations RFID et gérer le chargement de cette bobine.')
            : tr('Modifier le matériau, la couleur et le chargement de cet emplacement.');
        edit.onclick = () => openSpool(s.local_slot || s.slot);
        art.append(edit);
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
        b.onclick = () =>
          command(
            'dry-start',
            { ...boxData(), temperature: pr.temperature, hours: pr.hours },
            formatText(
              'Démarrer le séchage {0} à {1} °C pendant {2} h ?',
              pr.name,
              pr.temperature,
              pr.hours,
            ),
          );
        return b;
      }),
    );
  }
  $('go-spool').onclick = () => openSpool($('spool-form').elements.slot.value);
  $('go-drying').onclick = () => {
    const dry = selectedBox()?.drying;
    if (dry?.is_drying) {
      $('dry-form').elements.temperature.value = dry.target_temperature;
      if (Number.isFinite(dry.total_duration) && dry.total_duration > 0)
        $('dry-form').elements.hours.value = Math.max(1, Math.ceil(dry.total_duration / 60));
    }
    if (!$('dry-dialog').open) $('dry-dialog').showModal();
    $('dry-form').elements.temperature.focus({ preventScroll: true });
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
    command(
      'dry-start',
      { ...Object.fromEntries(new FormData(e.target)), ...boxData() },
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
