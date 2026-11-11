import { tr } from './workshop-ui.mjs?v=d730a15b9b57';

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
      ['machine', overview.querySelector('.overview-grid .product')],
      ['job', overview.querySelector('.overview-grid .overview-content')],
      ['temperatures', overview.querySelector('.printer-lower-grid > section:first-of-type')],
      ['details', overview.querySelector('.printer-lower-grid > section:last-of-type')],
    ].filter(([, element]) => element);
    bento = document.createElement('div');
    bento.id = 'aurora-bento';
    bento.className = 'aurora-bento';
    for (const [name, element] of entries) {
      // Les repères rétablissent les éléments à leur place à la sortie d’Aurore.
      const marker = document.createComment(`aurora:${name}`);
      element.before(marker);
      const card = document.createElement('article');
      card.className = `aurora-widget aurora-widget-${name}`;
      card.dataset.widget = name;
      card.append(element);
      bento.append(card);
      bentoItems.push({marker, element});
    }
    overview.prepend(bento);
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
