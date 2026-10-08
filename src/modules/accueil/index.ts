import { h } from '../../app/dom.ts';
import { House, ShieldCheck, icone } from '../../app/icones.ts';
import type { DescripteurModule } from '../../app/module.ts';
import { sectionBrief } from '../veille/brief.ts';

export const moduleAccueil: DescripteurModule = {
  id: 'accueil',
  libelle: 'Accueil',
  icone: House,
  statut: 'actif',
  rendre(conteneur) {
    const annulation = { annule: false };
    conteneur.append(
      h('h1', { tabindex: '-1' }, 'Bienvenue dans la Sandbox du Pôle 003'),
      h(
        'p',
        { class: 'texte-secondaire' },
        'Le tableau de bord personnalisé (salutation, accès aux modules, dossiers en cache) arrivera avec l’écran d’accueil complet.',
      ),
      h(
        'section',
        { class: 'carte carte-confidentialite', 'aria-labelledby': 'titre-confidentialite' },
        h('h2', { id: 'titre-confidentialite' }, icone(ShieldCheck, 20), 'Vos fichiers restent sur votre poste'),
        h(
          'ul',
          {},
          h('li', {}, 'Les FEC et autres fichiers sont lus et analysés dans votre navigateur, sans aucun envoi.'),
          h('li', {}, 'Les dossiers sont conservés dans ce navigateur uniquement, et peuvent être purgés à tout moment.'),
          h('li', {}, 'Le site ne charge aucune ressource externe : ni police, ni statistique de visite, ni traceur.'),
        ),
      ),
      sectionBrief(annulation),
    );
    return () => {
      annulation.annule = true;
    };
  },
};
