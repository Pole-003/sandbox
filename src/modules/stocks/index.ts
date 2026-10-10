import { ecranProvisoire } from '../../app/ecran-provisoire.ts';
import type { DescripteurModule } from '../../app/module.ts';

export const moduleStocks: DescripteurModule = {
  id: 'stocks',
  libelle: 'Stocks',
  statut: 'bientot',
  rendre(conteneur) {
    ecranProvisoire(conteneur, 'Stocks', 'Analyse de fichier de stock : bientôt disponible.');
  },
};
