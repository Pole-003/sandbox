/**
 * Collecte des constats de conformité : par règle, nombre d'occurrences et lignes concernées
 * (plafonnées pour borner la mémoire, le nombre d'occurrences restant exact).
 */
import { REGLES, regle, type Gravite } from './regles.ts';

export const PLAFOND_LIGNES = 50_000;

export interface Constat {
  code: string;
  occurrences: number;
  /** Numéros de ligne d'origine, croissants, au plus PLAFOND_LIGNES. */
  lignes: number[];
  /** Précisions (journaux ou mois en déséquilibre, numéros manquants, colonnes…). */
  details: string[];
}

export class Constats {
  private readonly parCode = new Map<string, { occurrences: number; lignes: number[]; details: string[]; derniere: number }>();

  private entree(code: string) {
    let e = this.parCode.get(code);
    if (!e) {
      regle(code);
      e = { occurrences: 0, lignes: [], details: [], derniere: -1 };
      this.parCode.set(code, e);
    }
    return e;
  }

  /** Constat sur une ligne (une seule occurrence par ligne et par règle). */
  ligne(code: string, ligne: number): void {
    const e = this.entree(code);
    if (e.derniere === ligne) return;
    e.derniere = ligne;
    e.occurrences++;
    if (e.lignes.length < PLAFOND_LIGNES) e.lignes.push(ligne);
  }

  /** Constat global (sans ligne), avec une précision facultative. */
  global(code: string, detail?: string, occurrences = 1): void {
    const e = this.entree(code);
    e.occurrences += occurrences;
    if (detail !== undefined) e.details.push(detail);
  }

  detail(code: string, detail: string): void {
    this.entree(code).details.push(detail);
  }

  fusionner(autres: Constat[]): void {
    for (const c of autres) {
      const e = this.entree(c.code);
      e.occurrences += c.occurrences;
      e.lignes.push(...c.lignes.slice(0, PLAFOND_LIGNES - e.lignes.length));
      e.details.push(...c.details);
    }
  }

  resultat(): Constat[] {
    const ordre = new Map(REGLES.map((r, i) => [r.code, i]));
    return [...this.parCode.entries()]
      .filter(([, e]) => e.occurrences > 0)
      .map(([code, e]) => {
        const lignes = [...new Set(e.lignes)].sort((a, b) => a - b);
        return { code, occurrences: e.occurrences, lignes, details: e.details };
      })
      .sort((a, b) => ordre.get(a.code)! - ordre.get(b.code)!);
  }
}

export function compterParGravite(constats: Constat[]): Record<Gravite, number> {
  const total: Record<Gravite, number> = { 'non-conforme': 0, anomalie: 0, information: 0 };
  for (const c of constats) total[regle(c.code).gravite] += c.occurrences;
  return total;
}
