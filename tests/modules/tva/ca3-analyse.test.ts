import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { analyserCa3, lireMontantCa3, type PageTexte } from '../../../src/modules/tva/ca3/analyse.ts';
import { pagesDuPdf } from '../../../src/modules/tva/ca3/texte-pdf.ts';
import { ATTENDUS_CA3, DOSSIER_CA3, lireFixture } from './aides.ts';

/** Générateur pseudo-aléatoire à graine (mulberry32) pour mélanger les éléments de texte. */
function melanger<T>(t: T[], graine: number): T[] {
  let a = graine >>> 0;
  const alea = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const r = [...t];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(alea() * (i + 1));
    [r[i], r[j]] = [r[j]!, r[i]!];
  }
  return r;
}

const page = (elements: [string, number, number][]): PageTexte => ({
  largeur: 595,
  hauteur: 842,
  elements: elements.map(([texte, x, y]) => ({ texte, x, y, largeur: texte.length * 4.2, hauteur: 8.5 })),
});

const identification: [string, number, number][] = [
  ['SIREN : 000777128', 50, 780],
  ['Période déclarée : 01/04/2026 au 30/04/2026', 50, 765],
  ['Formulaire 3310-CA3 (applicable à compter du 01/01/2026)', 40, 740],
];

describe('montants', () => {
  it('séparateurs de milliers (espace, insécable, fine), signe, entiers', () => {
    expect(lireMontantCa3('125 000')).toBe(12_500_000);
    expect(lireMontantCa3('125 000')).toBe(12_500_000);
    expect(lireMontantCa3('1 250 000')).toBe(125_000_000);
    expect(lireMontantCa3('55')).toBe(5_500);
    expect(lireMontantCa3('-1 000')).toBe(-100_000);
    expect(lireMontantCa3('20 %')).toBeNull();
    expect(lireMontantCa3('283-2')).toBeNull();
    expect(lireMontantCa3('3310-CA3G')).toBeNull();
    expect(lireMontantCa3('12 34')).toBeNull();
  });
});

describe('analyse du texte positionné', () => {
  it('l’ordre des éléments de texte n’a aucune influence (fixtures mélangées)', async () => {
    for (const [serie, a] of [['services', ATTENDUS_CA3.services[1]!], ['services', ATTENDUS_CA3.services[4]!], ['trimestrielle', ATTENDUS_CA3.trimestrielle[0]!]] as const) {
      const pages = await pagesDuPdf(pdfjs as unknown as typeof import('pdfjs-dist'), new Uint8Array(readFileSync(join(DOSSIER_CA3, serie, a.fichier))));
      for (const graine of [1, 2, 3]) {
        const l = analyserCa3(pages.map((p) => ({ ...p, elements: melanger(p.elements, graine) })));
        expect(l.cases, `${a.fichier} graine ${graine}`).toEqual(a.cases);
      }
    }
  });

  it('nombres des libellés ignorés, colonnes base / taxe calibrées sur les en-têtes', () => {
    const l = analyserCa3([
      page([
        ...identification,
        ['A1', 40, 700],
        ['Ventes, prestations de services', 70, 700],
        ['125 000', 525, 700],
        ['A3', 40, 688],
        ['Achats de prestations de services réalisés auprès d’un', 70, 688],
        ['assujetti non établi en France', 70, 677],
        ['(article 283-2 du code général des impôts)', 70, 666],
        ['2 500', 535, 666],
        ['TVA brute', 40, 640],
        ['Base hors taxe', 395, 640],
        ['Taxe due', 505, 640],
        ['08', 40, 625],
        ['Taux normal 20 %', 70, 625],
        ['120 000', 425, 625],
        ['24 000', 528, 625],
        ['T1', 40, 613],
        ['Opérations DOM au taux de 1,75 %', 70, 613],
        ['10', 40, 601],
        ['Taux normal 8,5 %', 70, 601],
        ['27', 40, 589],
        ['Crédit de TVA à reporter (ligne 25 – ligne 26), à reporter ligne 22', 70, 589],
        ['16', 40, 577],
        ['Total de la TVA brute due (lignes 08 à 5B)', 70, 577],
        ['24 000', 528, 577],
      ]),
    ]);
    expect(l.cases).toEqual({ A1: { montant: 12_500_000 }, A3: { montant: 250_000 }, '08': { base: 12_000_000, taxe: 2_400_000 }, '16': { montant: 2_400_000 } });
    expect(l.identification.millesime).toBe('2026');
  });

  it('ligne « dont » sans code : montant non rattaché, signalé en information', async () => {
    const a = ATTENDUS_CA3.services.find((x) => x.fichier.endsWith('202511.pdf'))!;
    const l = await lireFixture('services', a.fichier);
    expect(l.cases['21']).toEqual({ montant: 30_000 });
    expect(l.messages.filter((m) => m.code === 'NON_AFFECTE')).toHaveLength(1);
    expect(l.messages.find((m) => m.code === 'NON_AFFECTE')!.gravite).toBe('information');
  });

  it('millésime inconnu et case inconnue : acceptés avec avertissements', async () => {
    const l = await lireFixture('autres', 'CA3_000888230_millesime_inconnu.pdf');
    expect(l.identification.millesime).toBe('2027');
    expect(l.casesInconnues).toEqual(['W1']);
    expect(l.cases.W1).toEqual({ montant: 123_400 });
    expect(l.messages.map((m) => m.code)).toEqual(expect.arrayContaining(['MILLESIME', 'CASE_INCONNUE']));
  });

  it('PDF scanné : illisible, saisie manuelle proposée', async () => {
    const l = await lireFixture('autres', 'CA3_scan_illisible.pdf');
    expect(l.illisible).toBe(true);
    expect(l.messages[0]!.code).toBe('LECTURE');
  });

  it('déclaration de millésime connu : aucun avertissement de lecture', async () => {
    for (const a of ATTENDUS_CA3.services) {
      const l = await lireFixture('services', a.fichier);
      expect(l.messages.filter((m) => m.gravite !== 'information'), a.fichier).toEqual([]);
    }
  });
});
