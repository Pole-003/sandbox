/**
 * Robustesse de la lecture des CA3 : on déforme les pages réelles des fixtures (PDF pdf-lib et PDF
 * imprimé par Chromium) comme pourraient le faire d'autres producteurs, et la lecture doit rester exacte.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { analyserCa3, type ElementTexte, type PageTexte } from '../../../src/modules/tva/ca3/analyse.ts';
import { pagesDuPdf } from '../../../src/modules/tva/ca3/texte-pdf.ts';
import { ATTENDUS_CA3, DOSSIER_CA3 } from './aides.ts';

const lire = async (chemin: string) => pagesDuPdf(pdfjs as unknown as typeof import('pdfjs-dist'), new Uint8Array(readFileSync(chemin)));
const transformer = (pages: PageTexte[], f: (e: ElementTexte, p: PageTexte) => ElementTexte[]): PageTexte[] => pages.map((p) => ({ ...p, elements: p.elements.flatMap((e) => f(e, p)) }));
const estMontant = (t: string) => /^\d{1,3}([\s ]\d{3})*$/.test(t.trim());

const SOURCES = [
  { nom: 'pdf-lib, variante 1', chemin: join(DOSSIER_CA3, 'services', 'CA3_000777128_202509.pdf'), mois: '202509' },
  { nom: 'pdf-lib, variante 2', chemin: join(DOSSIER_CA3, 'services', 'CA3_000777128_202510.pdf'), mois: '202510' },
  { nom: 'Chromium', chemin: join(DOSSIER_CA3, 'navigateurs', 'CA3_000777128_202602_chromium_tableau.pdf'), mois: '202602' },
];
const attendu = (mois: string) => ATTENDUS_CA3.services.find((a) => a.fichier.includes(mois))!.cases;
const pages = new Map<string, PageTexte[]>();
beforeAll(async () => {
  for (const s of SOURCES) pages.set(s.nom, await lire(s.chemin));
});

describe.each(SOURCES)('déformations de $nom', ({ nom, mois }) => {
  const verifier = (p: PageTexte[]) => {
    const l = analyserCa3(p);
    expect(l.cases).toEqual(attendu(mois));
    return l;
  };

  it('sans en-têtes de colonnes : colonnes déduites des lignes de taux à deux montants', () => {
    verifier(transformer(pages.get(nom)!, (e) => (/^(Base hors taxe|Taxe due)$/.test(e.texte.trim()) ? [] : [e])));
  });

  it('en-têtes « Base HT » et « Montant de la taxe »', () => {
    verifier(transformer(pages.get(nom)!, (e) => [{ ...e, texte: e.texte.trim() === 'Base hors taxe' ? 'Base HT' : e.texte.trim() === 'Taxe due' ? 'Montant de la taxe' : e.texte }]));
  });

  it('montants suivis de « € », milliers en espace fine', () => {
    verifier(transformer(pages.get(nom)!, (e) => [estMontant(e.texte) ? { ...e, texte: `${e.texte.trim().replace(/[\s ]/g, ' ')} €`, largeur: e.largeur * 1.25 } : e]));
  });

  it('texte découpé caractère par caractère', () => {
    verifier(
      transformer(pages.get(nom)!, (e) => {
        const n = e.texte.length;
        return [...e.texte].map((c, i) => ({ ...e, texte: c, x: e.x + (i * e.largeur) / n, largeur: e.largeur / n }));
      }),
    );
  });

  it('échelle réduite (format Lettre, police plus petite) et marge décalée', () => {
    verifier(pages.get(nom)!.map((p) => ({ largeur: p.largeur * 0.9, hauteur: p.hauteur * 0.9, elements: p.elements.map((e) => ({ ...e, x: e.x * 0.9 + 6, y: e.y * 0.9, largeur: e.largeur * 0.9, hauteur: e.hauteur * 0.9 })) })));
  });

  it('pieds de page avec numéro isolé à droite et date / heure', () => {
    const l = verifier(
      pages.get(nom)!.map((p, i) => ({
        ...p,
        elements: [...p.elements, { texte: String(i + 2), x: p.largeur - 40, y: 18, largeur: 5, hauteur: 8 }, { texte: '08/10/2026 17:26', x: 30, y: 18, largeur: 60, hauteur: 8 }],
      })),
    );
    expect(l.casesInconnues).toEqual([]);
  });
});
