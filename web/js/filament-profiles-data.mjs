// Les fiches fabricant sont consultatives. Le restant affiché provient de l’ACE.
export const manufacturerProfiles = {
  'PLA Basic Refill': {
    url: 'https://store.anycubic.com/products/pla-basic-refill',
    density: 1.24, nozzle: [190, 230], bed: [55, 56], drying: [45, 50], hours: [6, 8],
    speed: [50, 200], flow: 12, minNozzle: 0.2,
  },
  'PLA Basic': {
    url: 'https://store.anycubic.com/products/pla-filament',
    density: 1.24,
  },
  'PLA+': {
    url: 'https://store.anycubic.com/products/pla-plus-filament',
    density: 1.21, nozzle: [190, 230], bed: [55, 65], minNozzle: 0.2,
  },
  'PLA+ Refill': {
    url: 'https://store.anycubic.com/products/pla-plus-refill',
    density: 1.21, nozzle: [190, 230], bed: [55, 65], drying: [45, 50], hours: [6, 8],
    speed: [50, 200], flow: 12, minNozzle: 0.2,
  },
  'PLA High Speed': {
    url: 'https://eu.anycubic.com/products/high-speed-pla-filament',
    density: 1.19, nozzle: [190, 260], bed: [55, 56], drying: [45, 50], hours: [6, 8],
    flow: 18, minNozzle: 0.2,
  },
  'PLA Matte': {
    url: 'https://eu.anycubic.com/products/matte-pla-filament',
    density: 1.25, nozzle: [190, 230], bed: [60, 65], drying: [55, 65], hours: [6, 8],
    speed: [50, 250], flow: 12,
  },
  'PLA Silk': {
    url: 'https://eu.anycubic.com/products/silk-pla-filament',
    density: 1.22, nozzle: [210, 240], bed: [55, 65], drying: [55, 65], hours: [6, 8],
    speed: [50, 250], flow: 8, minNozzle: 0.4,
  },
  'PLA Silk Dual/Tri-Color': {
    url: 'https://store.anycubic.com/products/silk-pla-dual-tri-color-filament',
    density: 1.22, nozzle: [210, 240], bed: [55, 56], drying: [55, 65], hours: [6, 8],
    speed: [50, 250], flow: 8, minNozzle: 0.4,
  },
  'PLA Galaxy': {
    url: 'https://store.anycubic.com/products/pla-galaxy',
    nozzle: [200, 230], bed: [60, 65], drying: [55, 60], hours: [6, 8], minNozzle: 0.4,
  },
  'PLA Metal': {
    url: 'https://eu.anycubic.com/products/pla-metal-filament',
    density: 1.2, nozzle: [200, 230], bed: [50, 60], drying: [55, 65], hours: [6, 8],
    speed: [40, 250], flow: 12, minNozzle: 0.4,
  },
  'PLA-CF': {
    url: 'https://store.anycubic.com/products/pla-cf-filament',
    density: 1.22, nozzle: [210, 250], bed: [55, 70], speed: [40, 250], flow: 20,
    minNozzle: 0.4, nozzleMaterial: 'Acier trempé',
  },
  'PLA Translucent': {
    url: 'https://store.anycubic.com/products/pla-translucent',
    drying: [50, 55], hours: [6, 8], minNozzle: 0.2,
  },
  'PLA Special': {
    url: 'https://store.anycubic.com/collections/filaments',
    nozzle: [190, 230], bed: [55, 65], minNozzle: 0.2,
  },
  'PLA Marble': {
    url: 'https://eu.anycubic.com/products/pla-marble',
    density: 1.37, nozzle: [200, 230], bed: [55, 65], drying: [55, 65], hours: [6, 8],
    speed: [40, 250], flow: 12, minNozzle: 0.4,
  },
  'PLA Glow': {
    url: 'https://store.anycubic.com/products/pla-glow',
    datasheet: 'https://cdn.shopify.com/s/files/1/0245/5519/2380/files/ANYCUBIC_TDS_PLA_Glow_V3.0.pdf?v=1758527363',
    density: 1.26, nozzle: [200, 230], bed: [60, 70], drying: [60, 65], hours: [6, 8],
    speed: [50, 250], flow: 12, minNozzle: 0.4,
  },
  PETG: {
    url: 'https://eu.anycubic.com/products/petg',
    density: 1.23, nozzle: [230, 250], bed: [60, 70], drying: [55, 65], hours: [6, 8],
    speed: [50, 250], flow: 12, minNozzle: 0.2,
  },
};
