const preference = 'cloud-page-language';
const locales = { fr: 'fr-FR', en: 'en', es: 'es', de: 'de-DE', it: 'it-IT' };
const catalogueURL = new URL('./workshop-translations.json', import.meta.url);
const catalogueIntegrity = '__CATALOGUE_INTEGRITY__';
let language = 'fr',
  catalogue = {};
const serverFormats = [
  [/^Valeur attendue entre (-?\d+) et (-?\d+)$/, 'Valeur attendue entre {0} et {1}'],
  [
    /^Connexion Anycubic indisponible \(([A-Za-z0-9_]+)\)\.$/,
    'Connexion Anycubic indisponible ({0}).',
  ],
  [
    /^(\d+) fiche\(s\) retirée\(s\) sur (\d+)\. Résultat suivant non confirmé : opération arrêtée\. Actualisez et vérifiez l’historique avant tout nouvel essai\.$/,
    '{0} fiche(s) retirée(s) sur {1}. Résultat suivant non confirmé : opération arrêtée. Actualisez et vérifiez l’historique avant tout nouvel essai.',
  ],
  [
    /^(\d+) fiche\(s\) retirée\(s\) de l’historique Anycubic\. La liste est relue depuis le cloud\.$/,
    '{0} fiche(s) retirée(s) de l’historique Anycubic. La liste est relue depuis le cloud.',
  ],
];

/** Préserve le texte français si une traduction est absente ou si le catalogue n’a pas chargé. */
export function tr(text) {
  if (language === 'fr' || typeof text !== 'string' || !Object.hasOwn(catalogue, text)) return text;
  return catalogue[text][language] || text;
}

/** Garde les codes et libellés techniques côté serveur, avec un retour localisé pour les erreurs non cataloguées. */
export function serverText(text, fallback) {
  if (language === 'fr' || !text) return text || tr(fallback);
  if (Object.hasOwn(catalogue, text)) return tr(text);
  for (const [pattern, template] of serverFormats) {
    const match = pattern.exec(text);
    if (match) return formatText(template, ...match.slice(1));
  }
  return tr(fallback);
}

function translatePage() {
  if (language === 'fr') return;
  document.documentElement.lang = language;
  document.title = tr(document.title);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const item = walker.currentNode;
    if (item.parentElement.closest('script,style,textarea,[data-language-options]')) continue;
    const label = item.textContent.trim();
    const localized = tr(label);
    if (label && localized !== label) item.textContent = item.textContent.replace(label, localized);
  }
  for (const element of document.querySelectorAll(
    '[title],[aria-label],[placeholder],[alt],[data-confirm]',
  )) {
    for (const attr of ['title', 'aria-label', 'placeholder', 'alt', 'data-confirm']) {
      if (element.hasAttribute(attr)) element.setAttribute(attr, tr(element.getAttribute(attr)));
    }
  }
}

