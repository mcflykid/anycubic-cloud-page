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

/** Récupère aussi les fiches personnelles importées avant l’ajout des associations. */
function readCustomProfiles() {
  try {
    const data = JSON.parse(localStorage.getItem(storageKey) || '[]');
    const profiles = Array.isArray(data) ? data : data.profiles;
    return {
      profiles: profiles.slice(0, 100).map(validateProfile),
      assignments: Array.isArray(data.assignments) ? data.assignments : [],
    };
  } catch {
    return {profiles: [], assignments: []};
  }
}

/** Conserve la palette rapportée par l’ACE comme indice lors d’un changement de bobine. */
function spoolPalette(spool) {
  const colors = Array.isArray(spool.color) ? spool.color : [];
  const hex = [];
  for (let i = 0; i + 2 < colors.length; i += 3) {
    const rgb = colors.slice(i, i + 3);
    if (rgb.every(value => Number.isInteger(value) && value >= 0 && value <= 255))
      hex.push('#' + rgb.map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase());
  }
  return hex;
}

/** Garde les valeurs et leur libellé associés dans les listes descriptives. */
function item(label, value) {
  const pair = node('div'), detail = node('dd');
  // Une valeur peut être un élément (pastille, jauge, badge) : textContent l’aplatirait.
  detail.append(value);
  pair.append(node('dt', tr(label)), detail);
  return pair;
}

/** Pastilles de couleur suivies du code, pour lire la teinte sans déchiffrer l’hexadécimal. */
function colorValue(hex) {
  if (!hex.length) return '—';
  const value = node('span', null, 'filament-colors');
  for (const color of hex) {
    const swatch = node('span', null, 'filament-swatch');
    swatch.style.setProperty('--swatch', color);
    value.append(swatch);
  }
  value.append(node('span', hex.join(' · '), 'muted'));
  return value;
}

/** Restant en pourcentage avec sa jauge ; une jauge faible prend la couleur d’alerte. */
function remainingValue(percent) {
  if (!Number.isFinite(percent)) return '—';
  const value = node('span', null, 'filament-remaining');
  const progress = node('progress');
  progress.max = 100;
  progress.value = Math.max(0, Math.min(100, percent));
  progress.dataset.state = percent <= 20 ? 'due' : 'ok';
  progress.setAttribute('aria-hidden', 'true');
  value.append(node('span', fmt(percent, ' %')), progress);
  return value;
}

/** Affiche la bobine lue par l’ACE, puis les valeurs d’impression et de séchage de la fiche. */
function showProfile(spool, title, hex, name, profile, personal) {
  set('filament-slot-title', title);
  set('filament-profile-reference', formatText(personal ? 'Fiche personnelle « {0} »' : 'Valeurs du fabricant pour {0}', name));
  const rfid = node('span', tr(spool.rfid === true ? 'RFID reconnu' : spool.rfid === false
    ? 'Configuration manuelle' : 'Inconnu'), 'atelier-count');
  rfid.dataset.state = spool.rfid === true ? 'ok' : 'unknown';
  $('filament-profile-reading').replaceChildren(
    item('Matériau', spool.material_type || '—'),
    item('Couleur du filament', colorValue(hex)),
    item('Filament restant', remainingValue(spool.remaining_percent)),
    item('Identification', rfid),
  );
  const source = $('filament-profile-source');
  source.href = profile.url;
  const communitySource = $('filament-profile-community-source');
  communitySource.hidden = !profile.profileSource;
  if (profile.profileSource) communitySource.href = profile.profileSource;
  else communitySource.removeAttribute('href');
  const datasheet = $('filament-profile-datasheet');
  datasheet.hidden = !profile.datasheet;
  if (profile.datasheet) datasheet.href = profile.datasheet;
  else datasheet.removeAttribute('href');
  source.textContent = tr(personal ? 'Source de la fiche' : 'Fiche fabricant');
  const range = ([min, max], unit) => fmt(min) + '–' + fmt(max, unit);
  const fill = (id, values) => {
    const shown = values.filter(([, value]) => value != null);
    $(id).replaceChildren(...shown.map(([label, value]) => item(label, value)));
    $(id).closest('section').hidden = !shown.length;
  };
  fill('filament-profile-facts', [
    ['Buse', profile.nozzle && range(profile.nozzle, ' °C')],
    ['Plateau', profile.bed && range(profile.bed, ' °C')],
    ['Vitesse d’impression', profile.speed && range(profile.speed, ' mm/s')],
    ['Débit volumique maximal', profile.flow == null ? null : fmt(profile.flow, ' mm³/s')],
    ['Diamètre minimal de buse', profile.minNozzle == null ? null : fmt(profile.minNozzle, ' mm')],
    ['Matériau de la buse', profile.nozzleMaterial ? tr(profile.nozzleMaterial) : null],
    ['Densité', profile.density == null ? null : new Intl.NumberFormat(document.documentElement.lang,
      {maximumFractionDigits: 3}).format(profile.density) + ' g/cm³'],
  ]);
  // Le wiki et les fiches donnent la durée de séchage en heures : elle rejoint sa température.
  fill('filament-profile-drying', [
    ['Température', profile.drying && range(profile.drying, ' °C')],
    ['Durée', profile.hours && range(profile.hours, ' h')],
  ]);
  $('filament-profile-dialog').showModal();
}

