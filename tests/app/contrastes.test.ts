import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../src/styles/jetons.css', import.meta.url), 'utf8');

function lireBloc(selecteur: string): Record<string, string> {
  const debut = css.indexOf(selecteur);
  if (debut < 0) throw new Error(`Bloc introuvable : ${selecteur}`);
  const corps = css.slice(css.indexOf('{', debut) + 1, css.indexOf('}', debut));
  return Object.fromEntries([...corps.matchAll(/--(c-[\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1]!, m[2]!.toLowerCase()]));
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contraste(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/** Paires texte / fond utilisées par l'interface : toutes doivent atteindre le niveau AA (4,5:1). */
const PAIRES: [string, string][] = [
  ['c-texte', 'c-fond'],
  ['c-texte', 'c-surface'],
  ['c-texte', 'c-surface-2'],
  ['c-texte-2', 'c-fond'],
  ['c-texte-2', 'c-surface'],
  ['c-texte-2', 'c-surface-2'],
  ['c-primaire', 'c-fond'],
  ['c-primaire', 'c-surface'],
  ['c-primaire', 'c-primaire-fond'],
  ['c-sur-primaire', 'c-primaire'],
  ['c-succes', 'c-surface'],
  ['c-succes-texte', 'c-succes-fond'],
  ['c-succes-texte', 'c-surface'],
  ['c-alerte', 'c-surface'],
  ['c-alerte-texte', 'c-alerte-fond'],
  ['c-danger', 'c-surface'],
  ['c-danger-texte', 'c-danger-fond'],
];

const clair = lireBloc(':root {');
const sombreForce = lireBloc(":root[data-theme='sombre']");
const sombreAuto = lireBloc(":root:not([data-theme='clair'])");

describe('contrastes de la charte (WCAG AA)', () => {
  it('le thème sombre automatique est identique au thème sombre forcé', () => {
    expect(sombreAuto).toEqual(sombreForce);
  });

  for (const [nom, jetons] of [
    ['clair', clair],
    ['sombre', sombreForce],
  ] as const) {
    it.each(PAIRES)(`${nom} : %s sur %s ≥ 4,5:1`, (texte, fond) => {
      expect(jetons[texte], texte).toBeDefined();
      expect(jetons[fond], fond).toBeDefined();
      expect(contraste(jetons[texte]!, jetons[fond]!)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
