/* =====================================================================
   Burbuja · Moxen
   Un modal que nace del botón que lo abre. Al pulsar «Invitar al equipo»
   el propio botón se transforma: su rectángulo crece con un resorte
   hasta ser el modal (el degradado se funde con el vidrio blanco, el
   radio pasa de 20 a 34 px y la etiqueta se va), la página de detrás se
   desenfoca y se oscurece. Dentro, un banner con burbujas que flotan,
   un campo donde cada correo que escribes (Intro, coma, espacio o al
   pegar) se vuelve un chip que salta con resorte, un selector de rol
   con una píldora elástica que se estira entre las dos opciones, un
   enlace con «Copiar» que cambia a ✓ y «Enviar». Al enviar llueve
   confeti y el modal se encoge hacia la esquina hasta ser un aviso
   («3 invitaciones enviadas») que, tras un momento, se despide.

     const b = Burbuja(document.querySelector('[data-burbuja]'), {
       onEnvia: ({ correos, rol }) => fetch(…),   // una promesa; si falla, { mensaje }
       avisoMs: 800,                              // ms que el aviso queda a la vista
     });
     b.abre();  b.cierra();  b.reinicia();

   Esc cierra, el foco queda atrapado dentro del modal y, al cerrar,
   vuelve al botón. Cómo se hace: .bu-modal se recorta con clip-path
   (inset … round) desde el rectángulo del botón hasta su tamaño, con la
   curva de un resorte (linear()); la sombra va en un filtro del
   contenedor para que siga al recorte, y la «piel» del botón (su
   degradado y su etiqueta) se funde por encima. Qué cambia qué:
   --bu-boton es el degradado del botón, el selector y el aviso;
   --bu-modal, el vidrio; --bu-radio, el radio del modal. Sin dependencias.
   ===================================================================== */
