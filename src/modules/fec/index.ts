import { ecranProvisoire } from '../../app/ecran-provisoire.ts';
import { FileSpreadsheet } from '../../app/icones.ts';
import type { DescripteurModule } from '../../app/module.ts';

export const moduleFec: DescripteurModule = {
  id: 'fec',
  libelle: 'FEC',
  icone: FileSpreadsheet,
  statut: 'actif',
  rendre(conteneur) {
    ecranProvisoire(
      conteneur,
      'Analyse de FEC',
      'Import, contrôle de conformité, balances, grand-livre et statistiques.',
      'Ce module arrive aux étapes 4 à 6.',
    );
  },
};
