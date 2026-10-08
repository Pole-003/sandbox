import { beforeAll, describe, expect, it } from 'vitest';
import { calculerBalanceAuxiliaire, TRANCHES } from '../../../src/modules/fec/analyses/auxiliaire.ts';
import { calculerBalance, comparerBalances } from '../../../src/modules/fec/analyses/balance.ts';
import { creerContexte, type ContexteAnalyse } from '../../../src/modules/fec/analyses/contexte.ts';
import { filtrerGrandLivre, lignesEcriture } from '../../../src/modules/fec/analyses/grand-livre.ts';
import { calculerStatistiques, ecrituresDuChiffre, libelleGenerique, PARAMETRES_STATISTIQUES, premierChiffre } from '../../../src/modules/fec/analyses/statistiques.ts';
import type { FecImporte } from '../../../src/modules/fec/import/pipeline.ts';
import { ATTENDUS, importerFichier } from './aides.ts';

let fec: FecImporte;
let ctx: ContexteAnalyse;

beforeAll(async () => {
  const r = await importerFichier(ATTENDUS.fichiers.find((f) => f.categorie === 'propre')!.fichier);
  if (r.statut !== 'termine') throw new Error();
  fec = r.fec;
  ctx = creerContexte(fec.colonnes, fec.meta.exercice!, fec.meta.journalAN);
});

const ecrituresDe = (nums: string[]) => nums.map((n) => fec.colonnes.ecriture[Array.from(fec.colonnes.ecritureNum).indexOf(fec.colonnes.textes.indexOf(n))]!);

describe('balance générale du FEC propre', () => {
  it('équilibrée, identique aux totaux du générateur, regroupée par classe et sous-classe', () => {
    const b = calculerBalance(ctx);
    expect(b.equilibre).toEqual({ ouverture: true, mouvements: true, cloture: true });
    const attendu = ATTENDUS.totaux.propre.comptes;
    expect(b.comptes.map((c) => c.compteNum)).toEqual(Object.keys(attendu));
    for (const c of b.comptes) {
      expect({ ouverture: c.ouverture, debit: c.debit, credit: c.credit, cloture: c.cloture }).toEqual({
        ouverture: attendu[c.compteNum]!.ouverture,
        debit: attendu[c.compteNum]!.debit,
        credit: attendu[c.compteNum]!.credit,
        cloture: attendu[c.compteNum]!.cloture,
      });
    }
    const classe4 = b.classes.find((c) => c.code === '4')!;
    expect(classe4.libelle).toBe('Comptes de tiers');
    expect(classe4.sousGroupes.map((s) => s.code)).toEqual(['40', '41', '42', '43', '44', '47', '48']);
    expect(classe4.sousGroupes.find((s) => s.code === '41')!.libelle).toBe('Clients');
    const somme = b.classes.reduce((s, c) => s + c.cloture, 0);
    expect(somme).toBe(0);
    expect(b.total.debit).toBe(b.total.credit);
  });

  it('comparaison N / N-1 : variation en valeur et en %', () => {
    const b = calculerBalance(ctx);
    const c = comparerBalances(b, b);
    expect(c.every((x) => x.variation === 0)).toBe(true);
    const fictif = { ...b, comptes: b.comptes.map((x) => ({ ...x, cloture: x.compteNum === '512100' ? x.cloture / 2 : x.cloture })) };
    const banque = comparerBalances(b, fictif).find((x) => x.compteNum === '512100')!;
    expect(banque.variation).toBe(b.comptes.find((x) => x.compteNum === '512100')!.cloture / 2);
    expect(banque.variationPct).toBeCloseTo(100 * Math.sign(banque.clotureN1!), 6);
  });
});

