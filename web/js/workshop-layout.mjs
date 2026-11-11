import { $, message, node, tr } from './workshop-ui.mjs?v=f51999168421';

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

/** Réorganise les tuiles de l’onglet courant et mémorise les positions et tailles. */
export function initializeTileLayout() {
  let preferences = read();
  let editing = null;
  let pointer = null;
  const groups = new Map();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const panelKey = key => key === 'overview-aurora' ? 'overview' : key;

  /** Le cadenas de chaque panneau ne s’applique qu’aux tuiles de ce panneau. */
  function addLocks() {
    for (const key of new Set(layouts.map(([id])=>panelKey(id)))) {
      const panel = $('tab-' + key);
      const toolbar = node('div', null, 'layout-toolbar');
      const toggle = layoutButton('Déverrouiller la disposition', '🔒', 'lock');
      toggle.setAttribute('aria-pressed', 'false');
      toggle.onclick = () => setEditing(editing === key ? null : key);
      toolbar.append(toggle);
      panel.prepend(toolbar);
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
  function motion(group, update) {
    const cards = groupCards(group);
    const before = new Map(cards.map(card=>[card,card.getBoundingClientRect()]));
    for (const card of cards) card.getAnimations().filter(animation => animation.id === 'tile-position').forEach(animation => animation.cancel());
    update();
    if (reduced.matches) return;
    for (const card of cards) {
      const old = before.get(card), next = card.getBoundingClientRect();
      const x = old.left-next.left, y = old.top-next.top;
      if (x || y) card.animate([{transform:`translate(${x}px,${y}px)`},{transform:'translate(0,0)'}],
        {id:'tile-position',duration:210,easing:'cubic-bezier(.2,.78,.25,1)'});
    }
  }

  /** Le bouton clavier déplace exactement d’une place, ou change d’une colonne. */
  function keyboardChange(group, card, operation) {
    if (editing !== panelKey(group.dataset.layoutGroup)) return;
    const cards = groupCards(group), index = cards.indexOf(card);
    const focused = document.activeElement;
    if (operation === 'resize') {
      card.dataset.layoutSpan = card.dataset.layoutSpan === '2' ? '1' : '2';
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
    pointer = {id:event.pointerId, x:event.clientX, y:event.clientY, group, card, operation,
      order:groupCards(group).map(item=>item.dataset.layoutCard), span:card.dataset.layoutSpan, changed:false};

    card.dataset.layoutDragging = 'true';
  }

  /** Le déplacement s’accroche aux cartes voisines, le redimensionnement aux colonnes. */
  function movePointer(event) {
    if (!pointer || event.pointerId !== pointer.id) return;
    const {group,card,operation,x,y,span} = pointer;
    if (Math.abs(event.clientX-x)+Math.abs(event.clientY-y)<7 && !pointer.changed) return;
    if (operation === 'resize') {
      const delta = event.clientX-x, threshold = group.clientWidth/5;
      const next = Math.abs(delta) < threshold ? span : delta > 0 ? '2' : '1';
      card.dataset.layoutSpan = next;
      pointer.changed = next !== span;
      return;
    }
    const target = document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-layout-card]');
    if (!target || target === card || target.parentElement !== group) return;
    const rect = target.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const sameRow = Math.abs(cardRect.top - rect.top) < 8;
    const before = sameRow ? event.clientX < rect.left + rect.width/2 : event.clientY < rect.top + rect.height/2;
    const cards = groupCards(group), original = cards.indexOf(card);
    const order = cards.filter(item=>item!==card).map(item=>item.dataset.layoutCard);
    const index = order.indexOf(target.dataset.layoutCard) + (before ? 0 : 1);
    if (index === original) return;
    order.splice(index,0,card.dataset.layoutCard);
    motion(group,()=>arrange(group,order));
    pointer.changed = true;
  }

  /** Une annulation restitue l’ordre initial du geste, une fin valide la modification. */
  function endPointer(event, cancelled) {
    if (!pointer || event && event.pointerId !== pointer.id) return;
    const {group,card,order,span,changed} = pointer;
    pointer = null;
    delete card.dataset.layoutDragging;
    if (cancelled) { arrange(group,order); card.dataset.layoutSpan = span; }
    else if (changed) save(group);
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
      button.textContent = active ? '🔓' : '🔒';
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
