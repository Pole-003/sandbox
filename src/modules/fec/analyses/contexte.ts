/**
 * Contexte commun aux analyses : FEC normalisé, exercice et repérage des lignes d'à-nouveaux.
 * Les analyses sont des fonctions pures sur ce contexte (testées sous Node).
 */
import type { FecColonnes } from '../donnees/colonnes.ts';
import { dateNombre } from '../import/valeurs.ts';
import { filtreAN, type JournalAN } from '../metadonnees.ts';

export interface ContexteAnalyse {
  f: FecColonnes;
  /** Exercice (ISO). */
  debut: string;
  fin: string;
  /** Exercice en entiers AAAAMMJJ. */
  debutN: number;
  finN: number;
  /** 1 si la ligne appartient aux à-nouveaux. */
  an: Uint8Array;
}

export function creerContexte(f: FecColonnes, exercice: { debut: string; fin: string }, journalAN: JournalAN | null): ContexteAnalyse {
  const estAN = filtreAN(f, journalAN);
  const an = new Uint8Array(f.nbLignes);
  for (let i = 0; i < f.nbLignes; i++) if (estAN(i)) an[i] = 1;
  return { f, debut: exercice.debut, fin: exercice.fin, debutN: dateNombre(exercice.debut), finN: dateNombre(exercice.fin), an };
}

/** Texte d'une ligne. */
export function t(f: FecColonnes, col: 'journalCode' | 'journalLib' | 'ecritureNum' | 'compteNum' | 'compteLib' | 'compAuxNum' | 'compAuxLib' | 'pieceRef' | 'ecritureLib' | 'ecritureLet', i: number): string {
  return f.textes[f[col][i]!]!;
}

/** Sens d'un solde : D (débiteur), C (créditeur) ou « » (nul). */
export function sens(solde: number): 'D' | 'C' | '' {
  return solde > 0 ? 'D' : solde < 0 ? 'C' : '';
}