async function initializeLanguage() {
  let requested = 'fr';
  try {
    requested = localStorage.getItem(preference) || 'fr';
  } catch {}
  if (requested !== 'fr' && Object.hasOwn(locales, requested)) {
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 1400);
    try {
      const response = await fetch(catalogueURL, {
        integrity: catalogueIntegrity,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('Catalogue indisponible');
      const translations = await response.json();
      if (
        !translations ||
        Array.isArray(translations) ||
        typeof translations !== 'object' ||
        !Object.values(translations).every(
          (entry) =>
            entry && !Array.isArray(entry) && typeof entry === 'object' &&
            ['en', 'es', 'de', 'it'].every(code => typeof entry[code] === 'string'),
        )
      ) {
        throw new Error('Catalogue invalide');
      }
      catalogue = translations;
      language = requested;
    } catch {
    } finally {
      clearTimeout(deadline);
    }
  }
  translatePage();
  const choice = document.getElementById('interface-language');
  if (!choice) return;
  choice.value = language;
  choice.addEventListener('change', () => {
    try {
      localStorage.setItem(preference, choice.value);
    } catch {
      choice.value = language;
      return;
    }
    location.reload();
  });
  choice.disabled = false;
}
function initializeTheme() {
  const storageKey = 'cloud-page-theme',
    root = document.documentElement,
    choice = document.getElementById('interface-theme'),
    toggle = document.getElementById('interface-mode-toggle');
  let theme = 'system';
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === 'light' || saved === 'dark') theme = saved;
  } catch {}
  root.dataset.theme = theme;
  if (!choice) return;
  const system = matchMedia('(prefers-color-scheme: dark)');
  const updateModeToggle = () => {
    const dark = root.dataset.theme === 'dark' || (root.dataset.theme === 'system' && system.matches);
    toggle.dataset.mode = dark ? 'dark' : 'light';
    toggle.setAttribute('aria-label', tr(dark ? 'Activer le mode clair' : 'Activer le mode sombre'));
  };
  if (toggle) {
    updateModeToggle();
    system.addEventListener('change', updateModeToggle);
    toggle.disabled = false;
    toggle.onclick = () => {
      choice.value = toggle.dataset.mode === 'dark' ? 'light' : 'dark';
      choice.dispatchEvent(new Event('change'));
    };
  }
  let transition;
  choice.value = theme;
  choice.addEventListener('change', () => {
    const nextTheme = choice.value;
    transition?.skipTransition();
    const applyTheme = () => {
      // Le navigateur peut différer le rendu jusqu’après un deuxième changement.
      if (choice.value === nextTheme) {
        root.dataset.theme = nextTheme;
        if (toggle) updateModeToggle();
      }
    };
    // WebKit peut conserver l’état précédent d’un objet MediaQueryList déjà créé.
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reducedMotion && typeof document.startViewTransition === 'function') {
      const current = document.startViewTransition(applyTheme);
      transition = current;
      current.ready.catch(() => {});
      current.finished.finally(() => {
        if (transition === current) transition = undefined;
      });
    } else {
      applyTheme();
    }
    try {
      localStorage.setItem(storageKey, nextTheme);
    } catch {}
  });
}
initializeTheme();

/** Applique le contraste au-dessus du style, y compris sur les pages sans sélecteur. */
function initializeContrast() {
  const key = 'cloud-page-contrast';
  const root = document.documentElement;
  const choice = document.getElementById('interface-contrast');
  const media = matchMedia('(prefers-contrast: more)');
  let mode = 'system';
  try {
    const saved = localStorage.getItem(key);
    if (saved === 'high' || saved === 'standard') mode = saved;
  } catch {}
  const apply = () => {
    root.dataset.contrast = mode === 'high' || (mode === 'system' && media.matches) ? 'high' : 'standard';
  };
  media.addEventListener('change', apply);
  apply();
  if (!choice) return;
  choice.value = mode;
  choice.onchange = () => {
    mode = choice.value;
    apply();
    try { localStorage.setItem(key, mode); } catch {}
  };
}
initializeContrast();

const styleCatalogue = [
  ['standard', 'Repères clairs et disposition directe pour le suivi quotidien.'],
  ['aurora', 'Surfaces lumineuses et accents violets.'],
  ['lab', 'Palette bleu-vert et menu latéral repliable sur ordinateur.'],
];

