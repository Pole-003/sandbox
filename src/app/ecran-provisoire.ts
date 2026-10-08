import { h } from './dom.ts';

/** Écran d'attente d'un module pas encore développé. */
export function ecranProvisoire(conteneur: HTMLElement, titre: string, ...paragraphes: string[]): void {
  conteneur.append(
    h('h1', { tabindex: '-1' }, titre),
    ...paragraphes.map((texte) => h('p', { class: 'texte-secondaire' }, texte)),
  );
}
