// Carnet rédigé pour l’atelier : les faits viennent des recommandations Anycubic pour la Kobra S1,
// la rédaction et les schémas sont originaux. Aucun texte ni aucune image du wiki n’est repris (#452).
export const MAINTENANCE_SOURCE =
  'https://wiki.anycubic.com/en/fdm-3d-printer/kobra-s1-combo/maintenance-recommendations';

/**
 * Fiches du carnet. `operations` relie une fiche aux opérations du registre d’entretien.
 * `when` décrit le repère du constructeur ; l’échéance réglée dans l’atelier s’affiche à part.
 */
export const maintenanceGuide = [
  {
    id: 'z-screw',
    title: 'Vis de l’axe Z',
    operations: ['z-screw'],
    when: 'Environ tous les trois mois, ou plus tôt si le plateau fait un bruit inhabituel en montant ou en descendant.',
    signs: [
      'Grincement ou frottement pendant les déplacements verticaux du plateau.',
      'Un bruit métallique pendant une impression très rapide, au-delà d’environ 350 mm/s, reste normal : il ne suffit pas à justifier un entretien.',
    ],
    tools: ['Chiffon non pelucheux', 'Graisse pour vis-mère, en petite quantité'],
    steps: [
      'Essuyez la vis sur toute sa hauteur pour retirer poussière et anciens dépôts.',
      'Depuis l’écran de l’imprimante, ouvrez Outils puis Déplacer et lancez le retour à l’origine de l’axe Z : le plateau remonte en position haute.',
      'Déposez un mince filet de graisse le long de la partie visible de la vis.',
      'Faites descendre le plateau jusqu’en bas avec Z+, graissez la partie dégagée, puis relancez le retour à l’origine pour répartir la graisse.',
      'Lancez une petite impression d’essai et vérifiez que le plateau se déplace sans à-coup ni bruit.',
    ],
    cautions: [
      'Préférez une graisse à une huile : l’huile coule le long de la vis et attire la poussière.',
      'Une petite quantité suffit ; essuyez l’excédent.',
    ],
    figure: 'z-screw',
  },
  {
    id: 'y-rods',
    title: 'Tiges de l’axe Y',
    operations: ['y-rods'],
    when: 'Contrôle une fois par mois.',
    signs: [
      'Débris, filament ou poussière collés sur les tiges ou les roulements.',
      'Point dur, accroche ou jeu quand on déplace l’axe à la main.',
    ],
    tools: ['Chiffon non pelucheux ou pinceau souple', 'Soufflette ou poire à air', 'Graisse, en petite quantité'],
    steps: [
      'Éteignez l’imprimante et débranchez-la.',
      'Inspectez les tiges et retirez délicatement poussières et débris.',
      'Déplacez doucement l’axe Y à la main sur toute sa course pour repérer un point dur.',
      'Si la poussière est abondante, soufflez-la par petites impulsions.',
      'Déposez une fine couche de graisse sur les tiges, puis faites plusieurs allers-retours pour la répartir.',
      'Rebranchez, rallumez et lancez une impression d’essai : le mouvement doit rester fluide et silencieux.',
    ],
    cautions: [
      'Soufflez avec modération pour ne pas repousser la poussière vers l’électronique.',
    ],
    figure: 'y-rods',
  },
  {
    id: 'x-rods',
    title: 'Tiges de l’axe X',
    operations: ['x-rods'],
    when: 'Dès que les tiges paraissent sales.',
    signs: ['Dépôts ou poussière visibles sur les tiges qui guident la tête.'],
    tools: ['Chiffon non pelucheux', 'Alcool isopropylique'],
    steps: [
      'Imprimante éteinte, humectez légèrement le chiffon d’alcool.',
      'Essuyez les tiges sur toute leur longueur jusqu’à ce qu’elles soient propres et lisses.',
    ],
    cautions: [
      'Ne graissez jamais l’axe X : ses bagues en graphène sont autolubrifiantes et la graisse les encrasserait.',
    ],
    figure: 'x-rods',
  },
  {
    id: 'camera',
    title: 'Caméra',
    operations: [],
    when: 'Quand l’image devient floue ou que l’objectif est visiblement sale.',
    signs: ['Image voilée, floue ou tachée dans la vidéo de l’atelier.'],
    tools: ['Chiffon non pelucheux ou coton-tige', 'Alcool isopropylique'],
    steps: ['Nettoyez doucement l’objectif avec le chiffon ou le coton-tige légèrement imbibé d’alcool.'],
    cautions: ['Frottez sans appuyer pour ne pas rayer l’objectif.'],
    figure: 'camera',
  },
  {
    id: 'cutter',
    title: 'Coupe-filament',
    operations: ['cutter'],
    when: 'Contrôle après trois à cinq bobines imprimées.',
    signs: ['Coupe nette qui devient difficile, filament écrasé ou mal sectionné lors des changements.'],
    tools: ['Clé Allen de 2,0 mm', 'Lame de rechange si nécessaire'],
    steps: [
      'Imprimante éteinte et tête refroidie, démontez l’ensemble du coupe-filament avec la clé Allen.',
      'Examinez la lame : remplacez-la si elle est émoussée ou ébréchée.',
      'Remontez l’ensemble.',
    ],
    cautions: ['La lame reste coupante : manipulez-la avec précaution.'],
    figure: 'cutter',
  },
  {
    id: 'hotend',
    title: 'Tête chauffante et buse',
    operations: ['nozzle'],
    when: 'En cas de sous-extrusion ou si la surface de la buse est encrassée.',
    signs: ['Extrusion irrégulière ou insuffisante.', 'Résidus de filament collés sur la buse.'],
    tools: ['Gants isolants', 'Papier absorbant, chiffon ou pince', 'Aiguille de débouchage'],
    steps: [
      'Retirez la chaussette silicone de la tête.',
      'Depuis l’écran de l’imprimante, chauffez la buse à 200 °C.',
      'Avec des gants isolants, nettoyez la surface de la buse avec le papier, le chiffon ou la pince.',
      'Montez à 230 °C et passez l’aiguille dans la buse pour dégager les restes de filament.',
      'Laissez refroidir, puis remettez la chaussette silicone.',
    ],
    cautions: [
      'La buse chaude provoque des brûlures graves : gants obligatoires.',
      'La chauffe se règle sur l’imprimante ; le carnet n’envoie aucune commande.',
    ],
    figure: 'hotend',
  },
  {
    id: 'silicone',
    title: 'Chaussette silicone',
    operations: ['nozzle'],
    when: 'À chaque nettoyage de la buse, et dès qu’elle paraît abîmée.',
    signs: ['Silicone déchiré, durci ou déformé.', 'Résidus de filament accumulés dessus.'],
    tools: ['Chaussette silicone de rechange'],
    steps: [
      'Tête froide, examinez la chaussette sur toutes ses faces.',
      'Si elle est usée ou encrassée, retirez-la et posez une chaussette neuve.',
    ],
    cautions: ['Ne retirez la chaussette qu’une fois la tête refroidie.'],
    figure: 'silicone',
  },
  {
    id: 'fans',
    title: 'Ventilateurs',
    operations: ['fans'],
    when: 'Contrôle régulier de la poussière.',
    signs: ['Poussière ou fils de filament sur les pales ou les grilles.', 'Ventilateur plus bruyant qu’à l’habitude.'],
    tools: ['Air sec en bombe ou soufflette', 'Pinceau et coton-tige', 'Aspirateur', 'Alcool isopropylique pour les taches tenaces'],
    steps: [
      'Imprimante éteinte, repérez les trois ventilateurs : celui de la tête chauffante, celui du capot avant et l’auxiliaire.',
      'Retirez la poussière à la soufflette, à l’aspirateur ou au pinceau.',
      'Nettoyez les pales au pinceau et au coton-tige ; utilisez un peu d’alcool sur les taches tenaces.',
      'Si l’encrassement est important, démontez le ventilateur pour le nettoyer complètement.',
    ],
    cautions: ['Laissez l’alcool s’évaporer avant de rallumer l’imprimante.'],
    figure: 'fans',
  },
  {
    id: 'bed',
    title: 'Plaque en acier',
    operations: ['bed'],
    when: 'Inspection et nettoyage réguliers.',
    signs: ['Traces de doigts, taches ou résidus sur la surface.', 'Pièces qui adhèrent moins bien.'],
    tools: ['Alcool isopropylique, ou eau et liquide vaisselle', 'Chiffon propre'],
    steps: [
      'Retirez la plaque une fois refroidie.',
      'Nettoyez-la à l’alcool ou à l’eau savonneuse, puis séchez-la.',
      'Reposez-la en la tenant par les bords.',
    ],
    cautions: ['Évitez de toucher la surface d’impression : le gras des doigts réduit l’adhérence.'],
    figure: 'bed',
  },
];
