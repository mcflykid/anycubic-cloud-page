import { $ } from './workshop-ui.mjs?v=d730a15b9b57';

/** État commun à la page et à ses commandes. Les sélections et caches propres aux panneaux restent dans leurs modules. */
export const workshopState = {
  snapshot: null,
  selectedPrinter: '',
  currentTab: 'summary',
  busy: false,
};

/** Un changement de langue recharge la page, donc le sélecteur attend la fin de l’action en cours. */
export function setBusy(value) {
  workshopState.busy = value;
  $('interface-language').disabled = value;
}
