/**
 * Demandes de confirmation numérotées (BQ-001, CL-001, FO-001) : une par établissement bancaire et par
 * tiers retenu. Source unique des références, partagée par le tableau de suivi et les courriers.
 */
import type { Etablissement, Selection, TiersCandidat } from './selection.ts';

export type PopulationDemande = 'banques' | 'clients' | 'fournisseurs';

export const PREFIXES_REFERENCE: Record<PopulationDemande, string> = { banques: 'BQ', clients: 'CL', fournisseurs: 'FO' };

export type Demande =
  | { ref: string; population: 'banques'; etablissement: Etablissement }
  | { ref: string; population: 'clients' | 'fournisseurs'; tiers: TiersCandidat };

export const reference = (population: PopulationDemande, rang: number) => `${PREFIXES_REFERENCE[population]}-${String(rang).padStart(3, '0')}`;

/** Demandes d'une sélection, dans l'ordre du tableau de suivi. */
export function demandes(selection: Selection): Record<PopulationDemande, Demande[]> {
  const tiers = (population: 'clients' | 'fournisseurs'): Demande[] =>
    selection[population].tiers.filter((t) => t.retenu).map((t, i) => ({ ref: reference(population, i + 1), population, tiers: t }));
  return {
    banques: selection.banques.etablissements.map((e, i) => ({ ref: reference('banques', i + 1), population: 'banques', etablissement: e })),
    clients: tiers('clients'),
    fournisseurs: tiers('fournisseurs'),
  };
}
