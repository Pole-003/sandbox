import { Newspaper } from '../../app/icones.ts';
import type { DescripteurModule } from '../../app/module.ts';
import { rendreVeille } from './ecran.ts';

export const moduleVeille: DescripteurModule = {
  id: 'veille',
  libelle: 'Veille',
  icone: Newspaper,
  statut: 'actif',
  rendre(conteneur) {
    const annulation = { annule: false };
    void rendreVeille(conteneur, { annulation });
    return () => {
      annulation.annule = true;
    };
  },
};
