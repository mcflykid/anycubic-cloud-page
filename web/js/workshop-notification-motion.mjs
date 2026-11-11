// Découpe et ressort repris de Moxen Burbuja https://moxen.cl/recursos/burbuja/
const spring = "linear(0.0000, 0.0218, 0.0868, 0.1588, 0.2414, 0.3290, 0.4394, 0.5247, 0.6048, 0.6784, 0.7599, 0.8163, 0.8649, 0.9060, 0.9476, 0.9738, 0.9943, 1.0100, 1.0237, 1.0308, 1.0351, 1.0371, 1.0372, 1.0359, 1.0337, 1.0309, 1.0278, 1.0237, 1.0204, 1.0172, 1.0135, 1.0109, 1.0086, 1.0065, 1.0043, 1.0029, 1.0018, 1.0008, 0.9999, 0.9994, 0.9991, 0.9988, 0.9986, 0.9986, 0.9986, 0.9987, 0.9988, 0.9989, 1)";
const duration = 850;
const radius = element => parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
const crop = (rect, base, corner) => 'inset('
  + [rect.top - base.top, base.right - rect.right, base.bottom - rect.bottom, rect.left - base.left]
    .map(value => value.toFixed(1) + 'px').join(' ') + ' round ' + corner + 'px)';

/** Le panneau naît de la cloche et peut repartir de sa forme courante si le geste s’inverse. */
export function createNotificationMotion(panel, bell) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const easing = CSS.supports('animation-timing-function', 'linear(0, 1)') ? spring : 'ease-out';
  let active = null;
  reduced.addEventListener('change', () => {
    if (reduced.matches) active?.finish();
  });
  return (open, immediate = false) => {
    const previous = active ? getComputedStyle(panel).clipPath : null;
    active?.cancel();
    active = null;
    panel.inert = !open;
    if (open) panel.hidden = false;
    if (immediate || reduced.matches || panel.hidden) {
      panel.hidden = !open;
      return;
    }

    const fromBell = crop(bell.getBoundingClientRect(), panel.getBoundingClientRect(), radius(bell));
    const full = 'inset(0px 0px 0px 0px round ' + radius(panel) + 'px)';
    const animation = panel.animate([
      {clipPath: previous || (open ? fromBell : full)},
      {clipPath: open ? full : fromBell},
    ], {id: 'notification-bubble', duration: open ? duration : duration * .8, easing, fill: 'both'});
    active = animation;
    animation.onfinish = () => {
      if (active !== animation) return;
      if (!open) panel.hidden = true;
      active = null;
      animation.cancel();
    };
  };
}
