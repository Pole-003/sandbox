/**
 * Identification des colonnes d'un FEC à plat : correspondance des noms, régime, présentation
 * des montants, zones manquantes et contrôles d'en-tête (S05 à S10, S13).
 */
import type { Constats } from '../conformite/constats.ts';
import {
  reconnaitreZone,
  zonesReglementaires,
  type PresentationMontants,
  type Reconnaissance,
  type Regime,
  type Zone,
} from '../zones.ts';

export interface Colonne {
  /** Rang dans le fichier (à partir de 0). */
  rang: number;
  nom: string;
  zone: Zone | null;
  reconnaissance: Reconnaissance | null;
}

export interface Identification {
  colonnes: Colonne[];
  index: Partial<Record<Zone, number>>;
  regime: Regime;
  presentation: PresentationMontants;
  manquantes: Zone[];
  /** Zones indispensables à l'analyse encore introuvables : l'assistant de correspondance est requis. */
  bloquantes: Zone[];
  ordreConforme: boolean;
  supplementaires: string[];
}

/** Correspondance validée dans l'assistant : rang de colonne → zone (null = colonne ignorée). */
export type Correspondance = Record<number, Zone | null>;

export function identifierColonnes(
  entetes: string[],
  options: { regime?: Regime; correspondance?: Correspondance } = {},
): Identification {
  const index: Partial<Record<Zone, number>> = {};
  const colonnes: Colonne[] = entetes.map((nom, rang) => {
    const manuelle = options.correspondance?.[rang];
    if (manuelle !== undefined) {
      if (manuelle === null || index[manuelle] !== undefined) return { rang, nom, zone: null, reconnaissance: null };
      const auto = reconnaitreZone(nom);
      index[manuelle] = rang;
      return { rang, nom, zone: manuelle, reconnaissance: auto?.zone === manuelle ? auto.reconnaissance : 'manuelle' };
    }
    const r = reconnaitreZone(nom);
    if (!r || index[r.zone] !== undefined) return { rang, nom, zone: null, reconnaissance: null };
    index[r.zone] = rang;
    return { rang, nom, zone: r.zone, reconnaissance: r.reconnaissance };
  });
  const presentation: PresentationMontants =
    index.Montant !== undefined && index.Sens !== undefined && (index.Debit === undefined || index.Credit === undefined)
      ? 'montant-sens'
      : 'debit-credit';
  const regime: Regime =
    options.regime ?? (index.IdClient !== undefined ? 'bnc-tresorerie' : index.DateRglt !== undefined || index.ModeRglt !== undefined ? 'ba-tresorerie' : 'bic');
  const reglementaires = zonesReglementaires(regime, presentation);
  const manquantes = reglementaires.filter((z) => index[z] === undefined);
  const indispensables: Zone[] = ['EcritureNum', 'EcritureDate', 'CompteNum', ...(presentation === 'montant-sens' ? (['Montant', 'Sens'] as Zone[]) : (['Debit', 'Credit'] as Zone[]))];
  const bloquantes = indispensables.filter((z) => index[z] === undefined);
  // Ordre : les zones réglementaires présentes doivent être en tête, dans l'ordre de l'arrêté.
  const presentes = reglementaires.filter((z) => index[z] !== undefined);
  const ordreConforme = presentes.every((z, i) => index[z] === i);
  const supplementaires = colonnes.filter((c) => c.zone === null && c.nom !== '').map((c) => c.nom);
  return { colonnes, index, regime, presentation, manquantes, bloquantes, ordreConforme, supplementaires };
}

/** Constats d'en-tête (ligne 1). */
export function controlerEntete(id: Identification, k: Constats, sansEntete = false): void {
  for (const c of id.colonnes) {
    // Sans en-tête, toutes les colonnes sont attribuées à la main : S05 suffit.
    if (sansEntete && c.reconnaissance === 'manuelle') continue;
    if (c.reconnaissance === 'casse' || c.reconnaissance === 'variante-officielle') {
      k.global('S07', `« ${c.nom} » → ${c.zone}`);
    } else if (c.reconnaissance === 'alias' || c.reconnaissance === 'manuelle') {
      k.global('S08', `« ${c.nom} » → ${c.zone}${c.reconnaissance === 'manuelle' ? ' (correspondance manuelle)' : ''}`);
    }
  }
  for (const z of id.manquantes) k.global('S06', z);
  if (!id.ordreConforme) k.global('S09', 'Zones réglementaires hors de l’ordre de l’arrêté');
  for (const nom of id.supplementaires) k.global('S10', nom);
  if (id.colonnes.length > 0 && id.colonnes[id.colonnes.length - 1]!.nom === '') k.global('S13');
}

/** Première ligne sans en-tête : moins de trois noms de zones reconnus. */
export function estEntete(champs: string[]): boolean {
  return champs.filter((c) => reconnaitreZone(c) !== null).length >= 3;
}

/** Signature d'un en-tête, pour retrouver un profil d'import mémorisé. */
export function signatureEntete(champs: string[]): string {
  return champs.map((c) => c.trim().toUpperCase()).join('\u0001');
}

/** Proposition de correspondance pour l'assistant (reconnaissance automatique). */
export function proposerCorrespondance(id: Identification): Correspondance {
  const c: Correspondance = {};
  for (const col of id.colonnes) c[col.rang] = col.zone;
  return c;
}
