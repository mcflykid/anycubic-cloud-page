import { $, message, node, tr } from './workshop-ui.mjs';

const STORAGE = 'cloud-page-tile-layout-v1';
const layouts = [
  ['summary', '#tab-summary .summary-grid', {printer: '.summary-printer', ace: '.summary-ace'}],
  ['overview', '#tab-overview', {project: '.overview-grid', readings: '.printer-lower-grid'}],
  ['overview-aurora', '#aurora-bento', {machine: '.aurora-widget-machine', job: '.aurora-widget-job', temperatures: '.aurora-widget-temperatures', details: '.aurora-widget-details'}],
  ['ace', '#tab-ace', {module: '.ace-overview', spools: '#ace-filament-card'}],
  ['camera', '#tab-camera', {live: '.camera-layout', timelapse: '.timelapse-panel'}],
  ['statistics', '#tab-statistics .statistics-grid', {printer: '#statistics-printer', ace: '#statistics-ace', filament: '#statistics-filament'}],
  ['fleet', '#tab-fleet', {printers: '#fleet-cards', monitoring: '#monitoring'}],
  ['settings', '#tab-settings .settings-layout', {connection: '.settings-connection', appearance: '.settings-appearance', device: '.settings-device'}],
];

/** Retient uniquement les cartes connues et des tailles de une ou deux colonnes. */
function validate(input) {
  if (!input || input.version !== 1 || !input.layouts || typeof input.layouts !== 'object' || Array.isArray(input.layouts)) throw new Error('format');
  const output = {};
  for (const [key, , selectors] of layouts) {
    const entry = input.layouts[key];
    if (entry === undefined) continue;
    if (!entry || !Array.isArray(entry.order) || !entry.spans || typeof entry.spans !== 'object' || Array.isArray(entry.spans)) throw new Error('format');
    const ids = Object.keys(selectors);
    const order = [...new Set(entry.order.filter(id => ids.includes(id)))];
    if (!order.length) throw new Error('format');
    output[key] = {
      order: [...order, ...ids.filter(id => !order.includes(id))],
      spans: Object.fromEntries(ids.filter(id => entry.spans[id] === 1 || entry.spans[id] === 2).map(id => [id, entry.spans[id]])),
    };
  }
  return output;
}

/** Charge les préférences locales sans rendre la page indisponible si elles sont anciennes. */
function read() {
  try {
    const saved = localStorage.getItem(STORAGE);
    if (saved) return validate(JSON.parse(saved));
    // Préserve l’ordre enregistré par la première version des tuiles Aurore.
    const order = JSON.parse(localStorage.getItem('cloud-page-layout:aurora'));
    return Array.isArray(order) ? validate({version:1,layouts:{'overview-aurora':{order,spans:{}}}}) : {};
  } catch { return {}; }
}

/** Crée une commande de disposition sans la confondre avec un bouton d’impression. */
function layoutButton(label, symbol, action) {
  const button = node('button', symbol, 'layout-control');
  button.type = 'button';
  button.dataset.layoutAction = action;
  button.setAttribute('aria-label', tr(label));
  button.title = tr(label);
  return button;
}

/** Dessine le cadenas avec le même trait que les icônes de navigation. */
function paintLock(button, open) {
  const namespace = 'http://www.w3.org/2000/svg';
  const icon = document.createElementNS(namespace, 'svg');
  icon.classList.add('ui-icon');
  for (const [name, value] of Object.entries({
    viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
  })) icon.setAttribute(name, value);
  const outline = document.createElementNS(namespace, 'path');
  outline.setAttribute('d', 'M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Zm5 4v2');
  const shackle = document.createElementNS(namespace, 'path');
  shackle.setAttribute('d', open ? 'M8 11V7a4 4 0 0 1 7.6-1.8' : 'M8 11V7a4 4 0 0 1 8 0v4');
  icon.append(outline, shackle);
  button.replaceChildren(icon);
}

