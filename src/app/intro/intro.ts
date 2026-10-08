import { ecrirePreference, lirePreference } from '../../core/stockage.ts';
import { h } from '../dom.ts';
import { dateLocaleIso, deciderIntro, type ModeIntro } from './decision.ts';
import { construireScene } from './scene.ts';

/** Durée d'affichage de la version statique (prefers-reduced-motion). */
const DUREE_STATIQUE_MS = 1000;
/** Filet de sécurité si l'événement de fin d'animation n'arrive pas (onglet en arrière-plan, etc.). */
const DUREE_MAX_MS = 3000;

export interface OptionsIntro {
  /** Contenu de l'application, rendu inerte pendant l'animation. */
  application: HTMLElement;
  maintenant?: Date;
  reduireMouvement?: boolean;
}

/** Joue l'animation d'ouverture si nécessaire ; renvoie le mode retenu. */
export function lancerIntro({ application, maintenant = new Date(), reduireMouvement }: OptionsIntro): ModeIntro {
  const aujourdhui = dateLocaleIso(maintenant);
  const mode = deciderIntro({
    aujourdhui,
    derniereLecture: lirePreference('intro-derniere-lecture'),
    desactivee: lirePreference('intro-desactivee') === 'oui',
    reduireMouvement: reduireMouvement ?? window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  });
  if (mode === 'aucune') return mode;

  // Mémorisée dès le début : un rechargement de page ne la rejoue pas.
  ecrirePreference('intro-derniere-lecture', aujourdhui);

  const boutonPasser = h('button', { type: 'button', class: 'intro-passer' }, 'Passer');
  const voile = h(
    'div',
    { class: `intro intro-${mode}`, role: 'presentation' },
    construireScene(),
    h(
      'p',
      { class: 'intro-titre' },
      h('span', { class: 'intro-titre-pole' }, 'Pôle 003'),
      h('span', { class: 'intro-titre-suite' }, ' - Innovation'),
    ),
    boutonPasser,
  );

  const focusPrecedent = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  application.inert = true;
  document.body.append(voile);
  boutonPasser.focus({ preventScroll: true });

  let termine = false;
  const terminer = () => {
    if (termine) return;
    termine = true;
    clearTimeout(minuterie);
    document.removeEventListener('keydown', passer, true);
    voile.remove();
    application.inert = false;
    if (focusPrecedent?.isConnected && focusPrecedent !== document.body) focusPrecedent.focus();
  };
  const passer = (evenement: Event) => {
    evenement.preventDefault();
    if (mode === 'statique') terminer();
    else voile.classList.add('intro-passee');
  };

  voile.addEventListener('animationend', (e) => {
    if (e.target === voile && e.animationName === 'intro-disparition') terminer();
  });
  voile.addEventListener('click', passer);
  document.addEventListener('keydown', passer, true);
  const minuterie = setTimeout(terminer, mode === 'statique' ? DUREE_STATIQUE_MS : DUREE_MAX_MS);

  return mode;
}
