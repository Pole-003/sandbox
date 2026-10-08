import { ecranProvisoire } from '../../app/ecran-provisoire.ts';
import { MailCheck } from '../../app/icones.ts';
import type { DescripteurModule } from '../../app/module.ts';

export const moduleCircularisations: DescripteurModule = {
  id: 'circularisations',
  libelle: 'Circularisations',
  icone: MailCheck,
  statut: 'actif',
  rendre(conteneur) {
    ecranProvisoire(
      conteneur,
      'Circularisations',
      'Sélection des banques, clients et fournisseurs à circulariser, et tableau de suivi.',
      "Ce module arrive à l'étape 7.",
    );
  },
};
