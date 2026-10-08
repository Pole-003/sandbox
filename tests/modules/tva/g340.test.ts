import { beforeAll, describe, expect, it } from 'vitest';
import type { DonneesTvaFec } from '../../../src/modules/fec/interface-tva.ts';
import type { ValeurCase } from '../../../src/modules/tva/ca3/analyse.ts';
import { calculerG340, lignesVentes } from '../../../src/modules/tva/cadrage/g340.ts';
import { indiceLibelle, parametresParDefaut, type ParametresCadrage } from '../../../src/modules/tva/cadrage/parametres.ts';
import { ATTENDUS_TVA, declarationsServices, donneesTva, ventilationExacte } from './aides-cadrage.ts';

let conforme: DonneesTvaFec;
let cutoff: DonneesTvaFec;
let declarations: Record<string, ValeurCase>[];
beforeAll(async () => {
  conforme = await donneesTva('conforme');
  cutoff = await donneesTva('cutoff');
  declarations = (await declarationsServices()).map((d) => d.valeurs);
});

const parametres = (exacte: boolean, variante: 'conforme' | 'cutoff' = 'conforme'): ParametresCadrage => {
  const p = parametresParDefaut();
  if (exacte) p.ventilation = { methode: 'manuelle', manuelle: ventilationExacte(ATTENDUS_TVA[variante]) };
  return p;
};
const entree = (d: DonneesTvaFec, p: ParametresCadrage, decl = declarations) => ({
  observations: d.observerVentes({ produits: p.prefixesProduits, tva: p.prefixesTva, clients: ['41'] }),
  comptes: d.comptes(),
  comptesN1: null,
  declarations: decl,
  parametres: p,
});
/** Février corrigé : taxe 9B 550 au lieu de 500 (correction tracée dans l'écran). */
const corrigees = () => declarations.map((v, i) => (i === 7 ? { ...v, '9B': { base: v['9B']!.base!, taxe: 55_000 } } : v));

describe('chiffre d’affaires et taux proposés', () => {
  it('taux observé dans les écritures (706100 à 20 %, 706200 à 10 %), autoliquidation d’après les ventes sans TVA et le libellé', () => {
    const p = parametresParDefaut();
    const l = lignesVentes(conforme.observerVentes({ produits: ['70'], tva: p.prefixesTva, clients: ['41'] }), p);
    const a = ATTENDUS_TVA.conforme;
    expect(l.map((x) => [x.compteNum, x.taux, x.nature, x.caseCa3, x.source])).toEqual([
      ['706100', 2000, 'imposable', '08', 'observe'],
      ['706200', 1000, 'imposable', '9B', 'observe'],
      ['706300', null, 'autoliquidation', 'E2', 'observe'],
    ]);
    expect(l[0]!.ca).toBe(a.caParTaux['2000']);
    expect(l[0]!.exonere).toBe(0);
    expect(l[0]!.imposable).toBe(a.caParTaux['2000']);
    expect(l[1]!.ca).toBe(a.caParTaux['1000']);
    expect(l[2]!.ca).toBe(a.caParTaux['0']);
    expect(l[2]!.exonere).toBe(a.caParTaux['0']);
    expect(l[2]!.pctSoumis).toBe(0);
    // Le PCA et l'extourne de FAE (écritures sans client) ne sont pas pris pour des ventes exonérées.
    expect(l[0]!.observation.autres).toBe(-200_000);
    expect(l.reduce((s, x) => s + x.tva, 0)).toBe(a.tvaSurCa);
  });

  it('saisie prioritaire, compte vendu à plusieurs taux réparti, indices de libellé', () => {
    const p = parametresParDefaut();
    p.comptes['706200'] = { taux: 550 };
    const obs = conforme.observerVentes({ produits: ['70'], tva: p.prefixesTva, clients: ['41'] });
    expect(lignesVentes(obs, p).find((x) => x.compteNum === '706200')).toMatchObject({ taux: 550, source: 'saisie', caseCa3: '09' });
    const mixte = lignesVentes([{ compteNum: '706000', compteLib: 'Ventes', ca: 1_000_000, parTaux: { 2000: 800_000, 1000: 200_000 }, sansTva: 0, tauxInconnu: 0, autres: 0, nbEcrituresVente: 10 }], p);
    expect(mixte.map((x) => [x.cle, x.imposable, x.tva])).toEqual([
      ['706000@2000', 800_000, 160_000],
      ['706000@1000', 200_000, 20_000],
    ]);
    const sansEcriture = (lib: string) => lignesVentes([{ compteNum: '708000', compteLib: lib, ca: 100_000, parTaux: {}, sansTva: 0, tauxInconnu: 0, autres: 100_000, nbEcrituresVente: 0 }], p)[0]!;
    expect(sansEcriture('Produits annexes 5,5 %')).toMatchObject({ taux: 550, source: 'libelle' });
    expect(sansEcriture('Ventes EXPORT')).toMatchObject({ nature: 'exportation', caseCa3: 'E1', tva: 0 });
    expect(sansEcriture('Divers')).toMatchObject({ source: 'a-saisir', tva: 0 });
    expect(indiceLibelle('Prestations 2024')).toBeNull();
    expect(indiceLibelle('Ventes 20%')).toEqual({ taux: 2000, nature: 'imposable' });
    expect(indiceLibelle('Prestations AUTO-LIQ')).toEqual({ taux: 0, nature: 'autoliquidation' });
  });
});

