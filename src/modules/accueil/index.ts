import { h } from '../../app/dom.ts';
import type { DescripteurModule } from '../../app/module.ts';
import { creerPanneaux } from './panneaux.ts';

const DATE_LONGUE = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/** Poste de pilotage : ce qui change (veille, échéances, indicateurs) et ce que ce poste conserve (dossiers). */
export const moduleAccueil: DescripteurModule = {
  id: 'accueil',
  libelle: 'Accueil',
  statut: 'actif',
  rendre(conteneur) {
    const annulation = { annule: false };
    const maintenant = new Date();
    const panneaux = creerPanneaux(annulation, maintenant);
    const statut = h('p', { class: 'accueil-statut texte-secondaire', role: 'status' }, DATE_LONGUE.format(maintenant));
    panneaux.surResume((texte) => statut.replaceChildren(`${DATE_LONGUE.format(maintenant)} · ${texte}`));
    conteneur.append(
      h('div', { class: 'accueil-entete' }, h('p', { class: 'surtitre' }, 'Pôle 003 · Innovation'), h('h1', { tabindex: '-1' }, 'Accueil'), statut),
      h(
        'div',
        { class: 'accueil-grille' },
        h('div', { class: 'accueil-colonne' }, panneaux.veille, panneaux.echeances),
        h('div', { class: 'accueil-colonne' }, panneaux.indicateurs, panneaux.dossiers),
      ),
    );
    return () => {
      annulation.annule = true;
    };
  },
};
