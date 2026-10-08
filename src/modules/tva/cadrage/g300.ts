/**
 * Récapitulatif annuel des montants déclarés (feuille G300) : une colonne par déclaration de l'exercice et
 * un total ; seules les cases servies au moins une fois dans l'année sont présentées, dans l'ordre :
 * opérations (A1, A2, E1, E2, F2 et autres cases servies), base et taxe de chaque taux servi, TVA collectée
 * déclarée, lignes 15 et 5B (présentées à part), 16, TVA déductible (19, 20, 21, 22, 2C, 23), puis 25, TD,
 * 27, 28, 32 et les autres cases servies.
 */
import { CASES_CA3, CASES_PAR_CODE } from '../ca3-cases.ts';
import type { ValeurCase } from '../ca3/analyse.ts';
import { tvaCollecteeDeclaree } from '../ca3/controles.ts';
import type { Colonne } from '../ca3/declaration.ts';

export type BlocG300 = 'operations' | 'taux' | 'collectee' | 'brute' | 'deductible' | 'solde';

export interface LigneG300 {
  /** Code de case, ou « COLLECTEE » pour la ligne calculée. */
  code: string;
  libelle: string;
  colonne: Colonne | null;
  bloc: BlocG300;
  valeurs: (number | null)[];
  total: number | null;
}

export const TITRES_BLOCS: Record<BlocG300, string> = {
  operations: 'Montant des opérations réalisées (HT)',
  taux: 'TVA brute par taux (base hors taxe et taxe due)',
  collectee: 'TVA collectée déclarée',
  brute: 'Autres éléments de TVA brute',
  deductible: 'TVA déductible',
  solde: 'TVA due, crédit et montant à payer',
};

const PREMIERES_OPERATIONS = ['A1', 'A2', 'E1', 'E2', 'F2'];
const BRUTE = ['15', '5B', '16'];
const DEDUCTIBLE = ['19', '20', '21', '22', '2C', '23'];
const SOLDE = ['25', 'TD', '27', '28', '32'];

export function recapitulatifG300(declarations: Record<string, ValeurCase>[]): LigneG300[] {
  const servie = (code: string, colonne?: Colonne) => declarations.some((v) => (colonne ? v[code]?.[colonne] !== undefined : v[code] !== undefined));
  const ligne = (code: string, colonne: Colonne, bloc: BlocG300): LigneG300 => {
    const def = CASES_PAR_CODE.get(code);
    const valeurs = declarations.map((v) => v[code]?.[colonne] ?? null);
    const libelle = `${def?.libelle ?? 'Case inconnue'}${colonne === 'base' ? ' — base hors taxe' : colonne === 'taxe' ? ' — taxe due' : ''}`;
    return { code, libelle, colonne, bloc, valeurs, total: def?.pourcentage ? null : valeurs.reduce<number>((s, x) => s + (x ?? 0), 0) };
  };
  const lignes: LigneG300[] = [];
  const operations = [...PREMIERES_OPERATIONS, ...CASES_CA3.filter((c) => c.section === 'operations' && !PREMIERES_OPERATIONS.includes(c.code)).map((c) => c.code)];
  for (const code of operations) if (servie(code)) lignes.push(ligne(code, 'montant', 'operations'));
  for (const c of CASES_CA3.filter((x) => x.collectee)) {
    if (!servie(c.code)) continue;
    lignes.push(ligne(c.code, 'base', 'taux'), ligne(c.code, 'taxe', 'taux'));
  }
  const collectee = declarations.map(tvaCollecteeDeclaree);
  lignes.push({ code: 'COLLECTEE', libelle: 'TVA collectée déclarée (taxes des lignes 08 à 13, T1 à TC, P1, P2, I1 à I6)', colonne: null, bloc: 'collectee', valeurs: collectee, total: collectee.reduce((a, b) => a + b, 0) });
  for (const code of BRUTE) if (servie(code)) lignes.push(ligne(code, 'montant', 'brute'));
  for (const code of DEDUCTIBLE) if (servie(code)) lignes.push(ligne(code, 'montant', 'deductible'));
  for (const code of SOLDE) if (servie(code)) lignes.push(ligne(code, 'montant', 'solde'));
  // Autres cases servies (17, 18, 22A, 24, 2E, accise, 26, 29…) et cases inconnues, en fin de tableau.
  const deja = new Set(lignes.map((l) => l.code));
  const autres = [...new Set(declarations.flatMap((v) => Object.keys(v)))].filter((c) => !deja.has(c));
  for (const code of CASES_CA3.map((c) => c.code).filter((c) => autres.includes(c))) lignes.push(ligne(code, 'montant', CASES_PAR_CODE.get(code)!.section === 'tva-deductible' ? 'deductible' : CASES_PAR_CODE.get(code)!.section === 'tva-brute' ? 'brute' : 'solde'));
  for (const code of autres.filter((c) => !CASES_PAR_CODE.has(c)).sort()) {
    const colonnes = (['base', 'taxe', 'montant'] as Colonne[]).filter((k) => servie(code, k));
    for (const k of colonnes) lignes.push(ligne(code, k, 'solde'));
  }
  return lignes;
}
