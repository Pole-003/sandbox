/**
 * Balance auxiliaire clients et fournisseurs, avec balance âgée à la date de clôture
 * fondée sur les écritures non lettrées.
 */
import { ecartJours } from '../../../core/dates.ts';
import { dateIso } from '../import/valeurs.ts';
import { soldesPar, type SoldesCompte } from './balance.ts';
import type { ContexteAnalyse } from './contexte.ts';

export type Population = 'clients' | 'fournisseurs';

export const PREFIXES_POPULATION: Record<Population, RegExp> = {
  clients: /^41/,
  fournisseurs: /^40/,
};

/** Tranches d'ancienneté (en jours, bornes hautes incluses). */
export const TRANCHES = [
  { libelle: '0 à 30 j', max: 30 },
  { libelle: '31 à 60 j', max: 60 },
  { libelle: '61 à 90 j', max: 90 },
  { libelle: '91 à 180 j', max: 180 },
  { libelle: '181 à 365 j', max: 365 },
  { libelle: 'Plus d’un an', max: Number.POSITIVE_INFINITY },
] as const;

export interface LigneAuxiliaire extends SoldesCompte {
  /** Clé du tiers : CompAuxNum, sinon CompteNum (SPEC 4.2). */
  cle: string;
  compAuxNum: string;
  /** Compte(s) général(aux) du tiers. */
  comptes: string[];
  libelle: string;
  /** Montants non lettrés à la clôture, par tranche d'ancienneté (débit − crédit). */
  agee: number[];
  nonLettre: number;
}

export interface BalanceAuxiliaire {
  population: Population;
  tiers: LigneAuxiliaire[];
  total: SoldesCompte & { agee: number[]; nonLettre: number };
}

/** Une ligne est ouverte à la clôture si elle n'est pas lettrée, ou lettrée après la clôture. */
export function ouverteALaCloture(ctx: ContexteAnalyse, i: number): boolean {
  const { f } = ctx;
  if (f.ecritureLet[i] === 0) return true;
  return f.dateLet[i]! > ctx.finN;
}

/** Index des tiers : clé (CompAuxNum ou CompteNum) par ligne, en indice de dictionnaire. */
export function clesTiers(ctx: ContexteAnalyse): Uint32Array {
  const { f } = ctx;
  const cles = new Uint32Array(f.nbLignes);
  for (let i = 0; i < f.nbLignes; i++) cles[i] = f.compAuxNum[i] || f.compteNum[i]!;
  return cles;
}

export function calculerBalanceAuxiliaire(ctx: ContexteAnalyse, population: Population): BalanceAuxiliaire {
  const { f } = ctx;
  const prefixe = PREFIXES_POPULATION[population];
  const estDeLaPopulation = new Uint8Array(f.textes.length);
  for (let i = 0; i < f.nbLignes; i++) if (prefixe.test(f.textes[f.compteNum[i]!]!)) estDeLaPopulation[f.compteNum[i]!] = 1;
  const retenir = (i: number) => estDeLaPopulation[f.compteNum[i]!] === 1;
  const cles = clesTiers(ctx);
  const soldes = soldesPar(ctx, cles, retenir);
  const details = new Map<number, { comptes: Set<number>; libelle: number; aux: boolean; agee: number[]; nonLettre: number }>();
  for (let i = 0; i < f.nbLignes; i++) {
    if (!retenir(i)) continue;
    const k = cles[i]!;
    let d = details.get(k);
    if (!d) details.set(k, (d = { comptes: new Set(), libelle: f.compAuxLib[i] || f.compteLib[i]!, aux: f.compAuxNum[i] !== 0, agee: TRANCHES.map(() => 0), nonLettre: 0 }));
    d.comptes.add(f.compteNum[i]!);
    const date = f.ecritureDate[i]!;
    if (date <= 0 || date > ctx.finN || !ouverteALaCloture(ctx, i)) continue;
    const reference = f.pieceDate[i]! > 0 && f.pieceDate[i]! <= date ? f.pieceDate[i]! : date;
    const age = ecartJours(dateIso(reference), ctx.fin);
    const tranche = TRANCHES.findIndex((tr) => age <= tr.max);
    const montant = f.debit[i]! - f.credit[i]!;
    d.agee[tranche]! += montant;
    d.nonLettre += montant;
  }
  const tiers: LigneAuxiliaire[] = [...soldes].map(([k, s]) => {
    const d = details.get(k)!;
    return {
      cle: f.textes[k]!,
      compAuxNum: d.aux ? f.textes[k]! : '',
      comptes: [...d.comptes].map((c) => f.textes[c]!).sort(),
      libelle: f.textes[d.libelle]!,
      agee: d.agee,
      nonLettre: d.nonLettre,
      ...s,
    };
  });
  tiers.sort((a, b) => (a.cle < b.cle ? -1 : a.cle > b.cle ? 1 : 0));
  const total = { ouverture: 0, debit: 0, credit: 0, cloture: 0, nbLignes: 0, agee: TRANCHES.map(() => 0), nonLettre: 0 };
  for (const x of tiers) {
    total.ouverture += x.ouverture;
    total.debit += x.debit;
    total.credit += x.credit;
    total.cloture += x.cloture;
    total.nbLignes += x.nbLignes;
    total.nonLettre += x.nonLettre;
    x.agee.forEach((v, i) => (total.agee[i]! += v));
  }
  return { population, tiers, total };
}
