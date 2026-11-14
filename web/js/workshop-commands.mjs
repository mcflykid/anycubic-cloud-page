import { openErrorSheet } from './workshop-error-catalogue.mjs';
import { $, confirmAction, formatText, message, set, tr } from './workshop-ui.mjs';
import { workshopState, setBusy } from './workshop-state.mjs';
import { closePrintConfirmation, confirmPrint, followPrintStart, showPrintProgress, showPrintResult } from './workshop-print-confirmation.mjs';

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
  const confirmedStates = {pause:'paused', resume:'printing', cancel:'failed'};
  let pendingCommand = null;
  let pendingStoredPrint = null;

  /** Une réponse cloud ne suffit pas : seule la transition de la tâche ciblée retire son bandeau. */
  function observeCommand(snapshot) {
    const printer = snapshot.printer;
    if (pendingStoredPrint && snapshot.ok === true && printer?.printer_online === true &&
        pendingStoredPrint.target === workshopState.selectedPrinter &&
        printer.command_project && printer.command_project !== pendingStoredPrint.previousProject &&
        (printer.job_name === pendingStoredPrint.name || printer.stored_print_preparing) &&
        ['downloading', 'checking', 'preheating', 'leveling', 'printing'].includes(printer.job_state)) {
      if ($('message-text').firstChild === pendingStoredPrint.text) message('');
      pendingStoredPrint = null;
    }
    if (!pendingCommand || snapshot.ok !== true || printer?.printer_online !== true ||
        pendingCommand.target !== workshopState.selectedPrinter ||
        pendingCommand.projectKey !== printer.command_project ||
        pendingCommand.state !== printer.job_state) return;
    const banner = $('message-text');
    if (banner.firstChild === pendingCommand.text) message('');
    pendingCommand = null;
  }
  function diagnostic(snapshot = workshopState.snapshot) {
    if (!pendingCommand) return {état: 'Aucune transition en attente'};
    const printer = snapshot?.printer;
    return {
      état: 'Confirmation machine en attente',
      phase_attendue: pendingCommand.state,
      phase_observée: Object.values(confirmedStates).includes(printer?.job_state) ? printer.job_state : null,
      cloud_disponible: snapshot?.ok === true,
      machine_en_ligne: printer?.printer_online === true,
      même_machine: pendingCommand.target === workshopState.selectedPrinter,
      même_tâche: pendingCommand.projectKey === printer?.command_project,
      attente_s: Math.round((performance.now() - pendingCommand.since) / 1000),
      bandeau_visible: $('message-text').firstChild === pendingCommand.text && !$('message').hidden,
    };
  }
  /** Demande un jeton serveur lié à la cible et à l’action, sans joindre le mot de passe à la commande. */
  async function authorize(action, target, password, signal) {
    const result = await request('/reauth', {
      method: 'POST',
      printerKey: target,
      signal: AbortSignal.any([signal, AbortSignal.timeout(90000)]),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, password }),
    });
    return result.confirmation;
  }
  /** Présente l’avertissement avec le mot de passe et abandonne la confirmation si la fenêtre ferme. */
  function confirmPassword(action, target, question) {
    const dialog = $('reauth-dialog'),
      form = $('reauth-form'),
      submit = $('reauth-submit'),
      controller = new AbortController();
    let confirmation = null;
    form.reset();
    submit.disabled = false;
    $('reauth-question').hidden = !question;
    set('reauth-question', question || '');
    set('reauth-submit', tr('Installer la mise à jour'));
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
        const password = form.elements.password.value;
        form.reset();
        try {
          const token = await authorize(action, target, password, controller.signal);
          if (!dialog.open || controller.signal.aborted) return;
          confirmation = token;
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
  /** Renvoie le résultat ou null ; l’aperçu reste dans l’interface et ne fait pas partie de la commande. */
  async function command(action, data = {}, question, feedback, confirmSensitive, image) {
    const notify = (text, error, sheet) => {
      message(text, error);
      feedback?.(text, sheet);
    };
    if (workshopState.busy) {
      closePrintConfirmation();
      notify(tr('Une opération est déjà en cours.'), true);
      return null;
    }
    const target = workshopState.selectedPrinter,
      confirmedState = Object.hasOwn(confirmedStates, action) ? confirmedStates[action] : null,
      projectKey = confirmedState
        ? workshopState.snapshot?.printer?.command_project
        : null;
    if (confirmedState) data = { ...data, project_key: projectKey };
    if (!target) {
      notify(tr('Attendez la découverte des imprimantes avant une commande.'), true);
      return null;
    }
    const filePrint = ['print-cloud', 'print-local', 'print-usb'].includes(action);
    const printing = filePrint || action === 'task-reprint';
    const sensitive = sensitiveActions.has(action);
    const destructiveLabels = {
      cancel: tr('Arrêter l’impression'),
      'delete-cloud': tr('Supprimer'),
      'delete-local': tr('Supprimer'),
      'delete-usb': tr('Supprimer'),
      'cloud-delete-many': formatText('Supprimer {0} fichiers', data.handles?.length),
      'task-delete-many': tr('Retirer la sélection'),
    };
    if (filePrint) {
      const rows = data.details?.filaments;
      const filaments = rows?.length ? {
        materials: rows.map(row => row.material),
        colors: rows.map(row => row.color),
        slots: data.slots,
      } : undefined;
      const checkAdvice = filaments && (slots => filamentAdvice(request, {
        materials:filaments.materials, colors:filaments.colors.every(Boolean) ? filaments.colors : [],
        grams:rows.map(row => row.grams), slots,
      }, target));
      const confirmation = await confirmPrint({
        target, name:data.name, details:data.details, image, question, chooseSpools:true, requireSpools:action !== 'print-cloud' || data.archived === true, filaments, checkAdvice,
        initialSlots:data.slots,
        stored:action === 'print-local',
        queue: action === 'print-cloud' && !data.fromQueue && !data.archived ? async selected => {
          try {
            await request('/print-queue', {
              method:'POST', printerKey:target, headers:{'Content-Type':'application/json'},
              body:JSON.stringify({action:'add', handle:data.handle, slots:selected}),
            });
            notify(tr('Fichier ajouté à la file d’attente.'));
            return true;
          } catch (error) {
            notify(error.message, true);
            return false;
          }
        } : undefined,
      });
      if (!confirmation) return null;
      const {fromQueue, ...payload} = data;
      data = { ...payload, slots: confirmation.slots, preparation: confirmation.preparation };
    } else if (question && !sensitive &&
        !(await confirmAction(question, destructiveLabels[action]))) return null;
    if (action === 'idle-settings') data = { ...data, confirmed: !!question || data.confirmed === true };
    if (target !== workshopState.selectedPrinter) {
      if (printing) closePrintConfirmation();
      notify(tr('La cible a changé : commande annulée.'), true);
      return null;
    }
    setBusy(true);
    try {
      if (sensitive) {
        const confirmation = confirmSensitive
          ? await confirmSensitive((password, signal) => authorize(action, target, password, signal))
          : await confirmPassword(action, target, question);
        if (!confirmation) return null;
        if (target !== workshopState.selectedPrinter) {
          notify(tr('La cible a changé : commande annulée.'), true);
          return null;
        }
        data = { ...data, confirmation };
      }
      notify(tr('Demande en cours…'));
      const requestId = crypto.randomUUID();
      const stored = ['print-local', 'print-usb'].includes(action);
      const previousProject = stored ? workshopState.snapshot?.printer?.command_project : null;
      if (printing) showPrintProgress(tr('Demande en cours…'), requestId);
      const d = await request('/command', {
        printerKey: target,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...data, request_id: requestId }),
      });
      notify(d.message);
      if (confirmedState && projectKey) {
        pendingCommand = {target, projectKey, state:confirmedState, since:performance.now(), text:$('message-text').firstChild};
      }
      if (stored) {
        // Un projet nouveau avec le même fichier constitue une preuve de préparation, même sans accusé MQTT.
        pendingStoredPrint = {target, name:data.name, previousProject, text:$('message-text').firstChild};
      }
      if (printing) followPrintStart(d, stored ? {name:data.name, previousProject} : null);
      await refresh();
      return d;
    } catch (e) {
      notify(e.message, true, e.errorSheet);
      if (printing) showPrintResult(e.message, e.errorSheet);
      if (e.errorSheet) {
        const help = $('message-error-help');
        help.hidden = false;
        help.onclick = () => openErrorSheet(e.errorSheet);
      }
      return null;
    } finally {
      setBusy(false);
    }
  }

  return { command, observeCommand, diagnostic };
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
  const warnings = (result.warnings || []).filter(code => Object.hasOwn(labels, code)).map(code => tr(labels[code]));
  for (const {slot, grams, needed, relay} of result.shortfalls || []) {
    warnings.push(formatText('Emplacement {0} : environ {1} g restants pour {2} g estimés.', slot, grams, needed) +
      (relay.length ? ' ' + formatText('Relais compté : {0}.', relay.join(', ')) : ''));
  }
  return warnings.join('\n');
}

