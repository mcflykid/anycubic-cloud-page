/** La sélection peinte reste confinée à la gouttière ; aucun geste ne lance une action sur les fichiers. */
export function initializePaintSelection(container, changed) {
  let gesture = null, anchor = null;
  /** Lit les cases présentes après le rendu courant des lignes. */
  const inputs = () => [...container.querySelectorAll('input[data-selection]')];
  /** Met à jour une case puis notifie les gestionnaires existants comme une interaction native. */
  const paint = (input, selected) => {
    if (input.checked === selected) return;
    input.checked = selected;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  /** Applique l’état choisi à toutes les cases entre deux bornes incluses. */
  const range = (from, to, selected) => {
    const list = inputs(), a = list.indexOf(from), b = list.indexOf(to);
    if (a < 0 || b < 0) return;
    for (const input of list.slice(Math.min(a, b), Math.max(a, b) + 1)) paint(input, selected);
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
  container.addEventListener('lostpointercapture', () => { gesture = null; });
  container.addEventListener('click', event => {
    const input = event.target.closest('input[data-selection]');
    if (!input) return;
    // Le clic synthétique du pointeur ne doit pas annuler la peinture ; Espace reste natif.
    if (event.detail) event.preventDefault();
  });
}
