/** Relie les effets du formulaire au geste du pointeur et à la requête en cours. */
export function createUploadMotion(zone) {
  const outline = zone.querySelector('.upload-progress-outline rect');
  const light = zone.querySelector('.upload-drop-light');
  const form = zone.closest('form');
  const input = zone.querySelector('input[type=file]');
  const canHover = matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)');

  // Contour repris de Moxen Remesa https://moxen.cl/recursos/remesa/
  new ResizeObserver(() => {
    const width = zone.clientWidth, height = zone.clientHeight;
    if (!width || !height) return;
    outline.setAttribute('width', String(width - 2));
    outline.setAttribute('height', String(height - 2));
    const perimeter = 2 * (width + height);
    outline.setAttribute('pathLength', String(2 * Math.max(8, Math.round(perimeter / 17))));
  }).observe(zone);

  // Inclinaison et suivi lumineux repris de Moxen Arrastre https://moxen.cl/recursos/arrastre/
  const near = {value: 0, speed: 0, target: 0, stiffness: 90, damping: 2 * .95 * Math.sqrt(90)};
  const axes = [
    {value: 0, speed: 0, target: 0, stiffness: 140, damping: 2 * .62 * Math.sqrt(140)},
    {value: 0, speed: 0, target: 0, stiffness: 140, damping: 2 * .62 * Math.sqrt(140)},
  ];
  const springs = [near, ...axes];
  let frame = 0, previous = 0;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

  function tick(now) {
    frame = 0;
    const elapsed = previous ? Math.min((now - previous) / 1000, 1 / 30) : 1 / 60;
    previous = now;
    const count = Math.max(1, Math.ceil(elapsed / (1 / 240))), step = elapsed / count;
    for (let index = 0; index < count; index += 1) {
      for (const spring of springs) {
        spring.speed += (spring.stiffness * (spring.target - spring.value) - spring.damping * spring.speed) * step;
        spring.value += spring.speed * step;
      }
    }
    zone.style.transform = `perspective(900px) rotateX(${axes[0].value.toFixed(3)}deg) rotateY(${axes[1].value.toFixed(3)}deg)`;
    light.style.opacity = (near.value * .95).toFixed(3);
    if (springs.some(({target, value, speed}) => Math.abs(target - value) >= .001 || Math.abs(speed) >= .01)) {
      frame = requestAnimationFrame(tick);
    } else {
      previous = 0;
    }
  }

  function wake() {
    if (!frame) frame = requestAnimationFrame(tick);
  }

  form.addEventListener('pointermove', event => {
    if (!canHover.matches || document.hidden || event.pointerType === 'touch' || zone.hasAttribute('aria-busy')) return;
    const width = zone.offsetWidth, height = zone.offsetHeight;
    if (!width || !height) return;
    let left = 0, top = 0;
    for (let element = zone; element; element = element.offsetParent) {
      left += element.offsetLeft;
      top += element.offsetTop;
    }
    const x = event.pageX - left, y = event.pageY - top;
    const dx = Math.max(-x, 0, x - width), dy = Math.max(-y, 0, y - height);
    const proximity = clamp(Math.hypot(dx, dy) / 260, 0, 1);
    near.target = 1 - proximity * proximity * (3 - 2 * proximity);
    const occupied = input.files.length > 0 ? .3 : 1;
    axes[0].target = -clamp((y - height / 2) / (height / 2), -1.3, 1.3) * 4.5 * near.target * occupied;
    axes[1].target = clamp((x - width / 2) / (width / 2), -1.3, 1.3) * 6 * near.target * occupied;
    light.style.translate = `${clamp(x, -120, width + 120)}px ${clamp(y, -120, height + 120)}px`;
    wake();
  }, {passive: true});

  form.addEventListener('pointerleave', () => {
    if (!canHover.matches || document.hidden) return;
    springs.forEach(spring => { spring.target = 0; });
    wake();
  });

  function reset() {
    cancelAnimationFrame(frame);
    frame = 0;
    previous = 0;
    springs.forEach(spring => { spring.target = spring.value = spring.speed = 0; });
    zone.style.removeProperty('transform');
    light.style.removeProperty('opacity');
  }

  function syncVisibility() {
    zone.toggleAttribute('data-upload-motion-paused', document.hidden);
    if (document.hidden) reset();
  }

  canHover.addEventListener('change', reset);
  document.addEventListener('visibilitychange', syncVisibility);
  syncVisibility();

  return busy => {
    if (busy) {
      zone.setAttribute('aria-busy', 'true');
      reset();
    } else {
      zone.removeAttribute('aria-busy');
    }
  };
}
