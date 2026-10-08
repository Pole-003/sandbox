import { beforeAll, describe, expect, it } from 'vitest';
import { calculerBalance, type Balance, type LigneBalance } from '../../../src/modules/fec/analyses/balance.ts';
import { calculerChiffresCles } from '../../../src/modules/fec/analyses/chiffres-cles.ts';
import { creerContexte } from '../../../src/modules/fec/analyses/contexte.ts';
import { ATTENDUS, importerFichier } from './aides.ts';

let balance: Balance;

beforeAll(async () => {
  const r = await importerFichier(ATTENDUS.fichiers.find((f) => f.categorie === 'propre')!.fichier);
  if (r.statut !== 'termine') throw new Error();
  balance = calculerBalance(creerContexte(r.fec.colonnes, r.fec.meta.exercice!, r.fec.meta.journalAN));
});

/** Balance minimale à partir de soldes de clôture (débit positif). */
const balanceDe = (soldes: Record<string, number>, mouvements = true): Balance => ({
  comptes: Object.entries(soldes).map(
    ([compteNum, cloture]): LigneBalance => ({ compteNum, compteLib: compteNum, ouverture: 0, debit: mouvements ? Math.max(cloture, 0) + 100 : 0, credit: mouvements ? Math.max(-cloture, 0) + 100 : 0, cloture, nbLignes: 2 }),
  ),
  classes: [],
  total: { ouverture: 0, debit: 0, credit: 0, cloture: 0, nbLignes: 0 },
  equilibre: { ouverture: true, mouvements: true, cloture: true },
});

describe('chiffres clés et SIG', () => {
  it('FEC propre : chiffres identiques aux totaux du générateur', () => {
    const t = ATTENDUS.totaux.propre.comptes;
    const somme = (f: (c: string) => boolean) => Object.entries(t).reduce((s, [c, v]) => (f(c) ? s + v.cloture : s), 0);
    const c = calculerChiffresCles(balance);
    const produits = -somme((x) => x.startsWith('7'));
    const charges = somme((x) => x.startsWith('6'));
    expect(c.chiffreAffaires).toBe(-somme((x) => x.startsWith('70')));
    expect(c.chiffreAffaires).toBe(1_250_263_856);
    expect(c.totalProduits).toBe(produits);
    expect(c.totalCharges).toBe(charges);
    expect(c.resultat).toBe(produits - charges);
    expect(c.gestionSoldee).toBe(false);
    expect(c.resultatCompte12).toBeNull();
    const sig = Object.fromEntries(c.sig.map((l) => [l.code, l.montant]));
    expect(sig.CAMV).toBe(t['607000']!.cloture + t['603700']!.cloture);
    expect(sig.MC).toBe(c.chiffreAffaires - sig.CAMV!);
    expect(sig.CP).toBe(t['641100']!.cloture + t['645100']!.cloture);
    expect(sig.CF).toBe(t['661100']!.cloture);
    expect(sig.RF).toBe(-t['661100']!.cloture);
    expect(sig.EBE).toBe(sig.VA! - sig.CP!);
    expect(sig.RN).toBe(c.resultat);
    expect(sig.NC).toBeUndefined();
  });

  it('les SIG aboutissent au résultat, comptes non classés compris', () => {
    const c = calculerChiffresCles(
      balanceDe({ '706000': -100_000, '707000': -50_000, '7097': 1_000, '607000': 20_000, '6037': -2_000, '601': 5_000, '622': 3_000, '74': -4_000, '63': 1_500, '64': 30_000, '681': 2_000, '781': -500, '76': -700, '66': 900, '77': -300, '67': 200, '695': 6_000, '731': -10, '68': 99 }),
    );
    const sig = Object.fromEntries(c.sig.map((l) => [l.code, l.montant]));
    expect(c.chiffreAffaires).toBe(149_000);
    expect(sig.VM).toBe(49_000);
    expect(sig.CAMV).toBe(18_000);
    expect(sig.MC).toBe(31_000);
    expect(sig.PV).toBe(100_000);
    expect(sig.PI).toBe(10);
    expect(sig.CT).toBe(8_000);
    expect(sig.VA).toBe(31_000 + 100_010 - 8_000);
    expect(sig.EBE).toBe(123_010 + 4_000 - 1_500 - 30_000);
    expect(sig.RE).toBe(95_510 + 500 - 2_000);
    expect(sig.RF).toBe(-200);
    expect(sig.RX).toBe(100);
    expect(sig.NC).toBe(-99); // compte 68 sans sous-compte 681/686/687
    expect(sig.RN).toBe(c.totalProduits - c.totalCharges);
    expect(c.resultat).toBe(sig.RN);
    expect(sig.RCAI! + sig.RX! - sig.IS! + sig.NC!).toBe(sig.RN);
  });

  it('perte : résultat négatif', () => {
    expect(calculerChiffresCles(balanceDe({ '706': -1_000, '64': 3_000 })).resultat).toBe(-2_000);
  });

  it('comptes de gestion soldés : résultat lu au compte 12', () => {
    const c = calculerChiffresCles(balanceDe({ '706': 0, '607': 0, '120000': -12_345 }));
    expect(c.gestionSoldee).toBe(true);
    expect(c.resultat).toBe(12_345);
    expect(c.resultatCompte12).toBe(12_345);
  });

  it('compte 12 non soldé à côté des comptes de gestion : signalé, sans changer le résultat', () => {
    const c = calculerChiffresCles(balanceDe({ '706': -5_000, '120000': -800 }));
    expect(c.gestionSoldee).toBe(false);
    expect(c.resultat).toBe(5_000);
    expect(c.resultatCompte12).toBe(800);
  });
});
