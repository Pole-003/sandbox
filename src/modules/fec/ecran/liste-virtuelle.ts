/**
 * Liste virtualisée : seules les lignes visibles sont dans le DOM (grand-livre de plusieurs millions
 * de lignes). Positionnement par le CSSOM (element.style), compatible avec la CSP « style-src 'self' ».
 */
import { h } from '../../../app/dom.ts';

export interface ListeVirtuelle {
  element: HTMLElement;
  /** Remplace le contenu (nombre de lignes et fabrique), en revenant en haut. */
  definir(nombre: number, rendreLigne: (k: number) => HTMLElement): void;
}

export function creerListeVirtuelle(options: { hauteurLigne: number; entete: HTMLElement; libelle: string }): ListeVirtuelle {
  const { hauteurLigne } = options;
  const fenetre = h('div', { class: 'liste-virtuelle-fenetre', role: 'rowgroup' });
  const espaceur = h('div', { class: 'liste-virtuelle-espaceur' }, fenetre);
  const defilement = h('div', { class: 'liste-virtuelle', tabindex: '0', role: 'table', 'aria-label': options.libelle }, options.entete, espaceur);
  let nombre = 0;
  let fabrique: (k: number) => HTMLElement = () => h('div');
  let debutRendu = -1;
  let finRendu = -1;

  const rendre = () => {
    const visibles = Math.ceil((defilement.clientHeight || 600) / hauteurLigne);
    const debut = Math.max(0, Math.floor(defilement.scrollTop / hauteurLigne) - 10);
    const fin = Math.min(nombre, debut + visibles + 20);
    if (debut === debutRendu && fin === finRendu) return;
    debutRendu = debut;
    finRendu = fin;
    const lignes: HTMLElement[] = [];
    for (let k = debut; k < fin; k++) {
      const l = fabrique(k);
      l.setAttribute('aria-rowindex', String(k + 2));
      lignes.push(l);
    }
    fenetre.style.transform = `translateY(${debut * hauteurLigne}px)`;
    fenetre.replaceChildren(...lignes);
  };
  defilement.addEventListener('scroll', () => requestAnimationFrame(rendre), { passive: true });
  new ResizeObserver(() => {
    debutRendu = -1;
    rendre();
  }).observe(defilement);

  return {
    element: defilement,
    definir(n, f) {
      nombre = n;
      fabrique = f;
      defilement.setAttribute('aria-rowcount', String(n + 1));
      espaceur.style.height = `${n * hauteurLigne}px`;
      defilement.scrollTop = 0;
      debutRendu = -1;
      rendre();
    },
  };
}
