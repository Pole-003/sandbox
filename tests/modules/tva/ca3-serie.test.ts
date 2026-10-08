import { beforeAll, describe, expect, it } from 'vitest';
import { controlerDeclaration, controlerSerie, periodicite, trierParPeriode, tvaCollecteeDeclaree } from '../../../src/modules/tva/ca3/controles.ts';
import { libellePeriode, valeursRetenues, type DeclarationCa3 } from '../../../src/modules/tva/ca3/declaration.ts';
import { ATTENDUS_CA3, lireFixture } from './aides.ts';

async function serie(nom: 'services' | 'trimestrielle'): Promise<DeclarationCa3[]> {
  const liste: DeclarationCa3[] = [];
  for (const a of ATTENDUS_CA3[nom]) {
    const l = await lireFixture(nom, a.fichier);
    liste.push({ id: a.fichier, source: 'pdf', nomFichier: a.fichier, empreinte: null, identification: l.identification, lues: l.cases, corrections: [], messagesLecture: l.messages, casesInconnues: l.casesInconnues, importeLe: '' });
  }
  return liste;
}

let services: DeclarationCa3[];
let trimestrielle: DeclarationCa3[];
beforeAll(async () => {
  services = await serie('services');
  trimestrielle = await serie('trimestrielle');
});

const codes = (l: DeclarationCa3[]) => controlerSerie(l).map((m) => m.code).sort();

describe('contrôles de la série', () => {
  it('série complète des 12 mois, déposée dans le désordre : seul le dépôt tardif est signalé', () => {
    const desordre = [...services].reverse();
    expect(trierParPeriode(desordre).map((d) => libellePeriode(d.identification.debut, d.identification.fin))).toEqual([
      '07/2025', '08/2025', '09/2025', '10/2025', '11/2025', '12/2025', '01/2026', '02/2026', '03/2026', '04/2026', '05/2026', '06/2026',
    ]);
    expect(periodicite(desordre)).toBe('mensuelle');
    expect(codes(desordre)).toEqual(['DEPOT_TARDIF']);
  });

  it('report du crédit : ligne 22 = ligne 27 du mois précédent', () => {
    const sep = services[2]!;
    const oct = services[3]!;
    expect(valeursRetenues(sep)['27']).toEqual({ montant: 1_737_000 });
    expect(valeursRetenues(oct)['22']).toEqual({ montant: 1_737_000 });
    // Report modifié : anomalie sur octobre.
    const modifiee = { ...oct, corrections: [{ code: '22', colonne: 'montant' as const, avant: 1_737_000, apres: 1_700_000, le: '', motif: 'test' }] };
    const m = controlerSerie([sep, modifiee]).find((x) => x.code === 'SERIE_REPORT')!;
    expect(m.message).toContain('10/2025');
    expect(m.declaration).toBe(oct.id);
  });

  it('série incomplète : mois manquant signalé avec ses dates', () => {
    const incomplete = services.filter((_, i) => i !== 4);
    const trou = controlerSerie(incomplete).find((m) => m.code === 'SERIE_TROU')!;
    expect(trou.message).toContain('du 01/11/2025 au 30/11/2025');
    // Le report de crédit n'est plus contrôlé entre deux périodes non consécutives.
    expect(codes(incomplete)).toEqual(['DEPOT_TARDIF', 'SERIE_TROU']);
  });

  it('doublon et SIREN différent', () => {
    expect(codes([...services, services[0]!])).toContain('SERIE_DOUBLON');
    expect(codes([...services, trimestrielle[0]!])).toEqual(expect.arrayContaining(['SERIE_SIREN']));
  });

  it('série trimestrielle détectée, sans anomalie', () => {
    expect(periodicite(trimestrielle)).toBe('trimestrielle');
    expect(trimestrielle.map((d) => libellePeriode(d.identification.debut, d.identification.fin))).toEqual(['T1 2025', 'T2 2025', 'T3 2025', 'T4 2025']);
    expect(codes(trimestrielle)).toEqual([]);
  });

  it('périodicité mixte signalée', () => {
    expect(periodicite([services[0]!, trimestrielle[0]!])).toBe('mixte');
  });
});

describe('contrôles d’une déclaration', () => {
  it('correction tracée : la valeur retenue remplace la valeur lue et lève l’anomalie', () => {
    const fev = services[7]!;
    expect(controlerDeclaration(valeursRetenues(fev)).map((m) => m.code).sort()).toEqual(['L16', 'T9B']);
    const corrigee = { ...fev, corrections: [{ code: '9B', colonne: 'taxe' as const, avant: 50_000, apres: 55_000, le: '2026-10-08T10:00:00Z', motif: 'Erreur de taux' }] };
    expect(valeursRetenues(corrigee)['9B']).toEqual({ base: 550_000, taxe: 55_000 });
    expect(valeursRetenues(fev)['9B']).toEqual({ base: 550_000, taxe: 50_000 });
    expect(controlerDeclaration(valeursRetenues(corrigee)).map((m) => m.code)).toEqual(['L16']);
  });

  it('crédit : 25 = 23 − 16, 27 = 25 − 26, pas de TD', () => {
    expect(controlerDeclaration(valeursRetenues(services[2]!))).toEqual([]);
    expect(controlerDeclaration({ A1: { montant: 500 }, '08': { base: 500, taxe: 100 }, '16': { montant: 100 }, '20': { montant: 300 }, '23': { montant: 300 }, '25': { montant: 200 }, '27': { montant: 150 } }).map((m) => m.code)).toEqual(['L27']);
    expect(controlerDeclaration({ A1: { montant: 1_500 }, '08': { base: 1_500, taxe: 300 }, '16': { montant: 300 }, '20': { montant: 100 }, '23': { montant: 100 }, TD: { montant: 200 }, '25': { montant: 5 }, '28': { montant: 200 }, '32': { montant: 200 } }).map((m) => m.code)).toEqual(['L25', 'L27']);
  });

  it('opérations taxées et bases : avertissement si A1 à B5 ≠ somme des bases', () => {
    const m = controlerDeclaration({ A1: { montant: 1_000_000 }, '08': { base: 900_000, taxe: 180_000 }, '16': { montant: 180_000 }, TD: { montant: 180_000 }, '28': { montant: 180_000 }, '32': { montant: 180_000 } });
    expect(m.map((x) => [x.code, x.gravite])).toEqual([['BASES', 'avertissement']]);
  });

  it('TVA collectée déclarée = somme des taxes des lignes de taux, hors 15 et 5B', () => {
    expect(tvaCollecteeDeclaree({ '08': { base: 1, taxe: 2_000 }, '9B': { base: 1, taxe: 100 }, I1: { base: 1, taxe: 7 }, '15': { montant: 50 }, '5B': { montant: 9 } })).toBe(2_107);
  });
});
