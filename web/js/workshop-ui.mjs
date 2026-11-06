const preference = 'cloud-page-language';
const locales = { fr: 'fr-FR', en: 'en', es: 'es' };
const catalogueURL = new URL('./workshop-translations.json?v=3b30ca86c7bd', import.meta.url);
const catalogueIntegrity = 'sha256-OzDKhse9sxiUT2PeXZwyRFIkzEtcNJhvs1SI5wVktqY=';
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
await initializeLanguage();

/** Fournit la locale réellement chargée pour les nombres, les dates et la recherche. */
export const locale = locales[language];
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
    const finish = (value) => {
      d.close();
      resolve(value);
    };
    $('confirm-no').onclick = () => finish(false);
    $('confirm-yes').onclick = () => finish(true);
    d.oncancel = () => resolve(false);
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