/** Résout aussi les associations personnelles pour proposer la même action depuis les deux fenêtres. */
function profileSelection(spool, {printer, box, slot}) {
  const hex = spoolPalette(spool);
  const position = JSON.stringify([printer, box, slot]);
  // Le restant varie avec l’impression et ne fait donc pas partie de l’identité.
  const signature = JSON.stringify([spool.material_type, hex, spool.rfid, spool.spool_loaded]);
  const reference = spool.filament_profile;
  if (spool.spool_loaded !== false && spool.rfid === true && Object.hasOwn(manufacturerProfiles, reference))
    return {hex, position, signature, name: reference, profile: manufacturerProfiles[reference], personal: false};

  const saved = readCustomProfiles();
  const assignment = saved.assignments.find(entry => entry?.position === position && entry.signature === signature);
  const profile = saved.profiles.find(entry => entry.name === assignment?.name);
  return {hex, position, signature, name: profile?.name, profile, personal: true};
}

/** Choisit le libellé selon la disponibilité d’une fiche dans ce navigateur. */
export function filamentProfileAction(spool, position) {
  return tr(profileSelection(spool, position).profile ? 'Fiche filament' : 'Créer sa fiche filament');
}

/** Ouvre la fiche associée à l’emplacement ACE, ou le formulaire d’import si l’identité reste inconnue. */
export function openFilamentProfile(spool, target) {
  const title = formatText('Emplacement {0}', target.displaySlot);
  const material = spool.material_type;
  const {hex, position, signature, name, profile, personal} = profileSelection(spool, target);
  if (profile) return showProfile(spool, title, hex, name, profile, personal);

  const create = $('filament-profile-create'), upload = $('filament-profile-import');
  set('filament-profile-create-slot', material ? title + ' · ' + material : title);
  const swatch = $('filament-profile-create-swatch');
  swatch.hidden = !hex.length;
  if (hex.length) swatch.style.setProperty('--swatch', hex[0]);
  set('filament-profile-import-state', '');
  upload.value = '';
  upload.onchange = async () => {
    const file = upload.files[0];
    if (!file) return;
    const currentImport = upload.onchange;
    try {
      if (file.size > 16384) throw new TypeError();
      const profile = validateProfile(JSON.parse(await file.text()));
      if (!create.open || currentImport !== upload.onchange || upload.files[0] !== file) return;
      const latest = readCustomProfiles();
      const profiles = latest.profiles.filter(entry => entry.name !== profile.name);
      if (profiles.length >= 100) throw new TypeError();
      profiles.push(profile);
      const assignments = latest.assignments.filter(entry => entry?.position !== position);
      assignments.push({position, signature, name: profile.name});
      localStorage.setItem(storageKey, JSON.stringify({profiles, assignments}));
      create.close();
      showProfile(spool, title, hex, profile.name, profile, true);
    } catch {
      if (create.open && currentImport === upload.onchange && upload.files[0] === file)
        set('filament-profile-import-state', tr('Import impossible. Vérifiez le fichier et le stockage du navigateur.'));
    } finally {
      if (upload.files[0] === file) upload.value = '';
    }
  };
  const drop = create.querySelector('.filament-drop');
  drop.ondragover = event => {
    event.preventDefault();
    drop.dataset.over = 'true';
  };
  drop.ondragleave = () => delete drop.dataset.over;
  drop.ondrop = event => {
    event.preventDefault();
    delete drop.dataset.over;
    if (!event.dataTransfer?.files.length) return;
    upload.files = event.dataTransfer.files;
    upload.onchange();
  };
  create.showModal();
}
