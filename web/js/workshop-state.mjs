import { $ } from './workshop-ui.mjs?v=a2ec47cbeacf';

/** État commun à la page et à ses commandes. Les sélections et caches propres aux panneaux restent dans leurs modules. */
export const workshopState = {
  snapshot: null,
  selectedPrinter: '',
  currentTab: 'overview',
  busy: false,
};

/** Un changement de langue recharge la page, donc le sélecteur attend la fin de l’action en cours. */
export function setBusy(value) {
  workshopState.busy = value;
  $('interface-language').disabled = value;
}
