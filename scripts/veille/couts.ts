/**
 * Coût réel des appels à l'API Claude, calculé à partir du champ `usage` de chaque réponse,
 * et cumul mensuel dans veille/couts.json (plafond `budget_mensuel_usd` de veille/config.json).
 *
 * Les calculs se font en nanodollars entiers (pas de flottants), conversion en dollars à l'affichage.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/** Tarifs publics de l'API Claude (dollars par million de jetons), relevés le 08/10/2026. */
interface Tarif {
  entree: number;
  sortie: number;
  /** Au-delà de ce nombre de jetons d'entrée dans une requête, tarif long contexte. */
  seuilLong?: number;
  entreeLong?: number;
  sortieLong?: number;
}

export const TARIFS: Record<string, Tarif> = {
  'claude-fable-5-1': { entree: 10, sortie: 50 },
  'claude-fable-5': { entree: 10, sortie: 50 },
  'claude-opus-5-5': { entree: 4, sortie: 20 },
  'claude-opus-5': { entree: 5, sortie: 25 },
  'claude-opus-4-8': { entree: 5, sortie: 25 },
  'claude-sonnet-5-5': { entree: 2, sortie: 10 },
  'claude-sonnet-5': { entree: 2, sortie: 10 },
  'claude-sonnet-4-6': { entree: 3, sortie: 15 },
  'claude-haiku-5-5': { entree: 0.1, sortie: 0.5, seuilLong: 100_000, entreeLong: 0.5, sortieLong: 2.5 },
  'claude-haiku-4-5': { entree: 1, sortie: 5 },
};
/** Modèle absent du tableau : on applique le tarif le plus élevé (estimation prudente, jamais sous-évaluée). */
const TARIF_PRUDENT: Tarif = { entree: 10, sortie: 50 };

/** 10 $ pour 1 000 recherches web. */
export const NANO_PAR_RECHERCHE = 10_000_000;
const NANO_PAR_DOLLAR = 1_000_000_000;

/** Nanodollars par jeton pour un tarif exprimé en dollars par million de jetons. */
function nanoParJeton(dollarsParMillion: number): number {
  return Math.round(dollarsParMillion * 1_000);
}

