import { $, confirmAction, date, fmt, formatText, node, set, tr } from './workshop-ui.mjs';

/** Lie le registre local à sa fenêtre sans envoyer de commande à l’imprimante. */
export function bindMaintenance(request) {
  const dialog = $('maintenance-dialog'), form = $('maintenance-form');
  let edited, busy = false;

  /** Préserve les heures observées et affiche les échéances inconnues après une remise à zéro. */
  function render({items, hours}) {
    set('maintenance-hours', hours == null ? tr('Compteur d’heures indisponible.')
      : formatText('Compteur actuel : {0}', fmt(hours, ' h')));
    $('maintenance-list').replaceChildren(...items.map(item => {
      const row = node('li');
      const state = !item.enabled ? tr('Désactivé') : item.elapsed == null ? tr('Échéance inconnue')
        : item.elapsed >= item.interval ? tr('À faire')
        : item.elapsed >= item.interval * .8 ? tr('Bientôt') : tr('À jour');
      row.append(node('strong', item.name), node('p', [state,
        item.elapsed == null ? null : formatText('{0} sur {1}', fmt(item.elapsed, ' h'), fmt(item.interval, ' h')),
      ].filter(Boolean).join(' · ')));
      if (item.enabled && Number.isFinite(item.elapsed)) {
        const progress = node('progress');
        progress.max = item.interval;
        progress.value = Math.min(item.elapsed, item.interval);
        progress.setAttribute('aria-label', item.name);
        row.append(progress);
      }
      const done = node('button', tr('Fait')), edit = node('button', tr('Modifier')), remove = node('button', tr('Supprimer'));
      done.type = edit.type = remove.type = 'button';
      done.disabled = hours == null;
      done.onclick = async () => {
        if (await confirmAction(formatText('Enregistrer l’intervention pour « {0} » ?', item.name)))
          if (await load({action:'done', id:item.id, note:$('maintenance-note').value})) $('maintenance-note').value = '';
      };
      edit.onclick = () => {
        edited = item.id;
        form.elements.name.value = item.name;
        form.elements.interval.value = item.interval;
        form.elements.enabled.checked = item.enabled;
        form.elements.name.focus();
      };
      remove.onclick = async () => {
        if (await confirmAction(formatText('Supprimer l’opération « {0} » ?', item.name), tr('Supprimer')))
          await load({action:'delete', id:item.id});
      };
      row.append(done, edit, remove);
      if (item.history.length) {
        const history = node('details'), list = node('ul');
        history.append(node('summary', tr('Historique des interventions')), list);
        list.append(...[...item.history].reverse().map(event => node('li',
          [date(event.time), fmt(event.hours, ' h'), event.note].filter(Boolean).join(' · '))));
        row.append(history);
      }
      return row;
    }));
  }

  /** Sérialise les modifications de la fenêtre et garde les données en cas d’échec. */
  async function load(data) {
    if (busy) return false;
    busy = true;
    set('maintenance-state', '');
    try {
      render(await request('/maintenance', data ? {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data),
      } : undefined));
      return true;
    } catch (error) {
      set('maintenance-state', error.message);
      return false;
    } finally {
      busy = false;
    }
  }

  $('maintenance-open').onclick = () => {
    edited = undefined;
    form.reset();
    $('maintenance-note').value = '';
    dialog.showModal();
    void load();
  };
  form.onsubmit = async event => {
    event.preventDefault();
    if (await load({action:'save', id:edited, name:form.elements.name.value,
      interval:Number(form.elements.interval.value), enabled:form.elements.enabled.checked})) {
      edited = undefined;
      form.reset();
    }
  };
}