describe('TVA théorique (régime des encaissements)', () => {
  it('cas sans écart : avec février corrigé, la TVA théorique égale la TVA déclarée au centime', () => {
    const g = calculerG340(entree(conforme, parametres(true), corrigees()));
    expect(g.tvaTheorique).toBe(ATTENDUS_TVA.conforme.tvaTheorique);
    expect(g.tvaDeclaree).toBe(ATTENDUS_TVA.conforme.tvaTheorique);
    expect(g.ecart).toBe(0);
    expect(g.avertissements).toEqual([]);
  });

  it('écart de déclaration : février déclaré 500 au lieu de 550 en 9B, écart de +50 €', () => {
    const p = parametres(true);
    const g = calculerG340(entree(conforme, p));
    expect(g.tvaDeclaree).toBe(ATTENDUS_TVA.conforme.tvaCollecteeDeclaree);
    expect(g.ecart).toBe(5_000);
    expect(g.residuel).toBe(5_000);
    p.justifications = [{ id: '1', libelle: 'Écart de déclaration du mois de février', montant: 5_000, commentaire: '9B : 500 au lieu de 550', piece: 'CA3 02/2026' }];
    const j = calculerG340(entree(conforme, p));
    expect([j.justifie, j.residuel]).toEqual([5_000, 0]);
  });

  it('écart de cut-off : encaissement du 30/06 comptabilisé en N+1, TVA théorique inférieure de 2 000 €', () => {
    const g = calculerG340(entree(cutoff, parametres(true, 'cutoff'), corrigees()));
    expect(g.tvaTheorique).toBe(ATTENDUS_TVA.cutoff.tvaTheorique);
    expect(g.ecart).toBe(-200_000);
    expect(g.residuel).toBe(-200_000);
  });

  it('régularisations : encours N-1 / N, FAE, PCA, pertes, autoliquidation', () => {
    const a = ATTENDUS_TVA.conforme;
    const g = calculerG340(entree(conforme, parametres(true), corrigees()));
    const r = Object.fromEntries(g.regularisations.map((x) => [x.cle, x]));
    expect(Object.keys(r)).toEqual(['clients', 'douteux', 'fae', 'pca', 'pertes', 'autoliquidation']);
    expect(r.clients!.n1).toBe(Object.values(a.encours.clientsN1!).reduce((s, v) => s + v, 0));
    expect(r.clients!.n).toBe(Object.values(a.encours.clientsN!).reduce((s, v) => s + v, 0));
    expect(r.clients!.sourceN1).toBe('an');
    expect(r.clients!.tva).toBe(1_680_000 + 60_000 - 1_900_000 - 50_000);
    expect(r.douteux!.tva).toBe(20_000);
    expect(r.fae!.tva).toBe(60_000 - 100_000);
    expect(r.pca!.tva).toBe(40_000);
    expect(r.pertes!.tva).toBe(-20_000);
    expect(r.autoliquidation!.tva).toBe(a.autoliquidationAchats);
    // Synthèse : base théorique encaissée à 20 % = base déclarée en 08 (A1 à 20 % + A3 autoliquidé).
    const s20 = g.syntheseParTaux.find((s) => s.taux === 2000)!;
    expect(s20.caseCa3).toBe('08');
    expect(s20.aDeclarer).toBe(s20.taxeDeclaree);
    expect(s20.baseTheorique).toBe(s20.baseDeclaree);
    const e2 = g.syntheseParTaux.find((s) => s.caseCa3 === 'E2')!;
    expect(e2.ventes).toBe(a.caParTaux['0']);
    expect(e2.baseDeclaree).toBe(6_150_000);
    // Base encaissée non imposable = ventes 56 500 + clients N-1 12 000 − clients N 7 000 = base déclarée en E2.
    expect(e2.baseTheorique).toBe(e2.baseDeclaree);
  });

  it('ventilation au prorata par défaut : méthode affichée, écart d’approximation limité et expliqué', () => {
    const g = calculerG340(entree(conforme, parametres(false), corrigees()));
    expect(g.ventilation.methode).toBe('prorata');
    expect(g.ventilation.description).toMatch(/au prorata du chiffre d'affaires TTC de chaque taux \(20 % : [\d,]+ %, non imposable : [\d,]+ %, 10 % : [\d,]+ %\)/);
    // Les encours N-1 et N n'ont pas exactement la répartition du CA : écart de quelques centaines d'euros.
    expect(Math.abs(g.ecart)).toBeLessThan(100_000);
    expect(g.ecart).not.toBe(0);
  });

  it('soldes N-1 saisis prioritaires, régime des débits sans régularisation des encours', () => {
    const p = parametres(true);
    p.soldesN1.clients = { montant: 0, source: 'saisie' };
    const g = calculerG340(entree(conforme, p, corrigees()));
    expect(g.regularisations.find((x) => x.cle === 'clients')!.sourceN1).toBe('saisie');
    expect(g.ecart).toBe(-1_740_000);
    const d = parametres(false);
    d.regime = 'debits';
    const gd = calculerG340(entree(conforme, d, corrigees()));
    expect(gd.regularisations.map((x) => x.cle)).toEqual(['autoliquidation']);
    expect(gd.tvaTheorique).toBe(ATTENDUS_TVA.conforme.tvaSurCa + ATTENDUS_TVA.conforme.autoliquidationAchats);
  });
});
