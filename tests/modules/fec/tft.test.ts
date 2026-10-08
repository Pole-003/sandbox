import { beforeAll, describe, expect, it } from 'vitest';
import { calculerBalance, type Balance, type LigneBalance } from '../../../src/modules/fec/analyses/balance.ts';
import { calculerChiffresCles } from '../../../src/modules/fec/analyses/chiffres-cles.ts';
import { creerContexte } from '../../../src/modules/fec/analyses/contexte.ts';
import { calculerTft, presentationTft } from '../../../src/modules/fec/analyses/tft.ts';
import { ATTENDUS, importerFichier } from './aides.ts';

let balance: Balance;

beforeAll(async () => {
  const r = await importerFichier(ATTENDUS.fichiers.find((f) => f.categorie === 'propre')!.fichier);
  if (r.statut !== 'termine') throw new Error();
  balance = calculerBalance(creerContexte(r.fec.colonnes, r.fec.meta.exercice!, r.fec.meta.journalAN));
});

/** Balance à partir de [compte, ouverture, débit, crédit] (centimes). */
const balanceDe = (lignes: [string, number, number, number][]): Balance => ({
  comptes: lignes.map(([compteNum, ouverture, debit, credit]): LigneBalance => ({ compteNum, compteLib: `Compte ${compteNum}`, ouverture, debit, credit, cloture: ouverture + debit - credit, nbLignes: 1 })),
  classes: [],
  total: { ouverture: 0, debit: 0, credit: 0, cloture: 0, nbLignes: 0 },
  equilibre: { ouverture: true, mouvements: true, cloture: true },
});

describe('tableau des flux de trésorerie', () => {
  it('FEC propre : la somme des flux est la variation de trésorerie, au centime', () => {
    const t = calculerTft(balance);
    const a = ATTENDUS.totaux.propre.comptes;
    const tresorerie = (k: 'ouverture' | 'cloture') => Object.entries(a).reduce((s, [c, v]) => (c.startsWith('5') && !c.startsWith('59') ? s + v[k] : s), 0);
    expect(t.tresorerieOuverture).toBe(tresorerie('ouverture'));
    expect(t.tresorerieCloture).toBe(tresorerie('cloture'));
    expect(t.variationTresorerie).toBe(429_330_309);
    expect(t.flux.operationnel + t.flux.investissement + t.flux.financement).toBe(t.variationTresorerie);
    expect(t.ecart).toBe(0);
    expect(t.lignes.RN).toBe(calculerChiffresCles(balance).resultat);
    expect(t.lignes.AMO).toBe(2_700_000);
    expect(t.lignes.STK).toBe(-657_800);
    expect(t.lignes.REM).toBe(-2_400_000);
    expect(t.lignes.EMP).toBe(0);
    expect(t.lignes.DIV).toBe(0); // affectation du résultat N-1 en réserves, sans distribution
    expect(t.flux.investissement).toBe(0);
    expect(t.caf).toBe(t.lignes.RN + 2_700_000);
    // Les contributions par compte redonnent chaque ligne.
    for (const [code, montant] of Object.entries(t.lignes)) {
      expect(t.contributions.filter((c) => c.code === code).reduce((s, c) => s + c.montant, 0), code).toBe(montant);
    }
  });

  it('cas complet : cession, acquisition, emprunt, augmentation de capital', () => {
    const t = calculerTft(
      balanceDe([
        ['512000', 1_000, 17_800, 10_500],
        ['215400', 10_000, 3_000, 2_000],
        ['281540', -4_000, 1_500, 1_000],
        ['675000', 0, 500, 0],
        ['775000', 0, 0, 800],
        ['462000', 0, 800, 800],
        ['681100', 0, 1_000, 0],
        ['101300', -7_000, 0, 2_000],
        ['164000', 0, 1_000, 5_000],
        ['706000', 0, 0, 10_000],
        ['411000', 0, 10_000, 7_000],
        ['607000', 0, 4_000, 0],
        ['401000', 0, 3_500, 4_000],
        ['404000', 0, 3_000, 3_000],
      ]),
    );
    expect(t.lignes).toMatchObject({ RN: 5_300, AMO: 1_000, PVC: -300, CLI: -3_000, FRS: 500, ACQ: -3_000, CES: 800, DIM: 0, AIM: 0, CAP: 2_000, EMP: 5_000, REM: -1_000 });
    expect(t.caf).toBe(6_000);
    expect(t.variationBfr).toBe(-2_500);
    expect(t.flux).toEqual({ operationnel: 3_500, investissement: -2_200, financement: 6_000 });
    expect(t.variationTresorerie).toBe(7_300);
    expect(t.ecart).toBe(0);
  });

  it('distribution de dividendes, comptes courants, concours bancaires en trésorerie', () => {
    const t = calculerTft(
      balanceDe([
        // Dividendes payés (3 000), apport en compte courant (1 000), découvert (1 000).
        ['512000', 5_000, 2_000, 3_000],
        ['519000', 0, 0, 1_000],
        ['120000', -4_000, 4_000, 0],
        ['106800', 0, 0, 1_000],
        ['457000', 0, 3_000, 3_000],
        ['455000', -1_000, 0, 1_000],
        ['101300', 0, 0, 0],
      ]),
    );
    expect(t.lignes.DIV).toBe(-3_000);
    expect(t.lignes.CCA).toBe(1_000);
    expect(t.variationTresorerie).toBe(-2_000);
    expect(t.flux.financement).toBe(-2_000);
    expect(t.ecart).toBe(0);
  });

  it('comptes de gestion soldés : le résultat reste en flux opérationnels', () => {
    const t = calculerTft(
      balanceDe([
        ['512000', 0, 1_000, 0],
        ['706000', 0, 1_000, 1_000],
        ['120000', 0, 0, 1_000],
      ]),
    );
    expect(t.gestionSoldee).toBe(true);
    expect(t.lignes.RN).toBe(1_000);
    expect(t.lignes.DIV).toBe(0);
    expect(t.flux.operationnel).toBe(1_000);
    expect(t.ecart).toBe(0);
  });

  it('balance déséquilibrée : écart affiché', () => {
    const t = calculerTft(balanceDe([['512000', 0, 100, 0]]));
    expect(t.variationTresorerie).toBe(100);
    expect(t.ecart).toBe(100);
  });

  it('présentation : sections, sous-totaux et contrôle', () => {
    const p = presentationTft();
    const t = calculerTft(balance);
    const valeur = (cle: string) => p.find((l) => l.cle === cle)!.montant(t);
    expect(p.filter((l) => l.nature === 'section').map((l) => l.libelle)).toEqual([
      'Activités opérationnelles (Operating activities)',
      'Activités d’investissement (Investing activities)',
      'Activités de financement (Financing activities)',
    ]);
    expect(valeur('VAR')).toBe(valeur('DT'));
    expect(valeur('S-operationnel')).toBeNull();
  });
});
