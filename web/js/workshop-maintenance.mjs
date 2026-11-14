import { workshopState } from './workshop-state.mjs';
import { bindMaintenanceGuide, guideForOperation } from './workshop-maintenance-guide.mjs';
import { $, confirmAction, date, fmt, formatText, locale, node, set, timeZone, tr } from './workshop-ui.mjs';

/** Une intervention se lit au jour près ; l’heure exacte reste dans l’historique. */
const day = seconds => new Date(seconds * 1000).toLocaleDateString(locale, {timeZone});

/** Suffixe de chaque unité d’échéance, aligné sur les unités du registre serveur. */
const units = {hours:' h', days:' j', kg:' kg'};
const amount = (value, unit) => fmt(unit === 'days' ? Math.floor(value) : value, units[unit] || ' h');

/** Arrondit au dixième, comme le compteur affiché, pour qu’une saisie par défaut reste valide. */
const tenth = hours => Math.floor(hours * 10) / 10;

/** Lie le registre local à sa fenêtre sans envoyer de commande à l’imprimante. */
export function bindMaintenance(request) {
  const dialog = $('maintenance-dialog'), form = $('maintenance-form'), done = $('maintenance-done');
  let edited, target, pendingDone, current, busy = false, showHistory = false;
  const openGuide = bindMaintenanceGuide();

  /** Un seul panneau d’édition est visible pour que la saisie reste liée à son opération. */
  function panel(open) {
    form.hidden = open !== form;
    done.hidden = open !== done;
    open?.scrollIntoView({block:'nearest'});
    open?.querySelector('input, textarea')?.focus();
  }

  /** État lisible d’une opération : le seuil « bientôt » à 80 % suit la maquette validée. */
  function state(item) {
    if (!item.enabled) return ['Désactivé', 'unknown'];
    if (item.elapsed == null) return ['Échéance inconnue', 'unknown'];
    if (item.elapsed >= item.interval) return ['À faire', 'due'];
    return item.elapsed >= item.interval * .8 ? ['Bientôt', 'due'] : ['À jour', 'ok'];
  }

  /** Préserve les heures observées et affiche les échéances inconnues après une remise à zéro. */
  function render({items, hours, kg}) {
    current = hours;
    set('maintenance-hours', hours == null ? tr('Compteur d’heures indisponible.')
      : formatText('Compteur actuel : {0}', fmt(hours, ' h')));
    const due = items.filter(item => state(item)[1] === 'due' && item.elapsed >= item.interval).length;
    const summary = $('maintenance-summary');
    summary.hidden = !due;
    summary.dataset.state = 'paused';
    summary.textContent = due === 1 ? tr('1 opération à faire') : formatText('{0} opérations à faire', due);
    $('maintenance-history-toggle').hidden = !items.some(item => item.history.length);
    $('maintenance-list').replaceChildren(...items.map(item => {
      const row = node('li');
      const [label, tone] = state(item);
      const identity = node('div', null, 'maintenance-identity');
      const last = item.history.at(-1);
      identity.append(node('strong', tr(item.name)), node('span', !last ? tr('Dernière fois : non renseignée')
        : item.unit === 'hours' && last.hours != null
          ? formatText('Dernière fois : {0} à {1}', day(last.time), fmt(last.hours, ' h'))
          : formatText('Dernière fois : {0}', day(last.time)), 'muted'));
      const guide = guideForOperation(item.id);
      if (guide) {
        const read = node('button', tr('Voir la fiche'), 'maintenance-guide-link');
        read.type = 'button';
        read.setAttribute('aria-label', formatText('Fiche du carnet : {0}', tr(guide.title)));
        read.onclick = () => openGuide(guide.id, formatText('{0} · {1}', tr(item.name), amount(item.interval, item.unit)));
        // Sur la ligne de la dernière intervention, pour ne pas allonger la liste.
        identity.lastChild.append(' · ', read);
      }
      const gauge = node('div', null, 'maintenance-gauge');
      if (item.enabled && Number.isFinite(item.elapsed)) {
        const ratio = Math.min(1, item.elapsed / item.interval);
        const values = node('span');
        values.append(node('span', formatText('{0} sur {1}', amount(item.elapsed, item.unit), amount(item.interval, item.unit))),
          node('strong', fmt(Math.round(ratio * 100), ' %')));
        const progress = node('progress');
        progress.max = item.interval;
        progress.value = Math.min(item.elapsed, item.interval);
        progress.dataset.state = tone;
        progress.setAttribute('aria-label', tr(item.name));
        gauge.append(values, progress);
      } else if (item.enabled) {
        gauge.append(
          node('strong', formatText('Intervalle : {0}', amount(item.interval, item.unit))),
          node('span', item.unit === 'days'
            ? tr('Marquez l’opération comme faite pour démarrer le calendrier.')
            : tr('Indiquez le compteur de la dernière intervention.'), 'muted'),
        );
      }
      const badge = node('span', tr(label), 'atelier-count');
      badge.dataset.state = tone;
      const finish = node('button', tr('Fait'), 'atelier-control');
      finish.type = 'button';
      // Une opération calendaire se date sans compteur ; les autres attendent le leur.
      finish.disabled = item.unit === 'hours' ? hours == null : item.unit === 'kg' ? kg == null : false;
      if (tone === 'due' && item.elapsed >= item.interval) finish.classList.add('atelier-control-primary');
      finish.setAttribute('aria-label', formatText('Marquer « {0} » comme fait', tr(item.name)));
      finish.onclick = () => {
        pendingDone = item;
        const input = $('maintenance-last-hours');
        // Seules les heures d’impression peuvent être antidatées : le serveur borne ce compteur.
        input.closest('label').hidden = item.unit !== 'hours';
        input.required = item.unit === 'hours';
        input.max = hours == null ? '' : tenth(hours);
        input.value = hours == null ? '' : tenth(hours);
        $('maintenance-note').value = '';
        set('maintenance-done-text', formatText('« {0} » sera noté comme fait aujourd’hui.', tr(item.name)));
        panel(done);
      };
      const menu = node('details', null, 'maintenance-menu');
      const summaryButton = node('summary', '⋯', 'atelier-control');
      summaryButton.setAttribute('aria-label', formatText('Autres actions pour « {0} »', tr(item.name)));
      const edit = node('button', tr('Modifier')), remove = node('button', tr('Supprimer'), 'danger');
      edit.type = remove.type = 'button';
      edit.onclick = () => {
        menu.open = false;
        edited = item.id;
        form.elements.name.value = item.name;
        form.elements.interval.value = item.interval;
        form.elements.unit.value = item.unit;
        set('maintenance-form-title', tr('Modifier l’opération'));
        form.elements.enabled.checked = item.enabled;
        panel(form);
      };
      remove.onclick = async () => {
        menu.open = false;
        if (await confirmAction(formatText('Supprimer l’opération « {0} » ?', tr(item.name)), tr('Supprimer')))
          await load({action:'delete', id:item.id});
      };
      const actions = node('div');
      actions.append(edit, remove);
      menu.append(summaryButton, actions);
      row.append(identity, gauge, badge, finish, menu);
      if (showHistory && item.history.length) {
        const list = node('ul', null, 'maintenance-history');
        list.append(...[...item.history].reverse().map(event => node('li',
          [date(event.time), fmt(event.hours, ' h'), event.note].filter(Boolean).join(' · '))));
        row.append(list);
      }
      return row;
    }));
  }

  /** Sérialise les modifications de la fenêtre et garde les données en cas d’échec. */
  async function load(data, printerKey = target) {
    if (busy || printerKey !== workshopState.selectedPrinter) return false;
    busy = true;
    set('maintenance-state', '');
    try {
      const result = await request('/maintenance', {
        printerKey,
        ...(data ? {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)} : {}),
      });
      if (printerKey !== workshopState.selectedPrinter || !dialog.open) return false;
      render(result);
      return true;
    } catch (error) {
      set('maintenance-state', error.message);
      return false;
    } finally {
      busy = false;
    }
  }

  $('maintenance-open').onclick = () => {
    target = workshopState.selectedPrinter;
    edited = pendingDone = undefined;
    showHistory = false;
    $('maintenance-history-toggle').setAttribute('aria-pressed', 'false');
    form.reset();
    panel(null);
    dialog.showModal();
    void load();
  };
  $('maintenance-guide-open').onclick = () => openGuide();
  $('maintenance-add').onclick = () => {
    edited = undefined;
    form.reset();
    set('maintenance-form-title', tr('Nouvelle opération'));
    panel(form);
  };
  $('maintenance-history-toggle').onclick = event => {
    showHistory = !showHistory;
    event.currentTarget.setAttribute('aria-pressed', String(showHistory));
    void load();
  };
  for (const button of dialog.querySelectorAll('[data-maintenance-cancel]')) button.onclick = () => panel(null);
  done.onsubmit = async event => {
    event.preventDefault();
    const last = $('maintenance-last-hours');
    if (!pendingDone || !last.reportValidity()) return;
    // Le compteur proposé est arrondi : renvoyer null garde la valeur exacte du serveur.
    const declared = pendingDone.unit !== 'hours' || current == null || last.valueAsNumber === tenth(current)
      ? null : last.valueAsNumber;
    if (await load({action:'done', id:pendingDone.id, note:$('maintenance-note').value, last_hours:declared})) {
      pendingDone = undefined;
      panel(null);
    }
  };
  form.onsubmit = async event => {
    event.preventDefault();
    if (await load({action:'save', id:edited, name:form.elements.name.value,
      interval:Number(form.elements.interval.value), unit:form.elements.unit.value,
      enabled:form.elements.enabled.checked})) {
      edited = undefined;
      form.reset();
      panel(null);
    }
  };
}