describe('balance auxiliaire et balance âgée', () => {
  it('soldes par tiers identiques au générateur ; créditeurs et débiteurs anormaux', () => {
    const clients = calculerBalanceAuxiliaire(ctx, 'clients');
    const fournisseurs = calculerBalanceAuxiliaire(ctx, 'fournisseurs');
    const attendu = ATTENDUS.totaux.propre.tiers;
    for (const t of [...clients.tiers, ...fournisseurs.tiers]) {
      if (!attendu[t.cle]) continue;
      expect([t.cle, t.ouverture, t.debit, t.credit, t.cloture]).toEqual([t.cle, attendu[t.cle]!.ouverture, attendu[t.cle]!.debit, attendu[t.cle]!.credit, attendu[t.cle]!.cloture]);
    }
    expect(clients.tiers.filter((t) => t.compAuxNum).length).toBe(150);
    expect(fournisseurs.tiers.filter((t) => t.compAuxNum).length).toBe(80);
    expect(clients.tiers.filter((t) => t.cloture < 0 && t.compAuxNum).map((t) => t.cle)).toEqual(ATTENDUS.faits.clientsCrediteurs);
    expect(fournisseurs.tiers.filter((t) => t.cloture > 0 && t.compAuxNum).map((t) => t.cle)).toEqual(ATTENDUS.faits.fournisseursDebiteurs);
  });

  it('balance âgée : tranches cohérentes, non lettré ventilé intégralement', () => {
    const clients = calculerBalanceAuxiliaire(ctx, 'clients');
    expect(clients.total.agee).toHaveLength(TRANCHES.length);
    for (const t of clients.tiers) expect(t.agee.reduce((a, b) => a + b, 0)).toBe(t.nonLettre);
    // Factures litigieuses de N-1 restées impayées : présentes dans les tranches anciennes.
    expect(clients.total.agee[0]!).toBeGreaterThan(0);
    expect(clients.total.agee.slice(3).some((v) => v !== 0)).toBe(true);
  });
});

describe('grand-livre', () => {
  it('filtre par compte avec solde progressif égal au solde de clôture', () => {
    const gl = filtrerGrandLivre(ctx, { compte: '512300' });
    expect(gl.lignes.length).toBeGreaterThan(0);
    expect(gl.soldes[gl.soldes.length - 1]).toBe(0);
    const f = fec.colonnes;
    expect(Array.from(gl.lignes).every((i) => f.textes[f.compteNum[i]!] === '512300')).toBe(true);
    const tout = filtrerGrandLivre(ctx, {});
    expect(tout.lignes.length).toBe(f.nbLignes);
    expect(tout.totalDebit).toBe(tout.totalCredit);
  });

  it('filtres combinés : auxiliaire, journal, période, montant, libellé, lettrage', () => {
    const f = fec.colonnes;
    const gl = filtrerGrandLivre(ctx, { auxiliaire: 'C0001', journal: 'VT', du: '2025-09-01', au: '2025-12-31', montantMin: 10_000, libelle: 'facture', lettrage: 'non-lettre' });
    for (const i of gl.lignes) {
      expect(f.textes[f.compAuxNum[i]!]).toBe('C0001');
      expect(f.textes[f.journalCode[i]!]).toBe('VT');
      expect(f.ecritureDate[i]!).toBeGreaterThanOrEqual(20250901);
      expect(f.ecritureDate[i]!).toBeLessThanOrEqual(20251231);
      expect(f.debit[i]! || f.credit[i]!).toBeGreaterThanOrEqual(10_000);
      expect(f.ecritureLet[i]).toBe(0);
    }
    const parLibelle = filtrerGrandLivre(ctx, { libelle: 'REGULARISATION CHIFFRE' });
    expect(parLibelle.lignes.length).toBe(3);
  });

  it('écriture complète : toutes ses lignes, équilibrées', () => {
    const e = fec.colonnes.ecriture[100]!;
    const lignes = lignesEcriture(ctx, e);
    expect(lignes.length).toBeGreaterThanOrEqual(2);
    expect(Array.from(lignes).reduce((s, i) => s + fec.colonnes.debit[i]! - fec.colonnes.credit[i]!, 0)).toBe(0);
    expect(Array.from(lignes).every((i) => fec.colonnes.ecriture[i] === e)).toBe(true);
  });
});