// Ressort repris de Moxen Parrilla https://moxen.cl/recursos/parrilla/
function muelle(k, c) {
  if (!(window.CSS && CSS.supports && CSS.supports('animation-timing-function', 'linear(0, 1)'))) return 'cubic-bezier(.34, 1.56, .64, 1)';
  const pts = [0];
  let x = 0, v = 0, t = 0;
  while (t < 3) {
    v += (k * (1 - x) - c * v) / 240; x += v / 240; t += 1 / 240;
    pts.push(x);
    if (t > .15 && Math.abs(1 - x) < .001 && Math.abs(v) < .01) break;
  }
  const out = [];
  for (let i = 0; i <= 40; i++) out.push(pts[Math.round(i / 40 * (pts.length - 1))].toFixed(4));
  out[40] = '1';
  return 'linear(' + out.join(', ') + ')';
}

/** Réorganise les tuiles de l’onglet courant et mémorise les positions et tailles. */
export function initializeTileLayout() {
  let preferences = read();
  let editing = null;
  let pointer = null;
  let scrollFrame = 0;
  const groups = new Map();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const spring = muelle(190, 16);
  const returnSpring = muelle(120, 8.5);
  const panelKey = key => key === 'overview-aurora' ? 'overview' : key;

  /** Le cadenas de chaque panneau ne s’applique qu’aux tuiles de ce panneau. */
  function addLocks() {
    for (const key of new Set(layouts.map(([id])=>panelKey(id)))) {
      const panel = $('tab-' + key);
      const toolbar = node('div', null, 'layout-toolbar');
      const toggle = layoutButton('Déverrouiller la disposition', null, 'lock');
      paintLock(toggle, false);
      toggle.setAttribute('aria-pressed', 'false');
      toggle.onclick = () => setEditing(editing === key ? null : key);
      toolbar.append(toggle);
      const heading = panel.querySelector(':scope > .section-title');
      if (heading) heading.append(toolbar);
      else panel.prepend(toolbar);
    }
  }

  /** Garde l’ordre voulu et conserve les éléments non concernés à leur emplacement. */
  function arrange(group, order) {
    const cards = groupCards(group);
    for (const [index,id] of order.entries()) {
      const card = cards.find(element => element.dataset.layoutCard === id);
      const marker = group._layoutMarkers[index];
      if (card && marker && marker.nextSibling !== card) group.insertBefore(card,marker.nextSibling);
    }
  }

  /** Lit uniquement les tuiles directes pour ne pas déplacer les sous-formulaires. */
  function groupCards(group) {
    return [...group.children].filter(card => card.dataset.layoutCard);
  }

  /** Applique la grille adaptative uniquement lorsque l’utilisateur personnalise cette disposition. */
  function apply(group, key) {
    const entry = preferences[key];
    const defaults = group._layoutDefaults;
    const coveredByAurora = key === 'overview' && document.documentElement.dataset.style === 'aurora';
    group.toggleAttribute('data-layout-custom', !coveredByAurora && (!!entry || editing === panelKey(key)));
    arrange(group, entry?.order || defaults);
    for (const card of groupCards(group)) {
      const span = entry?.spans[card.dataset.layoutCard] || 1;
      card.dataset.layoutSpan = String(span);
    }
  }

  /** Enregistre une modification effective de taille ou de position. */
  function save(group) {
    const cards = groupCards(group);
    preferences[group.dataset.layoutGroup] = {
      order: cards.map(card => card.dataset.layoutCard),
      spans: Object.fromEntries(cards.map(card => [card.dataset.layoutCard, Number(card.dataset.layoutSpan) || 1])),
    };
    store();
  }

  /** Signale une mémoire locale indisponible tout en conservant le rendu de la page. */
  function store() {
    try { localStorage.setItem(STORAGE, JSON.stringify({version:1, layouts:preferences})); }
    catch { message(tr('Le navigateur ne peut pas mémoriser ce choix.'), true); }
  }

  /** Anime le changement de position sans rejouer l’apparition des autres éléments. */
  function motion(group, update, {returning = false, skip = null} = {}) {
    const cards = groupCards(group).filter(card => card !== skip);
    const before = new Map(cards.map(card => [card, card.getBoundingClientRect()]));
    for (const card of cards) {
      for (const animation of card.getAnimations()) {
        if (animation.id === 'tile-position') animation.cancel();
      }
    }
    update();
    if (reduced.matches) return;
    group.style.setProperty('--tile-spring', spring);
    for (const card of cards) {
      const old = before.get(card);
      const next = card.getBoundingClientRect();
      if (!next.width || !next.height || !old.width || !old.height) continue;
      const x = old.left - next.left;
      const y = old.top - next.top;
      const width = old.width / next.width;
      const height = old.height / next.height;
      if (x || y || width !== 1 || height !== 1) {
        card.animate([
          {transformOrigin: 'top left', transform: `translate(${x}px, ${y}px) scale(${width}, ${height})`},
          {transformOrigin: 'top left', transform: 'none'},
        ], {id: 'tile-position', duration: 800, easing: returning ? returnSpring : spring});
      }
    }
  }

  /** Le bouton clavier déplace exactement d’une place, ou change d’une colonne. */
  function keyboardChange(group, card, operation) {
    if (editing !== panelKey(group.dataset.layoutGroup)) return;
    const cards = groupCards(group), index = cards.indexOf(card);
    const focused = document.activeElement;
    if (operation === 'resize') {
      motion(group, () => { card.dataset.layoutSpan = card.dataset.layoutSpan === '2' ? '1' : '2'; });
    } else {
      const next = index + (operation === 'before' ? -1 : 1);
      if (!cards[next]) return;
      const order = cards.map(item=>item.dataset.layoutCard);
      [order[index],order[next]] = [order[next],order[index]];
      motion(group,()=>arrange(group,order));
      focused?.focus({preventScroll:true});
    }
    save(group);
  }

  /** Les poignées capturent le pointeur afin de suivre souris et toucher sans activer la carte. */
  function startPointer(event, group, card, operation) {
    if (event.button !== 0 || !event.isPrimary || editing !== panelKey(group.dataset.layoutGroup)) return;
    if (operation === 'drag') group.setPointerCapture(event.pointerId);
    const bounds = card.getBoundingClientRect();
    pointer = {
      id: event.pointerId, x: event.clientX, y: event.clientY, group, card, operation,
      order: groupCards(group).map(item => item.dataset.layoutCard),
      span: card.dataset.layoutSpan, changed: false, outside: false,
      offsetX: 0, offsetY: 0, lastX: event.clientX, lastY: event.clientY,
      gripX: event.clientX - bounds.left - bounds.width / 2,
      gripY: event.clientY - bounds.top - bounds.height / 2,
    };
    group.style.setProperty('--tile-spring', spring);
    card.dataset.layoutDragging = operation;
    if (operation === 'drag') {
      const target = node('div', null, 'layout-drop-target');
      target.setAttribute('aria-hidden', 'true');
      group.append(target);
      pointer.target = target;
      positionDraggedTile();
    }
  }

  // Le repère matérialise la case libre, tandis que la tuile suit la poignée.
  function positionDraggedTile() {
    const {group, card, target, lastX, lastY, gripX, gripY, offsetX, offsetY} = pointer;
    const bounds = card.getBoundingClientRect();
    const grid = group.getBoundingClientRect();
    const centerX = bounds.left + bounds.width / 2 - offsetX;
    const centerY = bounds.top + bounds.height / 2 - offsetY;
    const left = centerX - card.offsetWidth / 2 - grid.left - group.clientLeft;
    const top = centerY - card.offsetHeight / 2 - grid.top - group.clientTop;
    pointer.offsetX = lastX - gripX - centerX;
    pointer.offsetY = lastY - gripY - centerY;
    card.style.translate = `${pointer.offsetX}px ${pointer.offsetY}px`;
    target.style.transform = `translate(${left}px, ${top}px)`;
    target.style.width = `${card.offsetWidth}px`;
    target.style.height = `${card.offsetHeight}px`;
    target.toggleAttribute('data-layout-drop', !pointer.outside);
  }

  /** Le déplacement s’accroche aux cartes voisines, le redimensionnement aux colonnes. */
  function movePointer(event) {
    if (!pointer || event.pointerId !== pointer.id) return;
    const {group,card,operation,x,y,span} = pointer;
    if (Math.abs(event.clientX-x)+Math.abs(event.clientY-y)<7 && !pointer.changed) return;
    if (operation === 'resize') {
      const threshold = Math.min(140, group.clientWidth / 5);
      const crossedColumn = Math.abs(event.clientX - x) >= threshold;
      const otherSpan = span === '1' ? '2' : '1';
      const next = crossedColumn ? otherSpan : span;
      if (card.dataset.layoutSpan !== next) motion(group, () => { card.dataset.layoutSpan = next; });
      pointer.changed = next !== span;
      return;
    }
    pointer.lastX = event.clientX;
    pointer.lastY = event.clientY;
    updateDragTarget();
    if (!scrollFrame) scrollFrame = requestAnimationFrame(scrollWhileDragging);
  }

  // Retrait de la cible et retour des voisines quand le geste quitte la grille.
  function updateDragTarget() {
    const {group, card, lastX, lastY, order, outside} = pointer;
    const bounds = group.getBoundingClientRect();
    pointer.outside = lastX < bounds.left - 36 || lastX > bounds.right + 36
      || lastY < bounds.top - 40 || lastY > bounds.bottom + 70;
    if (!pointer.outside) {
      reorderAtPointer();
    } else if (!outside) {
      motion(group, () => arrange(group, order), {skip: card});
      pointer.changed = false;
    }
    positionDraggedTile();
  }

  /** Déplace la tuile en suivant la position visible du pointeur, même pendant le défilement. */
  function reorderAtPointer() {
    const {group, card, lastX, lastY} = pointer;
    const target = document.elementFromPoint(lastX,lastY)?.closest('[data-layout-card]');
    if (!target || target === card || target.parentElement !== group) return;
    const rect = target.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const sameRow = Math.abs(cardRect.top - pointer.offsetY - rect.top) < 8;
    const before = sameRow ? lastX < rect.left + rect.width/2 : lastY < rect.top + rect.height/2;
    const cards = groupCards(group), original = cards.indexOf(card);
    const order = cards.filter(item=>item!==card).map(item=>item.dataset.layoutCard);
    const index = order.indexOf(target.dataset.layoutCard) + (before ? 0 : 1);
    if (index === original) return;
    order.splice(index,0,card.dataset.layoutCard);
    motion(group, () => arrange(group, order), {skip: card});
    pointer.changed = true;
  }

  /** Fait défiler les cartes hors écran quand la poignée atteint un bord de la fenêtre. */
  function scrollWhileDragging() {
    scrollFrame = 0;
    if (!pointer) return;
    const edge = 72;
    const bottom = document.documentElement.clientHeight - edge;
    const y = pointer.lastY;
    const offset = y < edge ? y - edge : Math.max(0, y - bottom);
    if (!offset) return;
    const previous = window.scrollY;
    const step = Math.sign(offset) * Math.min(14, Math.ceil(Math.abs(offset) / 4));
    window.scrollBy({top: step, behavior: 'instant'});
    if (window.scrollY === previous) return;
    updateDragTarget();
    scrollFrame = requestAnimationFrame(scrollWhileDragging);
  }

  /** Une annulation restitue l’ordre initial du geste, une fin valide la modification. */
  function endPointer(event, cancelled) {
    if (!pointer || event && event.pointerId !== pointer.id) return;
    const {group, card, order, span, changed, outside, target} = pointer;
    pointer = null;
    cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
    const returning = cancelled || outside;
    motion(group, () => {
      delete card.dataset.layoutDragging;
      card.style.removeProperty('translate');
      target?.remove();
      if (returning) {
        arrange(group, order);
        card.dataset.layoutSpan = span;
      }
    }, {returning});
    if (!returning && changed) save(group);
  }

  /** Ajoute des poignées à chaque tuile compatible sans remplacer ses commandes existantes. */
  function register([key, selector, selectors]) {
    const group = document.querySelector(selector);
    if (!group || groups.get(key) === group) return;
    const found = Object.entries(selectors).map(([id,query])=>[id,group.querySelector(`:scope > ${query}`)]).filter(([,card])=>card);
    if (found.length < 2) return;
    group.dataset.layoutGroup = key;
    group._layoutDefaults = found.map(([id])=>id);
    group._layoutMarkers = [];
    for (const [id,card] of found) {
      const marker = document.createComment('Disposition de la tuile');
      group.insertBefore(marker,card);
      group._layoutMarkers.push(marker);
      card.dataset.layoutCard = id;
      const controls = node('div', null, 'layout-card-controls');
      const drag = layoutButton('Déplacer cette tuile', '⠿', 'drag');
      const previous = layoutButton('Déplacer avant', '↑', 'before');
      const next = layoutButton('Déplacer après', '↓', 'after');
      const resize = layoutButton('Redimensionner cette tuile', '↔', 'resize');
      drag.onpointerdown = event=>startPointer(event,group,card,'drag');
      resize.onpointerdown = event=>startPointer(event,group,card,'resize');
      resize.onclick = event=>{if(event.detail===0)keyboardChange(group,card,'resize');};
      previous.onclick = ()=>keyboardChange(group,card,'before');
      next.onclick = ()=>keyboardChange(group,card,'after');
      controls.append(drag,previous,next,resize);
      card.prepend(controls);
    }
    groups.set(key,group);
    apply(group,key);
  }

  /** Ferme les poignées et limite le mode édition à un onglet. */
  function setEditing(key) {
    endPointer(null,true);
    editing = key;
    for (const panel of document.querySelectorAll('.tab-panel:has(.layout-toolbar)')) {
      const active = panel.id === 'tab-' + key;
      panel.toggleAttribute('data-layout-editing',active);
      const button = panel.querySelector('[data-layout-action=lock]');
      const label = tr(active ? 'Verrouiller la disposition' : 'Déverrouiller la disposition');
      button.setAttribute('aria-label',label);
      button.setAttribute('aria-pressed',String(active));
      button.title = label;
      paintLock(button, active);
    }
    for (const [id,group] of groups) if (group.isConnected) apply(group,id);
  }

  addLocks();
  for (const layout of layouts) register(layout);
  new MutationObserver(()=>{
    const previousBento = groups.get('overview-aurora');
    register(layouts[2]);
    const bento = groups.get('overview-aurora');
    if (bento && !bento.isConnected) groups.delete('overview-aurora');
    if (groups.get('overview-aurora') !== previousBento) {
      const overview = groups.get('overview');
      if (overview) apply(overview, 'overview');
    }
    const panel = $('tab-overview'), toolbar = panel.querySelector('.layout-toolbar');
    if (panel.firstElementChild !== toolbar) panel.prepend(toolbar);
  }).observe($('tab-overview'),{childList:true});
  new MutationObserver(()=>{if(editing && $('tab-'+editing).hidden)setEditing(null);})
    .observe($('atelier'),{attributes:true,attributeFilter:['hidden'],subtree:true});
  document.addEventListener('pointermove',movePointer);
  document.addEventListener('pointerup',event=>endPointer(event,false));
  document.addEventListener('pointercancel',event=>endPointer(event,true));
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&editing&&!document.querySelector('dialog[open]'))setEditing(null);});

  $('layout-export').onclick = () => {
    const blob = new Blob([JSON.stringify({version:1,layouts:preferences},null,2)],{type:'application/json'});
    const url = URL.createObjectURL(blob), anchor = node('a');
    anchor.href=url; anchor.download='disposition-atelier.json'; anchor.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  $('layout-import').onchange = async event => {
    const input=event.currentTarget, file=input.files[0];
    input.value='';
    if(!file)return;
    try {
      if(file.size>16384)throw new Error('size');
      preferences=validate(JSON.parse(await file.text()));
      setEditing(null);store();
      message(tr('Disposition restaurée.'));
    } catch {message(tr('Sauvegarde de disposition invalide.'),true);}
  };
  $('layout-reset').onclick = () => {
    preferences={};setEditing(null);store();
    message(tr('Disposition d’origine restaurée.'));
  };
}