/** Conserve le style visuel indépendamment du mode clair ou sombre. */
function initializeStyle() {
  const choice = document.getElementById('interface-style');
  const storageKey = 'cloud-page-style';
  if (!choice) {
    try {
      const saved = localStorage.getItem(storageKey);
      const known = saved === 'minimal' ? 'standard' : saved;
      const valid = styleCatalogue.some(([id]) => id === known);
      document.documentElement.dataset.style = valid ? known : 'standard';
      if (!valid || saved !== known) localStorage.setItem(storageKey, valid ? known : 'standard');
    } catch {}
    return;
  }
  const description = document.getElementById('theme-description');
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === 'minimal' || !styleCatalogue.some(([id]) => id === saved)) {
      choice.value = 'standard';
      localStorage.setItem(storageKey, 'standard');
    } else if (Array.from(choice.options).some((option) => option.value === saved)) {
      choice.value = saved;
    }
  } catch {}
  const apply = () => {
    document.documentElement.dataset.style = choice.value;
    const selected = styleCatalogue.find(([id]) => id === choice.value);
    if (description) description.textContent = tr(selected?.[1] || '');
  };
  apply();
  choice.addEventListener('change', () => {
    apply();
    try {
      localStorage.setItem(storageKey, choice.value);
    } catch {}
  });
}
initializeStyle();
await initializeLanguage();

/** Fournit la locale réellement chargée pour les nombres, les dates et la recherche. */
export const locale = locales[language];
/** Réarme le mouvement sur un changement réel, même si le précédent est encore en cours. */
export function signalChange(element) {
  element.dataset.motionChange = element.dataset.motionChange === 'a' ? 'b' : 'a';
}

const pendingLists = new WeakMap();

/** Diffère le squelette et réserve l’état occupé à la dernière lecture de la liste. */
export function beginListLoading(list, skeleton, announce) {
  pendingLists.get(list)?.();
  list.setAttribute('aria-busy', 'true');
  const pieces = [...skeleton.querySelectorAll('.skeleton-piece')];
  // Adapté d’Esqueleto · Moxen (https://moxen.cl/recursos/esqueleto/) : les décalages synchronisent le reflet après chaque changement de grille.
  const alignSweep = () => {
    const {left, width} = skeleton.getBoundingClientRect();
    skeleton.style.setProperty('--skeleton-width', `${width}px`);
    for (const piece of pieces) {
      const offset = piece.getBoundingClientRect().left - left;
      piece.style.setProperty('--skeleton-offset', `${offset}px`);
    }
  };
  const observer = new ResizeObserver(alignSweep);
  const timer = setTimeout(() => {
    if (announce() === false || list.childElementCount !== 0) return;
    skeleton.hidden = false;
    alignSweep();
    observer.observe(skeleton);
  }, 240);
  const stop = () => {
    if (pendingLists.get(list) !== stop) return;
    clearTimeout(timer);
    observer.disconnect();
    skeleton.hidden = true;
    list.removeAttribute('aria-busy');
    pendingLists.delete(list);
  };
  pendingLists.set(list, stop);
  return stop;
}

/** Insère des valeurs littérales dans les confirmations, sans interpréter leur contenu. */
export const formatText = (label, ...values) =>
  tr(label).replace(/\{(\d+)\}/g, (_, index) => String(values[index] ?? ''));
export const timeZone = document.documentElement.dataset.timeZone || 'Europe/Paris';

/** Ancre la fin prévue au relevé de temps restant transmis par l’imprimante. */
export function finishEstimate(id, remainingMinutes, observedAt) {
  const element = $(id);
  const reportedAt = Date.parse(observedAt);
  element.hidden = !Number.isFinite(remainingMinutes) || remainingMinutes <= 0 || !Number.isFinite(reportedAt);
  if (element.hidden) return;
  const time = new Intl.DateTimeFormat(locale, {timeStyle:'short', timeZone});
  element.textContent = formatText('Fin prévue {0}', time.format(reportedAt + remainingMinutes * 60_000));
}

const timelineIcons = {
  downloading: 'M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4',
  checking: 'M9 12l2 2 4-4M5 4h14v16H5z',
  preheating: 'M10 14V5a2 2 0 0 1 4 0v9a4 4 0 1 1-4 0zM12 10v7',
  leveling: 'M3 17h18M4 13l16-3M7 7h10',
  printing: 'M12 3l9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5',
  paused: 'M9 5v14m6-14v14',
  resumed: 'M8 5l11 7-11 7z',
  finished: 'M4 12l5 5L20 6',
  failed: 'M6 6h12v12H6z',
  spool: 'M20 11a8 8 0 1 0-2 6m2-12v6h-6M12 10v4',
  filament_low: 'M12 4l9 16H3zM12 9v4m0 3v.2',
};

