import { ecrirePreference, lirePreference } from '../../core/stockage.ts';
import { calculerTrajectoire, dateLocaleIso, doitJouerIntro } from './decision.ts';

const NS = 'http://www.w3.org/2000/svg';
const DUREE_MS = 1600;
const TAILLE_FUSEE = 44;

function s(balise: string, attributs: Record<string, string | number>): SVGElement {
  const element = document.createElementNS(NS, balise);
  for (const [nom, valeur] of Object.entries(attributs)) element.setAttribute(nom, String(valeur));
  return element;
}

/** Fusée dessinée nez vers le haut, centrée dans un carré de 48 × 48. */
function construireFusee(): SVGElement {
  const svg = s('svg', {
    viewBox: '0 0 48 48',
    width: TAILLE_FUSEE,
    height: TAILLE_FUSEE,
    class: 'fusee-vol-dessin',
    'aria-hidden': 'true',
    focusable: 'false',
  });
  svg.append(
    s('path', { d: 'M20 34 L24 46 L28 34 Z', class: 'fusee-vol-flamme' }),
    s('path', { d: 'M17 26 L11 36 L18 34 Z', class: 'fusee-vol-aileron' }),
    s('path', { d: 'M31 26 L37 36 L30 34 Z', class: 'fusee-vol-aileron' }),
    s('path', { d: 'M24 2 C31 10 32 22 30 35 L18 35 C16 22 17 10 24 2 Z', class: 'fusee-vol-carlingue' }),
    s('path', { d: 'M24 2 C27.5 6 29.5 10 30.3 14 L17.7 14 C18.5 10 20.5 6 24 2 Z', class: 'fusee-vol-ogive' }),
    s('circle', { cx: 24, cy: 21, r: 3.5, class: 'fusee-vol-hublot' }),
  );
  return svg;
}

export interface OptionsIntro {
  maintenant?: Date;
  reduireMouvement?: boolean;
}

/**
 * Fait traverser l'écran à une fusée, par-dessus l'interface (une fois par jour).
 * L'animation est purement décorative : elle ne bloque ni les clics ni le clavier.
 * Renvoie true si la fusée a été lancée.
 */
export function lancerIntro({ maintenant = new Date(), reduireMouvement }: OptionsIntro = {}): boolean {
  const aujourdhui = dateLocaleIso(maintenant);
  const jouer = doitJouerIntro({
    aujourdhui,
    derniereLecture: lirePreference('intro-derniere-lecture'),
    desactivee: lirePreference('intro-desactivee') === 'oui',
    reduireMouvement: reduireMouvement ?? window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  });
  if (!jouer) return false;

  // Mémorisée dès le départ : un rechargement de page ne la rejoue pas.
  ecrirePreference('intro-derniere-lecture', aujourdhui);

  const fusee = document.createElement('div');
  fusee.className = 'fusee-vol';
  fusee.setAttribute('aria-hidden', 'true');
  fusee.append(construireFusee());
  document.body.append(fusee);

  const demi = TAILLE_FUSEE / 2;
  const images = calculerTrajectoire(window.innerWidth, window.innerHeight).map(({ x, y, angle }) => ({
    transform: `translate(${x - demi}px, ${y - demi}px) rotate(${angle}deg)`,
  }));
  // Web Animations API : aucun style en ligne, compatible avec la CSP « style-src 'self' ».
  const animation = fusee.animate(images, { duration: DUREE_MS, easing: 'cubic-bezier(0.4, 0, 0.7, 1)', fill: 'both' });
  const retirer = () => fusee.remove();
  animation.addEventListener('finish', retirer);
  animation.addEventListener('cancel', retirer);
  return true;
}
