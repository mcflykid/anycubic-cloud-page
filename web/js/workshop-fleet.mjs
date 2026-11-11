import { $, node, tr, formatText, date } from './workshop-ui.mjs';

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
        const summary = node('div', null, 'fleet-summary');
        const name = node('h4', row.name);
        name.title = row.name;
        const hasAge = Number.isFinite(row.age_seconds);
        const ageLabel = hasAge ? formatText('Dernière mesure il y a {0} s.', row.age_seconds)
          : tr('Aucune mesure fraîche disponible.');
        const age = node('span', null, 'fleet-age');
        age.title = ageLabel;
        age.append(node('span', ageLabel, 'fleet-age-full'));
        const short = node('span', hasAge ? `${row.age_seconds} s` : '—', 'fleet-age-short');
        short.setAttribute('aria-hidden', 'true');
        age.append(short);
        const state = node('span', tr(labels[row.state] || labels.unknown), 'atelier-status');
        state.dataset.state = row.state === 'online' ? 'normal' : row.state === 'offline' ? 'offline' : 'unknown';
        summary.append(name, state, age);
        card.append(summary);
        if (row.job_in_progress === true) card.append(node('p', tr('Impression en cours')));
        if (row.alerts?.length) {
          const alert = node('p', tr('Problème de connexion observé depuis au moins trois minutes.'));
          alert.className = 'fleet-alert';
          card.append(alert);
        }
        return card;
      });
      $('fleet-cards').replaceChildren(...cards);
      $('fleet-state').textContent = cards.length ? '' : tr('Aucune imprimante disponible.');
      $('fleet-events-empty').hidden = !!data.events?.length;
      $('fleet-events-empty').textContent = tr('Aucun événement de connexion.');
      const names = new Map((data.items || []).map((row) => [row.key, row.name]));
      $('fleet-events').replaceChildren(...(data.events || []).slice(-8).reverse().map((event) =>
        node('li', `${names.get(event.key) || tr('Imprimante')} · ${tr(event.transition === 'recovered' ? 'Connexion rétablie' : event.transition === 'changed' ? 'État de connexion modifié' : 'Alerte de connexion')} · ${date(event.time)}`)));
    } catch {
      $('fleet-cards').replaceChildren();
      $('fleet-events').replaceChildren();
      $('fleet-state').textContent = tr('Le résumé du parc est temporairement indisponible.');
      $('fleet-events-empty').hidden = false;
      $('fleet-events-empty').textContent = tr('Les événements de connexion sont indisponibles.');
    } finally {
      pending = false;
    }
  };
}