/** Le bouton et le texte de l’événement portent déjà le libellé du pictogramme. */
function timelineIcon(kind) {
  const ns = 'http://www.w3.org/2000/svg';
  const icon = document.createElementNS(ns, 'svg');
  const path = document.createElementNS(ns, 'path');
  icon.setAttribute('class', 'ui-icon');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '2');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('d', timelineIcons[kind]);
  icon.append(path);
  return icon;
}

/** Regroupe les relevés par journée locale sans perdre l’heure complète des repères clavier. */
export function printTimeline(id, events = []) {
  const section = $(id);
  const labels = {
    downloading: 'Téléchargement en cours', checking: 'Vérification…',
    preheating: 'Préchauffage', leveling: 'Mise à niveau du plateau',
    printing: 'Impression en cours', paused: 'En pause', resumed: 'Impression reprise',
    finished: 'Impression terminée', failed: 'Impression arrêtée', spool: 'Changement de bobine',
    filament_low: 'Filament bientôt épuisé',
  };
  const days = section.querySelector('.timeline-days');
  const entries = events.filter(event => Object.hasOwn(labels, event.kind));
  section.hidden = !entries.length;
  const signature = JSON.stringify(entries);
  if (section.dataset.events === signature) return;
  section.dataset.events = signature;
  const first = entries[0]?.time, last = entries.at(-1)?.time;
  const day = new Intl.DateTimeFormat(locale, {dateStyle:'short', timeZone});
  const clock = new Intl.DateTimeFormat(locale, {timeStyle:'short', timeZone});
  const full = new Intl.DateTimeFormat(locale, {dateStyle:'short', timeStyle:'short', timeZone});
  const markers = section.querySelector('.timeline-markers');
  markers?.replaceChildren();
  days.replaceChildren();
  let previousDay, list;
  entries.forEach((event, index) => {
    const slots = event.kind === 'spool' ? event.slots.map(([box, slot]) =>
      formatText('ACE {0} · emplacement {1}', Number(box) + 1, slot)).join(', ') : '';
    const shortages = event.kind === 'filament_low' ? (event.shortages || []).map(slot => formatText('Emplacement {0}', slot)).join(', ') : '';
    const timestamp = event.time * 1000;
    const currentDay = day.format(timestamp);
    if (currentDay !== previousDay) {
      list = node('ol');
      days.append(node('p', currentDay, 'timeline-day'), list);
      previousDay = currentDay;
    }
    const text = [tr(labels[event.kind]), slots, shortages].filter(Boolean).join(' · ');
    const time = node('time', clock.format(timestamp));
    time.dateTime = new Date(timestamp).toISOString();
    const item = node('li');
    item.append(timelineIcon(event.kind), time, node('span', text));
    list.append(item);
    if (markers) {
      item.tabIndex = -1;
      const marker = node('button');
      marker.append(timelineIcon(event.kind));
      marker.type = 'button';
      marker.title = [full.format(timestamp), text].join(' · ');
      marker.setAttribute('aria-label', marker.title);
      marker.style.setProperty('--timeline-position', (last > first ? 100 * (event.time - first) / (last - first) : 50) + '%');
      marker.onclick = () => item.focus();
      marker.onkeydown = event => {
        const offset = {ArrowLeft:-1, ArrowRight:1}[event.key];
        if (offset && markers.children[index + offset]) {
          event.preventDefault();
          markers.children[index + offset].focus();
        }
      };
      markers.append(marker);
    }
  });
}
/** Renvoie l’élément HTML par identifiant ; les contrôles de cette page partagent ce point d’accès. */
export const $ = (id) => document.getElementById(id);
/** Écrit du texte littéral et représente une valeur absente par un tiret. */
export const set = (id, value) => {
  $(id).textContent = value ?? '—';
};
/** Formate une valeur en français avec suffixe, en distinguant zéro d’une donnée absente. */
export const fmt = (v, suffix = '') =>
  v == null
    ? '—'
    : `${typeof v === 'number' ? v.toLocaleString(locale, { maximumFractionDigits: 1 }) : v}${tr(suffix)}`;
