import { beforeAll, describe, expect, it } from 'vitest';
import type { DonneesTvaFec } from '../../../src/modules/fec/interface-tva.ts';
import type { IdentificationCa3, ValeurCase } from '../../../src/modules/tva/ca3/analyse.ts';
import { recapitulatifG300 } from '../../../src/modules/tva/cadrage/g300.ts';
import { calculerG340 } from '../../../src/modules/tva/cadrage/g340.ts';
import { cadrageMensuel, controlesComplementaires, type DeclarationRetenue } from '../../../src/modules/tva/cadrage/mensuel.ts';
import { parametresParDefaut } from '../../../src/modules/tva/cadrage/parametres.ts';
import { ATTENDUS_TVA, donneesTva, ventilationExacte } from './aides-cadrage.ts';
import { ATTENDUS_CA3, lireFixture } from './aides.ts';

let conforme: DonneesTvaFec;
let cutoff: DonneesTvaFec;
let declarations: DeclarationRetenue[];
beforeAll(async () => {
  conforme = await donneesTva('conforme');
  cutoff = await donneesTva('cutoff');
  declarations = [];
  for (const a of ATTENDUS_CA3.services) {
    const l = await lireFixture('services', a.fichier);
    declarations.push({ identification: l.identification, valeurs: l.cases });
  }
});
const exercice = { debut: '2025-07-01', fin: '2026-06-30' };

describe('récapitulatif G300', () => {
  it('cases servies dans l’ordre du modèle, total annuel, TVA collectée déclarée', () => {
    const r = recapitulatifG300(declarations.map((d) => d.valeurs));
    expect(r.map((l) => `${l.code}${l.colonne === 'base' ? 'b' : l.colonne === 'taxe' ? 't' : ''}`)).toEqual(['A1', 'E2', 'A3', '08b', '08t', '9Bb', '9Bt', 'COLLECTEE', '16', '19', '20', '21', '22', '23', '25', 'TD', '27', '28', '32']);
    const t = Object.fromEntries(r.map((l) => [`${l.code}${l.colonne ?? ''}`, l.total]));
    expect(t.A1montant).toBe(114_075_000);
    expect(t['08base']).toBe(110_595_000);
    expect(t.COLLECTEE).toBe(ATTENDUS_TVA.conforme.tvaCollecteeDeclaree);
    expect(t['16montant']).toBe(22_619_000);
    expect(t['22montant']).toBe(1_768_000);
    expect(r.find((l) => l.code === 'TD')!.valeurs[2]).toBeNull();
  });

  it('cases inconnues et 22A (pourcentage, sans total)', () => {
    const r = recapitulatifG300([{ A1: { montant: 100 }, '22A': { montant: 8_500 }, W1: { montant: 5 } }]);
    expect(r.find((l) => l.code === '22A')!.total).toBeNull();
    expect(r.at(-1)).toMatchObject({ code: 'W1', total: 5 });
  });
});

describe('cadrage mensuel et contrôles complémentaires', () => {
  it('par période : TVA déclarée et TVA comptabilisée au crédit des 4457 identiques sauf février (−50 €)', () => {
    const m = cadrageMensuel(exercice, declarations, conforme.mouvementsMensuels(['4457']), conforme.mouvementsMensuels(['70']), conforme.mouvementsMensuels(['4452']));
    expect(m).toHaveLength(12);
    expect(m.map((x) => x.tva4457)).toEqual(Object.values(ATTENDUS_TVA.conforme.tva4457ParMois));
    const ecarts = m.filter((x) => x.ecartTva !== 0).map((x) => [x.periode, x.ecartTva]);
    // Février : 9B déclarée 500 au lieu de 550. La TVA autoliquidée (A3, 4452) est rapprochée à part.
    expect(ecarts).toEqual([['02/2026', -5_000]]);
    expect(m.filter((x) => x.tvaAutoliquidee).map((x) => [x.periode, x.tvaAutoliquidee])).toEqual([
      ['10/2025', 50_000],
      ['03/2026', 64_000],
    ]);
    expect(m[0]!.dateDepot).toBe('2025-08-15');
  });

  it('cut-off : écart de 2 000 € en juin entre TVA déclarée et TVA comptabilisée', () => {
    const m = cadrageMensuel(exercice, declarations, cutoff.mouvementsMensuels(['4457']), cutoff.mouvementsMensuels(['70']));
    expect(m.find((x) => x.periode === '06/2026')!.ecartTva).toBe(200_000);
  });

  it('série incomplète : mois non déclaré présenté à part', () => {
    const m = cadrageMensuel(exercice, declarations.filter((_, i) => i !== 3), conforme.mouvementsMensuels(['4457']), conforme.mouvementsMensuels(['70']));
    expect(m.find((x) => x.mois[0] === '2025-10')).toMatchObject({ periode: '10/2025 (non déclaré)', tvaDeclaree: null, tva4457: 2_046_000 });
  });

  it('trimestrielle : une ligne par trimestre, sommes des trois mois', () => {
    const id = (debut: string, fin: string): IdentificationCa3 => ({ denomination: null, siren: null, debut, fin, dateLimite: null, dateDepot: null, dateCreation: null, millesime: null });
    const v: Record<string, ValeurCase> = { '08': { base: 100, taxe: 20 } };
    const m = cadrageMensuel({ debut: '2025-07-01', fin: '2025-12-31' }, [{ identification: id('2025-07-01', '2025-09-30'), valeurs: v }, { identification: id('2025-10-01', '2025-12-31'), valeurs: v }], conforme.mouvementsMensuels(['4457']), conforme.mouvementsMensuels(['70']));
    expect(m.map((x) => [x.periode, x.mois.length])).toEqual([
      ['T3 2025', 3],
      ['T4 2025', 3],
    ]);
    const t = ATTENDUS_TVA.conforme.tva4457ParMois;
    expect(m[0]!.tva4457).toBe(t['2025-07']! + t['2025-08']! + t['2025-09']!);
  });

  it('contrôles 4455, 44567 et TVA des encours', () => {
    const p = parametresParDefaut();
    p.ventilation = { methode: 'manuelle', manuelle: ventilationExacte(ATTENDUS_TVA.conforme) };
    const g = calculerG340({ observations: conforme.observerVentes({ produits: ['70'], tva: p.prefixesTva, clients: ['41'] }), comptes: conforme.comptes(), comptesN1: null, declarations: declarations.map((d) => d.valeurs), parametres: p });
    const c = Object.fromEntries(controlesComplementaires(conforme.comptes(), declarations, g, p, exercice.fin).map((x) => [x.cle, x]));
    expect(c['4455-solde']).toMatchObject({ comptable: ATTENDUS_TVA.conforme.solde4455, declare: 1_901_000, ecart: 0 });
    // Crédits 4455 = lignes 28 (février : 15 030 déclarés et liquidés tels quels).
    expect(c['4455-mouvements']!.ecart).toBe(0);
    expect(c['44567']).toMatchObject({ comptable: 0, declare: 0, ecart: 0 });
    // TVA des encours N (19 000 + 500 + 1 000) ; solde 4457 + 44587 = 20 550 (50 € de février non liquidés).
    expect(c['4457-encours']).toMatchObject({ declare: 2_050_000, comptable: 2_055_000, ecart: 5_000 });
  });
});
