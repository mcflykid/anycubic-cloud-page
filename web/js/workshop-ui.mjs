const preference = 'cloud-page-language';
const locales = { fr: 'fr-FR', en: 'en', es: 'es' };
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
  return catalogue[text][language === 'en' ? 0 : 1];
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
  if (requested === 'en' || requested === 'es') {
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
          (pair) =>
            Array.isArray(pair) &&
            pair.length === 2 &&
            pair.every((value) => typeof value === 'string'),
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
    choice = document.getElementById('interface-theme');
  let theme = 'system';
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === 'light' || saved === 'dark') theme = saved;
  } catch {}
  root.dataset.theme = theme;
  if (!choice) return;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let transition;
  choice.value = theme;
  choice.addEventListener('change', () => {
    const nextTheme = choice.value;
    transition?.skipTransition();
    const applyTheme = () => {
      // Le navigateur peut différer le rendu jusqu’après un deuxième changement.
      if (choice.value === nextTheme) root.dataset.theme = nextTheme;
    };
    if (!reducedMotion.matches && typeof document.startViewTransition === 'function') {
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

const styleCatalogue = [
  ['standard', 'Repères clairs et disposition directe pour le suivi quotidien.'],
  ['aurora', 'Tableau de bord en tuiles déplaçables et surfaces lumineuses.'],
  ['lab', 'Navigation par usage et compositions expérimentales pour comparer les parcours.'],
  ['glasshouse', 'Navigation en panneaux vitrés et cartes aérées.'],
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
  $('message').hidden = !text;
  $('message').classList.toggle('error', error);
}
/** Renvoie une promesse booléenne ; une fermeture du dialogue annule l’action physique proposée. */
export function confirmAction(text) {
  return new Promise((resolve) => {
    const d = $('confirm-dialog');
    set('confirm-text', text);
    d.showModal();
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
    $('confirm-no').onclick = () => finish(false);
    $('confirm-yes').onclick = () => finish(true);
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
