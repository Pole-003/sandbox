import type { DescripteurModule } from '../app/module.ts';
import { moduleAccueil } from './accueil/index.ts';
import { moduleCircularisations } from './circularisations/index.ts';
import { moduleFec } from './fec/index.ts';
import { moduleStocks } from './stocks/index.ts';
import { moduleTva } from './tva/index.ts';
import { moduleVeille } from './veille/index.ts';

/** Ordre d'affichage dans la navigation. */
export const MODULES: readonly DescripteurModule[] = [
  moduleAccueil,
  moduleVeille,
  moduleFec,
  moduleCircularisations,
  moduleStocks,
  moduleTva,
];
