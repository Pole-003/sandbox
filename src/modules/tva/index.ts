import { ecranProvisoire } from '../../app/ecran-provisoire.ts';
import { ReceiptEuro } from '../../app/icones.ts';
import type { DescripteurModule } from '../../app/module.ts';

export const moduleTva: DescripteurModule = {
  id: 'tva',
  libelle: 'TVA',
  icone: ReceiptEuro,
  statut: 'bientot',
  rendre(conteneur) {
    ecranProvisoire(conteneur, 'Cadrage de TVA', 'Rapprochement CA3 et FEC : bientôt disponible.');
  },
};
