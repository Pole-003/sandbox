/**
 * Déclaration CA3 enregistrée dans un dossier : valeurs lues (PDF) ou saisies, corrections tracées,
 * valeurs retenues (lues + corrections). Montants en centimes.
 */
import type { IdentificationCa3, MessageCa3, ValeurCase } from './analyse.ts';

export type Colonne = keyof ValeurCase;

export interface CorrectionCa3 {
  code: string;
  colonne: Colonne;
  /** Valeur lue ou précédente (null = case vide). */
  avant: number | null;
  apres: number | null;
  /** Date-heure ISO de la correction. */
  le: string;
  motif: string;
}

export interface DeclarationCa3 {
  id: string;
  source: 'pdf' | 'saisie';
  nomFichier: string | null;
  /** SHA-256 du PDF (preuve du fichier utilisé, sans son contenu). */
  empreinte: string | null;
  identification: IdentificationCa3;
  /** Valeurs telles que lues dans le PDF ou saisies. */
  lues: Record<string, ValeurCase>;
  corrections: CorrectionCa3[];
  /** Messages de lecture (les contrôles sont recalculés à chaque affichage). */
  messagesLecture: MessageCa3[];
  casesInconnues: string[];
  importeLe: string;
}

/** Valeurs retenues : lues, puis corrections dans l'ordre (la dernière l'emporte). */
export function valeursRetenues(d: Pick<DeclarationCa3, 'lues' | 'corrections'>): Record<string, ValeurCase> {
  const v: Record<string, ValeurCase> = structuredClone(d.lues);
  for (const c of d.corrections) {
    const x = (v[c.code] ??= {});
    if (c.apres === null) delete x[c.colonne];
    else x[c.colonne] = c.apres;
    if (Object.keys(x).length === 0) delete v[c.code];
  }
  return v;
}

/** Valeur d'une case (montant, ou taxe pour une ligne à deux colonnes), 0 si vide. */
export function valeur(v: Record<string, ValeurCase>, code: string, colonne?: Colonne): number {
  const x = v[code];
  if (!x) return 0;
  if (colonne) return x[colonne] ?? 0;
  return x.montant ?? x.taxe ?? x.base ?? 0;
}

/** Libellé court d'une période : « 04/2026 », « T2 2026 » ou « 01/04/2026 – 30/06/2026 ». */
export function libellePeriode(debut: string | null, fin: string | null): string {
  if (!debut || !fin) return 'période inconnue';
  const [ad, md, jd] = debut.split('-').map(Number) as [number, number, number];
  const [af, mf] = fin.split('-').map(Number) as [number, number];
  const mois = (af - ad) * 12 + (mf - md) + 1;
  if (jd === 1 && mois === 1) return `${String(md).padStart(2, '0')}/${ad}`;
  if (jd === 1 && mois === 3 && (md - 1) % 3 === 0) return `T${(md + 2) / 3} ${ad}`;
  const fr = (iso: string) => iso.split('-').reverse().join('/');
  return `${fr(debut)} – ${fr(fin)}`;
}
