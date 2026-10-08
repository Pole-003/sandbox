/**
 * Paramètres d'une sélection de circularisations (SPEC 4.1 et 4.2), sauvegardés avec le dossier.
 * Montants en centimes entiers.
 */
import { nouvelleGraine } from './alea.ts';

export type Population = 'clients' | 'fournisseurs';

export interface Critere {
  actif: boolean;
  /** Seuil saisi en euros (centimes) ou en % du seuil de planification. */
  mode: 'euros' | 'pct-sp';
  /** Centimes si mode « euros », pourcentage si « pct-sp ». */
  valeur: number;
}

export interface ParametresPopulation {
  /** Préfixes de comptes inclus. */
  prefixes: string[];
  /** Préfixes de comptes exclus (prioritaires sur les inclusions). */
  exclus: string[];
  /** Comptes d'avances (4191, 4091) : leur solde est ignoré pour le test de solde anormal. */
  avances: string[];
  /** C1 / F1 : solde (débiteur pour les clients, créditeur pour les fournisseurs) ≥ seuil. */
  solde: Critere;
  /** C2 / F2 : mouvements de l'exercice (débit clients, crédit fournisseurs) ≥ seuil. */
  mouvements: Critere;
  /** C3 / F3 : solde anormal. */
  anormal: { actif: boolean };
  /** C4 / F4 : tirage aléatoire uniforme parmi les tiers non retenus à solde non nul. */
  aleatoire: { actif: boolean; nombre: number };
}

export interface DecisionManuelle {
  population: Population;
  cle: string;
  action: 'ajout' | 'exclusion';
  justification: string;
  /** ISO date-heure de la décision. */
  le: string;
}

export interface ParametresCircularisation {
  version: 1;
  dateCloture: string;
  /** Seuils en centimes (null = non saisi). */
  ss: number | null;
  sp: number | null;
  sai: number | null;
  graine: number;
  banques: {
    prefixes: string[];
    /** Valeurs mobilières de placement (50), optionnel. */
    inclureVmp: boolean;
    /** Compte → établissement (proposé d'après le libellé, modifiable). */
    etablissements: Record<string, string>;
  };
  clients: ParametresPopulation;
  fournisseurs: ParametresPopulation;
  manuels: DecisionManuelle[];
  /** Date-heure à laquelle la sélection a été arrêtée (affichée et exportée). */
  selectionArreteeLe: string | null;
}

export const PREFIXES_BANQUES = ['512', '514', '517', '519', '5186', '164'];

/** Valeurs par défaut validées le 08/10/2026 : C1/F1 = 50 % du SP, C2/F2 = 100 % du SP, tirage uniforme. */
export function parametresParDefaut(dateCloture: string, graine = nouvelleGraine()): ParametresCircularisation {
  const population = (prefixes: string[], exclus: string[], avances: string[]): ParametresPopulation => ({
    prefixes,
    exclus,
    avances,
    solde: { actif: true, mode: 'pct-sp', valeur: 50 },
    mouvements: { actif: true, mode: 'pct-sp', valeur: 100 },
    anormal: { actif: true },
    aleatoire: { actif: true, nombre: 5 },
  });
  return {
    version: 1,
    dateCloture,
    ss: null,
    sp: null,
    sai: null,
    graine,
    banques: { prefixes: [...PREFIXES_BANQUES], inclureVmp: false, etablissements: {} },
    clients: population(['411', '413', '416', '4191'], ['418'], ['4191']),
    fournisseurs: population(['401', '403', '404', '405', '4091'], ['408'], ['4091']),
    manuels: [],
    selectionArreteeLe: null,
  };
}

/** Seuil effectif en centimes, ou null s'il ne peut être calculé (SP non saisi). */
export function seuilEffectif(c: Critere, sp: number | null): number | null {
  if (c.mode === 'euros') return Math.round(c.valeur);
  if (sp === null) return null;
  return Math.round((sp * c.valeur) / 100);
}

/** Le compte relève-t-il de la population (inclus et non exclu) ? */
export function compteRetenu(compte: string, prefixes: string[], exclus: string[]): boolean {
  return prefixes.some((p) => compte.startsWith(p)) && !exclus.some((p) => compte.startsWith(p));
}

/**
 * Établissement proposé d'après le libellé du compte : on retire les mentions génériques
 * (« compte courant », numéros, « emprunt »…) ; à défaut, « À préciser ».
 */
export function proposerEtablissement(libelle: string): string {
  const nettoye = libelle
    .replace(/\b(comptes?\s+courants?|c\/c|cc|cpte|compte|livret|d[ée]p[oô]t\s+[àa]\s+terme|cat|en\s+euros?|eur|n°?\s*\d+|\d{3,})\b/gi, ' ')
    .replace(/[-–—:,()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!nettoye || /^(banques?|emprunts?\b.*|int[ée]r[êe]ts?\b.*|pr[êe]ts?\b.*|valeurs?\s+mobili.*|concours\s+bancaires.*|[ée]tablissements?\b.*)$/i.test(nettoye)) {
    return 'À préciser';
  }
  return nettoye;
}
