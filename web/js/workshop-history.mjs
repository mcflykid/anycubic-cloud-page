import { createNotificationMotion } from './workshop-notification-motion.mjs';
import {
  $,
  beginListLoading,
  confirmAction,
  date,
  fmt,
  formatText,
  locale,
  message,
  mins,
  node,
  printTimeline,
  serverText,
  set,
  signalChange,
  timeZone,
  tr,
} from './workshop-ui.mjs';
import { workshopState } from './workshop-state.mjs';
import { slots, filamentAdvice } from './workshop-commands.mjs';
import { closePrintConfirmation, confirmPrint } from './workshop-print-confirmation.mjs';
import { renderTaskDetails as renderTaskBands } from './workshop-task-details.mjs';
import { errorSheet, isDeviceErrorCode, openErrorSheet, safeErrorSource } from './workshop-error-catalogue.mjs';

/** Relie l’historique des impressions et les notifications aux données du compte. */
export function createHistory(request, command, selectedBox) {
  let gallery = false;
  try { gallery = localStorage.getItem('cloud-page-history-view') === 'gallery'; } catch {}
  let reprintPending = false;
  let pastTaskKey = null,
    tasksPage = 1,
    tasksGeneration = 0,
    taskRows = [];
  let historyPage = 1,
    historyPending = false,
    noticeRows = [],
    noticeFilter = 'all',
    noticeMore = false,
    noticeSignature = '',
    noticeUnread = 0,
    cloudUnread = 0,
    noticeError = '',
    noticeSource = 'slicer',
    legacySelected = false,
    noticeGeneration = 0;
  /** Charge une page de notifications du compte, en empêchant deux lectures simultanées. */
  async function loadHistory(force = false, page = 1) {
    if (historyPending) return;
    historyPending = true;
    const generation = noticeGeneration;
    const source = legacySelected ? 'legacy' : 'slicer';
    const snapshot = workshopState.snapshot;
    try {
      const d =
        !force && source === 'slicer' && snapshot?.notifications?.source === source &&
          !snapshot.notifications_error
          ? snapshot.notifications
          : await request(`/history?page=${page}&source=${source}`);
      if (generation !== noticeGeneration) return;
      if ((d.source || 'legacy') !== source) throw new Error(tr('Messages temporairement indisponibles'));
      applyNotifications(d, page);
    } catch (e) {
      if (generation !== noticeGeneration) return;
      noticeError = e.message || tr('Messages temporairement indisponibles');
      renderNotifications();
    } finally {
      if (generation === noticeGeneration) historyPending = false;
    }
  }
  /** Actualise le panneau sans mélanger les pages issues de journaux différents. */
  function applyNotifications(d, page = 1) {
    const source = d.source || 'legacy';
    noticeRows =
      page === 1 || noticeSource !== source
        ? d.items
        : [...new Map([...noticeRows, ...d.items].map((item) => [item.key, item])).values()];
    historyPage = page;
    noticeSource = source;
    noticeMore = d.has_more;
    noticeError = '';
    updateNoticeCount(d.unread);
    renderNotifications();
  }
  /** Conserve le compteur reçu par le statut, sans ajouter un intervalle de requêtes. */
  function updateNoticeCount(count) {
    noticeUnread = count == null
      ? noticeRows.filter((item) => item.unread).length
      : Math.max(0, Number(count) || 0);
    const displayed = fmt(noticeUnread);
    const plural = noticeUnread > 1 ? 's' : '';
    const badge = $('notifications-dot');
    if (!legacySelected) {
      badge.hidden = !noticeUnread;
      if (noticeUnread > cloudUnread) signalChange(badge);
      cloudUnread = noticeUnread;
      $('notifications-toggle').setAttribute(
        'aria-label',
        formatText('Notifications : {0} message{1} non lu{2}', displayed, plural, plural),
      );
    }
    $('notifications-filter-dot').hidden = !noticeUnread;
    set('notifications-title', formatText('Messages ({0})', displayed));
    $('history-read-all').disabled = !noticeUnread;
  }
  /** Filtre les messages chargés ; les noms du cloud restent du texte et les aperçus sont différés. */
  function renderNotifications() {
    notificationPreviewObserver.disconnect();
    const query = $('notification-search').value.trim().toLocaleLowerCase(locale);
    const type = $('historical-notifications-kind'), printer = $('historical-notifications-printer');
    if (legacySelected) {
      const current = printer.value;
      const names = [...new Set(noticeRows.map(item => item.printer).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right, locale));
      if (current && !names.includes(current)) names.push(current);
      printer.replaceChildren(new Option(tr('Toutes les imprimantes'), ''),
        ...names.map(name => new Option(name, name)));
      printer.value = current;
    }
    const rows = noticeRows.filter(item =>
      (noticeFilter === 'all' || (noticeFilter === 'unread') === !!item.unread) &&
      item.name.toLocaleLowerCase(locale).includes(query) &&
      (!legacySelected || ((!type.value || item.kind === type.value) &&
        (!printer.value || item.printer === printer.value))),
    );
    const groups = new Map(), list = $('history-list');
    const expanded = new Set([...list.querySelectorAll('details[open]')].map(item => item.dataset.group));
    list.replaceChildren();
    for (const item of rows) {
      const key = item.group || item.key;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    const today = taskDay(Date.now() / 1000);
    const yesterday = new Date(today + 'T12:00:00Z');
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    let lastDay;
    for (const [key, items] of groups) {
      const day = items[0].time && taskDay(items[0].time);
      if (legacySelected && day && day !== lastDay) {
        const label = day === today ? tr('Aujourd’hui') : day === yesterday.toISOString().slice(0, 10)
          ? tr('Hier') : new Intl.DateTimeFormat(locale, {dateStyle: 'long', timeZone: 'UTC'})
            .format(new Date(day));
        list.append(node('li', label, 'journal-day historical-notifications-day'));
        lastDay = day;
      }
      if (items.length === 1) {
        list.append(notificationRow(items[0]));
        continue;
      }
      const wrapper = node('li'), details = node('details', null, 'notification-group'), events = node('ul');
      details.dataset.group = key;
      details.open = expanded.has(key);
      details.append(node('summary', formatText('{0} · {1} · {2} événements',
        items[0].name, serverText(items[0].reason || items[0].result, 'Notification d’impression'),
        fmt(items.length))), events);
      events.append(...items.map(notificationRow));
      wrapper.append(details);
      list.append(wrapper);
    }
    const state = noticeError || (rows.length ? '' : tr(
      noticeRows.length || query || noticeFilter !== 'all'
        ? 'Aucun message ne correspond aux filtres.'
        : 'Aucun message',
    ));
    set('history-state', state);
    $('history-state').className = state ? 'empty-message' : '';
    if (noticeError) $('history-state').dataset.visualState = 'error';
    else if (state) $('history-state').dataset.visualState = 'empty';
    else delete $('history-state').dataset.visualState;
    $('history-state').hidden = !state;
    $('notifications-more').hidden = !noticeMore;
    $('history-delete-all').disabled = !noticeRows.length;
  }
  /** Chaque événement conserve sa miniature, son horodatage et ses actions individuelles. */
  function notificationRow(item) {
    const row = node('li', null, 'notification-row'),
      open = node('button', null, 'notification-open'),
      body = node('span', null, 'notification-copy');
    let errorBlock = null;
    open.type = 'button';
    const thumb = taskThumbnail(
      { ...item, key: 'notification:' + item.key, notification: true },
      () => openNotice(item),
    );
    thumb.tabIndex = -1;
    row.append(thumb);
    const code = String(item.reason_code || '');
    const isError = isDeviceErrorCode(code);
    const sheet = errorSheet(code);
    /* Une erreur codée est expliquée par sa fiche et son aide contextuelle : éviter de répéter la même phrase. */
    const meta = node('span', null, 'muted notification-meta');
    if (item.printer) meta.append(node('span', item.printer));
    const timestamp = node('time', legacySelected && item.time
      ? new Date(typeof item.time === 'number' ? item.time * 1000 : item.time)
        .toLocaleTimeString(locale, {timeZone, hour: '2-digit', minute: '2-digit'})
      : date(item.time));
    const timestampValue =
      typeof item.time === 'number' && item.time > 1e9 && item.time < 1e11
        ? item.time * 1000
        : item.time;
    if (item.time) timestamp.dateTime = new Date(timestampValue).toISOString();
    meta.append(timestamp);
    body.append(
      node('strong', item.name, 'notification-name'),
      meta,
      node(
        'span',
        `${item.kind === 'success' ? '✓' : item.kind === 'interrupted' ? '■' : '◷'} ${tr(item.result)}`,
        'notification-result ' + item.kind,
      ),
    );
    if (item.reason && !isError)
      body.append(
        node('span', serverText(item.reason, 'Pas de diagnostic traduit pour cet événement.'), 'muted'),
      );
    if (isError) {
      const error = node('span', null, 'notification-error'),
        button = node('button', formatText('Code d’erreur : {0}', code), 'notification-error-link'),
        tooltip = node(
          'span',
          tr(sheet?.description || item.error_description || 'Ce code n’est pas encore documenté dans l’atelier.'),
          'notification-error-tooltip',
        );
      tooltip.id = 'notification-error-' + item.key;
      tooltip.setAttribute('role', 'tooltip');
      button.type = 'button';
      button.setAttribute('aria-haspopup', 'dialog');
      button.setAttribute('aria-describedby', tooltip.id);
      button.onclick = () => openErrorSheet(item);
      error.append(button, tooltip);
      errorBlock = error;
    }
    open.append(body);
    if (item.unread) {
      const dot = node('span', null, 'unread-dot');
      dot.setAttribute('aria-label', tr('Non lu'));
      open.append(dot);
    }
    open.onclick = () => openNotice(item);
    const content = node('div', null, 'notification-content');
    content.append(open);
    if (errorBlock) content.append(errorBlock);
    row.append(content);
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
          body: JSON.stringify({ key: item.key, source: noticeSource }),
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
  const animateNoticePanel = createNotificationMotion($('notifications-panel'), $('notifications-toggle'));
  /** Ferme le panneau et restitue le clavier à la cloche sur Échap. */
  function noticePanel(open, focus = false, immediate = false) {
    $('notifications-toggle').setAttribute('aria-expanded', String(open));
    animateNoticePanel(open, immediate);
    if (open) {
      historyPage = 1;
      void loadHistory();
    } else if (focus) $('notifications-toggle').focus();
  }
  $('notifications-toggle').onclick = () => noticePanel($('notifications-toggle').getAttribute('aria-expanded') !== 'true');
  document.addEventListener('keydown', (event) => {
    if (
      event.key === 'Escape' &&
      !document.querySelector('dialog[open]') &&
      $('notifications-toggle').getAttribute('aria-expanded') === 'true'
    ) {
      event.preventDefault();
      noticePanel(false, true);
    }
  });
  document.addEventListener('pointerdown', (event) => {
    if (
      !document.querySelector('dialog[open]') &&
      $('notifications-toggle').getAttribute('aria-expanded') === 'true' &&
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
  $('notifications-more').onclick = () => void loadHistory(true, historyPage + 1);
  const noticeDialog = $('historical-notifications-dialog');
  $('historical-notifications-kind').onchange = $('historical-notifications-printer').onchange = renderNotifications;
  const historyOpen = $('historical-notifications-open');
  const noticeContent = $('notifications-panel');
  const bellContainer = noticeContent.parentElement;
  /** Invalide les réponses de la source précédente avant de réutiliser la liste. */
  function selectNoticeSource(legacy) {
    noticeGeneration++;
    historyPending = false;
    legacySelected = legacy;
    noticeSource = legacy ? 'legacy' : 'slicer';
    noticeRows = [];
    noticeMore = false;
    noticeError = '';
    noticeSignature = '';
    historyPage = 1;
    noticeFilter = 'all';
    $('historical-notifications-kind').value = $('historical-notifications-printer').value = '';
    set('notifications-more', tr(legacy ? 'Afficher les entrées précédentes' : 'Charger les messages suivants'));
    $('notification-search').value = '';
    for (const button of document.querySelectorAll('[data-notice-filter]')) {
      button.setAttribute('aria-pressed', String(button.dataset.noticeFilter === 'all'));
    }
    updateNoticeCount(legacy ? 0 : cloudUnread);
    renderNotifications();
  }
  historyOpen.onclick = () => {
    noticePanel(false, false, true);
    selectNoticeSource(true);
    noticeDialog.append(noticeContent);
    noticeContent.hidden = false;
    noticeContent.inert = false;
    noticeDialog.showModal();
    void loadHistory(true);
  };
  noticeDialog.addEventListener('close', () => {
    noticeContent.hidden = true;
    bellContainer.append(noticeContent);
    selectNoticeSource(false);
    const latest = workshopState.snapshot?.notifications;
    if (latest?.source === 'slicer') syncNotifications(latest);
    historyOpen.focus({preventScroll: true});
  });
  /** Relit le journal après confirmation du marquage par le Cloud. */
  async function markHistoryRead(key, allItems, button) {
    button.disabled = true;
    try {
      const result = await request('/history/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: noticeSource, ...(allItems ? { all: true } : { key }) }),
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
        tr(allItems ? 'Supprimer tous les messages' : 'Supprimer cette notification'),
      ))
    )
      return;
    button.disabled = true;
    try {
      const result = await request('/history/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: noticeSource, ...(allItems ? { all: true } : { key }) }),
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
        entry.expires = Date.now() + (src ? 300000 : t.notification ? 5000 : 30000);
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
    $('notification-preview-state').dataset.visualState = 'loading';
    $('notification-preview-state').hidden = false;
    image.hidden = true;
    dialog.showModal();
    const src = await taskPreview({ ...item, key: 'notification:' + item.key, notification: true });
    if (!dialog.open || dialog.dataset.notification !== item.key) return;
    const unavailable = () => {
      set('notification-preview-state', tr('Aperçu indisponible pour cette notification.'));
      $('notification-preview-state').dataset.visualState = 'error';
    };
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
      $('notification-preview-state').dataset.visualState = 'ready';
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
    button.dataset.previewState = 'loading';
    button.setAttribute('aria-busy', 'true');
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
            button.dataset.previewState = 'ready';
            button.removeAttribute('aria-busy');
          };
          image.onerror = () => {
            image.hidden = true;
            fallback.hidden = false;
            fallback.textContent = tr('Aperçu indisponible');
            button.dataset.previewState = 'unavailable';
            button.removeAttribute('aria-busy');
          };
          image.src = src;
        } else {
          fallback.textContent = tr('Aperçu indisponible');
          button.dataset.previewState = 'unavailable';
          button.removeAttribute('aria-busy');
        }
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
  const initialEnd = taskDay(Date.now() / 1000);
  // Soustrait des jours calendaires à la date affichée, indépendamment des changements d’heure.
  const historyStart = new Date(initialEnd);
  historyStart.setUTCDate(historyStart.getUTCDate() - 89);
  const initialStart = historyStart.toISOString().slice(0, 10);
  let from = initialStart,
    to = initialEnd,
    calendarMonth,
    chooseEnd = false,
    activeRange = '90', draftRange = activeRange;
  const rangeDialog = $('history-period-dialog'),
    rangeButton = $('history-period-open'),
    dateFrom = $('tasks-from'),
    dateTo = $('tasks-to'),
    calendar = $('history-months');
  const dateLabel = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }),
    monthLabel = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    weekLabel = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
  const calendarDate = (date) => date.toISOString().slice(0, 10);
  const monthAt = (month, delta = 0) =>
    new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + delta, 1));
  /** Un clic fixe le début, le suivant termine la plage, même en ordre inverse. */
  function pickDay(day) {
    if (!chooseEnd || !dateFrom.value) {
      dateFrom.value = day;
      dateTo.value = '';
      chooseEnd = true;
    } else {
      [dateFrom.value, dateTo.value] = [dateFrom.value, day].sort();
      chooseEnd = false;
    }
    renderCalendar(day);
  }
  /** Les jours sont des boutons natifs et les champs date offrent un accès direct à toute date. */
  function renderCalendar(focusDay) {
    const months = [calendarMonth];
    calendar.replaceChildren(...months.map((month) => {
      const section = node('section', null, 'history-month'),
        grid = node('div', null, 'history-days');
      section.append(node('h3', monthLabel.format(month)), grid);
      for (let weekday = 0; weekday < 7; weekday++)
        grid.append(node('span', weekLabel.format(new Date(Date.UTC(2024, 0, weekday + 1)))));
      const offset = (month.getUTCDay() + 6) % 7;
      for (let empty = 0; empty < offset; empty++) grid.append(node('span'));
      const next = monthAt(month, 1);
      for (const date = new Date(month); date < next; date.setUTCDate(date.getUTCDate() + 1)) {
        const day = calendarDate(date),
          button = extraButton(String(date.getUTCDate()), () => pickDay(day));
        button.dataset.day = day;
        button.disabled = day > initialEnd;
        button.setAttribute('aria-label', dateLabel.format(date));
        button.setAttribute('aria-pressed', String(day === dateFrom.value || day === dateTo.value));
        button.classList.toggle('in-range', day >= dateFrom.value && day <= dateTo.value);
        grid.append(button);
      }
      return section;
    }));
    const start = dateFrom.value, end = dateTo.value;
    const invalid = !start || !end || start > end || end > initialEnd;
    $('history-period-apply').disabled = invalid;
    $('history-month-next').disabled = calendarDate(calendarMonth) >= initialEnd.slice(0, 7) + '-01';
    const count = taskRows.filter(task => {
      const day = taskDay(task.start);
      return day >= start && day <= end;
    }).length;
    set('history-range-summary', invalid ? tr('Choisissez une plage valide, sans date future.')
      : formatText('{0} tâches chargées · {1} au {2}', count, dateLabel.format(new Date(start)), dateLabel.format(new Date(end))));
    if (focusDay) calendar.querySelector(`[data-day="${focusDay}"]`)?.focus();
  }
  calendar.onkeydown = (event) => {
    const day = event.target.dataset.day;
    const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    if (!day || !offset) return;
    event.preventDefault();
    const date = new Date(day);
    date.setUTCDate(date.getUTCDate() + offset);
    const nextDay = calendarDate(date);
    if (nextDay > initialEnd) return;
    const nextButton = calendar.querySelector(`[data-day="${nextDay}"]`);
    if (nextButton?.getClientRects().length) {
      nextButton.focus();
    } else {
      calendarMonth = monthAt(date);
      renderCalendar(nextDay);
    }
  };
  /** Le bouton résume la plage appliquée, indépendamment des valeurs en cours de saisie. */
  function setRangeButton() {
    rangeButton.textContent = `${dateLabel.format(new Date(from))} – ${dateLabel.format(new Date(to))}`;
  }
  /** Ouvre les mois autour de la fin de période et réinitialise la sélection en cours. */
  function showRange(start, end) {
    dateFrom.value = start;
    dateTo.value = end;
    chooseEnd = false;
    calendarMonth = monthAt(new Date(end));
    renderCalendar();
  }
  /** Applique les bornes calendaires d’un raccourci au brouillon de période. */
  function chooseRange(value) {
    draftRange = value;
    $('history-custom-range').hidden = value !== 'custom';
    for (const button of $('history-range-presets').querySelectorAll('[data-range]'))
      button.setAttribute('aria-pressed', String(button.dataset.range === value));
    if (value === 'custom') return renderCalendar();
    const start = new Date(initialEnd);
    if (value === 'year') start.setUTCMonth(0, 1);
    else start.setUTCDate(start.getUTCDate() - Number(value) + 1);
    showRange(calendarDate(start), initialEnd);
  }
  setRangeButton();
  dateFrom.max = dateTo.max = initialEnd;
  for (const button of $('history-range-presets').querySelectorAll('[data-range]'))
    button.onclick = () => chooseRange(button.dataset.range);
  rangeButton.onclick = () => {
    showRange(from, to);
    chooseRange(activeRange);
    rangeDialog.showModal();
  };
  $('history-month-prev').onclick = () => {
    calendarMonth = monthAt(calendarMonth, -1);
    renderCalendar();
  };
  $('history-month-next').onclick = () => {
    calendarMonth = monthAt(calendarMonth, 1);
    renderCalendar();
  };
  dateFrom.oninput = dateTo.oninput = () => renderCalendar();
  $('history-period-reset').onclick = () => chooseRange('90');
  $('history-period-apply').onclick = () => {
    if ($('history-period-apply').disabled) return;
    activeRange = draftRange;
    from = dateFrom.value;
    to = dateTo.value;
    setRangeButton();
    rangeDialog.close();
    void loadTasks();
  };
  /** Les filtres combinés portent sur les pages déjà chargées ; une page suivante ne remplace pas la sélection. */
  function visibleTasks() {
    const query = $('tasks-search').value.trim().toLocaleLowerCase(locale),
      device = $('tasks-printer').value, tag = $('tasks-tag').value;
    return taskRows.filter((t) => {
      const day = taskDay(t.start);
      return (
        (taskStatus === 'all' || String(t.status_code) === taskStatus) &&
        (device === 'all' || t.printer_key === device) &&
        (!from || day >= from) &&
        (!to || day <= to) &&
        (!tag || t.local_note?.tags?.includes(tag)) &&
        [t.name, t.local_note?.text].some(value => value?.toLocaleLowerCase(locale).includes(query))
      );
    });
  }
  $('tasks-tag').onchange = () => renderTasks();

  /** Rafraîchit les étiquettes sans retirer un filtre choisi sur une page déjà chargée. */
  function updateTaskTags() {
    const field = $('tasks-tag'), selected = field.value;
    const tags = [...new Set(taskRows.flatMap(task => task.local_note?.tags || []))].sort();
    if (selected && !tags.includes(selected)) tags.push(selected);
    field.replaceChildren(new Option(tr('Toutes'), ''), ...tags.map(tag => new Option(tag, tag)));
    field.value = selected;
  }
  /** La case globale ne sélectionne que les cartes visibles, jamais des fiches non chargées. */
  function taskSelectionState() {
    const rows = visibleTasks(),
      n = taskSelected.size;
    set('tasks-selected-count', n ? formatText('{0} sélection{1}', n, n > 1 ? 's' : '') : tr('Aucune sélection'));
    $('tasks-delete').disabled = !n;
    $('tasks-select-page').disabled = !rows.length;
    $('tasks-select-page').checked = !!rows.length && rows.every((t) => taskSelected.has(t.key));
    $('tasks-select-page').indeterminate =
      rows.some((t) => taskSelected.has(t.key)) && !$('tasks-select-page').checked;
  }

  /** Conserve les filtres, la pagination et les clés de sélection lors du changement de présentation. */
  function chooseHistoryView(value) {
    gallery = value;
    try { localStorage.setItem('cloud-page-history-view', value ? 'gallery' : 'list'); } catch {}
    renderTasks();
  }
  $('history-list-view').onclick = () => chooseHistoryView(false);
  $('history-gallery-view').onclick = () => chooseHistoryView(true);
  $('tasks-gallery').onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const list = event.currentTarget;
    const buttons = [...list.querySelectorAll('.task-thumbnail')];
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    const columns = getComputedStyle(list).gridTemplateColumns.split(' ').length;
    const offset = {ArrowLeft:-1, ArrowRight:1, ArrowUp:-columns, ArrowDown:columns}[event.key];
    if (buttons[index + offset]) {
      event.preventDefault();
      buttons[index + offset].focus();
    }
  };

  /** Réutilise les aperçus différés et les actions de détail de la liste. */
  function renderTaskGallery(rows) {
    const list = $('tasks-gallery');
    list.replaceChildren(...rows.map(task => {
      const item = node('li', undefined, 'history-gallery-card');
      const preview = taskThumbnail(task);
      const check = node('input');
      check.type = 'checkbox';
      check.checked = taskSelected.has(task.key);
      check.setAttribute('aria-label', tr('Sélectionner ') + task.name);
      check.onchange = () => {
        check.checked ? taskSelected.add(task.key) : taskSelected.delete(task.key);
        taskSelectionState();
      };
      const title = node('strong', task.name, 'history-card-name');
      title.title = task.name;
      const state = node('span', tr(task.status), 'atelier-status history-status-' + task.status_code);
      const details = node('span', [task.start && date(task.start),
        Number.isFinite(task.elapsed_minutes) && mins(task.elapsed_minutes)].filter(Boolean).join(' · '));
      item.append(check, preview, title, state, details);
      const colors = (task.colors || []).filter(color => /^#[0-9a-f]{6}$/i.test(color));
      if (colors.length) {
        const palette = node('span', null, 'history-gallery-colors');
        for (const color of colors) {
          const swatch = node('span', null, 'material-color');
          swatch.style.backgroundColor = color;
          swatch.title = color;
          palette.append(swatch);
        }
        item.append(palette);
      }
      return item;
    }));
  }
  /** Indique une disponibilité réelle et conserve la confirmation existante de la réimpression. */
  function canReprint(task) {
    const printer = workshopState.snapshot?.printer;
    return task.can_reprint && ![0, 1].includes(task.status_code) &&
      task.printer_key === workshopState.selectedPrinter && printer?.printer_online && printer.is_available;
  }
  /** Charge les données de la fiche puis ouvre directement la confirmation commune. */
  async function prepareReprint(task, details, image, filaments) {
    if (reprintPending || workshopState.busy || !canReprint(task)) return;
    const target = workshopState.selectedPrinter, trigger = document.activeElement;
    reprintPending = true;
    try {
      if (!details) {
        const data = await request('/extras/task?key=' + encodeURIComponent(task.key), {printerKey:target});
        details = {seconds:data.estimated_seconds, grams:data.material_grams};
        filaments = reprintFilaments(data);
      }
      image ||= await taskPreview(task);
      if (!trigger?.isConnected || target !== workshopState.selectedPrinter || !canReprint(task)) return;
      const advice = slots => filamentAdvice(request, {key:task.key, slots}, target);
      const confirmation = await confirmPrint({
        target, name:task.name, details, image, filaments,
        readSlots: selectedBox() && !filaments.materials.length ? slots : undefined,
        question:tr('Vérifiez que le plateau est libre.'),
        checkAdvice:advice,
      });
      if (!confirmation) return;
      if (target !== workshopState.selectedPrinter || !canReprint(task)) {
        closePrintConfirmation();
        return;
      }
      const result = await command('task-reprint', {key:task.key, slots:confirmation.slots ?? []});
      if (result) {
        const detail = $('past-task-dialog');
        if (detail.open && pastTaskKey === task.key) detail.close();
      }
    } catch (error) {
      message(error.message, true);
    } finally {
      reprintPending = false;
    }
  }

  /** Préserve l’ordre des couleurs annoncé par la fiche de tranche. */
  function reprintFilaments(data) {
    return {
      materials: (data.materials || []).map(row => row.material),
      colors: (data.materials || []).map(row => row.color?.match(/[0-9a-f]{2}/gi)?.map(value => parseInt(value, 16))),
    };
  }

  /** Une ligne par impression, sans inventer une date ou une durée manquante. */
  function renderTasks() {
    taskPreviewObserver.disconnect();
    updateTaskTags();
    const rows = visibleTasks();
    $('history-list-view').setAttribute('aria-pressed', String(!gallery));
    $('history-gallery-view').setAttribute('aria-pressed', String(gallery));
    $('tasks-gallery').hidden = !gallery;
    $('tasks-list').closest('table').hidden = gallery;
    renderTaskGallery(gallery ? rows : []);
    $('tasks-list').replaceChildren(
      ...(gallery ? [] : rows).map((t) => {
        const row = node('tr'),
          selectCell = node('td', null, 'files-selection-cell'),
          select = node('input'),
          file = node('td', null, 'files-identity-cell'),
          identity = node('div', null, 'history-table-identity'),
          copy = node('div', null, 'file-row-caption'),
          name = node('strong', t.name, 'history-card-name'),
          status = node('td', null, 'history-table-status'),
          state = node('span',
            { 2: tr('Terminée'), 3: tr('Arrêtée'), 1: tr('En cours'), 0: tr('En préparation') }[t.status_code] || t.status,
            'atelier-status history-status-' + t.status_code,
          ),
          started = node('td', t.start ? date(t.start) : '—', 'history-table-start'),
          duration = node('td', t.elapsed_minutes == null ? '—' : fmt(t.elapsed_minutes, ' min'), 'files-size history-table-duration'),
          actionsCell = node('td', null, 'files-actions-cell'),
          actions = node('div', null, 'files-row-actions'),
          open = extraButton(tr('Détail'), () => openPastTask(t), 'atelier-control history-detail'),
          reprint = extraButton(tr('Réimprimer'), () => prepareReprint(t), 'atelier-control');
        if (t.status_code === 1 && Number.isFinite(t.progress)) state.append(' · ' + fmt(t.progress, ' %'));
        select.type = 'checkbox';
        select.checked = taskSelected.has(t.key);
        select.setAttribute('aria-label', tr('Sélectionner ') + t.name);
        select.onchange = () => {
          select.checked ? taskSelected.add(t.key) : taskSelected.delete(t.key);
          taskSelectionState();
        };
        name.title = t.name;
        reprint.disabled = !canReprint(t);
        open.setAttribute('aria-label', tr('Voir le détail'));
        selectCell.append(select);
        copy.append(name, node('span', t.printer || tr('Imprimante')));
        if (t.local_note?.text) copy.append(node('span', tr('Note locale')));
        if (t.local_note?.tags?.length) copy.append(node('span', t.local_note.tags.join(' · ')));
        identity.append(taskThumbnail(t), copy);
        file.append(identity);
        status.append(state);
        actions.append(open, reprint);
        actionsCell.append(actions);
        row.append(selectCell, file, status, started, duration, actionsCell);
        return row;
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
    if (rows.length) delete $('tasks-state').dataset.visualState;
    else $('tasks-state').dataset.visualState = 'empty';
    set('tasks-page', formatText(rows.length === 1 ? '{0} impression sur la période' : '{0} impressions sur la période', rows.length));
    $('tasks-next').hidden = !taskMore;
    taskSelectionState();
  }
  /** Relit le cloud après mutation ; le cache d’affichage ne constitue pas une preuve de suppression. */
  async function loadTasks(append = false) {
    const generation = ++tasksGeneration;
    if (!append) {
      tasksPage = 1;
      taskRows = [];
    }
    const stopLoading = beginListLoading($('tasks-list'), $('tasks-loading'), () => {
      set('tasks-state', tr('Chargement des impressions…'));
      $('tasks-state').dataset.visualState = 'loading';
      $('tasks-state').hidden = false;
    });
    try {
      const d = await request(`/extras/tasks?page=${tasksPage}&device=all`);
      if (generation !== tasksGeneration) return;
      taskRows = append
        ? [...new Map([...taskRows, ...d.items].map((t) => [t.key, t])).values()]
        : d.items;
      taskMore = d.has_more;
      const previous = $('tasks-printer').selectedOptions[0],
        devices = new Map(taskRows.map((t) => [t.printer_key, t.printer]));
      if (previous && previous.value !== 'all' && !devices.has(previous.value))
        devices.set(previous.value, previous.text);
      $('tasks-printer').replaceChildren(
        new Option(tr('Tous les appareils'), 'all'),
        ...[...devices]
          .filter(([k]) => k)
          .map(([k, name]) => new Option(name || tr('Imprimante'), k)),
      );
      $('tasks-printer').value = previous?.value || 'all';
      if (!append)
        for (const key of taskSelected)
          if (!taskRows.some((t) => t.key === key)) taskSelected.delete(key);
      renderTasks();
    } catch (e) {
      if (generation !== tasksGeneration) return;
      set('tasks-state', e.message);
      $('tasks-state').className = 'empty-message';
      $('tasks-state').dataset.visualState = 'error';
      $('tasks-state').hidden = false;
    } finally {
      stopLoading();
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
  for (const id of ['tasks-printer', 'tasks-search'])
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
  /** Ouvre la fenêtre commune et conserve les actions disponibles dans l’historique. */
  async function openPastTask(t) {
    $('correct-finish-settings').hidden = true;
    printTimeline('past-print-timeline');
    const dialog = $('past-task-dialog'), extra = $('past-task-extra');
    pastTaskKey = t.key;
    const notes = $('task-note-form');
    notes.hidden = false;
    notes.elements.text.value = t.local_note?.text || '';
    notes.elements.tags.value = t.local_note?.tags?.join(', ') || '';
    const updateNoteCount = () => set('task-note-count', formatText('{0} sur {1}', notes.elements.text.value.length, notes.elements.text.maxLength));
    notes.elements.text.oninput = updateNoteCount;
    updateNoteCount();
    const tags = [...new Set(taskRows.flatMap(task => task.local_note?.tags || []))].sort();
    $('task-note-suggestions').replaceChildren(...tags.map(tag => new Option(tag)));
    set('task-note-state', '');
    notes.onsubmit = async event => {
      event.preventDefault();
      const button = notes.querySelector('button[type=submit]');
      if (button.disabled || !dialog.open || pastTaskKey !== t.key) return;
      button.disabled = true;
      try {
        const {note} = await request('/task-note', {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({key: t.key, text: notes.elements.text.value,
            tags: notes.elements.tags.value.split(',').map(tag => tag.trim()).filter(Boolean)}),
        });
        for (const task of taskRows) if (task.key === t.key) task.local_note = note;
        t.local_note = note;
        renderTasks();
        if (dialog.open && pastTaskKey === t.key) set('task-note-state', tr('Note locale enregistrée.'));
      } catch (error) {
        if (dialog.open && pastTaskKey === t.key) set('task-note-state', error.message);
      } finally {
        button.disabled = false;
      }
    };
    extra.dataset.history = 'true';
    extra.hidden = true;
    set('past-task-name', t.name);
    $('past-task-state').querySelector('span').textContent = tr('Chargement des détails…');
    $('past-task-state').dataset.state = 'active';
    set('past-task-reason', '');
    const image = $('past-task-preview'), fallback = $('past-task-preview-state');
    image.hidden = true;
    image.removeAttribute('src');
    fallback.hidden = false;
    $('past-task-diagnostic').hidden = true;
    $('past-task-materials').hidden = true;
    $('past-task-material-list').replaceChildren();
    $('past-task-help').hidden = true;
    $('past-task-error').hidden = true;
    $('past-task-error').onclick = null;
    $('past-task-data').replaceChildren();
    $('task-detail-progress').replaceChildren();
    $('past-task-parameters').replaceChildren();
    const selected = t.printer_key === workshopState.selectedPrinter;
    const rate = $('past-task-rate'), reprint = $('past-task-reprint');
    rate.hidden = !selected || t.status_code !== 2;
    rate.disabled = false;
    reprint.hidden = !selected || !t.can_reprint;
    reprint.disabled = !canReprint(t);
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
    let printDetails, printFilaments;
    reprint.onclick = () => {
      void prepareReprint(t, printDetails, image.hidden ? undefined : image.currentSrc, printFilaments);
    };
    dialog.showModal();
    const current = () => dialog.open && pastTaskKey === t.key;
    taskPreview(t).then((src) => {
      if (!current()) return;
      if (!src) return;
      image.onload = () => { if (current()) { image.hidden = false; fallback.hidden = true; } };
      image.onerror = () => { if (current()) { image.hidden = true; fallback.hidden = false; } };
      image.src = src;
    });
    try {
      const d = await request('/extras/task?key=' + encodeURIComponent(t.key));
      if (!current()) return;
      printTimeline('past-print-timeline', d.timeline);
      printDetails = {seconds: d.estimated_seconds, grams: d.material_grams};
      printFilaments = reprintFilaments(d);
      $('past-task-state').querySelector('span').textContent = tr(t.status);
      $('past-task-state').dataset.state = t.status_code === 3 ? 'stopped' : 'active';
      const hasDiagnostic = !!(d.reason || d.reason_code || d.help_url);
      $('past-task-diagnostic').hidden = !hasDiagnostic;
      set(
        'past-task-reason',
        [
          d.reason && serverText(d.reason, 'Pas de diagnostic traduit pour cet événement.'),
          d.reason_code && tr('Code') + ' ' + d.reason_code,
        ].filter(Boolean).join(' · '),
      );
      const hasCode = isDeviceErrorCode(d.reason_code);
      const error = $('past-task-error');
      error.hidden = !hasCode;
      error.onclick = hasCode ? () => openErrorSheet({...d, printer:t.printer, name:d.name || t.name}) : null;
      const help = $('past-task-help');
      const source = safeErrorSource(d.help_url);
      help.hidden = !source || hasCode;
      if (!help.hidden) help.href = source;
      if (d.materials?.length) {
        const list = $('past-task-material-list');
        for (const {material, grams, color} of d.materials) {
          const row = node('li');
          if (color) {
            const swatch = node('span', null, 'material-color');
            swatch.style.backgroundColor = color;
            swatch.setAttribute('aria-hidden', 'true');
            row.append(swatch);
          }
          row.append(document.createTextNode([material || tr('Matière non renseignée'), color, fmt(grams, ' g')].filter(Boolean).join(' · ')));
          list.append(row);
        }
        $('past-task-materials').hidden = false;
      }
      const params = d.parameters || {};
      renderTaskBands({
        progress: t.progress,
        layers: d.layers,
        layerCountDisplay: d.layers == null ? null : t.status_code === 2 ? `${fmt(d.layers)} / ${fmt(d.layers)}` : fmt(d.layers),
        remainingSeconds: t.status_code === 2 ? 0 : null,
        dimensions: d.dimensions,
        estimatedSeconds: d.estimated_seconds,
        materialGrams: d.material_grams,
        parameters: params,
      });
      extra.hidden = !hasDiagnostic && !d.materials?.length && rate.hidden && reprint.hidden && !$('past-task-actions-state').textContent;
    } catch (e) {
      if (current()) $('past-task-state').querySelector('span').textContent = e.message;
    }
  }
  /** Vérifie l’éligibilité cloud avant d’autoriser l’envoi d’une note sur la tâche sélectionnée. */
  async function openRating(t) {
    const dialog = $('task-rating-dialog'), form = $('rating-form'), preview = $('rating-preview');
    const submit = form.querySelector('button[type=submit]');
    pastTaskKey = t.key;
    set('rating-task-name', t.name);
    set('rating-task-summary', [t.end ? date(t.end) : '', t.status ? tr(t.status) : ''].filter(Boolean).join(' · '));
    set('rating-state', tr('Vérification auprès d’Anycubic…'));
    set('rating-value', '');
    form.reset();
    submit.disabled = true;
    preview.hidden = true;
    preview.removeAttribute('src');
    form.querySelector('fieldset').disabled = true;
    dialog.showModal();
    void taskPreview(t).then(src => {
      if (!dialog.open || pastTaskKey !== t.key || !src) return;
      preview.onload = () => { preview.hidden = false; };
      preview.src = src;
    });
    try {
      const d = await request('/extras/rating?key=' + encodeURIComponent(t.key));
      if (!dialog.open || pastTaskKey !== t.key) return;
      form.querySelector('fieldset').disabled = !d.available || d.already_rated;
      if (d.already_rated && Number.isInteger(d.stars) && d.stars >= 1 && d.stars <= 5) {
        form.elements.stars.value = String(d.stars);
        set('rating-value', formatText('{0} sur 5', d.stars));
      }
      set(
        'rating-state',
        d.already_rated
          ? tr('Cette impression est déjà évaluée')
          : d.available
            ? tr('La note sera envoyée au compte Anycubic')
            : tr('Anycubic ne propose pas d’évaluation pour cette impression'),
      );
    } catch (e) {
      if (dialog.open && pastTaskKey === t.key) set('rating-state', e.message);
    }
  }
  $('rating-form').onchange = (event) => {
    const form = event.currentTarget, stars = Number(new FormData(form).get('stars'));
    form.querySelector('button[type=submit]').disabled = !stars;
    set('rating-value', stars ? formatText('{0} sur 5', stars) : '');
  };
  $('rating-form').onsubmit = async (e) => {
    e.preventDefault();
    const stars = Number(new FormData(e.target).get('stars'));
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) return;
    const ok = await command(
      'task-rate',
      { key: pastTaskKey, stars },
      tr('Envoyer cette note à Anycubic ?'),
    );
    if (ok) {
      $('task-rating-dialog').close();
      loadTasks();
    }
  };
  /** Réconcilie la première page du statut sans remplacer un journal choisi manuellement. */
  function syncNotifications(notifications) {
    if (legacySelected || historyPending || notifications.source !== 'slicer') return;
    const signature = JSON.stringify(notifications);
    if (signature === noticeSignature) return;
    noticeSignature = signature;
    if (historyPage === 1 || (notifications.source || 'legacy') !== noticeSource) {
      applyNotifications(notifications);
    } else {
      const merged = new Map([...noticeRows, ...notifications.items].map((item) => [item.key, item]));
      noticeRows = [...merged.values()].sort((a, b) => b.time - a.time);
      updateNoticeCount(notifications.unread);
      if (!$('notifications-panel').hidden) renderNotifications();
    }
  }

  return { loadTasks, renderTasks, syncNotifications };
}
