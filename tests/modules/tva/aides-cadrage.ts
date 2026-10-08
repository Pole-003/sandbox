import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { construireDonneesTva, type DonneesTvaFec } from '../../../src/modules/fec/interface-tva.ts';
import { reglagesInitiaux } from '../../../src/modules/fec/stockage/base-fec.ts';
import type { ValeurCase } from '../../../src/modules/tva/ca3/analyse.ts';
import { importerFichier } from '../fec/aides.ts';
import { ATTENDUS_CA3, lireFixture } from './aides.ts';

export const DOSSIER_TVA = join(import.meta.dirname, '..', '..', 'fixtures', 'tva');

export interface AttendusTva {
  fichier: string;
  tvaCollecteeDeclaree: number;
  tvaTheorique: number;
  ecart: number;
  caParTaux: Record<string, number>;
  tvaSurCa: number;
  encours: Record<string, Record<string, number>>;
  perteHt: number;
  autoliquidationAchats: number;
  tva4457ParMois: Record<string, number>;
  solde4455: number;
  solde44567: number;
}
export const ATTENDUS_TVA = JSON.parse(readFileSync(join(DOSSIER_TVA, 'attendus.json'), 'utf8')) as Record<'conforme' | 'cutoff', AttendusTva>;

export async function donneesTva(variante: 'conforme' | 'cutoff'): Promise<DonneesTvaFec> {
  const r = await importerFichier(join(DOSSIER_TVA, ATTENDUS_TVA[variante].fichier));
  if (r.statut !== 'termine') throw new Error(r.statut);
  return construireDonneesTva(
    r.fec.colonnes,
    { id: 'x', dossierId: 'd', role: 'N', importeLe: '', meta: r.fec.meta, constatsLecture: [], constatsEcritures: [], reglages: reglagesInitiaux(r.fec.meta) },
    { id: 'd', nom: 'Conseil fictif' },
  );
}

/** Valeurs lues dans les 12 CA3 fictives (PDF), dans l'ordre des périodes. */
export async function declarationsServices(): Promise<{ periode: string; valeurs: Record<string, ValeurCase> }[]> {
  const r = [];
  for (const a of ATTENDUS_CA3.services) {
    const l = await lireFixture('services', a.fichier);
    r.push({ periode: l.identification.debut!.slice(0, 7), valeurs: l.cases });
  }
  return r;
}

/** Ventilation exacte des encours (montants TTC par taux), connue du générateur. */
export function ventilationExacte(a: AttendusTva): Record<string, Record<string, number>> {
  return {
    'clients:n1': a.encours.clientsN1!,
    'clients:n': a.encours.clientsN!,
    'douteux:n1': a.encours.douteuxN1!,
    'fae:n1': a.encours.faeN1!,
    'fae:n': a.encours.faeN!,
    'pca:n': a.encours.pcaN!,
    'pertes:n': { 2000: a.perteHt },
  };
}
