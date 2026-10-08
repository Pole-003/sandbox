import { ecranProvisoire } from '../../app/ecran-provisoire.ts';
import { Newspaper } from '../../app/icones.ts';
import type { DescripteurModule } from '../../app/module.ts';

export const moduleVeille: DescripteurModule = {
  id: 'veille',
  libelle: 'Veille',
  icone: Newspaper,
  statut: 'actif',
  rendre(conteneur) {
    ecranProvisoire(
      conteneur,
      'Veille',
      'Actualités comptables, fiscales et économiques, suivi du projet de loi de finances.',
      "Ce module arrive à l'étape 3.",
    );
  },
};
