# Contrôle des SKU Anycubic

Le relevé du 14 novembre 2026 compare le champ SKU de chaque fiche individuelle ouverte aux SKU des variantes des boutiques Anycubic consultées. Le catalogue publie les variantes recoupées. Les autres lignes du premier relevé restent ici pour expliquer leur retrait. Une absence dans la boutique peut correspondre à une ancienne référence, une autre région ou un identifiant de produit différent. Elle ne valide pas une nouvelle association RFID.

| Fiche | SKU | Résultat |
| --- | --- | --- |
| [ABS · Black](https://3dfilamentprofiles.com/filament/details/6895) | `G2630-M6396723572` | Écarté : SKU non confirmé |
| [ASA · Black](https://3dfilamentprofiles.com/filament/details/12623) | `HASBK-103` | Écarté : SKU non confirmé |
| [ASA · White](https://3dfilamentprofiles.com/filament/details/4504) | `HASWH-103` | Écarté : SKU non confirmé |
| [PETG · Blue (2026)](https://3dfilamentprofiles.com/filament/details/24623) | `AHPEDB-102` | Écarté : SKU non confirmé |
| [PETG · Lake Blue](https://3dfilamentprofiles.com/filament/details/10791) | `AHPEAB-102` | Écarté : SKU non confirmé |
| [PETG · Lime Green](https://3dfilamentprofiles.com/filament/details/10780) | `AHPELG-102` | Écarté : SKU non confirmé |
| [PLA Basic · Black](https://3dfilamentprofiles.com/filament/details/560) | `AHPLBK-107` | [SKU recoupé chez un distributeur](https://www.blueconnect.co.za/shop/printers/filament/anycubic-pla-basic-filament-1kg-black/) |
| [PLA Basic · Brown](https://3dfilamentprofiles.com/filament/details/2830) | `AHPLBR-107` | [SKU recoupé chez un distributeur](https://www.printus.de/anycubic-basic-filament-rolle-895407) |
| [PETG Translucent · Pink](https://3dfilamentprofiles.com/filament/details/11662) | `AHPETK-102` | Écarté : SKU non confirmé |
| [PLA Basic · Pearl Black](https://3dfilamentprofiles.com/filament/details/3045) | `AHPLBK-103` | Écarté : SKU non confirmé |
| [PLA-CF · Black](https://3dfilamentprofiles.com/filament/details/24562) | `HPFBK-101` | Confirmé chez Anycubic |
| [PLA-CF · Fish Scale White](https://3dfilamentprofiles.com/filament/details/24563) | `HPFFW-101` | Confirmé chez Anycubic |
| [PLA-CF · Jade Green](https://3dfilamentprofiles.com/filament/details/24564) | `HPFJG-101` | Confirmé chez Anycubic |
| [PLA Glow · Yellow](https://3dfilamentprofiles.com/filament/details/14401) | `00840432413975` | Code numérique à confirmer comme SKU fabricant |
| [PLA Marble · Marble White](https://3dfilamentprofiles.com/filament/details/15191) | `AHLSMW-101` | Confirmé chez Anycubic |

Deux lignes PLA Basic Black du tableau partagent `AHPLBK-107`. Une seule fiche est proposée pour ce SKU, celle qui affiche ce SKU dans le détail ([560](https://3dfilamentprofiles.com/filament/details/560)). La variante noire vert foncé n’a pas de SKU confirmé dans le détail. Les rapprochements avec les deux bobines PLA Basic de l’ACE correspondent aux fiches déjà associées dans le projet. Les boutiques Anycubic consultées ne listent pas ces deux références à l’identique. Les distributeurs cités recoupent le code, la famille et la couleur.

Le catalogue local contient 32 fiches sélectionnées après recoupement. Les variantes supplémentaires retenues figurent dans [les données du catalogue](../web/js/filament-profiles-data.mjs). Les sept pages de la liste ont été parcourues pour repérer les lignes avec SKU. Une partie des fiches individuelles reste à ouvrir ou à recouper.

## Autres sources publiques

- Le [guide filament Anycubic](https://wiki.anycubic.com/en/filament-and-resin/filament-guide) décrit les familles et leurs usages. Les données techniques se vérifient dans les fiches produit et PDF Anycubic.
- Le [relevé de SKU Anycubic](https://github.com/mrRobot62/anycubic_filament_sku_sniffer#complete-list-of-skus-colors-filaments) rapproche références commerciales, familles et couleurs à partir des boutiques. Il confirme notamment `AHLSBR-101` pour Marble Brick Red et `AHLSMW-101` pour Marble White. Puisqu’il reprend la boutique, il facilite la vérification sans constituer une source indépendante pour une puce.
- La [fiche Anycubic de SpoolmanDB](https://github.com/Donkie/SpoolmanDB/blob/main/filaments/anycubic.json) fournit notamment des couleurs et réglages de PETG. Elle sert à comparer les paramètres et ne suffit pas à valider un SKU lu par l’ACE.