/** Formate des minutes arrondies en durée lisible ; une valeur absente reste inconnue. */
export const mins = (v) => {
  if (v == null) return '—';
  const n = Math.max(0, Math.round(v)),
    h = Math.floor(n / 60),
    m = n % 60;
  return h ? `${fmt(h)} h${m ? ' ' + fmt(m) + ' min' : ''}` : `${fmt(m)} min`;
};
/** Affiche le fuseau configuré pour garder historique et graphiques cohérents ; accepte les horodatages ISO et les secondes Unix du cloud. */
export const date = (v) =>
  v
    ? new Date(typeof v === 'number' && v > 1e9 && v < 1e11 ? v * 1000 : v).toLocaleString(locale, {
        timeZone,
      })
    : '—';
/** Crée un élément avec texte littéral afin de ne pas interpréter les noms cloud comme du HTML. */
export const node = (tag, text, cls) => {
  const e = document.createElement(tag);
  if (text != null) e.textContent = text;
  if (cls) e.className = cls;
  return e;
};
/** Affiche un retour horodaté ; error distingue une erreur sans exposer de détails internes. */
export function message(text, error = false) {
  set(
    'message-text',
    text
      ? `${new Date().toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone })} — ${text}`
      : '',
  );
  const help = $('message-error-help');
  if (help) {
    help.hidden = true;
    help.onclick = null;
  }
  $('message').hidden = !text;
  $('message').classList.toggle('error', error);
}
/** Renvoie une promesse booléenne ; un libellé destructif donne la priorité à l’annulation. */
export function confirmAction(text, destructiveLabel = '') {
  return new Promise((resolve) => {
    const d = $('confirm-dialog');
    const yes = $('confirm-yes'), no = $('confirm-no');
    set('confirm-text', text);
    set('confirm-yes', destructiveLabel || tr('Confirmer'));
    d.dataset.severity = destructiveLabel ? 'destructive' : 'ordinary';
    yes.classList.toggle('primary', !destructiveLabel);
    yes.classList.toggle('danger', !!destructiveLabel);
    d.showModal();
    if (destructiveLabel) no.focus();
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const finish = (value) => {
      settle(value);
      d.close();
    };
    no.onclick = () => finish(false);
    yes.onclick = () => finish(true);
    d.oncancel = () => settle(false);
    d.onclose = () => settle(false);
  });
}

/** Renvoie le premier élément d’une liste ou la valeur scalaire, pour les paramètres de tranche multimatériaux. */
export function single(v) {
  return Array.isArray(v) ? v[0] : v;
}
/** Formate un paramètre scalaire ou son premier matériau, sans doubler une unité déjà présente. */
export function valueUnit(v, unit = '') {
  v = single(v);
  return v == null
    ? '—'
    : typeof v === 'number'
      ? v.toLocaleString(locale, { maximumFractionDigits: 3 }) + unit
      : String(v) + (unit && !String(v).includes(unit.trim()) ? unit : '');
}

/** Formate le quota en unités binaires, en préservant la distinction entre zéro et une donnée absente. */
export const bytes = (v) =>
  v == null
    ? '—'
    : Number(v) >= 1073741824
      ? (Number(v) / 1073741824).toLocaleString(locale, { maximumFractionDigits: 2 }) + tr(' Go')
      : Number(v) >= 1048576
        ? (Number(v) / 1048576).toLocaleString(locale, { maximumFractionDigits: 1 }) + tr(' Mo')
        : Number(v).toLocaleString(locale) + tr(' octets');
