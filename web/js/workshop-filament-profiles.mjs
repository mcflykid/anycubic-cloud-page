import { $, fmt, formatText, node, set, tr } from './workshop-ui.mjs';

import { manufacturerProfiles } from './filament-profiles-data.mjs';

const storageKey = 'cloud-page-custom-filaments';
const scalarFields = ['density', 'flow', 'minNozzle'];
const rangeFields = ['nozzle', 'bed', 'drying', 'hours', 'speed'];

/** Vérifie une fiche locale et réserve la source aux liens HTTPS ordinaires. */
function validateProfile(data) {
  if (!data || typeof data.name !== 'string' || !data.name.trim() || data.name.length > 100 ||
      typeof data.url !== 'string' || data.url.length > 500) throw new TypeError();
  const url = new URL(data.url);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new TypeError();
  const profile = {name: data.name.trim(), url: url.href};
  for (const key of scalarFields) {
    if (data[key] == null) continue;
    if (!Number.isFinite(data[key]) || data[key] <= 0) throw new TypeError();
    profile[key] = data[key];
  }
  for (const key of rangeFields) {
    if (data[key] == null) continue;
    const values = data[key];
    if (!Array.isArray(values) || values.length !== 2 ||
        !values.every(value => Number.isFinite(value) && value > 0) || values[0] > values[1]) throw new TypeError();
    profile[key] = values;
  }
  return profile;
}

/** Les fiches personnelles restent dans le navigateur et survivent à une mise à jour du conteneur. */
function readCustomProfiles() {
  try {
    const data = JSON.parse(localStorage.getItem(storageKey) || '[]');
    return Array.isArray(data) ? data.slice(0, 100).map(validateProfile) : [];
  } catch {
    return [];
  }
}

/** Présente la télémétrie du créneau et les données de la référence confirmée par l’utilisateur. */
export function openFilamentProfile(spool, slot) {
  const dialog = $('filament-profile-dialog'), reference = $('filament-profile-reference');
  const reading = $('filament-profile-reading'), facts = $('filament-profile-facts');
  set('filament-slot-title', formatText('Emplacement {0}', slot));
  const colors = Array.isArray(spool.color) ? spool.color : [];
  const hex = [];
  for (let i = 0; i + 2 < colors.length; i += 3) {
    const rgb = colors.slice(i, i + 3);
    if (rgb.every(value => Number.isInteger(value) && value >= 0 && value <= 255))
      hex.push('#' + rgb.map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase());
  }
  /** Garde les valeurs et leur provenance associées dans les listes descriptives. */
  function item(label, value) {
    const pair = node('div');
    pair.append(node('dt', tr(label)), node('dd', value));
    return pair;
  }
  reading.replaceChildren(
    item('Matériau', spool.material_type || '—'),
    item('Couleur du filament', hex.join(' · ') || '—'),
    item('Filament restant', fmt(spool.remaining_percent, ' %')),
    item('Identification RFID', tr(spool.rfid === true ? 'RFID reconnu' : spool.rfid === false
      ? 'Configuration manuelle' : 'Inconnu')),
  );
  let custom = readCustomProfiles();
  const upload = $('filament-profile-import');
  upload.value = '';
  set('filament-profile-import-state', '');
  /** Affiche les références personnelles séparément des fiches fournies. */
  function choices(value) {
    reference.replaceChildren(new Option(tr('Choisir la référence de la bobine'), ''),
      ...Object.keys(manufacturerProfiles).map(name => new Option(name, name)),
      ...custom.map((profile, index) => new Option(profile.name + ' · ' + tr('Fiche personnelle'), 'custom:' + index)));
    reference.value = value;
  }
  const exact = spool.rfid === true && Object.hasOwn(manufacturerProfiles, spool.material_type) &&
    !['PETG', 'PLA Basic', 'PLA+'].includes(spool.material_type);
  choices(exact ? spool.material_type : '');
  /** Les champs omis restent inconnus et une fiche ne modifie aucun ordre ACE. */
  function renderProfile() {
    const personal = reference.value.startsWith('custom:');
    const profile = personal ? custom[Number(reference.value.slice(7))] : manufacturerProfiles[reference.value];
    const source = $('filament-profile-source');
    source.hidden = !profile;
    if (!profile) {
      source.removeAttribute('href');
      facts.replaceChildren();
      return;
    }
    source.href = profile.url;
    source.textContent = tr(personal ? 'Source de la fiche' : 'Fiche fabricant');
    const range = ([min, max], unit) => fmt(min) + '–' + fmt(max, unit);
    const values = [
      ['Densité', profile.density == null ? null : new Intl.NumberFormat(document.documentElement.lang,
        {maximumFractionDigits: 3}).format(profile.density) + ' g/cm³'],
      ['Température de la buse', profile.nozzle && range(profile.nozzle, ' °C')],
      ['Température du plateau', profile.bed && range(profile.bed, ' °C')],
      ['Température de séchage', profile.drying && range(profile.drying, ' °C')],
      ['Durée (heures)', profile.hours && range(profile.hours, ' h')],
      ['Vitesse d’impression', profile.speed && range(profile.speed, ' mm/s')],
      ['Débit volumique maximal', profile.flow == null ? null : fmt(profile.flow, ' mm³/s')],
      ['Diamètre minimal de buse', profile.minNozzle == null ? null : fmt(profile.minNozzle, ' mm')],
      ['Matériau de la buse', profile.nozzleMaterial ? tr(profile.nozzleMaterial) : null],
    ];
    facts.replaceChildren(...values.filter(([, value]) => value != null).map(([label, value]) => item(label, value)));
  }
  upload.onchange = async () => {
    const file = upload.files[0];
    if (!file) return;
    try {
      if (file.size > 16384) throw new TypeError();
      const profile = validateProfile(JSON.parse(await file.text()));
      if (!dialog.open) return;
      const next = custom.filter(entry => entry.name !== profile.name);
      if (next.length >= 100) throw new TypeError();
      next.push(profile);
      localStorage.setItem(storageKey, JSON.stringify(next));
      custom = next;
      choices('custom:' + (custom.length - 1));
      renderProfile();
      set('filament-profile-import-state', tr('Fiche personnelle enregistrée dans ce navigateur.'));
    } catch {
      set('filament-profile-import-state', tr('Import impossible. Vérifiez le fichier et le stockage du navigateur.'));
    } finally {
      upload.value = '';
    }
  };
  reference.onchange = renderProfile;
  renderProfile();
  dialog.showModal();
}
