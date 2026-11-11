import { formatText, tr } from './workshop-ui.mjs?v=544c79feee4e';

/** Gère la navigation responsive et les dispositions locales des thèmes Blueprint et Aurore. */
export function initializeWorkshopNavigation() {
  const toggle = document.getElementById('section-menu-toggle');
  const navigation = document.getElementById('atelier-tabs');
  const shell = document.querySelector('.printer-shell');
  if (!toggle || !navigation || !shell || toggle.dataset.initialized === 'true') return;
  toggle.dataset.initialized = 'true';
  const menuName = tr('Sections');
  toggle.setAttribute('aria-label', menuName);
  const compact = window.matchMedia('(max-width: 760px)');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  navigation.dataset.open = 'false';
  navigation.dataset.phase = '';
  const tabs = [...navigation.querySelectorAll('[data-tab]')];
  tabs.forEach((tab, index) => {
    tab.style.setProperty('--tile-index', index);
    tab.style.setProperty('--tile-exit-index', tabs.length - index - 1);
  });
  let phase = 0, closeTimer = 0, bento = null, bentoItems = [], indicator = null;
  let mobileLabel = document.getElementById('section-menu-current');
  if (!mobileLabel) {
    mobileLabel = document.createElement('span');
    mobileLabel.id = 'section-menu-current';
    mobileLabel.className = 'section-menu-current';
    mobileLabel.setAttribute('aria-hidden', 'true');
    toggle.append(mobileLabel);
  }
  const currentButton = () => navigation.querySelector('[data-tab][aria-current="page"]');
  const updateCurrentLabel = () => {
    const label = currentButton()?.querySelector('span')?.textContent?.trim();
    mobileLabel.textContent = label || '';
  };
  const finishClose = (token) => {
    // Un jeton empêche le minuteur d’une ancienne fermeture de masquer un menu rouvert.
    if (token !== phase || toggle.getAttribute('aria-expanded') === 'true') return;
    navigation.dataset.open = 'false';
    navigation.dataset.phase = '';
    navigation.inert = false;
    clearTimeout(closeTimer);
  };
  const close = (restoreFocus = false) => {
    if (toggle.getAttribute('aria-expanded') !== 'true') return;
    const token = ++phase;
    clearTimeout(closeTimer);
    toggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus) toggle.focus();
    if (reducedMotion.matches || !compact.matches) {
      finishClose(token);
      return;
    }
    // La vague reste visible, mais les tuiles fermées quittent aussitôt le parcours clavier.
    navigation.inert = true;
    navigation.dataset.phase = 'closing';
    const first = navigation.querySelector('[data-tab]');
    if (!first) return finishClose(token);
    // Le délai couvre la vague de sortie même si animationend ne remonte pas du dernier bouton.
    closeTimer = window.setTimeout(() => finishClose(token), 900);
  };
  const open = () => {
    const token = ++phase;
    clearTimeout(closeTimer);
    navigation.dataset.open = 'true';
    navigation.dataset.phase = '';
    navigation.inert = false;
    toggle.setAttribute('aria-expanded', 'true');
    updateCurrentLabel();
    if (compact.matches && !reducedMotion.matches) {
      void navigation.offsetWidth;
      navigation.dataset.phase = 'opening';
    }
    (currentButton() || navigation.querySelector('[data-tab]:not(:disabled)'))?.focus();
    requestAnimationFrame(() => {
      if (token === phase) updateIndicator();
    });
  };
  toggle.onclick = () => {
    if (toggle.getAttribute('aria-expanded') === 'true') close(true);
    else open();
  };
  toggle.disabled = false;
  navigation.addEventListener('click', event => {
    const tab = event.target.closest('[data-tab]');
    if (!tab) return;
    updateCurrentLabel();
    requestAnimationFrame(updateIndicator);
    if (compact.matches) close(true);
  });
  navigation.addEventListener('animationend', event => {
    const tabs = navigation.querySelectorAll('[data-tab]');
    if (event.animationName === 'tile-enter' && event.target === tabs[tabs.length - 1] &&
      navigation.dataset.phase === 'opening') navigation.dataset.phase = '';
    if (event.animationName === 'tile-exit' && event.target === tabs[0] &&
      navigation.dataset.phase === 'closing') finishClose(phase);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && compact.matches && toggle.getAttribute('aria-expanded') === 'true') {
      event.preventDefault();
      close(true);
    }
  });
  document.addEventListener('pointerdown', event => {
    if (compact.matches && toggle.getAttribute('aria-expanded') === 'true' &&
      !event.target.closest('.atelier-navigation')) close();
  });
  compact.addEventListener('change', event => {
    if (event.matches) return;
    if (navigation.dataset.phase === 'closing') finishClose(phase);
    else close();
  });
  reducedMotion.addEventListener('change', event => {
    if (!event.matches) return;
    if (navigation.dataset.phase === 'opening') navigation.dataset.phase = '';
    if (navigation.dataset.phase === 'closing') finishClose(phase);
  });

  indicator = document.createElement('span');
  indicator.className = 'atelier-active-indicator';
  indicator.setAttribute('aria-hidden', 'true');
  navigation.append(indicator);
  const blueprintToggle = document.createElement('button');
  blueprintToggle.id = 'blueprint-nav-toggle';
  blueprintToggle.type = 'button';
  blueprintToggle.setAttribute('aria-expanded', String(!shell.classList.contains('blueprint-sidebar-collapsed')));
  const blueprintIcon = document.createElement('span'), blueprintLabel = document.createElement('span');
  blueprintIcon.setAttribute('aria-hidden', 'true');
  blueprintIcon.textContent = '⌗';
  blueprintLabel.className = 'blueprint-toggle-label';
  blueprintLabel.textContent = tr('Replier le plan');
  blueprintToggle.setAttribute('aria-label', blueprintLabel.textContent);
  blueprintToggle.append(blueprintIcon, blueprintLabel);
  document.querySelector('.atelier-navigation').insertBefore(blueprintToggle, navigation);
  blueprintToggle.onclick = () => {
    const expanded = blueprintToggle.getAttribute('aria-expanded') === 'true';
    shell.classList.toggle('blueprint-sidebar-collapsed', expanded);
    blueprintToggle.setAttribute('aria-expanded', String(!expanded));
    const label = tr(expanded ? 'Déplier le plan' : 'Replier le plan');
    blueprintToggle.setAttribute('aria-label', label);
    blueprintToggle.querySelector('.blueprint-toggle-label').textContent = label;
    requestAnimationFrame(updateIndicator);
  };
  const styleObserver = new MutationObserver(() => {
    const style = document.documentElement.dataset.style;
    updateCurrentLabel();
    requestAnimationFrame(updateIndicator);
    if (style === 'aurora') buildAuroraBento();
    else restoreAuroraBento();
  });
  styleObserver.observe(document.documentElement, {attributes: true, attributeFilter: ['data-style']});

  function buildAuroraBento() {
    if (bento) return;
    const overview = document.getElementById('tab-overview');
    if (!overview) return;
    const entries = [
      ['machine', tr('Imprimante'), overview.querySelector('.overview-grid .product')],
      ['job', tr('Travail en cours'), overview.querySelector('.overview-grid .overview-content')],
      ['temperatures', tr('Températures'), overview.querySelector('.printer-lower-grid > section:first-child')],
      ['details', tr('Détails'), overview.querySelector('.printer-lower-grid > section:last-child')],
    ].filter(([, , element]) => element);
    bento = document.createElement('div');
    bento.id = 'aurora-bento';
    bento.className = 'aurora-bento';
    const toolbar = document.createElement('div');
    toolbar.className = 'aurora-bento-toolbar';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'aurora-layout-reset';
    reset.textContent = tr('Réinitialiser la disposition');
    const status = document.createElement('p');
    status.className = 'aurora-layout-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    toolbar.append(reset, status);
    bento.append(toolbar);
    overview.prepend(bento);
    // Les commentaires repères rétablissent les sections à leur place quand le style change.
    const key = 'cloud-page-layout:aurora';
    const defaults = entries.map(([name]) => name);
    // Valide la préférence locale avant d’insérer les cartes pour tolérer les versions partielles.
    const readOrder = () => {
      try {
        const saved = JSON.parse(localStorage.getItem(key) || 'null');
        if (!Array.isArray(saved)) return [...defaults];
        const valid = [...new Set(saved.filter(name => defaults.includes(name)))];
        return [...valid, ...defaults.filter(name => !valid.includes(name))];
      } catch { return [...defaults]; }
    };
    const cards = new Map();
    for (const [name, label, element] of entries) {
      const marker = document.createComment(`aurora:${name}`);
      element.parentNode.insertBefore(marker, element);
      const card = document.createElement('article');
      card.className = `aurora-widget aurora-widget-${name}`;
      card.dataset.widget = name;
      const controls = document.createElement('div');
      controls.className = 'aurora-widget-controls';
      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'aurora-drag-handle';
      handle.setAttribute('aria-label', formatText('Déplacer {0} par glisser-déposer', label));
      handle.title = tr('Déplacer cette tuile');
      handle.textContent = '⠿';
      const up = document.createElement('button');
      up.type = 'button';
      up.className = 'aurora-move-up';
      up.setAttribute('aria-label', formatText('Déplacer {0} vers le haut', label));
      up.textContent = '↑';
      const down = document.createElement('button');
      down.type = 'button';
      down.className = 'aurora-move-down';
      down.setAttribute('aria-label', formatText('Déplacer {0} vers le bas', label));
      down.textContent = '↓';
      controls.append(handle, up, down);
      card.append(controls, element);
      bento.append(card);
      cards.set(name, {card, marker, element, label});
      bentoItems.push({card, marker, element});
      up.onclick = () => move(card, -1, true);
      down.onclick = () => move(card, 1, true);
      installPointerDrag(handle, card);
    }
    const list = () => [...bento.querySelectorAll('.aurora-widget')];
    const persist = () => {
      try { localStorage.setItem(key, JSON.stringify(list().map(card => card.dataset.widget))); } catch {}
      updateControls();
    };
    const updateControls = () => {
      for (const [index, card] of list().entries()) {
        card.querySelector('.aurora-move-up').disabled = index === 0;
        card.querySelector('.aurora-move-down').disabled = index === list().length - 1;
      }
    };
    const arrange = order => {
      for (const name of order) {
        const card = cards.get(name)?.card;
        if (card) bento.append(card);
      }
      updateControls();
    };
    const announce = card => {
      const index = list().indexOf(card) + 1;
      status.textContent = formatText('{0} · {1}/{2}', cards.get(card.dataset.widget)?.label || '', index, list().length);
    };
    // L’animation FLIP conserve les positions visuelles; les mouvements sont annulés en mode réduit.
    const flip = action => {
      const before = new Map(list().map(card => [card, card.getBoundingClientRect()]));
      // Repartir de la position visible si un déplacement est encore en cours.
      for (const card of list()) card.getAnimations().forEach(animation => animation.cancel());
      action();
      if (!reducedMotion.matches) {
        for (const card of list()) {
          const old = before.get(card), next = card.getBoundingClientRect();
          if (!old) continue;
          const dx = old.left - next.left, dy = old.top - next.top;
          if (dx || dy) {
            card.animate([{transform: `translate(${dx}px,${dy}px)`}, {transform: 'translate(0,0)'}], {
              duration: 270, easing: 'cubic-bezier(.2,.78,.25,1)',
            });
          }
        }
      }
    };
    function move(card, direction, save) {
      const current = list().indexOf(card), next = Math.max(0, Math.min(list().length - 1, current + direction));
      if (next === current) return;
      flip(() => direction < 0 ? bento.insertBefore(card, list()[next]) : bento.insertBefore(card, list()[next].nextSibling));
      if (save) persist();
      announce(card);
    }
    // Le glissement au pointeur complète les commandes haut/bas accessibles au clavier.
    function installPointerDrag(handle, card) {
      let drag = null;
      handle.addEventListener('pointerdown', event => {
        if (event.button !== 0 || !event.isPrimary) return;
        drag = {pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
          original: list().map(item => item.dataset.widget), moved: false};
        handle.setPointerCapture(event.pointerId);
        card.classList.add('is-dragging');
      });
      document.addEventListener('pointermove', event => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        if (Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) > 5) drag.moved = true;
        if (!drag.moved) return;
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.aurora-widget');
        if (!target || target === card || target.parentElement !== bento) return;
        const rect = target.getBoundingClientRect();
        flip(() => bento.insertBefore(card, event.clientY < rect.top + rect.height / 2 ? target : target.nextSibling));
      });
      const finish = (event, cancelled) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        const previous = drag.original;
        drag = null;
        card.classList.remove('is-dragging');
        if (cancelled) arrange(previous);
        else if (previous.join(',') !== list().map(item => item.dataset.widget).join(',')) {
          persist();
          announce(card);
        }
      };
      document.addEventListener('pointerup', event => finish(event, false));
      document.addEventListener('pointercancel', event => finish(event, true));
    }
    reset.onclick = () => {
      arrange(defaults);
      try { localStorage.removeItem(key); } catch {}
      status.textContent = tr('Disposition d’origine restaurée.');
    };
    arrange(readOrder());
  }
  // Replace chaque élément avant son repère afin de quitter Aurore sans déplacer le contenu.
  function restoreAuroraBento() {
    if (!bento) return;
    for (const {marker, element} of bentoItems) {
      if (marker.parentNode) marker.parentNode.insertBefore(element, marker);
      marker.remove();
    }
    bento.remove();
    bento = null;
    bentoItems = [];
  }
  // Le repère est positionné en coordonnées de la barre pour suivre le bouton actif.
  function updateIndicator() {
    if (!indicator || !['apple', 'ocean'].includes(document.documentElement.dataset.style)) return;
    const active = currentButton();
    if (!active) return;
    const parent = navigation.getBoundingClientRect(), rect = active.getBoundingClientRect();
    indicator.style.width = `${rect.width}px`;
    indicator.style.height = `${rect.height}px`;
    indicator.style.transform = `translate(${rect.left - parent.left - navigation.clientLeft}px,${rect.top - parent.top - navigation.clientTop}px)`;
  }
  updateCurrentLabel();
  const resizeObserver = new ResizeObserver(updateIndicator);
  resizeObserver.observe(navigation);
  if (document.documentElement.dataset.style === 'aurora') buildAuroraBento();
}
