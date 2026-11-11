import { $, node, tr, formatText, date } from './workshop-ui.mjs?v=6e32f535c683';

/** La vue n’active aucune machine et ne permet aucune commande ni sélection implicite. */
export function createFleet(request) {
  let pending = false;
  const labels = {
    online: 'En ligne', offline: 'Hors ligne', stale: 'Données périmées',
    unavailable: 'Cloud indisponible', unmonitored: 'Pas encore suivie', unknown: 'État inconnu',
  };
  return async function loadFleet() {
    if (pending) return;
    pending = true;
    try {
      const data = await request('/fleet');
      const cards = (data.items || []).map((row) => {
        const card = node('article');
        card.className = 'fleet-card';
        card.append(node('h4', row.name), node('p', tr(labels[row.state] || labels.unknown)));
        card.append(node('p', Number.isFinite(row.age_seconds)
          ? formatText('Dernière mesure il y a {0} s.', row.age_seconds)
          : tr('Aucune mesure fraîche disponible.')));
        if (row.job_in_progress === true) card.append(node('p', tr('Impression en cours')));
        if (row.alerts?.length) {
          const alert = node('p', tr('Problème de connexion observé depuis au moins trois minutes.'));
          alert.className = 'fleet-alert';
          card.append(alert);
        }
        return card;
      });
      $('fleet-cards').replaceChildren(...cards);
      $('fleet-state').textContent = cards.length ? tr('Résumé des machines déjà suivies, sans collecte supplémentaire.') : tr('Aucune imprimante disponible.');
      const names = new Map((data.items || []).map((row) => [row.key, row.name]));
      $('fleet-events').replaceChildren(...(data.events || []).slice(-8).reverse().map((event) =>
        node('li', `${names.get(event.key) || tr('Imprimante')} · ${tr(event.transition === 'recovered' ? 'Connexion rétablie' : event.transition === 'changed' ? 'État de connexion modifié' : 'Alerte de connexion')} · ${date(event.time)}`)));
    } catch {
      $('fleet-cards').replaceChildren();
      $('fleet-events').replaceChildren();
      $('fleet-state').textContent = tr('Le résumé du parc est temporairement indisponible.');
    } finally {
      pending = false;
    }
  };
}