export interface UsageJetons {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export interface UsageReponse extends UsageJetons {
  server_tool_use?: { web_search_requests?: number | null } | null;
  /** Détail par tentative (boucle d'outils serveur, repli sur un autre modèle) : prioritaire s'il est fourni. */
  iterations?: ReadonlyArray<Partial<UsageJetons> & { model?: string | null; type?: string }> | null;
}

export interface CoutAppel {
  nano: number;
  recherches: number;
  /** Faux si un modèle inconnu a été tarifé au prix le plus élevé. */
  tarifConnu: boolean;
}

function coutJetons(usage: Partial<UsageJetons>, modele: string): { nano: number; connu: boolean } {
  const tarif = TARIFS[modele];
  const t = tarif ?? TARIF_PRUDENT;
  const entree = usage.input_tokens ?? 0;
  const lecture = usage.cache_read_input_tokens ?? 0;
  const ecriture = usage.cache_creation_input_tokens ?? 0;
  const long = t.seuilLong !== undefined && entree + lecture + ecriture > t.seuilLong;
  const pe = nanoParJeton(long ? (t.entreeLong ?? t.entree) : t.entree);
  const ps = nanoParJeton(long ? (t.sortieLong ?? t.sortie) : t.sortie);
  // Écriture en cache : 1,25 × l'entrée ; lecture : 0,1 × l'entrée.
  const nano = entree * pe + Math.round(ecriture * pe * 1.25) + Math.round(lecture * pe * 0.1) + (usage.output_tokens ?? 0) * ps;
  return { nano, connu: tarif !== undefined };
}

/** Coût d'une réponse de l'API : jetons (par tentative si le détail existe) + recherches web. */
export function coutReponse(usage: UsageReponse, modeleReponse: string): CoutAppel {
  const recherches = usage.server_tool_use?.web_search_requests ?? 0;
  let nano = recherches * NANO_PAR_RECHERCHE;
  let tarifConnu = true;
  const iterations = (usage.iterations ?? []).filter((i) => i.input_tokens !== undefined || i.output_tokens !== undefined);
  for (const morceau of iterations.length > 0 ? iterations : [{ ...usage, model: modeleReponse }]) {
    const c = coutJetons(morceau, morceau.model ?? modeleReponse);
    nano += c.nano;
    tarifConnu &&= c.connu;
  }
  return { nano, recherches, tarifConnu };
}

export function enDollars(nano: number): number {
  return Math.round(nano / 1_000) / 1_000_000; // arrondi au micro-dollar
}

export function depuisDollars(dollars: number): number {
  return Math.round(dollars * NANO_PAR_DOLLAR);
}

// --- Cumul mensuel : veille/couts.json ---

export interface Couts {
  _commentaire?: string;
  /** Par mois (AAAA-MM) : total et détail par jour (AAAA-MM-JJ), en dollars. */
  mois: Record<string, { total_usd: number; jours: Record<string, number> }>;
}

export function lireCouts(chemin: URL): Couts {
  if (!existsSync(chemin)) return { mois: {} };
  const couts = JSON.parse(readFileSync(chemin, 'utf8')) as Couts;
  return { ...couts, mois: couts.mois ?? {} };
}

export function ecrireCouts(chemin: URL, couts: Couts): void {
  const contenu: Couts = {
    _commentaire: 'Coût réel de la veille IA (couches C et notation), calculé à partir du champ usage de chaque réponse. Mis à jour par le workflow veille.yml.',
    mois: couts.mois,
  };
  writeFileSync(chemin, `${JSON.stringify(contenu, null, 2)}\n`);
}

export function totalMoisNano(couts: Couts, mois: string): number {
  return depuisDollars(couts.mois[mois]?.total_usd ?? 0);
}

export function totalJourNano(couts: Couts, jour: string): number {
  return depuisDollars(couts.mois[jour.slice(0, 7)]?.jours[jour] ?? 0);
}

/** Ajoute une dépense au jour donné (AAAA-MM-JJ). Ne modifie pas l'objet reçu. */
export function ajouterDepense(couts: Couts, jour: string, nano: number): Couts {
  if (nano <= 0) return couts;
  const mois = jour.slice(0, 7);
  const actuel = couts.mois[mois] ?? { total_usd: 0, jours: {} };
  const jourNano = depuisDollars(actuel.jours[jour] ?? 0) + nano;
  const totalNano = depuisDollars(actuel.total_usd) + nano;
  return {
    ...couts,
    mois: { ...couts.mois, [mois]: { total_usd: enDollars(totalNano), jours: { ...actuel.jours, [jour]: enDollars(jourNano) } } },
  };
}

/**
 * Suivi du budget pendant une exécution : chaque appel est imputé dès sa réponse,
 * et `depasse()` est consulté avant chaque nouvel appel.
 */
export class Budget {
  private nanoMois: number;
  private nanoExecution = 0;
  private couts: Couts;
  private readonly jour: string;
  private readonly plafondNano: number;
  constructor(couts: Couts, jour: string, plafondNano: number) {
    this.couts = couts;
    this.jour = jour;
    this.plafondNano = plafondNano;
    this.nanoMois = totalMoisNano(couts, jour.slice(0, 7));
  }
  depasse(): boolean {
    return this.nanoMois >= this.plafondNano;
  }
  imputer(nano: number): void {
    this.nanoMois += nano;
    this.nanoExecution += nano;
    this.couts = ajouterDepense(this.couts, this.jour, nano);
  }
  get etat(): Couts {
    return this.couts;
  }
  get moisNano(): number {
    return this.nanoMois;
  }
  get executionNano(): number {
    return this.nanoExecution;
  }
}
