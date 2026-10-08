// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { lienVers, resoudreRoute } from '../../src/app/routeur.ts';
import { appliquerTheme, lireChoixTheme, memoriserTheme, themeSuivant } from '../../src/app/theme.ts';

describe('resoudreRoute', () => {
  const ids = ['accueil', 'veille', 'fec'];
  it.each([
    ['#/fec', 'fec'],
    ['#fec', 'fec'],
    ['#/fec/balance', 'fec'],
    ['#/fec?x=1', 'fec'],
    ['', 'accueil'],
    ['#/', 'accueil'],
    ['#/stocks', 'accueil'],
    ['#/inconnu', 'accueil'],
  ])('%s → %s', (ancre, attendu) => {
    expect(resoudreRoute(ancre, ids, 'accueil')).toBe(attendu);
  });

  it('construit les liens', () => {
    expect(lienVers('veille')).toBe('#/veille');
  });
});

describe('thème', () => {
  it('alterne automatique → clair → sombre → automatique', () => {
    expect(themeSuivant('auto')).toBe('clair');
    expect(themeSuivant('clair')).toBe('sombre');
    expect(themeSuivant('sombre')).toBe('auto');
  });

  it('pose ou retire data-theme', () => {
    const racine = document.createElement('html');
    appliquerTheme('sombre', racine);
    expect(racine.getAttribute('data-theme')).toBe('sombre');
    appliquerTheme('auto', racine);
    expect(racine.hasAttribute('data-theme')).toBe(false);
  });

  it('mémorise le choix sous une clé préfixée, et efface la clé en automatique', () => {
    memoriserTheme('sombre');
    expect(localStorage.getItem('pole003-sandbox-theme')).toBe('sombre');
    expect(lireChoixTheme()).toBe('sombre');
    memoriserTheme('auto');
    expect(localStorage.getItem('pole003-sandbox-theme')).toBeNull();
    expect(lireChoixTheme()).toBe('auto');
  });

  it('ignore une valeur mémorisée inconnue', () => {
    localStorage.setItem('pole003-sandbox-theme', 'fluo');
    expect(lireChoixTheme()).toBe('auto');
  });
});
