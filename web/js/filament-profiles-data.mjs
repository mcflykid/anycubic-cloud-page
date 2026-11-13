// Les fiches fabricant sont consultatives. Le restant affiché provient de l’ACE.
export const manufacturerProfiles = {
  'PLA Basic Refill': {
    url: 'https://store.anycubic.com/products/pla-basic-refill',
    density: 1.24, nozzle: [190, 230], bed: [55, 56], drying: [45, 50], hours: [6, 8],
    speed: [50, 200], flow: 12, minNozzle: 0.2,
  },
  'PLA Basic': {
    url: 'https://store.anycubic.com/products/pla-filament',
    datasheet: 'https://cdn.shopify.com/s/files/1/0698/1235/5357/files/ANYCUBIC_TDS_PLA_V3.0.pdf?v=1757585748',
    density: 1.24, nozzle: [190, 230], bed: [55, 65], drying: [45, 50], hours: [6, 8],
    speed: [50, 200], flow: 12,
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
    datasheet: 'https://cdn.shopify.com/s/files/1/0245/5519/2380/files/ANYCUBIC_TDS_PLA_Marble_V3.0.pdf?v=1758283111',
    density: 1.37, nozzle: [200, 230], bed: [55, 65], drying: [55, 65], hours: [6, 8],
    speed: [40, 250], flow: 12, minNozzle: 0.4,
  },
  'PLA Glow': {
    url: 'https://store.anycubic.com/products/pla-glow',
    profileSource: 'https://3dfilamentprofiles.com/filament/details/14400',
    datasheet: 'https://cdn.shopify.com/s/files/1/0245/5519/2380/files/ANYCUBIC_TDS_PLA_Glow_V3.0.pdf?v=1758527363',
    density: 1.26, nozzle: [200, 230], bed: [60, 70], drying: [60, 65], hours: [6, 8],
    speed: [50, 250], flow: 12, minNozzle: 0.4,
  },
  PETG: {
    url: 'https://eu.anycubic.com/products/petg',
    density: 1.23, nozzle: [230, 250], bed: [60, 70], drying: [55, 65], hours: [6, 8],
    speed: [50, 250], flow: 12, minNozzle: 0.2,
  },
  'PETG Translucent': {
    url: 'https://store.anycubic.com/products/petg-filament-translucent',
    datasheet: 'https://cdn.shopify.com/s/files/1/0698/1235/5357/files/ANYCUBIC_TDS_PETG_V3.0.pdf?v=1757584046',
    density: 1.23, nozzle: [230, 250], bed: [60, 70], drying: [55, 65], hours: [6, 8],
    speed: [50, 250], flow: 12,
  },
  ABS: {
    url: 'https://store.anycubic.com/products/abs-filament',
    datasheet: 'https://cdn.shopify.com/s/files/1/0685/7578/9245/files/ANYCUBIC_TDS_ABS_V3.0.pdf?v=1757562279',
    density: 1.05, nozzle: [240, 280], bed: [80, 100], drying: [70, 80], hours: [8, 12],
    speed: [50, 150], flow: 15,
  },
  ASA: {
    url: 'https://store.anycubic.com/products/asa-filament',
    datasheet: 'https://cdn.shopify.com/s/files/1/0245/5519/2380/files/ANYCUBIC_TDS_ASA_V3.0.pdf?v=1758535865',
    density: 1.07, nozzle: [255, 275], bed: [80, 100], drying: [70, 80], hours: [8, 12],
    speed: [50, 100], flow: 12,
  },
  'TPU 95A': {
    url: 'https://store.anycubic.com/products/tpu-filament',
    datasheet: 'https://cdn.shopify.com/s/files/1/0685/7578/9245/files/ANYCUBIC_TDS_TPU_V3.0.pdf?v=1757560611',
    density: 1.23, nozzle: [195, 230], bed: [50, 60], drying: [70, 80], hours: [8, 12],
    speed: [50, 150], flow: 3.2,
  },
};
