import { formatText, serverText, tr } from './workshop-ui.mjs?v=fdeafc76b674';
export const api = '/imprimante-api';

/** Applique la cible propre au navigateur et réserve les reprises automatiques aux lectures. */
export function createRequest(getPrinter) {
  /** Exécute une requête liée à la cible active et applique les reprises réservées aux lectures. */
  return async function request(path, options = {}) {
    const { timeoutMs, ...fetchOptions } = options;
    const target = options.printerKey ?? getPrinter();
    const read = !options.method || options.method === 'GET';
    let response;
    for (let attempt = 0; attempt < (read ? 2 : 1); attempt++) {
      try {
        response = await fetch(api + path, {
          cache: 'no-store',
          signal: AbortSignal.timeout(timeoutMs ?? (path.startsWith('/files/') ? 45000 : 90000)),
          ...fetchOptions,
          headers: {
            ...options.headers,
            ...(target && path !== '/printers' ? { 'X-Printer-Key': target } : {}),
          },
        });
      } catch {
        if (read && attempt === 0) continue;
        throw new Error(
          path === '/upload'
            ? tr(
                'Résultat de l’envoi incertain. Vérifiez les fichiers du cloud et l’état de l’imprimante avant tout nouvel essai.',
              )
            : read
              ? tr('Connexion au serveur interrompue. Nouvelle tentative automatique.')
              : tr(
                  'Connexion interrompue. Vérifiez l’état de la machine avant de renvoyer cette commande.',
                ),
        );
      }
      if (read && [502, 503, 504].includes(response.status) && !response.headers.has('Retry-After') && attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        continue;
      }
      break;
    }
    if (response.status === 401) {
      window.location.assign('/login');
      throw new Error(tr('Session expirée. Reconnectez-vous avant toute nouvelle action.'));
    }
    const diagnosticId = response.headers.get('X-Request-ID');
    /** Ajoute la référence de requête seulement lorsqu’elle respecte le format expurgé attendu. */
    const diagnosticText = text => /^[a-f0-9]{32}$/.test(diagnosticId || '')
      ? `${text} ${formatText('Référence de diagnostic : {0}', diagnosticId)}` : text;
    const raw = await response.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(
        read
          ? formatText(
              'Le service redémarre ou ne répond pas (HTTP {0}). Nouvelle tentative automatique.',
              response.status,
            )
          : formatText(
              'Le service n’a pas confirmé la commande (HTTP {0}). Vérifiez l’état de la machine avant un nouvel essai.',
              response.status,
            ),
      );
    }
    if (!response.ok || (data.ok === false && path != '/status')) {
      const fallback = read
        ? 'Échec de la lecture auprès d’Anycubic.'
        : 'Le service a refusé la demande ou n’a pas confirmé son résultat. Vérifiez l’état avant de réessayer.';
      const error = new Error(
        diagnosticText(data.message
          ? serverText(data.message, fallback)
          : formatText('Erreur {0}', response.status)),
      );
      error.cameraReason = data.camera_error;
      error.cameraPresenceExpired = path === '/camera-presence' && response.status === 400;
      error.diagnosticId = /^[a-f0-9]{32}$/.test(diagnosticId || '') ? diagnosticId : null;
      throw error;
    }
    if (data.message)
      data.message = serverText(
        data.message,
        data.ok === false
          ? 'Échec de la lecture auprès d’Anycubic.'
          : read
            ? 'Le cloud ne fournit pas de détail traduit.'
            : 'La commande a été traitée. Vérifiez l’état de l’imprimante.',
      );
    return data;
  };
}
