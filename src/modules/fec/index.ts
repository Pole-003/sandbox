import { FileSpreadsheet } from '../../app/icones.ts';
import type { DescripteurModule } from '../../app/module.ts';
import { rendreEcranFec } from './ecran/ecran-fec.ts';

export const moduleFec: DescripteurModule = {
  id: 'fec',
  libelle: 'FEC',
  icone: FileSpreadsheet,
  statut: 'actif',
  rendre(conteneur) {
    return rendreEcranFec(conteneur);
  },
};
