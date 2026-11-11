import { $, bytes, date, fmt, node, set, tr } from './workshop-ui.mjs?v=fdeafc76b674';

/** Prépare la consultation des timelapses lorsque le panneau est activé. */
export function createTimelapses(request) {
  let timelapsePage = 1,
    timelapseKeyword = '',
    timelapseGeneration = 0;
  /** L’imprimante sélectionnée est la seule interrogée et la dernière recherche prévaut. */
  async function loadTimelapse(page = 1) {
    if (document.querySelector('.timelapse-panel').hidden) return;
    const generation = ++timelapseGeneration;
    const previous = $('timelapse-previous'),
      next = $('timelapse-next');
    previous.disabled = true;
    next.disabled = true;
    $('timelapse-list').replaceChildren();
    set('timelapse-state', tr('Lecture des vidéos…'));
    try {
      const d = await request(
        '/extras/videos?' + new URLSearchParams({ page, keyword: timelapseKeyword }),
      );
      if (generation !== timelapseGeneration) return;
      timelapsePage = page;
      set('timelapse-state', d.message || (!d.items?.length ? tr('Aucune vidéo signalée') : ''));
      previous.disabled = !d.available || page <= 1;
      next.disabled = !d.available || !d.has_more;
      $('timelapse-list').replaceChildren(
        ...(d.items || []).map((v) => {
          const item = node('article', null, 'task-history-item');
          item.append(
            node('h4', v.name),
            node('p', `${date(v.created)} · ${bytes(v.size)} · ${fmt(v.duration, ' s')}`, 'muted'),
          );
          return item;
        }),
      );
    } catch (e) {
      if (generation === timelapseGeneration) set('timelapse-state', e.message);
    }
  }
  $('timelapse-load').onclick = () => void loadTimelapse();
  $('timelapse-previous').onclick = () => void loadTimelapse(timelapsePage - 1);
  $('timelapse-next').onclick = () => void loadTimelapse(timelapsePage + 1);
  $('timelapse-search').onsubmit = (e) => {
    e.preventDefault();
    timelapseKeyword = e.target.elements.keyword.value.trim();
    void loadTimelapse();
  };

  return { loadTimelapse };
}
