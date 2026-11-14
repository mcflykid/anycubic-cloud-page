// Compteur à rouleaux repris de Moxen Lote https://moxen.cl/recursos/lote/
export function createSelectionCounter(el) {
  let cols = [];
  el.textContent = '';
  function pon(n) {
    const dig = Array.from(String(n));
    while (cols.length > dig.length) el.removeChild(cols.shift());
    let nuevo = false;
    while (cols.length < dig.length) {
      const c = document.createElement('span'), t = document.createElement('span');
      c.className = 'selection-digit'; t.className = 'selection-digit-strip';
      c.setAttribute('aria-hidden', 'true');
      t.innerHTML = '0<br>1<br>2<br>3<br>4<br>5<br>6<br>7<br>8<br>9';
      t.style.setProperty('--d', 0);
      c.appendChild(t); el.insertBefore(c, el.firstChild); cols.unshift(c); nuevo = true;
    }
    if (nuevo) void el.offsetWidth; // Une nouvelle colonne commence à zéro.
    dig.forEach((ch, i) => { const t = cols[i].firstChild; t.style.setProperty('--i', dig.length - 1 - i); t.style.setProperty('--d', ch); });
  }
  return { pon };
}

/** La sélection peinte reste confinée à la gouttière ; aucun geste ne lance une action sur les fichiers. */
export function initializePaintSelection(container, changed) {
  let gesture = null, anchor = null;
  /** Lit les cases présentes après le rendu courant des lignes. */
  const inputs = () => [...container.querySelectorAll('input[data-selection]')];
  /** Met à jour une case puis notifie les gestionnaires existants comme une interaction native. */
  const paint = (input, selected, delay = 0) => {
    if (input.checked === selected) return;
    input.closest('tr')?.style.setProperty('--selection-wave-delay', `${delay}ms`);
    input.checked = selected;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  /** Applique l’état choisi à toutes les cases entre deux bornes incluses. */
  const range = (from, to, selected) => {
    const list = inputs(), a = list.indexOf(from), b = list.indexOf(to);
    if (a < 0 || b < 0) return;
    // Cascade reprise de Moxen Lote https://moxen.cl/recursos/lote/
    const changes = list.slice(Math.min(a, b), Math.max(a, b) + 1)
      .filter(input => input.checked !== selected);
    if (a > b) changes.reverse();
    changes.forEach((input, index) => paint(input, selected, selected ? index * 46 : 0));
  };
  container.addEventListener('pointerdown', event => {
    const input = event.target.closest('.file-selection-gutter')?.querySelector('input[data-selection]');
    if (!input || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    const selected = !input.checked;
    gesture = { pointer: event.pointerId, last: input, selected };
    if (event.shiftKey && anchor?.isConnected) range(anchor, input, selected);
    else paint(input, selected);
    anchor = input;
    input.focus({ preventScroll: true });
    container.setPointerCapture(event.pointerId);
  });
  container.addEventListener('pointermove', event => {
    if (!gesture || event.pointerId !== gesture.pointer) return;
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const input = hit?.closest('.file-selection-gutter')?.querySelector('input[data-selection]');
    if (!input || !container.contains(input)) return;
    range(gesture.last, input, gesture.selected);
    gesture.last = input;
  });
  /** Termine le geste courant, libère la capture et recalcule les commandes groupées. */
  const end = event => {
    if (gesture?.pointer !== event.pointerId) return;
    gesture = null;
    if (container.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId);
    changed();
  };
  container.addEventListener('pointerup', end);
  container.addEventListener('pointercancel', end);
  container.addEventListener('lostpointercapture', () => {
    if (!gesture) return;
    gesture = null;
    changed();
  });
  container.addEventListener('click', event => {
    const input = event.target.closest('input[data-selection]');
    if (!input) return;
    // Le clic synthétique du pointeur ne doit pas annuler la peinture ; Espace reste natif.
    if (event.detail) event.preventDefault();
  });
  // La barre groupée attend la fin du geste pour ne pas déplacer les cases sous le doigt.
  return () => gesture !== null;
}
