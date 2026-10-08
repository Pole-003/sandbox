import ExcelJS from 'exceljs';
import { beforeAll, describe, expect, it } from 'vitest';
import { calculerBalanceAuxiliaire } from '../../../src/modules/fec/analyses/auxiliaire.ts';
import { calculerBalance, comparerBalances } from '../../../src/modules/fec/analyses/balance.ts';
import { calculerChiffresCles } from '../../../src/modules/fec/analyses/chiffres-cles.ts';
import { creerContexte, type ContexteAnalyse } from '../../../src/modules/fec/analyses/contexte.ts';
import { filtrerGrandLivre } from '../../../src/modules/fec/analyses/grand-livre.ts';
import { calculerStatistiques } from '../../../src/modules/fec/analyses/statistiques.ts';
import {
  classeurBalanceGenerale,
  classeurBalancesAuxiliaires,
  classeurChiffresCles,
  classeurGrandLivre,
  classeurStatistiques,
} from '../../../src/modules/fec/export/analyses-xlsx.ts';
import { octetsClasseur, type Parametres } from '../../../src/modules/fec/export/xlsx.ts';
import { importerFichier } from './aides.ts';

let ctx: ContexteAnalyse;
const parametres: Parametres = {
  dossier: 'Petit Comptoir',
  siren: '000987651',
  exercice: 'du 01/01/2025 au 31/12/2025',
  fichier: '000987651FEC20251231.txt',
  empreinte: 'e'.repeat(64),
  version: '0.0.0',
};

async function relire(wb: ExcelJS.Workbook): Promise<ExcelJS.Workbook> {
  const r = new ExcelJS.Workbook();
  await r.xlsx.load((await octetsClasseur(wb)).buffer as ArrayBuffer);
  return r;
}

beforeAll(async () => {
  const r = await importerFichier('variantes/000987651FEC20251231_standard.txt');
  if (r.statut !== 'termine') throw new Error();
  ctx = creerContexte(r.fec.colonnes, r.fec.meta.exercice!, r.fec.meta.journalAN);
});

describe('exports Excel des analyses', () => {
  it('chiffres clés : SIG en montants numériques, soldes en gras, comparaison N-1, Paramètres', async () => {
    const c = calculerChiffresCles(calculerBalance(ctx));
    const wb = await relire(classeurChiffresCles(ExcelJS, c, c, parametres, { n: calculerBalance(ctx), n1: calculerBalance(ctx) }));
    expect(wb.worksheets.map((w) => w.name)).toEqual(['TCD SIG', 'Données TCD', 'SIG', 'Chiffres clés', 'Paramètres']);
    const sig = wb.getWorksheet('SIG')!;
    expect(sig.getRow(4).values).toEqual([undefined, 'Rubrique', 'Comptes', 'Exercice N', 'Exercice N-1', 'Variation']);
    const derniere = sig.getRow(4 + c.sig.length);
    expect(derniere.getCell(1).value).toBe('= Résultat de l’exercice');
    expect(derniere.getCell(3).value).toBe(c.resultat / 100);
    expect(derniere.getCell(5).value).toBe(0);
    expect(derniere.font?.bold).toBe(true);
    // TCD par compte : le total général est le résultat de l'exercice.
    const tcd = wb.getWorksheet('TCD SIG')!;
    expect(tcd.getCell('A4').value).toBe('Étiquettes de lignes');
    expect(String(tcd.getCell('A5').value)).toMatch(/^01 \+ Ventes de marchandises$/);
    const derniereTcd = tcd.getRow(tcd.actualRowCount);
    expect(derniereTcd.getCell(1).value).toBe('Total général');
    expect(derniereTcd.getCell(2).value).toBeCloseTo(c.resultat / 100, 2);
    expect(derniereTcd.getCell(3).value).toBeCloseTo(c.resultat / 100, 2);
    const cles = wb.getWorksheet('Chiffres clés')!;
    expect(cles.getCell('A5').value).toBe('Chiffre d’affaires (comptes 70)');
    expect(cles.getCell('B5').value).toBe(c.chiffreAffaires / 100);
  });


  it('balance générale : montants numériques, en-tête figé, filtre, total SOUS.TOTAL, onglet Paramètres', async () => {
    const b = calculerBalance(ctx);
    const wb = await relire(classeurBalanceGenerale(ExcelJS, b, comparerBalances(b, b), parametres));
    expect(wb.worksheets.map((w) => w.name)).toEqual(['TCD Balance', 'Données TCD', 'Balance générale', 'Par classe', 'Comparaison N-1', 'Paramètres']);
    const ws = wb.getWorksheet('Balance générale')!;
    expect(ws.getRow(4).getCell(3).value).toBe('Compte');
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 4 });
    expect(ws.autoFilter).toBeTruthy();
    expect(typeof ws.getRow(5).getCell(8).value).toBe('number');
    const total = ws.getRow(5 + b.comptes.length);
    expect(total.getCell(1).value).toBe('Total');
    expect((total.getCell(8).value as { formula: string }).formula).toBe(`SUBTOTAL(9,H5:H${4 + b.comptes.length})`);
    expect(wb.getWorksheet('Paramètres')!.getCell('B5').value).toBe('e'.repeat(64));
  });

  it('balances auxiliaires et âgées, grand-livre, statistiques', async () => {
    const aux = await relire(classeurBalancesAuxiliaires(ExcelJS, [calculerBalanceAuxiliaire(ctx, 'clients'), calculerBalanceAuxiliaire(ctx, 'fournisseurs')], parametres));
    expect(aux.worksheets.map((w) => w.name)).toEqual(['TCD Clients', 'Données Clients', 'TCD Fournisseurs', 'Données Fournisseurs', 'Clients', 'Fournisseurs', 'Paramètres']);
    expect(typeof aux.getWorksheet('Clients')!.getRow(5).getCell(10).value).toBe('number');

    const gl = filtrerGrandLivre(ctx, { compte: '512' });
    const wgl = await relire(classeurGrandLivre(ExcelJS, ctx, gl, 'compte 512', parametres));
    const feuille = wgl.getWorksheet('Grand-livre')!;
    expect(feuille.getRow(5).getCell(3).value).toBeInstanceOf(Date);
    expect(typeof feuille.getRow(5).getCell(14).value).toBe('number');

    const stats = await relire(classeurStatistiques(ExcelJS, ctx, calculerStatistiques(ctx), parametres));
    expect(stats.worksheets.map((w) => w.name).slice(0, 3)).toEqual(['Écritures par journal et mois', 'Indicateurs', 'Benford']);
    expect(stats.worksheets.at(-1)!.name).toBe('Paramètres');
  });
});