(function () {
  'use strict';

  /* ── resortes ─────────────────────────────────────────────────────── */
  const resorte = (x, k, c) => ({ x, v: 0, meta: x, k, c });
  function avanza(r, h) { r.v += (r.k * (r.meta - r.x) - r.c * r.v) * h; r.x += r.v * h; }

  // un resorte convertido en curva CSS linear(), para animar con WAAPI
  function muelle(k, c) {
    const pts = [0];
    let x = 0, v = 0, t = 0;
    while (t < 3) {
      v += (k * (1 - x) - c * v) / 240; x += v / 240; t += 1 / 240;
      pts.push(x);
      if (t > .15 && Math.abs(1 - x) < .001 && Math.abs(v) < .01) break;
    }
    const out = [];
    for (let i = 0; i <= 48; i++) out.push(pts[Math.round(i / 48 * (pts.length - 1))].toFixed(4));
    out[48] = '1';
    return { easing: 'linear(' + out.join(', ') + ')', duration: Math.round(t * 1000) };
  }

  // azar con semilla: el confeti sale siempre igual (la página y el vídeo coinciden)
  function mulberry32(s) {
    return () => {
      s = s + 0x6D2B79F5 | 0;
      let t = Math.imul(s ^ s >>> 15, 1 | s);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* El confeti: papelitos que giran en 3D (se achatan al voltearse), con
     gravedad, roce del aire y aleteo. Un canvas que solo corre si hay piezas. */
  function Confeti(lienzo, semilla, reduce) {
    const g = lienzo.getContext('2d'), azar = mulberry32(semilla), piezas = [];
    let W = 0, H = 0, dpr = 1, raf = 0, previo = 0, colores = ['#ff5fb3', '#5b4bff', '#fff', '#ffc85a', '#4d8cff', '#b583ff'];
    function mide() {
      W = lienzo.clientWidth; H = lienzo.clientHeight; dpr = Math.min(2, devicePixelRatio || 1);
      lienzo.width = Math.round(W * dpr); lienzo.height = Math.round(H * dpr);
      const cs = getComputedStyle(lienzo);
      colores = [1, 2, 3, 4, 5, 6].map(i => cs.getPropertyValue('--bu-confeti-' + i).trim()).filter(Boolean);
    }
    function lanza(x, y, n, angulo, abanico, fuerza) {
      if (reduce) return;
      for (let i = 0; i < n; i++) {
        const a = (angulo + (azar() - .5) * abanico) * Math.PI / 180, v = fuerza * (.45 + azar() * .75);
        piezas.push({
          x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, w: 6 + azar() * 7, h: 10 + azar() * 10, giro: azar() * 6.28, vg: (azar() - .5) * 14,
          fase: azar() * 6.28, vf: 5 + azar() * 7, c: colores[Math.floor(azar() * colores.length)], redonda: azar() < .2, vida: 0,
        });
      }
      if (!raf) { previo = 0; raf = requestAnimationFrame(cuadro); }
    }
    function cuadro(ms) {
      raf = 0;
      const h = previo ? Math.min(.05, (ms - previo) / 1000) : 1 / 60; previo = ms;
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
      for (let i = piezas.length - 1; i >= 0; i--) {
        const p = piezas[i];
        p.vy += 1500 * h; p.vx *= 1 - 1.4 * h; p.vy *= 1 - 1.5 * h;
        p.x += p.vx * h + Math.sin(p.fase) * 26 * h; p.y += p.vy * h; p.giro += p.vg * h; p.fase += p.vf * h; p.vida += h;
        if (p.y > H + 30 || p.vida > 1.9) { piezas.splice(i, 1); continue; }
        g.save(); g.translate(p.x, p.y); g.rotate(p.giro); g.scale(1, Math.cos(p.fase));
        g.globalAlpha = Math.min(1, (1.9 - p.vida) * 1.8); g.fillStyle = p.c;
        if (p.redonda) { g.beginPath(); g.arc(0, 0, p.w * .45, 0, 6.2832); g.fill(); } else g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        g.restore();
      }
      if (piezas.length) raf = requestAnimationFrame(cuadro);
    }
    function limpia() { piezas.length = 0; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, lienzo.width, lienzo.height); }
    new ResizeObserver(mide).observe(lienzo);
    mide();
    return { lanza, limpia };
  }

  const VALIDO = t => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/.test(t);
  const ROLES = { editor: 'Puede crear y editar proyectos.', lector: 'Solo puede ver y comentar.' };
  const ABRE = muelle(135, 16.5);       // el modal crece del botón y se encoge al aviso
  const POP = muelle(300, 15);        // el salto de un chip
  const CIERRA = muelle(210, 21);     // el modal se encoge hasta el aviso

  function Burbuja(raiz, opciones) {
    const o = Object.assign({ onEnvia: null, avisoMs: 800, minimo: 600, semilla: 9 }, opciones);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const $ = s => raiz.querySelector(s);
    const abre = $('[data-abre]'), capa = $('[data-capa]'), sombra = $('.bu-sombra'), modal = $('[data-modal]'), piel = $('.bu-piel');
    const contenido = $('[data-contenido]'), pagina = $('[data-pagina]'), velo = $('[data-velo]'), aviso = $('[data-aviso]');
    const campo = $('[data-campo]'), correos = $('[data-correos]'), input = $('#bu-correos'), msj = $('[data-msj]');
    const enviar = $('[data-enviar]'), enviarTxt = $('[data-enviar-txt]'), copia = $('[data-copia]'), alerta = $('[data-alerta]');
    const confeti = Confeti($('.bu-confeti'), o.semilla, reduce);
    let estado = 'cerrado', previo = null, rol = 'editor';
    const lista = [];

    const relojes = new Set();
    const luego = (fn, ms) => { const id = setTimeout(() => { relojes.delete(id); fn(); }, ms); relojes.add(id); return id; };
    const espera = ms => new Promise(listo => luego(listo, ms));
    const anima = (el, fotogramas, opts) => reduce ? null : el.animate(fotogramas, opts);
    const radio = el => parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
    // el rectángulo r como recorte dentro de la caja base
    const recorte = (r, base, rad) => 'inset(' + [r.top - base.top, base.right - r.right, base.bottom - r.bottom, r.left - base.left].map(v => v.toFixed(1) + 'px').join(' ') + ' round ' + rad + 'px)';
    const lleno = () => 'inset(0px 0px 0px 0px round ' + radio(modal) + 'px)';
    const avisa = s => { alerta.textContent = ''; alerta.textContent = s; };

    /* ── abrir: el botón crece hasta ser el modal ──────────────────── */
    function abrir() {
      if (estado !== 'cerrado') return;
      estado = 'abriendo';
      previo = document.activeElement;
      capa.hidden = false;
      raiz.classList.add('is-abierto');
      pagina.inert = true;
      const base = modal.getBoundingClientRect(), b = abre.getBoundingClientRect();
      // la piel lleva la etiqueta del botón, en su mismo sitio, para que no desaparezca de golpe
      piel.textContent = '';
      const lab = document.createElement('span');
      lab.className = 'bu-piel-lab'; lab.innerHTML = abre.innerHTML;
      lab.style.cssText = 'left:' + (b.left - base.left) + 'px;top:' + (b.top - base.top) + 'px;width:' + b.width + 'px;height:' + b.height + 'px';
      piel.appendChild(lab);
      abre.style.visibility = 'hidden';
      if (!reduce) {
        const a = modal.animate([{ clipPath: recorte(b, base, radio(abre)) }, { clipPath: lleno() }], { duration: ABRE.duration, easing: ABRE.easing });
        a.onfinish = () => { a.cancel(); };
        piel.style.opacity = 1;
        const p = piel.animate([{ opacity: 1 }, { opacity: 1, offset: .16 }, { opacity: 0 }], { duration: 520, easing: 'ease-out', fill: 'both' });
        p.onfinish = () => { piel.style.opacity = ''; p.cancel(); };
        // el banner y cada pieza del cuerpo llegan escalonados, cuando el modal ya casi ha crecido
        const piezas = contenido.querySelectorAll('.bu-banner, .bu-cuerpo > *');
        piezas.forEach((el, k) => el.animate([{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: 650, delay: 180 + k * 55, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'backwards' }));
        contenido.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: 140, fill: 'backwards' });
      }
      luego(() => { estado = 'abierto'; input.focus({ preventScroll: true }); }, reduce ? 0 : 420);
      avisa('Ventana para invitar al equipo');
    }

    /* ── cerrar: el modal vuelve a ser el botón ─────────────────────── */
    function cerrar() {
      if (estado !== 'abierto' && estado !== 'abriendo') return;
      estado = 'cerrando';
      raiz.classList.remove('is-abierto');
      const base = modal.getBoundingClientRect(), b = abre.getBoundingClientRect();
      const lab = piel.firstChild;
      if (lab) lab.style.cssText = 'left:' + (b.left - base.left) + 'px;top:' + (b.top - base.top) + 'px;width:' + b.width + 'px;height:' + b.height + 'px';
      const fin = () => {
        capa.hidden = true; modal.getAnimations().forEach(x => x.cancel()); piel.getAnimations().forEach(x => x.cancel()); contenido.getAnimations().forEach(x => x.cancel());
        pagina.inert = false; abre.style.visibility = '';
        limpia();
        estado = 'cerrado';
        if (previo && previo.focus) previo.focus({ preventScroll: true });
        anima(abre, [{ transform: 'scale(.88)' }, { transform: 'none' }], { duration: POP.duration, easing: POP.easing });
      };
      if (reduce) return fin();
      contenido.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' });
      piel.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 60, fill: 'forwards' });
      modal.animate([{ clipPath: lleno() }, { clipPath: recorte(b, base, radio(abre)) }], { duration: ABRE.duration * .8, easing: ABRE.easing, fill: 'forwards' }).onfinish = fin;
    }

    abre.addEventListener('click', abrir);
    velo.addEventListener('click', () => { if (estado === 'abierto') cerrar(); });
    $('[data-cierra]').addEventListener('click', cerrar);
    raiz.addEventListener('keydown', e => {
      if (estado === 'cerrado' || estado === 'cerrando') return;
      if (e.key === 'Escape') {
        if (estado === 'envia' || estado === 'aviso') return;
        e.preventDefault(); cerrar();
      } else if (e.key === 'Tab' && !capa.hidden && estado !== 'aviso') {
        // el foco queda atrapado en el modal
        const fs = Array.from(modal.querySelectorAll('button, input, [tabindex="0"]')).filter(f => !f.disabled && f.tabIndex >= 0 && f.offsetParent !== null);
        if (!fs.length) return;
        const a = fs[0], z = fs[fs.length - 1];
        if (!modal.contains(document.activeElement)) { e.preventDefault(); a.focus(); }
        else if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
        else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
      }
    });

    /* ── los correos: cada dirección es un chip ─────────────────────── */
    function error(texto) {
      msj.textContent = texto;
      campo.classList.add('is-error');
      campo.classList.remove('is-sacude'); void campo.offsetWidth; campo.classList.add('is-sacude');
      avisa(texto);
    }
    const sinError = () => campo.classList.remove('is-error');
    function agrega(texto) {
      texto = texto.trim();
      if (!texto) return true;
      if (!VALIDO(texto)) { error('Revisa «' + texto + '»: no parece un correo'); return false; }
      if (lista.some(c => c.texto.toLowerCase() === texto.toLowerCase())) { error('Ese correo ya está en la lista'); return false; }
      const chip = document.createElement('span'), av = document.createElement('span'), t = document.createElement('span'), q = document.createElement('button');
      chip.className = 'bu-chip'; chip.dataset.c = String(lista.length % 4);
      av.className = 'bu-chip-av'; av.textContent = texto[0]; av.setAttribute('aria-hidden', 'true');
      t.className = 'bu-chip-t'; t.textContent = texto;
      q.className = 'bu-quita'; q.type = 'button'; q.setAttribute('aria-label', 'Quitar ' + texto);
      q.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>';
      chip.append(av, t, q);
      correos.insertBefore(chip, input);
      const c = { texto, chip };
      lista.push(c);
      anima(chip, [{ transform: 'scale(.3) rotate(-10deg)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: POP.duration, easing: POP.easing });
      q.addEventListener('click', () => { quita(c); input.focus(); });
      sinError(); pintaEnviar();
      avisa(texto + ' agregado. ' + lista.length + (lista.length === 1 ? ' correo' : ' correos') + ' en la lista.');
      return true;
    }
    function quita(c) {
      const i = lista.indexOf(c);
      if (i < 0) return;
      lista.splice(i, 1);
      const fin = () => { c.chip.remove(); lista.forEach((x, k) => { x.chip.dataset.c = String(k % 4); }); pintaEnviar(); };
      if (reduce) fin(); else anima(c.chip, [{ transform: 'none', opacity: 1 }, { transform: 'scale(.4)', opacity: 0 }], { duration: 180, easing: 'ease-in' }).onfinish = fin;
      c.chip.style.pointerEvents = 'none';
      avisa(c.texto + ' quitado.');
    }
    input.addEventListener('input', () => {
      sinError();
      const v = input.value;
      if (!/[,;\s]/.test(v)) return;
      // una coma, un espacio o un pegado con varias direcciones: todo lo anterior son chips
      const partes = v.split(/[,;\s]+/), resto = /[,;\s]$/.test(v) ? '' : partes.pop();
      for (let i = 0; i < partes.length; i++) if (partes[i] && !agrega(partes[i])) { input.value = partes.slice(i).concat(resto).join(' ').trim(); return; }
      input.value = resto;
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); if (input.value.trim() && agrega(input.value)) input.value = ''; }
      else if (e.key === 'Backspace' && !input.value && lista.length) quita(lista[lista.length - 1]);
    });
    input.addEventListener('blur', () => { if (estado === 'abierto' && VALIDO(input.value.trim())) { if (agrega(input.value)) input.value = ''; } });
    correos.addEventListener('click', e => { if (e.target === correos) input.focus(); });

    function pintaEnviar() {
      const n = lista.length;
      const t = n === 0 ? 'Agrega un correo para enviar' : n === 1 ? 'Enviar 1 invitación' : 'Enviar ' + n + ' invitaciones';
      enviar.setAttribute('aria-disabled', n === 0 ? 'true' : 'false');
      if (enviarTxt.textContent === t) return;
      enviarTxt.textContent = t;
      anima(enviarTxt, [{ transform: 'translateY(55%)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 420, easing: 'cubic-bezier(.22, 1, .36, 1)' });
    }

    /* ── el rol: una píldora elástica ───────────────────────────────── */
    const seg = $('[data-seg]'), pildora = $('.bu-pildora'), opciones_ = Array.from(seg.querySelectorAll('.bu-opcion')), rolTxt = $('[data-rol-txt]');
    // la píldora lleva su propia copia de las etiquetas, en blanco: se ven solo donde ella está
    opciones_.forEach(b => { const s = document.createElement('span'); s.innerHTML = b.innerHTML; pildora.appendChild(s); });
    const edgeL = resorte(0, 150, 15), edgeR = resorte(0, 150, 15);
    let ancho = 0, rafSeg = 0, previoSeg = 0, restoSeg = 0;
    function dibujaSeg() { pildora.style.clipPath = 'inset(0 ' + Math.max(0, ancho - edgeR.x).toFixed(2) + 'px 0 ' + Math.max(0, edgeL.x).toFixed(2) + 'px round 16px)'; }
    function metaSeg(salta) {
      ancho = pildora.clientWidth;
      const i = opciones_.findIndex(b => b.dataset.rol === rol), mitad = ancho / 2;
      const l = i * mitad, r = (i + 1) * mitad;
      // el borde que va por delante es rápido y el de atrás lo sigue: la píldora se estira
      const adelante = l > edgeL.meta;
      edgeL.k = adelante ? 120 : 340; edgeL.c = adelante ? 14 : 25; edgeR.k = adelante ? 340 : 120; edgeR.c = adelante ? 25 : 14;
      edgeL.meta = l; edgeR.meta = r;
      if (salta || reduce) { edgeL.x = l; edgeR.x = r; edgeL.v = edgeR.v = 0; dibujaSeg(); } else despiertaSeg();
    }
    function cuadroSeg(ms) {
      rafSeg = 0;
      const dt = previoSeg ? Math.min(.05, (ms - previoSeg) / 1000) : 0; previoSeg = ms; restoSeg += dt;
      while (restoSeg >= 1 / 120) { avanza(edgeL, 1 / 120); avanza(edgeR, 1 / 120); restoSeg -= 1 / 120; }
      dibujaSeg();
      if (Math.abs(edgeL.v) + Math.abs(edgeR.v) + Math.abs(edgeL.meta - edgeL.x) + Math.abs(edgeR.meta - edgeR.x) > .04) rafSeg = requestAnimationFrame(cuadroSeg);
      else { edgeL.x = edgeL.meta; edgeR.x = edgeR.meta; dibujaSeg(); }
    }
    function despiertaSeg() { if (!rafSeg) { previoSeg = 0; rafSeg = requestAnimationFrame(cuadroSeg); } }
    function eligeRol(r, foco) {
      if (r === rol) return;
      rol = r;
      opciones_.forEach(b => { b.setAttribute('aria-checked', String(b.dataset.rol === r)); b.tabIndex = b.dataset.rol === r ? 0 : -1; if (foco && b.dataset.rol === r) b.focus(); });
      metaSeg();
      rolTxt.textContent = ROLES[r];
      anima(rolTxt, [{ transform: 'translateY(7px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 380, easing: 'cubic-bezier(.22, 1, .36, 1)' });
    }
    opciones_.forEach(b => {
      b.addEventListener('click', () => eligeRol(b.dataset.rol, false));
      b.addEventListener('keydown', e => {
        const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        if (!d) return;
        e.preventDefault(); eligeRol(opciones_[(opciones_.indexOf(b) + d + opciones_.length) % opciones_.length].dataset.rol, true);
      });
    });
    new ResizeObserver(() => { if (pildora.clientWidth !== ancho) metaSeg(true); }).observe(pildora);

    /* ── copiar el enlace ───────────────────────────────────────────── */
    let relojCopia = 0;
    copia.addEventListener('click', () => {
      const url = $('[data-enlace]').textContent;
      try { if (navigator.clipboard) navigator.clipboard.writeText(url).catch(() => {}); } catch (e) { /* sin permiso: igual se confirma */ }
      copia.classList.add('is-copiado'); copia.setAttribute('aria-label', 'Enlace copiado');
      avisa('Enlace copiado.');
      clearTimeout(relojCopia);
      relojCopia = luego(() => { copia.classList.remove('is-copiado'); copia.setAttribute('aria-label', 'Copiar el enlace de invitación'); }, 2200);
    });

    /* ── enviar: confeti y el modal se encoge hasta ser un aviso ────── */
    enviar.addEventListener('click', envia);
    function envia() {
      if (estado !== 'abierto') return;
      if (input.value.trim() && !agrega(input.value)) { input.focus(); return; }
      input.value = '';
      if (!lista.length) { error('Agrega al menos un correo'); input.focus(); return; }
      estado = 'envia';
      enviar.classList.add('is-envia'); enviar.setAttribute('aria-busy', 'true'); input.readOnly = true;
      const datos = { correos: lista.map(c => c.texto), rol };
      Promise.all([Promise.resolve().then(() => o.onEnvia ? o.onEnvia(datos) : null), espera(reduce ? 0 : o.minimo)])
        .then(() => listo(datos), falla);
    }
    function falla(e) {
      estado = 'abierto';
      enviar.classList.remove('is-envia'); enviar.removeAttribute('aria-busy'); input.readOnly = false;
      error((e && (e.mensaje || e.message)) || 'No pudimos enviar las invitaciones. Inténtalo de nuevo.');
      anima(sombra, [{ transform: 'translateX(0)' }, { transform: 'translateX(-10px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(0)' }], { duration: 420 });
    }
    function listo(datos) {
      estado = 'aviso';
      const n = datos.correos.length;
      $('[data-aviso-t]').textContent = n === 1 ? '1 invitación enviada' : n + ' invitaciones enviadas';
      $('[data-aviso-s]').textContent = n === 1 ? 'Le llegará en unos segundos.' : 'Les llegarán en unos segundos.';
      avisa($('[data-aviso-t]').textContent);
      raiz.classList.remove('is-abierto');
      const base = modal.getBoundingClientRect(), t = aviso.getBoundingClientRect(), b = enviar.getBoundingClientRect();
      if (!reduce) {
        // confeti: del botón de enviar y de las dos esquinas de arriba del modal
        confeti.lanza(b.left + b.width / 2, b.top + b.height / 2, 80, -90, 110, 1500);
        luego(() => confeti.lanza(base.left + 24, base.top + 80, 36, -60, 70, 1200), 120);
        luego(() => confeti.lanza(base.right - 24, base.top + 80, 36, -120, 70, 1200), 200);
        contenido.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' });
        const a = modal.animate([{ clipPath: lleno() }, { clipPath: recorte(t, base, radio(aviso)) }], { duration: CIERRA.duration, easing: CIERRA.easing, fill: 'forwards' });
        a.onfinish = () => { capa.hidden = true; [modal, sombra, contenido].forEach(x => x.getAnimations().forEach(y => y.cancel())); };
        // a mitad de camino el aviso aparece y el modal se funde con él
        luego(() => {
          aviso.classList.add('is-aviso');
          aviso.animate([{ opacity: 0, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'ease-out' });
          sombra.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 240, fill: 'forwards' });
        }, CIERRA.duration * .5);
      } else {
        capa.hidden = true; aviso.classList.add('is-aviso');
      }
      // la página vuelve: el botón regresa con un salto
      luego(() => {
        pagina.inert = false; abre.style.visibility = '';
        anima(abre, [{ transform: 'scale(.82)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: POP.duration, easing: POP.easing });
        limpia(); estado = 'cerrado';
        if (previo && previo.focus) previo.focus({ preventScroll: true });
      }, reduce ? 0 : 380);
      // el aviso se despide
      luego(() => {
        const fin = () => { aviso.classList.remove('is-aviso'); aviso.getAnimations().forEach(x => x.cancel()); };
        if (reduce) return fin();
        aviso.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(28px) scale(.97)' }], { duration: 480, easing: 'cubic-bezier(.5, 0, .85, .4)', fill: 'forwards' }).onfinish = fin;
      }, (reduce ? 1800 : CIERRA.duration * .5 + 260) + o.avisoMs);
    }

    /* ── volver al principio ────────────────────────────────────────── */
    function limpia() {
      lista.splice(0).forEach(c => c.chip.remove());
      input.value = ''; input.readOnly = false; sinError();
      enviar.classList.remove('is-envia'); enviar.removeAttribute('aria-busy'); pintaEnviar();
      copia.classList.remove('is-copiado');
      rol = 'editor'; opciones_.forEach(b => { b.setAttribute('aria-checked', String(b.dataset.rol === 'editor')); b.tabIndex = b.dataset.rol === 'editor' ? 0 : -1; });
      rolTxt.textContent = ROLES.editor; metaSeg(true);
    }
    function reinicia() {
      relojes.forEach(clearTimeout); relojes.clear();
      [modal, sombra, contenido, piel, aviso, abre].forEach(x => x.getAnimations().forEach(y => y.cancel()));
      confeti.limpia();
      capa.hidden = true; raiz.classList.remove('is-abierto'); aviso.classList.remove('is-aviso');
      pagina.inert = false; abre.style.visibility = '';
      limpia(); estado = 'cerrado';
    }

    pintaEnviar();
    metaSeg(true);
    if (document.fonts) document.fonts.ready.then(() => metaSeg(true));
    return { abre: abrir, cierra: cerrar, reinicia };
  }

  window.Burbuja = Burbuja;
})();
