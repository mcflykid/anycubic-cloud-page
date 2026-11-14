import { $, fmt, formatText, node, set, tr } from './workshop-ui.mjs';

import { communityFilamentVariants, manufacturerProfiles, officialPlaBasicVariants } from './filament-profiles-data.mjs';

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
  if (data.type != null) {
    if (typeof data.type !== 'string' || !data.type.trim() || data.type.length > 80) throw new TypeError();
    profile.type = data.type.trim();
  }
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
function showProfile(spool, title, hex, name, profile, personal, variant = null) {
  set('filament-slot-title', title);
  set('filament-profile-reference', formatText(personal ? 'Fiche personnelle « {0} »' : 'Valeurs du fabricant pour {0}', name));
  $('filament-slot-title').closest('section').hidden = !spool;
  if (spool) {
    const rfid = node('span', tr(spool.rfid === true ? 'RFID reconnu' : spool.rfid === false
      ? 'Configuration manuelle' : 'Inconnu'), 'atelier-count');
    rfid.dataset.state = spool.rfid === true ? 'ok' : 'unknown';
    $('filament-profile-reading').replaceChildren(
      item('Matériau', spool.material_type || '—'),
      item('Couleur du filament', colorValue(hex)),
      item('Filament restant', remainingValue(spool.remaining_percent)),
      item('Identification', rfid),
    );
  }
  const source = $('filament-profile-source');
  source.href = variant?.productId ? profile.url + '?variant=' + variant.productId : profile.url;
  const communitySource = $('filament-profile-community-source');
  const communityUrl = variant?.id ? 'https://3dfilamentprofiles.com/filament/details/' + variant.id
    : profile.communityVariants?.[hex.join(' · ').toUpperCase()] || profile.profileSource;
  communitySource.hidden = !communityUrl;
  if (communityUrl) communitySource.href = communityUrl;
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
    ['Matériau', !spool ? profile.material : null],
    ['Type', profile.type],
    ['SKU fabricant', variant?.sku],
    ['Couleur du filament', !spool && variant?.hex ? colorValue([variant.hex]) : null],
    ['Masse nominale', variant?.weight ? fmt(variant.weight, ' g') : null],
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
  const properties = profile.properties;
  const withTolerance = (value, unit) => value && fmt(value[0]) + ' ± ' + fmt(value[1], unit);
  fill('filament-profile-properties', properties ? [
    ['Température de fusion', fmt(properties.melting, ' °C')],
    ['Température de ramollissement Vicat', fmt(properties.vicat, ' °C')],
    ['Température de fléchissement sous charge (0,45 MPa)', fmt(properties.heatDeflection, ' °C')],
    ['Résistance à la traction', withTolerance(properties.tensile, ' MPa')],
    ['Allongement à la rupture', withTolerance(properties.elongation, ' %')],
    ['Résistance à la flexion', withTolerance(properties.bending, ' MPa')],
  ] : []);
  $('filament-profile-dialog').showModal();
}

/** Met en évidence le texte recherché sans interpréter le nom comme du HTML. */
function highlight(text, query) {
  const index = query ? text.toLocaleLowerCase().indexOf(query) : -1;
  if (index < 0) return [text];
  return [text.slice(0, index), node('mark', text.slice(index, index + query.length)), text.slice(index + query.length)];
}

/** Les fiches restent consultables sans avoir chargé la matière dans l’ACE. */
export function bindFilamentCatalogue() {
  const dialog = $('filament-catalogue-dialog');
  const search = $('filament-catalogue-search');
  const list = $('filament-catalogue-list');
  const render = () => {
    const query = search.value.trim().toLocaleLowerCase();
    const variants = new Map(officialPlaBasicVariants.map(variant => [variant.sku, variant]));
    for (const variant of communityFilamentVariants) {
      variants.set(variant.sku, {...variants.get(variant.sku), ...variant});
    }
    const all = [...variants.values()];
    const rows = all
      .filter(({profile, color, sku}) => [profile, color, sku].some(value => value.toLocaleLowerCase().includes(query)))
      .sort((left, right) => left.profile.localeCompare(right.profile) || left.color.localeCompare(right.color));
    renderRanges(all, rows);
    const groups = Map.groupBy(rows.filter(variant => !range || variant.profile === range), variant => variant.profile);
    list.replaceChildren(...[...groups].map(([profile, items]) => {
      const group = node('li', null, 'catalogue-group');
      const heading = node('p', null, 'catalogue-group-title');
      heading.append(node('b', profile), node('span', items.length === 1 ? tr('1 référence') : formatText('{0} références', items.length)));
      const entries = node('ul', null, 'catalogue-entries');
      entries.append(...items.map(variant => {
        const entry = node('li');
        const name = variant.profile + ' · ' + variant.color;
        const button = node('button', null, 'catalogue-entry');
        button.type = 'button';
        // Le nom accessible garde la gamme, absente du libellé visible regroupé sous son titre.
        button.title = name + ' · ' + variant.sku;
        button.setAttribute('aria-label', button.title);
        const swatch = node('i', null, 'catalogue-swatch');
        if (variant.hex) swatch.style.setProperty('--swatch', variant.hex);
        else swatch.dataset.unknown = 'true';
        const label = node('span', null, 'catalogue-name');
        label.append(...highlight(variant.color, query));
        button.append(swatch, label, node('code', variant.sku), node('span', '›', 'catalogue-chevron'));
        button.onclick = () => showProfile(null, '', [], name, manufacturerProfiles[variant.profile], false, variant);
        entry.append(button);
        return entry;
      }));
      group.append(heading, entries);
      return group;
    }));
    set('filament-catalogue-count', formatText('{0} références', rows.length));
    $('filament-catalogue-empty').hidden = rows.length > 0;
  };
  let range = '';
  /** Pastilles de gamme créées ici pour laisser intact le gabarit partagé de la fenêtre. */
  const ranges = node('div', null, 'catalogue-ranges');
  ranges.setAttribute('role', 'group');
  ranges.setAttribute('aria-label', tr('Gamme'));
  const count = node('span', null, 'muted');
  count.id = 'filament-catalogue-count';
  dialog.querySelector('.dialog-close').before(count);
  const empty = node('p', tr('Aucune référence ne correspond à cette recherche.'), 'catalogue-empty');
  empty.id = 'filament-catalogue-empty';
  list.before(ranges);
  list.after(empty);
  function renderRanges(all, rows) {
    const totals = Map.groupBy(rows, variant => variant.profile);
    const names = [...new Set(all.map(variant => variant.profile))].sort((a, b) => a.localeCompare(b));
    ranges.replaceChildren(...[['', rows.length], ...names.map(name => [name, totals.get(name)?.length || 0])].map(([name, total]) => {
      const chip = node('button', name || tr('Toutes'), 'catalogue-range');
      chip.type = 'button';
      chip.setAttribute('aria-pressed', String(range === name));
      chip.append(node('span', String(total)));
      chip.disabled = !total && range !== name;
      chip.onclick = () => { range = name; render(); };
      return chip;
    }));
  }
  search.addEventListener('input', render);
  $('filament-catalogue-open').onclick = () => {
    search.value = '';
    range = '';
    render();
    dialog.showModal();
  };
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