describe('statistiques et tests d’écritures', () => {
  it('retrouvent les pistes volontaires du FEC propre', () => {
    const s = calculerStatistiques(ctx);
    const ind = (id: string) => s.indicateurs.find((x) => x.id === id)!.ecritures;
    expect(ind('week-end')).toEqual(ecrituresDe(ATTENDUS.pistes['week-end']!));
    expect(ind('jour-ferie')).toEqual(ecrituresDe(ATTENDUS.pistes['jour-ferie']!));
    expect(ind('validee-apres-cloture')).toEqual(ecrituresDe(ATTENDUS.pistes['validee-apres-cloture']!));
    expect(ind('datee-apres-cloture')).toEqual([]);
    expect(ind('od-tresorerie')).toEqual(ecrituresDe(ATTENDUS.pistes['od-tresorerie']!));
    // Régularisation volontaire de CA et écriture d'inventaire « Factures à établir » (OD sur 707).
    const fae = fec.colonnes.ecriture[Array.from(fec.colonnes.pieceRef).indexOf(fec.colonnes.textes.indexOf('INV-FAE'))]!;
    expect(ind('od-chiffre-affaires')).toEqual([...ecrituresDe(ATTENDUS.pistes['od-chiffre-affaires']!), fae]);
    expect(ind('libelle-generique')).toEqual(ecrituresDe(ATTENDUS.pistes['libelle-generique']!));
    expect(ind('doublon-probable')).toEqual(expect.arrayContaining(ecrituresDe(ATTENDUS.pistes['doublon-probable']!)));
    expect(ind('montants-ronds')).toEqual(expect.arrayContaining(ecrituresDe([...ATTENDUS.pistes['od-chiffre-affaires']!, '7956'])));
    // Fin de période : dans la fenêtre de 5 jours autour de la clôture et au-dessus du 99e centile.
    const f = fec.colonnes;
    expect(ind('fin-periode').length).toBeGreaterThan(0);
    for (const e of ind('fin-periode')) {
      const lignes = Array.from(f.ecriture.keys()).filter((i) => f.ecriture[i] === e);
      expect(f.ecritureDate[lignes[0]!]!).toBeGreaterThanOrEqual(20260625);
      expect(lignes.reduce((t, i) => t + f.debit[i]!, 0)).toBeGreaterThanOrEqual(s.seuilFinPeriode);
    }
    const abaisse = calculerStatistiques(ctx, { ...PARAMETRES_STATISTIQUES, seuilFinPeriode: 1_000_000 });
    expect(abaisse.indicateurs.find((x) => x.id === 'fin-periode')!.ecritures).toEqual(expect.arrayContaining(ecrituresDe(ATTENDUS.pistes['od-chiffre-affaires']!)));
  });

  it('écritures par journal et par mois : total égal au nombre d’écritures', () => {
    const s = calculerStatistiques(ctx);
    expect(s.journaux).toEqual(['AC', 'AN', 'BQ1', 'BQ2', 'OD', 'VT']);
    expect(s.mois).toHaveLength(12);
    expect(s.ecrituresParJournalMois.flat().reduce((a, b) => a + b, 0)).toBe(fec.colonnes.nbEcritures);
  });

  it('loi de Benford : effectifs, écart absolu moyen et appréciation', () => {
    const { benford } = calculerStatistiques(ctx);
    expect(benford.total).toBeGreaterThan(10_000);
    expect(benford.observes.reduce((a, b) => a + b, 0)).toBe(benford.total);
    expect(benford.attendues.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    // Montants fictifs tirés entre 80 € et 25 000 € et nombreux montants fixes : écart réel mais modéré.
    expect(benford.mad).toBeLessThan(0.02);
    expect(['proche', 'acceptable', 'marginale']).toContain(benford.conformite);
    expect(ecrituresDuChiffre(ctx, 1).length).toBeGreaterThan(ecrituresDuChiffre(ctx, 9).length);
  });

  it('outils : premier chiffre et libellés génériques', () => {
    expect(premierChiffre(123456)).toBe(1);
    expect(premierChiffre(9_00)).toBe(9);
    expect(libelleGenerique('Divers')).toBe(true);
    expect(libelleGenerique(' Régul ')).toBe(true);
    expect(libelleGenerique('Facture FA2500001')).toBe(false);
  });
});
