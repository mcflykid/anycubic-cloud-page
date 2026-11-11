/* =====================================================================
   Esqueleto · Moxen
   Tarjetas esqueleto que salen del propio contenido: el contenido real
   ya está en la página, y esto mide cada [data-hueso] y le dibuja encima
   su hueso —los textos, línea a línea y con su largo de verdad—. Una
   sola luz pasa por todos a la vez (cada hueso recorta su trozo, con
   transform) y, al cargar, los huesos se apagan y el contenido aparece
   en orden, con las ilustraciones asentándose. Sin dependencias.

     const e = Esqueleto(document.querySelector('[data-esqueleto]'));
     e.carga();       // huesos a la vista
     e.muestra();     // fuera huesos, dentro el contenido

   data-hueso         un bloque con la forma del elemento
   data-hueso="texto" una barra por línea de texto
   ===================================================================== */
(function () {
  'use strict';

  function Esqueleto(raiz, opciones) {
    const o = Object.assign({ espera: 55 }, opciones);
    const piezas = Array.from(raiz.querySelectorAll('[data-hueso]'));
    const capa = document.createElement('div');
    capa.className = 'eq-capa';
    capa.setAttribute('aria-hidden', 'true');
    raiz.appendChild(capa);

    /* Las líneas de un texto, con un Range: getClientRects() da un
       rectángulo por trozo de línea; los de la misma altura se juntan. */
    function lineas(el) {
      const r = document.createRange();
      r.selectNodeContents(el);
      const filas = [];
      Array.from(r.getClientRects()).forEach(c => {
        if (c.width < 1) return;
        const f = filas.find(x => Math.abs(x.top - c.top) < c.height / 2);
        if (f) { f.left = Math.min(f.left, c.left); f.right = Math.max(f.right, c.right); }
        else filas.push({ top: c.top, bottom: c.bottom, left: c.left, right: c.right });
      });
      return filas;
    }

    // mide sin desplazamientos puestos: si no, los huesos saldrían corridos
    function arma() {
      capa.textContent = '';
      raiz.classList.add('eq-midiendo');
      piezas.forEach(p => { p.style.translate = '0 0'; });
      const base = raiz.getBoundingClientRect();
      capa.style.setProperty('--eq-ancho', base.width.toFixed(1) + 'px');
      piezas.forEach((p, i) => {
        const espera = (i * o.espera / 1000).toFixed(3) + 's';
        p.style.setProperty('--eq-espera', espera);
        const hueso = (x, y, w, h, radio) => {
          const b = document.createElement('i');
          b.className = 'eq-hueso';
          Object.assign(b.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
          if (radio) b.style.borderRadius = radio;
          b.style.setProperty('--eq-espera', espera);
          // su banda de luz sabe cuánto está corrido el hueso, para ir a la par de las otras
          const luz = document.createElement('i');
          luz.className = 'eq-luz';
          luz.style.setProperty('--x', x.toFixed(1) + 'px');
          b.appendChild(luz);
          capa.appendChild(b);
        };
        if (p.dataset.hueso === 'texto') {
          // la barra es más baja que la línea: así se lee como texto
          lineas(p).forEach(l => {
            const alto = (l.bottom - l.top) * .62;
            hueso(l.left - base.left, l.top - base.top + (l.bottom - l.top - alto) / 2, l.right - l.left, alto);
          });
        } else {
          const r = p.getBoundingClientRect();
          hueso(r.left - base.left, r.top - base.top, r.width, r.height, getComputedStyle(p).borderRadius);
        }
      });
      piezas.forEach(p => { p.style.translate = ''; });
      raiz.classList.remove('eq-midiendo');
    }

    const carga = () => { raiz.classList.add('is-cargando'); raiz.setAttribute('aria-busy', 'true'); };
    const muestra = () => { raiz.classList.remove('is-cargando'); raiz.setAttribute('aria-busy', 'false'); };

    (document.fonts ? document.fonts.ready : Promise.resolve()).then(arma);
    addEventListener('resize', arma, { passive: true });
    arma();
    return { carga, muestra, arma };
  }

  window.Esqueleto = Esqueleto;
})();
