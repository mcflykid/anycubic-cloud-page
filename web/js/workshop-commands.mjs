import { $, confirmAction, message, set, tr } from './workshop-ui.mjs?v=2e1dc6d92ed1';
import { workshopState, setBusy } from './workshop-state.mjs?v=18a90760f2bd';

/** Renvoie les numéros de bobines dans l’ordre saisi ; lève Error pour un numéro hors de 1 à 8. */
export function slots(value) {
  if (!value.trim()) return [];
  const result = value
    .split(/[ ,;]+/)
    .filter(Boolean)
    .map(Number);
  if (result.some((v) => !Number.isInteger(v) || v < 1 || v > 8))
    throw new Error(tr('Indiquez des emplacements de 1 à 8.'));
  return result;
}

/** Prépare les commandes utilisateur et la confirmation des actions sensibles. */
export function createCommands(request, refresh) {
  const sensitiveActions = new Set(['firmware', 'ace-firmware', 'factory-reset']);
  /** Vérifie le mot de passe séparément de la commande et abandonne la confirmation si le dialogue ferme. */
  function confirmPassword(action, target) {
    const dialog = $('reauth-dialog'),
      form = $('reauth-form'),
      submit = $('reauth-submit'),
      controller = new AbortController();
    let confirmation = null;
    form.reset();
    submit.disabled = false;
    set('reauth-state', '');
    return new Promise((resolve) => {
      dialog.addEventListener(
        'close',
        () => {
          controller.abort();
          form.reset();
          form.onsubmit = null;
          resolve(confirmation);
        },
        { once: true },
      );
      form.onsubmit = async (event) => {
        event.preventDefault();
        if (submit.disabled) return;
        submit.disabled = true;
        set('reauth-state', tr('Vérification…'));
        const body = JSON.stringify({ action, password: form.elements.password.value });
        form.reset();
        try {
          const result = await request('/reauth', {
            method: 'POST',
            printerKey: target,
            signal: controller.signal,
            headers: { 'Content-Type': 'application/json' },
            body,
          });
          if (!dialog.open || controller.signal.aborted) return;
          confirmation = result.confirmation;
          dialog.close();
        } catch (error) {
          if (!dialog.open || controller.signal.aborted) return;
          submit.disabled = false;
          set('reauth-state', error.message);
          form.elements.password.focus();
        }
      };
      dialog.showModal();
    });
  }
  /** Renvoie le résultat ou null ; question demande confirmation et request_id empêche une répétition côté serveur. */
  async function command(action, data = {}, question, feedback) {
    const notify = (text, error) => {
      message(text, error);
      feedback?.(text);
    };
    if (workshopState.busy) {
      notify(tr('Une opération est déjà en cours.'), true);
      return null;
    }
    const target = workshopState.selectedPrinter,
      projectKey = ['pause', 'resume', 'cancel'].includes(action)
        ? workshopState.snapshot?.printer?.command_project
        : null;
    if (['pause', 'resume', 'cancel'].includes(action)) data = { ...data, project_key: projectKey };
    if (!target) {
      notify(tr('Attendez la découverte des imprimantes avant une commande.'), true);
      return null;
    }
    if (question && !(await confirmAction(question))) return null;
    if (target !== workshopState.selectedPrinter) {
      notify(tr('La cible a changé : commande annulée.'), true);
      return null;
    }
    setBusy(true);
    try {
      if (sensitiveActions.has(action)) {
        const confirmation = await confirmPassword(action, target);
        if (!confirmation) return null;
        data = { ...data, confirmation };
      }
      notify(tr('Demande en cours…'));
      const d = await request('/command', {
        printerKey: target,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...data, request_id: crypto.randomUUID() }),
      });
      notify(d.message);
      await refresh();
      return d;
    } catch (e) {
      notify(e.message, true);
      return null;
    } finally {
      setBusy(false);
    }
  }

  return { command };
}
