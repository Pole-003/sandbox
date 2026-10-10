import { createElement, type IconNode } from 'lucide';

export type { IconNode };
export {
  Menu,
  Monitor,
  Moon,
  ShieldCheck,
  Sun,
} from 'lucide';

/** Icône décorative (masquée aux lecteurs d'écran). */
export function icone(noeud: IconNode, taille = 18): SVGElement {
  return createElement(noeud, {
    width: taille,
    height: taille,
    'aria-hidden': 'true',
    focusable: 'false',
    class: 'icone',
  });
}
