import { $, confirmAction, message, set, tr } from './workshop-ui.mjs?v=00bb8ecf6593';
import { workshopState, setBusy } from './workshop-state.mjs?v=5f58442116d3';

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
    if (action === 'idle-settings') data = { ...data, confirmed: !!question };
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

/** Présente les divergences de bobines avant confirmation ; les données manquantes restent explicites. */
export async function filamentAdvice(request, data, printerKey = workshopState.selectedPrinter) {
  const result = await request('/preflight', {
    method: 'POST', printerKey,
    headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data),
  });
  const labels = {
    'metadata-missing': 'Métadonnées de filament incomplètes : vérifiez les bobines et les emplacements.',
    'material-mismatch': 'Le matériau du fichier diffère de celui des bobines sélectionnées.',
    'color-mismatch': 'La couleur du fichier diffère de celle des bobines sélectionnées.',
    'mixed-temperatures': 'La sélection mélange des filaments de groupes de température différents.',
  };
  return (result.warnings || []).filter(code => Object.hasOwn(labels, code)).map(code => tr(labels[code])).join('\n');
}

/** Lit seulement l’en-tête de commentaires G-code ; aucune commande du fichier n’est exécutée. */
export async function filamentMetadata(file) {
  const header = await file.slice(0, 65536).text();
  const field = key => header.match(new RegExp(`^;\\s*${key}\\s*=\\s*([^\\r\\n]*)`, 'mi'))?.[1]
    ?.split(';').slice(0, 16).map(value => value.trim()) || [];
  const rawColors = field('filament_(?:colour|color)');
  return {
    materials: field('filament_type').filter(value => value.length <= 48),
    colors: rawColors.every(value => /^#[0-9a-f]{6}$/i.test(value))
      ? rawColors.map(value => [1, 3, 5].map(offset => parseInt(value.slice(offset, offset + 2), 16))) : [],
  };
}
