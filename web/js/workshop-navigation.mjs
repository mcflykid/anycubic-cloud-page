import { tr } from './workshop-ui.mjs';

/** Gère la navigation responsive et le rail du Laboratoire. */
export function initializeWorkshopNavigation() {
  const toggle = document.getElementById('section-menu-toggle');
  const navigation = document.getElementById('atelier-tabs');
  const shell = document.querySelector('.printer-shell');
  if (!toggle || !navigation || !shell || toggle.dataset.initialized === 'true') return;
  toggle.dataset.initialized = 'true';
  const labToggle = document.getElementById('lab-navigation-toggle');
  labToggle.hidden = false;
  labToggle.onclick = () => {
    const collapsed = shell.classList.toggle('lab-navigation-collapsed');
    labToggle.setAttribute('aria-expanded', String(!collapsed));
    labToggle.setAttribute('aria-label', tr(collapsed ? 'Développer les sections' : 'Réduire les sections'));
  };

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
  let phase = 0, closeTimer = 0;
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
    ++phase;
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

  updateCurrentLabel();
}
