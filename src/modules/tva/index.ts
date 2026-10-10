import type { DescripteurModule } from '../../app/module.ts';
import { rendreEcranTva } from './ecran.ts';

export const moduleTva: DescripteurModule = {
  id: 'tva',
  libelle: 'TVA',
  statut: 'actif',
  rendre(conteneur) {
    return rendreEcranTva(conteneur);
  },
};