/** Lit les commentaires de tranche aux deux extrémités du G-code, sans lire le fichier complet. */
export async function filamentMetadata(file) {
  const header = await file.slice(0, 65536).text();
  const tail = file.size > 65536 ? await file.slice(Math.max(65536, file.size - 65536)).text() : '';
  const comments = header + '\n' + tail;
  const field = key => comments.match(new RegExp(`^;[ \\t]*${key}[ \\t]*=[ \\t]*([^\\r\\n]*)`, 'mi'))?.[1]
    ?.split(';').slice(0, 16).map(value => value.trim()) || [];
  const rawColors = field('filament_(?:colour|color)');
  // Les commentaires générés par le trancheur donnent la durée et les quantités dans des unités explicites.
  const duration = field('estimated printing time \\(normal mode\\)')[0]
    ?.match(/^(?:(\d+)d\s*)?(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)?$/);
  const numbers = values => {
    const parts = values.flatMap(value => value.split(',').map(part => part.trim()));
    if (!parts.length || !parts.every(value => /^\d+(?:\.\d+)?$/.test(value))) return undefined;
    return parts.map(Number);
  };
  const quantities = values => numbers(values)?.reduce((total, value) => total + value, 0);
  const perFilament = numbers(field('filament used \\[g\\]'));
  const materials = field('filament_type').map(value => value.length <= 48 ? value : '');
  const totalGrams = quantities(field('total filament used \\[g\\]')) ?? perFilament?.reduce((total, value) => total + value, 0);
  const millimetres = quantities(field('filament used \\[mm\\]'));
  return {
    materials,
    grams: perFilament ?? (materials.length === 1 && totalGrams != null ? [totalGrams] : undefined),
    colors: rawColors.every(value => /^#[0-9a-f]{6}$/i.test(value))
      ? rawColors.map(value => [1, 3, 5].map(offset => parseInt(value.slice(offset, offset + 2), 16))) : [],
    details: {
      seconds: duration?.slice(1).some(Boolean)
        ? duration.slice(1).reduce((total, value, index) => total + (Number(value) || 0) * [86400, 3600, 60, 1][index], 0)
        : undefined,
      grams: totalGrams,
      metres: millimetres == null ? undefined : millimetres / 1000,
    },
  };
}
