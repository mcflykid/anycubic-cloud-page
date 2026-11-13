import { $, fmt, formatText, node, set, tr } from './workshop-ui.mjs';

// Les fiches fabricant sont consultatives. Le restant affiché provient de l’ACE.
const profiles = {
  'PLA Basic': {
    url: 'https://store.anycubic.com/products/pla-basic-refill',
    density: 1.24, nozzle: [190, 230], bed: [55, 56], drying: [45, 50], hours: [6, 8],
    speed: [50, 200], flow: 12, minNozzle: 0.2,
  },
  'PLA Marble': {
    url: 'https://eu.anycubic.com/products/pla-marble',
    density: 1.37, nozzle: [200, 230], bed: [55, 65], drying: [55, 65], hours: [6, 8],
    speed: [40, 250], flow: 12, minNozzle: 0.4,
  },
  'PLA Glow': {
    url: 'https://store.anycubic.com/products/pla-glow',
    density: 1.26, nozzle: [200, 230], bed: [60, 70], drying: [60, 65], hours: [6, 8],
    speed: [50, 250], flow: 12, minNozzle: 0.4,
  },
  PETG: {
    url: 'https://eu.anycubic.com/products/petg',
    density: 1.23, nozzle: [230, 250], bed: [60, 70], drying: [55, 65], hours: [6, 8],
    speed: [50, 250], flow: 12, minNozzle: 0.2,
  },
};

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
  reference.replaceChildren(new Option(tr('Choisir la référence de la bobine'), ''),
    ...Object.keys(profiles).map(name => new Option(name, name)));
  reference.value = Object.hasOwn(profiles, spool.material_type) &&
    !['PETG'].includes(spool.material_type) ? spool.material_type : '';
  /** Une famille générique comme PLA peut correspondre à plusieurs produits. */
  function renderProfile() {
    const profile = profiles[reference.value], source = $('filament-profile-source');
    source.hidden = !profile;
    if (!profile) {
      source.removeAttribute('href');
      facts.replaceChildren();
      return;
    }
    source.href = profile.url;
    const range = ([min, max], unit) => fmt(min) + '–' + fmt(max, unit);
    facts.replaceChildren(
      item('Densité', fmt(profile.density, ' g/cm³')),
      item('Température de la buse', range(profile.nozzle, ' °C')),
      item('Température du plateau', range(profile.bed, ' °C')),
      item('Température de séchage', range(profile.drying, ' °C')),
      item('Durée (heures)', range(profile.hours, ' h')),
      item('Vitesse d’impression', range(profile.speed, ' mm/s')),
      item('Débit volumique maximal', fmt(profile.flow, ' mm³/s')),
      item('Diamètre minimal de buse', fmt(profile.minNozzle, ' mm')),
    );
  }
  reference.onchange = renderProfile;
  renderProfile();
  dialog.showModal();
}
