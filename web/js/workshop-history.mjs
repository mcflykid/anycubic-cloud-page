import {
  $,
  confirmAction,
  date,
  fmt,
  formatText,
  locale,
  message,
  mins,
  node,
  serverText,
  set,
  timeZone,
  tr,
  valueUnit,
} from './workshop-ui.mjs?v=68fab6c5e108';
import { workshopState } from './workshop-state.mjs?v=5678652a821c';
import { slots } from './workshop-commands.mjs?v=fc9466503925';
import { definition } from './workshop-overview.mjs?v=7abf0e8ed928';

/** Relie l’historique des impressions et les notifications aux données du compte. */
export function createHistory(request, command, selectedBox) {
  let pastTaskKey = null,
    tasksPage = 1,
    taskRows = [];
  let historyPage = 1,
    historyPending = false,
    noticeRows = [],
    noticeFilter = 'all',
    noticeMore = false,
    noticeSignature = '',
    noticeUnread = 0;
  /** Charge une page de notifications du compte, en empêchant deux lectures simultanées. */
  async function loadHistory(force = false) {
    if (historyPending) return;
    historyPending = true;
    try {
      const d =
        !force && historyPage === 1 && workshopState.snapshot?.notifications
          ? workshopState.snapshot.notifications
          : await request(`/history?page=${historyPage}`);
      noticeRows =
        historyPage === 1
          ? d.items
          : [...new Map([...noticeRows, ...d.items].map((x) => [x.key, x])).values()];
      noticeMore = d.has_more;
      updateNoticeCount(d.unread);
      renderNotifications();
    } catch (e) {
      set('history-state', e.message);
    } finally {
      historyPending = false;
    }
  }
  /** Conserve le compteur reçu par le statut, sans ajouter un intervalle de requêtes. */
  function updateNoticeCount(count) {
    noticeUnread = Math.max(0, Number(count) || 0);
    const displayed = fmt(noticeUnread);
    const plural = noticeUnread > 1 ? 's' : '';
    $('notifications-dot').hidden = !noticeUnread;
    $('notifications-filter-dot').hidden = !noticeUnread;
    set('notifications-title', formatText('Messages ({0})', displayed));
    $('notifications-toggle').setAttribute(
      'aria-label',
      formatText('Notifications : {0} message{1} non lu{2}', displayed, plural, plural),
    );
    $('history-read-all').disabled = !noticeUnread;
  }
  /** Filtre les messages chargés ; les noms du cloud restent du texte et les aperçus sont différés. */
  function renderNotifications() {
    notificationPreviewObserver.disconnect();
    const query = $('notification-search').value.trim().toLocaleLowerCase(locale);
    const rows = noticeRows.filter(
      (x) =>
        (noticeFilter === 'all' || (noticeFilter === 'unread') === !!x.unread) &&
        x.name.toLocaleLowerCase(locale).includes(query),
    );
    const groups = new Map(),
      list = $('history-list');
    const expanded = new Set(
      [...list.querySelectorAll('details[open]')].map((item) => item.dataset.group),
    );
    list.replaceChildren();
    for (const item of rows) {
      const key = item.group || item.key;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    for (const [key, items] of groups) {
      if (items.length === 1) {
        list.append(notificationRow(items[0]));
        continue;
      }
      const wrapper = node('li'),
        details = node('details', null, 'notification-group'),
        events = node('ul');
      details.dataset.group = key;
      details.open = expanded.has(key);
      details.append(
        node(
          'summary',
          formatText(
            '{0} · {1} · {2} événements',
            items[0].name,
            serverText(items[0].reason || items[0].result, 'Notification d’impression'),
            fmt(items.length),
          ),
        ),
        events,
      );
      events.append(...items.map(notificationRow));
      wrapper.append(details);
      list.append(wrapper);
    }
    set('history-state', rows.length ? '' : tr('Aucun message'));
    $('history-state').className = rows.length ? '' : 'empty-message';
    $('history-state').hidden = !!rows.length;
    $('notifications-more').hidden = !noticeMore;
    $('history-delete-all').disabled = !noticeRows.length;
  }
  /** Chaque événement conserve sa miniature, son horodatage et ses actions individuelles. */
  function notificationRow(item) {
    const row = node('li', null, 'notification-row'),
      open = node('button', null, 'notification-open'),
      body = node('span', null, 'notification-copy');
    open.type = 'button';
    const thumb = taskThumbnail(
      { ...item, key: 'notification:' + item.key, notification: true },
      () => openNotice(item),
    );
    thumb.tabIndex = -1;
    row.append(thumb);
    body.append(
      node('strong', item.name, 'notification-name'),
      node('span', item.printer, 'muted'),
      node(
        'span',
        `${item.kind === 'success' ? '✓' : item.kind === 'interrupted' ? '■' : '◷'} ${tr(item.result)}`,
        'notification-result ' + item.kind,
      ),
    );
    if (item.reason || item.reason_code)
      body.append(
        node(
          'span',
          [
            item.reason && serverText(item.reason, 'Pas de diagnostic traduit pour cet événement.'),
            item.reason_code && tr('Code') + ' ' + item.reason_code,
          ]
            .filter(Boolean)
            .join(' · '),
          'muted',
        ),
      );
    body.append(node('time', date(item.time), 'muted'));
    open.append(body);
    if (item.unread) {
      const dot = node('span', null, 'unread-dot');
      dot.setAttribute('aria-label', tr('Non lu'));
      open.append(dot);
    }
    open.onclick = () => openNotice(item);
    row.append(open);
    const remove = node('button', '×', 'notification-delete');
    remove.type = 'button';
    remove.setAttribute('aria-label', tr('Supprimer la notification : ') + item.name);
    remove.title = tr('Supprimer cette notification');
    remove.onclick = () => deleteHistory(item.key, false, remove);
    row.append(remove);
    return row;
  }
  /** Le marquage est confirmé avant le détail ; aucune impression n’est déclenchée. */
  async function openNotice(item) {
    try {
      if (item.unread) {
        await request('/history/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: item.key }),
        });
        item.unread = false;
        updateNoticeCount(noticeUnread - 1);
        renderNotifications();
      }
      await openNotificationPreview(item);
    } catch (e) {
      message(e.message, true);
    }
  }
  /** Ferme le panneau et restitue le clavier à la cloche sur Échap. */
  function noticePanel(open, focus = false) {
    $('notifications-panel').hidden = !open;
    $('notifications-toggle').setAttribute('aria-expanded', String(open));
    if (open) {
      historyPage = 1;
      void loadHistory();
    } else if (focus) $('notifications-toggle').focus();
  }
  $('notifications-toggle').onclick = () => noticePanel($('notifications-panel').hidden);
  document.addEventListener('keydown', (event) => {
    if (
      event.key === 'Escape' &&
      !document.querySelector('dialog[open]') &&
      !$('notifications-panel').hidden
    ) {
      event.preventDefault();
      noticePanel(false, true);
    }
  });
  document.addEventListener('pointerdown', (event) => {
    if (
      !document.querySelector('dialog[open]') &&
      !$('notifications-panel').hidden &&
      !event.target.closest('.notifications')
    )
      noticePanel(false);
  });
  for (const button of document.querySelectorAll('[data-notice-filter]'))
    button.onclick = () => {
      noticeFilter = button.dataset.noticeFilter;
      document
        .querySelectorAll('[data-notice-filter]')
        .forEach((x) => x.setAttribute('aria-pressed', String(x === button)));
      renderNotifications();
    };
  $('notification-search').oninput = renderNotifications;
  $('notifications-more').onclick = () => {
    historyPage++;
    void loadHistory(true);
  };
  /** Marque une notification ou toutes comme lues ; allItems exige une confirmation puis rafraîchit le journal. */
  async function markHistoryRead(key, allItems, button) {
    button.disabled = true;
    try {
      const result = await request('/history/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(allItems ? { all: true } : { key }),
      });
      message(result.message);
      historyPage = 1;
      await loadHistory(true);
    } catch (e) {
      message(e.message, true);
      button.disabled = false;
    }
  }

  $('history-read-all').onclick = () => markHistoryRead(null, true, $('history-read-all'));
  $('history-delete-all').onclick = () => deleteHistory(null, true, $('history-delete-all'));
  /** La suppression vise uniquement les notifications ; elle ne remplace pas celle des fiches d’impression. */
  async function deleteHistory(key, allItems, button) {
    if (
      !(await confirmAction(
        allItems
          ? tr('Effacer définitivement les notifications d’impression du compte Anycubic ?')
          : tr('Effacer définitivement cette notification Anycubic ?'),
      ))
    )
      return;
    button.disabled = true;
    try {
      const result = await request('/history/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(allItems ? { all: true } : { key }),
      });
      message(result.message);
      historyPage = 1;
      await loadHistory(true);
    } catch (e) {
      message(e.message, true);
      button.disabled = false;
    } finally {
      if (button.id !== 'history-delete-all') button.disabled = false;
    }
  }

  const taskPreviewCache = new Map();
  /** Renvoie une promesse d’image mise en cache ; sépare les références de notifications de celles des tâches. */
  function taskPreview(t) {
    const cached = taskPreviewCache.get(t.key);
    if (cached && cached.expires > Date.now()) return cached.pending;
    const entry = { expires: Infinity };
    entry.pending = request(
      '/extras/' +
        (t.notification ? 'notification-preview' : 'task-preview') +
        '?key=' +
        encodeURIComponent(t.notification ? t.key.slice(13) : t.key),
    )
      .then((data) => data.image || null)
      .catch(() => null)
      .then((src) => {
        entry.expires = Date.now() + (src ? 300000 : 30000);
        return src;
      });
    taskPreviewCache.set(t.key, entry);
    while (taskPreviewCache.size > 40)
      taskPreviewCache.delete(taskPreviewCache.keys().next().value);
    return entry.pending;
  }
  /** Ouvre l’aperçu d’une notification et ignore la réponse si son dialogue a changé entre-temps. */
  async function openNotificationPreview(item) {
    const dialog = $('notification-preview-dialog'),
      image = $('notification-preview-image'),
      open = $('notification-task-open');
    const task = item.task_key && taskRows.find((row) => row.key === item.task_key);
    open.hidden = !task;
    open.onclick = task
      ? () => {
          dialog.close();
          void openPastTask(task);
        }
      : null;
    dialog.dataset.notification = item.key;
    set('notification-preview-name', item.name);
    set('notification-preview-state', tr('Chargement de l’aperçu…'));
    image.hidden = true;
    dialog.showModal();
    const src = await taskPreview({ ...item, key: 'notification:' + item.key, notification: true });
    if (!dialog.open || dialog.dataset.notification !== item.key) return;
    const unavailable = () =>
      set('notification-preview-state', tr('Aperçu indisponible pour cette notification.'));
    if (!src) {
      unavailable();
      return;
    }
    image.src = src;
    try {
      await image.decode();
    } catch {
      if (dialog.open && dialog.dataset.notification === item.key) unavailable();
      return;
    }
    if (dialog.open && dialog.dataset.notification === item.key) {
      image.hidden = false;
      set('notification-preview-state', tr(item.result));
    }
  }
  /** Chaque liste possède son observateur pour que le rafraîchissement de l’historique préserve les notifications. */
  function previewObserver() {
    return new IntersectionObserver(
      (entries, observer) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          entry.target.loadPreview();
        }
      },
      { rootMargin: '100px' },
    );
  }
  const taskPreviewObserver = previewObserver(),
    notificationPreviewObserver = previewObserver();
  /** Renvoie un bouton dont l’image est chargée près de la zone visible ; onOpen remplace l’ouverture des détails. */
  function taskThumbnail(t, onOpen = () => openPastTask(t)) {
    const button = node('button', null, 'task-thumbnail'),
      image = node('img'),
      fallback = node('span', tr('Aperçu indisponible'));
    button.type = 'button';
    button.title = tr('Voir les détails de ') + t.name;
    button.setAttribute('aria-label', button.title);
    button.onclick = onOpen;
    image.alt = tr('Aperçu de ') + t.name;
    image.hidden = true;
    fallback.textContent = tr('Chargement…');
    button.append(image, fallback);
    button.loadPreview = () =>
      taskPreview(t).then((src) => {
        /* La page de résultats peut avoir changé avant la fin du téléchargement. */ if (
          !button.isConnected
        )
          return;
        if (src) {
          image.onload = () => {
            image.hidden = false;
            fallback.hidden = true;
          };
          image.onerror = () => {
            image.hidden = true;
            fallback.hidden = false;
            fallback.textContent = tr('Aperçu indisponible');
          };
          image.src = src;
        } else fallback.textContent = tr('Aperçu indisponible');
      });
    (t.notification ? notificationPreviewObserver : taskPreviewObserver).observe(button);
    return button;
  }
  /** Renvoie un bouton non soumis à un formulaire, associé au rappel fn. */
  function extraButton(label, fn, cls) {
    const b = node('button', label, cls);
    b.type = 'button';
    b.onclick = fn;
    return b;
  }
  let taskStatus = 'all',
    taskMore = false;
  const taskSelected = new Set();
  /** Les bornes de date suivent le fuseau de l’atelier, y compris pour les dates cloud en secondes. */
  function taskDay(value) {
    if (value == null || value === '') return '';
    const n = Number(value),
      d = Number.isFinite(n) ? new Date(n * 1000) : new Date(value);
    return Number.isNaN(d.getTime())
      ? ''
      : new Intl.DateTimeFormat('sv-SE', {
          timeZone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(d);
  }
  $('tasks-to').value = taskDay(Date.now() / 1000);
  // Soustrait des jours calendaires à la date affichée, indépendamment des changements d’heure.
  const historyStart = new Date($('tasks-to').value);
  historyStart.setUTCDate(historyStart.getUTCDate() - 89);
  $('tasks-from').value = historyStart.toISOString().slice(0, 10);
  /** Les filtres combinés portent sur les pages déjà chargées ; une page suivante ne remplace pas la sélection. */
  function visibleTasks() {
    const query = $('tasks-search').value.trim().toLocaleLowerCase(locale),
      device = $('tasks-printer').value,
      from = $('tasks-from').value,
      to = $('tasks-to').value;
    return taskRows.filter((t) => {
      const day = taskDay(t.start);
      return (
        (taskStatus === 'all' || String(t.status_code) === taskStatus) &&
        (device === 'all' || t.printer_key === device) &&
        (!from || day >= from) &&
        (!to || day <= to) &&
        t.name.toLocaleLowerCase(locale).includes(query)
      );
    });
  }
  /** La case globale ne sélectionne que les cartes visibles, jamais des fiches non chargées. */
  function taskSelectionState() {
    const rows = visibleTasks(),
      n = taskSelected.size;
    set('tasks-selected-count', formatText('{0} sélection{1}', n, n > 1 ? 's' : ''));
    $('tasks-delete').disabled = !n;
    $('tasks-select-page').checked = !!rows.length && rows.every((t) => taskSelected.has(t.key));
    $('tasks-select-page').indeterminate =
      rows.some((t) => taskSelected.has(t.key)) && !$('tasks-select-page').checked;
  }
  /** Les cartes affichent les dates connues sans fabriquer une fin ni une durée manquante. */
  function renderTasks() {
    taskPreviewObserver.disconnect();
    const rows = visibleTasks();
    $('tasks-list').replaceChildren(
      ...rows.map((t) => {
        const li = node('li', null, 'task-history-item'),
          select = node('input'),
          label = node('label', null, 'history-card-select'),
          body = node('div', null, 'history-card-body'),
          name = node('strong', t.name, 'history-card-name'),
          state = node(
            'span',
            { 2: tr('Terminé'), 3: tr('Arrêté'), 1: tr('En cours'), 0: tr('En préparation') }[
              t.status_code
            ] || t.status,
            'history-badge status-' + t.status_code,
          ),
          open = extraButton(tr('Voir le détail'), () => openPastTask(t), 'history-detail');
        select.type = 'checkbox';
        select.checked = taskSelected.has(t.key);
        select.setAttribute('aria-label', tr('Sélectionner ') + t.name);
        select.onchange = () => {
          select.checked ? taskSelected.add(t.key) : taskSelected.delete(t.key);
          taskSelectionState();
        };
        label.append(select, node('span', tr('Sélectionner'), 'sr-only'));
        name.title = t.name;
        body.append(
          name,
          state,
          node('p', t.printer || tr('Imprimante'), 'muted'),
          node('p', tr('Début : ') + date(t.start), 'muted'),
          node('p', tr('Fin : ') + (t.end ? date(t.end) : tr('Non renseignée')), 'muted'),
          node(
            'p',
            tr('Durée : ') +
              (t.elapsed_minutes == null
                ? tr('Non renseignée')
                : Number(t.elapsed_minutes).toLocaleString(locale, { maximumFractionDigits: 1 }) +
                  ' min'),
            'muted',
          ),
          open,
        );
        li.append(label, taskThumbnail(t), body);
        return li;
      }),
    );
    set(
      'tasks-state',
      rows.length
        ? ''
        : taskMore
          ? tr(
              'Aucune fiche correspondante dans les pages chargées. Chargez la suite pour poursuivre la recherche.',
            )
          : tr("Aucun historique d'impression"),
    );
    $('tasks-state').hidden = !!rows.length;
    $('tasks-state').className = rows.length ? 'muted' : 'empty-message';
    set('tasks-page', formatText('{0} fiche(s) chargée(s)', taskRows.length));
    $('tasks-next').hidden = !taskMore;
    taskSelectionState();
  }
  /** Relit le cloud après mutation ; le cache d’affichage ne constitue pas une preuve de suppression. */
  async function loadTasks(append = false) {
    if (!append) {
      tasksPage = 1;
      taskRows = [];
    }
    set('tasks-state', tr('Chargement des impressions…'));
    $('tasks-state').hidden = false;
    try {
      const d = await request(`/extras/tasks?page=${tasksPage}&device=all`);
      taskRows = append
        ? [...new Map([...taskRows, ...d.items].map((t) => [t.key, t])).values()]
        : d.items;
      taskMore = d.has_more;
      const previous = $('tasks-printer').value,
        devices = new Map(taskRows.map((t) => [t.printer_key, t.printer]));
      $('tasks-printer').replaceChildren(
        new Option(tr('Tous les appareils'), 'all'),
        ...[...devices]
          .filter(([k]) => k)
          .map(([k, name]) => new Option(name || tr('Imprimante'), k)),
      );
      $('tasks-printer').value = devices.has(previous) ? previous : 'all';
      if (!append)
        for (const key of taskSelected)
          if (!taskRows.some((t) => t.key === key)) taskSelected.delete(key);
      renderTasks();
    } catch (e) {
      set('tasks-state', e.message);
      $('tasks-state').hidden = false;
    }
  }
  /** L’onglet d’historique est distinct du centre de messages de la cloche. */
  for (const button of document.querySelectorAll('[data-task-status]'))
    button.onclick = () => {
      taskStatus = button.dataset.taskStatus;
      for (const b of document.querySelectorAll('[data-task-status]'))
        b.setAttribute('aria-pressed', String(b === button));
      renderTasks();
    };
  for (const id of ['tasks-printer', 'tasks-from', 'tasks-to', 'tasks-search'])
    $(id).oninput = renderTasks;
  $('tasks-select-page').onchange = (e) => {
    for (const t of visibleTasks())
      e.target.checked ? taskSelected.add(t.key) : taskSelected.delete(t.key);
    taskSelectionState();
  };
  $('tasks-next').onclick = () => {
    tasksPage++;
    loadTasks(true);
  };
  $('tasks-delete').onclick = async () => {
    const keys = [...taskSelected],
      names = taskRows
        .filter((t) => taskSelected.has(t.key))
        .map((t) => '• ' + t.name)
        .join('\n');
    const result = await command(
      'task-delete-many',
      { keys },
      formatText(
        'Retirer {0} fiche(s) de l’historique ?\n{1}\nCes fiches seront aussi retirées de l’historique dans l’application Anycubic et le slicer.',
        keys.length,
        names,
      ),
    );
    if (result) {
      taskSelected.clear();
      await loadTasks();
    }
  };
  /** Affiche détails, diagnostic et aperçu d’une tâche, sans interpréter une donnée absente comme une valeur nulle. */
  async function openPastTask(t) {
    const dialog = $('past-task-dialog');
    pastTaskKey = t.key;
    set('past-task-name', t.name);
    set('past-task-state', tr('Chargement des détails…'));
    set('past-task-reason', '');
    $('past-task-preview').hidden = true;
    $('past-task-diagnostic').hidden = true;
    $('past-task-help').hidden = true;
    $('past-task-data').replaceChildren();
    $('past-task-parameters').replaceChildren();
    const selected = t.printer_key === workshopState.selectedPrinter;
    const rate = $('past-task-rate'),
      reprint = $('past-task-reprint');
    rate.hidden = !selected || t.status_code !== 2;
    rate.disabled = t.evaluated === true;
    reprint.hidden = !selected || !t.can_reprint;
    reprint.disabled =
      !workshopState.snapshot?.printer?.printer_online ||
      !workshopState.snapshot.printer.is_available;
    set(
      'past-task-actions-state',
      !selected
        ? tr('Sélectionnez l’imprimante de cette fiche pour agir.')
        : !t.can_reprint
          ? tr('G-code non disponible pour la réimpression.')
          : reprint.disabled
            ? tr('Imprimante hors ligne ou occupée.')
            : '',
    );
    rate.onclick = () => {
      dialog.close();
      void openRating(t);
    };
    reprint.onclick = () => {
      dialog.close();
      set('reprint-task-name', t.name);
      set('reprint-target', workshopState.snapshot?.printer?.name || t.printer);
      const form = $('task-reprint-form');
      form.reset();
      form.elements.slots.required = !!selectedBox();
      form.elements.slots.disabled = !selectedBox();
      $('task-reprint-dialog').showModal();
    };
    dialog.showModal();
    const current = () => dialog.open && pastTaskKey === t.key;
    taskPreview(t).then((src) => {
      if (src && current()) {
        $('past-task-preview').src = src;
        $('past-task-preview').hidden = false;
      }
    });
    try {
      const d = await request('/extras/task?key=' + encodeURIComponent(t.key));
      if (!current()) return;
      set('past-task-state', tr(t.status));
      $('past-task-diagnostic').hidden = !(d.reason || d.reason_code || d.help_url);
      set(
        'past-task-reason',
        [
          d.reason && serverText(d.reason, 'Pas de diagnostic traduit pour cet événement.'),
          d.reason_code && tr('Code') + ' ' + d.reason_code,
        ]
          .filter(Boolean)
          .join(' · '),
      );
      if (d.help_url) {
        $('past-task-help').href = d.help_url;
        $('past-task-help').hidden = false;
      }
      const dims = d.dimensions,
        params = d.parameters || {};
      definition('past-task-data', [
        [
          tr('Dimensions'),
          dims ? ['length', 'width', 'height'].map((k) => fmt(dims[k])).join(' × ') + ' mm' : '—',
        ],
        [tr('Couches'), fmt(d.layers)],
        [tr('Durée rapportée'), mins(d.reported_minutes)],
        [tr('Temps estimé'), d.estimated_seconds == null ? '—' : mins(d.estimated_seconds / 60)],
        [tr('Filament estimé'), fmt(d.material_grams, ' g')],
      ]);
      if (d.materials?.length) {
        const details = node('details'),
          list = node('ul');
        details.append(node('summary', tr('Filaments estimés par matière')), list);
        for (const { material, grams, color } of d.materials) {
          const row = node('li');
          if (color) {
            const swatch = node('span', null, 'material-color');
            swatch.style.backgroundColor = color;
            swatch.setAttribute('aria-hidden', 'true');
            row.append(swatch);
          }
          row.append(
            document.createTextNode(
              [material || tr('Matière non renseignée'), color, fmt(grams, ' g')]
                .filter(Boolean)
                .join(' · '),
            ),
          );
          list.append(row);
        }
        $('past-task-parameters').append(details);
      }
      const groups = [
        [
          tr('Général'),
          [
            [tr('Hauteur de couche'), 'layer_height', ' mm'],
            ['Remplissage', 'fill_density', ' %'],
            ['Supports', 'enable_support'],
            [tr('Adhérence'), 'brim_type'],
          ],
        ],
        [
          tr('Températures et ventilation'),
          [
            [tr('Buse'), 'temperature', ' °C'],
            [tr('Plateau'), 'bed_temperature', ' °C'],
            [tr('Ventilation maximale'), 'fan_max_speed', ' %'],
          ],
        ],
        [
          tr('Extrusion et parois'),
          [
            [tr('Rétraction'), 'filament_retract_length', ' mm'],
            [tr('Nombre de parois'), 'perimeters'],
            [tr('Largeur des parois'), 'perimeter_extrusion_width', ' mm'],
          ],
        ],
        [
          'Vitesses',
          [
            [tr('Paroi externe'), 'outer_wall_speed', ' mm/s'],
            [tr('Déplacement'), 'travel_speed', ' mm/s'],
          ],
        ],
      ];
      for (const [title, fields] of groups) {
        const available = fields.filter(([, key]) => params[key] != null);
        if (!available.length) continue;
        const details = node('details'),
          list = node('dl', null, 'task-data');
        details.append(node('summary', title), list);
        for (const [label, key, unit] of available) {
          const value = params[key];
          const row = node('div');
          row.append(
            node('dt', label),
            node(
              'dd',
              typeof value === 'boolean' ? (value ? tr('Oui') : tr('Non')) : valueUnit(value, unit),
            ),
          );
          list.append(row);
        }
        $('past-task-parameters').append(details);
      }
    } catch (e) {
      if (current()) set('past-task-state', e.message);
    }
  }
  /** Vérifie l’éligibilité cloud avant d’autoriser l’envoi d’une note sur la tâche sélectionnée. */
  async function openRating(t) {
    pastTaskKey = t.key;
    set('rating-task-name', t.name);
    set('rating-state', tr('Vérification auprès d’Anycubic…'));
    $('rating-form').reset();
    $('rating-form').querySelector('fieldset').disabled = true;
    $('task-rating-dialog').showModal();
    try {
      const d = await request('/extras/rating?key=' + encodeURIComponent(t.key));
      $('rating-form').querySelector('fieldset').disabled = !d.available || d.already_rated;
      set(
        'rating-state',
        d.already_rated
          ? tr('Cette impression est déjà évaluée')
          : d.available
            ? tr('La note sera envoyée au compte Anycubic')
            : tr('Anycubic ne propose pas d’évaluation pour cette impression'),
      );
    } catch (e) {
      set('rating-state', e.message);
    }
  }
  $('rating-form').onsubmit = async (e) => {
    e.preventDefault();
    const ok = await command(
      'task-rate',
      { key: pastTaskKey, stars: Number(new FormData(e.target).get('stars')) },
      tr('Envoyer cette note à Anycubic ?'),
    );
    if (ok) {
      $('task-rating-dialog').close();
      loadTasks();
    }
  };
  $('task-reprint-form').onsubmit = async (e) => {
    e.preventDefault();
    const form = e.currentTarget,
      submit = form.querySelector('[type=submit]');
    if (submit.disabled || workshopState.busy) return;
    let mapping;
    try {
      mapping = slots(form.elements.slots.value);
    } catch (err) {
      message(err.message, true);
      return;
    }
    const wording = mapping.length
      ? tr(
          'Réimprimer « {0} » sur {1} ? Vérifiez que le plateau est libre et que les bobines correspondent aux emplacements {2}.',
        )
      : tr(
          'Réimprimer « {0} » sur {1} ? Vérifiez que le plateau est libre et que les bobines correspondent au fichier.',
        );
    submit.disabled = true;
    try {
      const ok = await command(
        'task-reprint',
        { key: pastTaskKey, slots: mapping },
        formatText(
          wording,
          $('reprint-task-name').textContent,
          $('reprint-target').textContent,
          mapping.join(', '),
        ),
      );
      if (ok) $('task-reprint-dialog').close();
    } finally {
      submit.disabled = false;
    }
  };

  function syncNotifications(notifications) {
    updateNoticeCount(notifications.unread);
    const signature = JSON.stringify(notifications);
    if (signature !== noticeSignature) {
      noticeSignature = signature;
      if (historyPage === 1) noticeRows = notifications.items;
      else {
        const merged = new Map([...noticeRows, ...notifications.items].map((x) => [x.key, x]));
        noticeRows = [...merged.values()].sort((a, b) => b.time - a.time);
      }
      if (!$('notifications-panel').hidden) renderNotifications();
    }
  }

  return { loadTasks, renderTasks, syncNotifications };
}
