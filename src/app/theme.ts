import { ecrirePreference, lirePreference } from '../core/stockage.ts';

export type ChoixTheme = 'auto' | 'clair' | 'sombre';

const ORDRE: readonly ChoixTheme[] = ['auto', 'clair', 'sombre'];
export const LIBELLES_THEME: Record<ChoixTheme, string> = {
  auto: 'automatique (système)',
  clair: 'clair',
  sombre: 'sombre',
};

export function lireChoixTheme(): ChoixTheme {
  const valeur = lirePreference('theme');
  return valeur === 'clair' || valeur === 'sombre' ? valeur : 'auto';
}

export function themeSuivant(choix: ChoixTheme): ChoixTheme {
  return ORDRE[(ORDRE.indexOf(choix) + 1) % ORDRE.length] ?? 'auto';
}

/** « auto » laisse la feuille de style suivre prefers-color-scheme. */
export function appliquerTheme(choix: ChoixTheme, racine: HTMLElement = document.documentElement): void {
  if (choix === 'auto') racine.removeAttribute('data-theme');
  else racine.setAttribute('data-theme', choix);
}

export function memoriserTheme(choix: ChoixTheme): void {
  ecrirePreference('theme', choix === 'auto' ? null : choix);
}
