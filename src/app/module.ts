import type { IconNode } from './icones.ts';

export interface DescripteurModule {
  /** Identifiant utilisé dans l'adresse : #/<id> */
  id: string;
  libelle: string;
  icone: IconNode;
  /** « bientot » : affiché grisé dans la barre latérale, non navigable. */
  statut: 'actif' | 'bientot';
  /** Construit l'écran dans le conteneur ; peut renvoyer une fonction de nettoyage appelée en quittant l'écran. */
  rendre(conteneur: HTMLElement): void | (() => void);
}
