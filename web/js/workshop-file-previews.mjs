import { fmt, mins, node, tr } from './workshop-ui.mjs?v=6061611bf118';

/** Agrandit l’image déjà chargée sans une nouvelle requête à l’imprimante. */
function openFilePreview(file, src) {
  const dialog = node('dialog', null, 'file-preview-dialog'),
    title = node('h2', file.name),
    close = node('button', tr('Fermer'));
  close.type = 'button';
  close.onclick = () => dialog.close();
  dialog.onclose = () => dialog.remove();
  const header = node('div', null, 'dialog-top');
  header.append(title, close);
  dialog.append(header);
  if (src) {
    const img = node('img');
    img.src = src;
    img.alt = tr('Aperçu de ') + file.name;
    img.style.width = '100%';
    dialog.append(img);
  }
  const details = file.details || {};
  const metrics = node('dl', null, 'detail-list');
  for (const [label, value] of [
    ['Durée estimée', details.seconds ? mins(details.seconds / 60) : null],
    ['Matériau', details.material],
    ['Épaisseur de couche', details.layer_mm ? fmt(details.layer_mm, ' mm') : null],
    ['Dimensions', [details.x, details.y, details.z].every(Number.isFinite)
      ? [details.x, details.y, details.z].map((side) => fmt(side)).join(' × ') + ' mm'
      : null],
  ]) {
    if (value == null) continue;
    const metric = node('div');
    metric.append(node('dt', tr(label)), node('dd', value));
    metrics.append(metric);
  }
  if (metrics.childElementCount) dialog.append(metrics);
  document.body.append(dialog);
  dialog.showModal();
}
/** Isole le cache et limite la concurrence des miniatures sur le canal de l’imprimante. */
export function createFileThumbnails(request, isCurrent) {
  const cache = new Map(),
    queue = new Map(),
    jobs = new WeakMap();
  let loading = false;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const { target, isIntersecting } of entries) {
        if (!isIntersecting || !target.isConnected) continue;
        observer.unobserve(target);
        queue.set(target, jobs.get(target));
      }
      void load();
    },
    { rootMargin: '48px' },
  );

  /** Une seule miniature en cours évite de monopoliser le canal MQTT de la machine. */
  async function load() {
    if (loading) return;
    loading = true;
    try {
      while (queue.size) {
        const [host, job] = queue.entries().next().value;
        queue.delete(host);
        if (!host.isConnected || !isCurrent(job.context)) continue;
        let cached = cache.get(job.key);
        if (!cached || cached.expires <= Date.now()) {
          const { context, file } = job;
          let image = null;
          try {
            const result = await request('/preview', {
              method: 'POST',
              printerKey: context.printer,
              timeoutMs: 20000,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                source: context.source,
                handle: file.handle,
                name: file.name,
                path: context.path,
              }),
            });
            image = result.image || null;
          } catch {}
          cached = { image, expires: Date.now() + (image ? 300000 : 30000) };
          cache.delete(job.key);
          cache.set(job.key, cached);
          while (cache.size > 20) cache.delete(cache.keys().next().value);
        }
        if (host.isConnected && isCurrent(job.context)) show(host, job.file, cached.image);
      }
    } finally {
      loading = false;
    }
  }

  /** Le nom reste lisible si le fichier n’a pas d’image ou si son décodage échoue. */
  function show(host, file, src) {
    const unavailable = () => {
      host.removeAttribute('aria-busy');
      host.title = tr('Aperçu indisponible');
      host.textContent = '—';
      if (file.details && Object.keys(file.details).length) {
        const details = node('button', '⋯', 'file-thumbnail-open');
        details.type = 'button';
        details.setAttribute('aria-label', tr('Détails du fichier'));
        details.onclick = () => openFilePreview(file, null);
        host.replaceChildren(details);
      }
    };
    if (!src) {
      unavailable();
      return;
    }
    const image = node('img'),
      button = node('button', null, 'file-thumbnail-open');
    image.alt = '';
    button.type = 'button';
    button.setAttribute('aria-label', tr('Agrandir l’aperçu de ') + file.name);
    button.onclick = () => openFilePreview(file, src);
    button.append(image);
    image.onload = () => {
      host.removeAttribute('aria-busy');
      host.title = '';
      host.replaceChildren(button);
    };
    image.onerror = unavailable;
    image.src = src;
  }

  /** Prépare une vignette liée au dossier, à la source et à la cible de la ligne. */
  function create(file, context) {
    const host = node('span', null, 'file-thumbnail');
    host.setAttribute('aria-busy', 'true');
    const key = JSON.stringify([
      context.printer,
      context.source,
      context.path,
      file.handle,
      file.name,
      file.size_mb,
    ]);
    jobs.set(host, { file, context, key });
    host.title = tr('Chargement de l’aperçu');
    const cached = cache.get(key);
    if (cached && cached.expires > Date.now()) show(host, file, cached.image);
    else observer.observe(host);
    return host;
  }
  return {
    create,
    reset() {
      observer.disconnect();
      queue.clear();
    },
  };
}
