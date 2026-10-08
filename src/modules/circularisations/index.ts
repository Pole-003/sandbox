import { MailCheck } from '../../app/icones.ts';
import type { DescripteurModule } from '../../app/module.ts';
import { rendreEcranCircularisations } from './ecran.ts';

export const moduleCircularisations: DescripteurModule = {
  id: 'circularisations',
  libelle: 'Circularisations',
  icone: MailCheck,
  statut: 'actif',
  rendre(conteneur) {
    return rendreEcranCircularisations(conteneur);
  },
};
