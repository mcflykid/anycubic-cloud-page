// Schémas originaux du carnet : formes simplifiées, sans reprise d’une photo ou d’un dessin constructeur.
// Le trait suit les couleurs du thème ; la pièce concernée ressort en couleur d’accent.
const frame = '<rect class="mg-frame" x="8" y="8" width="224" height="144" rx="10"/>';

const figures = {
  'z-screw': `${frame}
    <path class="mg-part" d="M60 24v112M180 24v112"/>
    <rect class="mg-part" x="52" y="62" width="136" height="12" rx="3"/>
    <path class="mg-focus" d="M120 22v116"/>
    <path class="mg-focus mg-thin" d="M114 34l12 6M114 46l12 6M114 58l12 6M114 82l12 6M114 94l12 6M114 106l12 6M114 118l12 6"/>
    <path class="mg-hint" d="M150 34v24m-6-6 6 6 6-6M150 126v-24m-6 6 6-6 6 6"/>
    <circle class="mg-drop" cx="132" cy="96" r="4"/>`,
  'y-rods': `${frame}
    <path class="mg-focus" d="M40 56h160M40 104h160"/>
    <rect class="mg-part" x="96" y="48" width="48" height="64" rx="6"/>
    <rect class="mg-accent-fill" x="102" y="51" width="14" height="10" rx="3"/>
    <rect class="mg-accent-fill" x="124" y="99" width="14" height="10" rx="3"/>
    <path class="mg-hint" d="M64 80h-18m6-6-6 6 6 6M176 80h18m-6-6 6 6-6 6"/>
    <circle class="mg-drop" cx="170" cy="56" r="4"/>`,
  'x-rods': `${frame}
    <path class="mg-focus" d="M32 64h176M32 92h176"/>
    <rect class="mg-part" x="94" y="52" width="52" height="52" rx="6"/>
    <path class="mg-part" d="M112 104v20l8 10 8-10v-20"/>
    <path class="mg-cloth" d="M156 54h28l-4 14h-28z"/>
    <path class="mg-warning" d="M44 116l20 20m0-20-20 20"/>
    <circle class="mg-warning" cx="54" cy="126" r="16"/>`,
  camera: `${frame}
    <rect class="mg-part" x="60" y="48" width="96" height="64" rx="10"/>
    <circle class="mg-focus" cx="108" cy="80" r="20"/>
    <circle class="mg-accent-fill" cx="108" cy="80" r="7"/>
    <path class="mg-cloth" d="M166 98c12-14 30-18 42-10l-10 22c-10-4-22-2-32 2z"/>`,
  cutter: `${frame}
    <rect class="mg-part" x="64" y="40" width="80" height="80" rx="8"/>
    <path class="mg-part" d="M104 20v20M104 120v20"/>
    <path class="mg-focus" d="M86 92l36-36"/>
    <path class="mg-focus mg-thin" d="M86 92l10 4-6 6z"/>
    <path class="mg-part" d="M164 64l36 36"/>
    <path class="mg-part mg-thin" d="M200 100h-16v-8"/>`,
  hotend: `${frame}
    <rect class="mg-part" x="84" y="24" width="72" height="56" rx="6"/>
    <rect class="mg-part" x="96" y="80" width="48" height="26" rx="4"/>
    <path class="mg-focus" d="M110 106h20l-6 18h-8z"/>
    <path class="mg-heat" d="M60 112c6-8-6-12 0-20M48 120c6-8-6-12 0-20M180 112c6-8-6-12 0-20"/>
    <path class="mg-part mg-thin" d="M120 132v14"/>`,
  silicone: `${frame}
    <rect class="mg-part" x="84" y="24" width="72" height="56" rx="6"/>
    <path class="mg-focus" d="M92 78h56v34a6 6 0 0 1-6 6h-44a6 6 0 0 1-6-6z"/>
    <path class="mg-part" d="M112 118h16l-4 14h-8z"/>
    <path class="mg-hint" d="M176 96h28m-8-8 8 8-8 8"/>`,
  fans: `${frame}
    <rect class="mg-part" x="40" y="40" width="72" height="72" rx="8"/>
    <circle class="mg-focus" cx="76" cy="76" r="26"/>
    <path class="mg-focus mg-thin" d="M76 76c10-14 22-10 20 0M76 76c14 10 10 22 0 20M76 76c-10 14-22 10-20 0M76 76c-14-10-10-22 0-20"/>
    <path class="mg-hint" d="M136 60h56m-44 16h56m-44 16h56"/>`,
  bed: `${frame}
    <path class="mg-focus" d="M36 100l40-44h128l-40 44z"/>
    <path class="mg-part mg-thin" d="M36 100v8h128v-8M164 108l40-44v-8"/>
    <path class="mg-cloth" d="M108 66h36l-8 16h-36z"/>
    <path class="mg-warning" d="M176 112c4-10 10-12 14-8m-10 14c4-8 8-10 12-6"/>`,
};

/**
 * Construit le schéma d’une fiche ; le contenu est statique et défini ci-dessus.
 * @param {string} name identifiant de fiche
 * @param {string} label description lue par les technologies d’assistance
 */
export function maintenanceFigure(name, label) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 240 160');
  svg.setAttribute('class', 'maintenance-figure');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  svg.innerHTML = figures[name] || frame;
  return svg;
}
