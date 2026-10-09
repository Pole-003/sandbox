/**
 * Lecture des réglages de la veille (modifiables sans toucher au code) :
 *  - veille/config.json : fenêtres, conservation, longueur des résumés, User-Agent ;
 *  - veille/sources.json : catalogue des sources ;
 *  - veille/mots-cles.json : classement par mots-clés (thème, importance, public, exclusions) ;
 *  - veille/suivi.json : suivi PLF / PLFSS saisi à la main ;
 *  - veille/hierarchie-mesures.json : hiérarchie des mesures du PLF et du PLFSS établie par le pôle ;
 *  - veille/indicateurs.json : séries suivies par les API de la couche B (INSEE, BODACC) ;
 *  - veille/echeances.json : échéances des entreprises saisies à la main (règles et dates ponctuelles).
 */
import { readFileSync } from 'node:fs';
import { THEMES, type SuiviTexte, type Theme, type TypeArticle } from '../../src/modules/veille/modele.ts';
import { verifierMotsCles, type MotsCles } from './classement.ts';
import type { PolitiqueRobots } from './http.ts';
import { verifierFichierEcheances, type FichierEcheances } from '../../src/modules/veille/echeances.ts';
import { verifierHierarchie, type HierarchieMesures } from './projet-loi.ts';

export interface ConfigVeille {
  /** Toujours false : la recherche IA (couche C) est désactivée, la veille fonctionne à 0 €. */
  recherche_ia: boolean;
  fenetre_jours: Record<string, number> & { defaut: number };
  conservation_jours: number;
  /** Longueur maximale du résumé repris de la description du flux. */
  longueur_resume: number;
  user_agent: string;
}

export interface SourceCatalogue {
  id: string;
  nom: string;
  type: 'rss' | 'page' | 'api' | 'dossier' | 'alerte_google' | 'calendrier';
  /** Pour un dossier législatif, « {annee} » est remplacé par l'année du texte (essai de l'année suivante, puis de l'année en cours). */
  url?: string;
  /** Dossier législatif suivi : PLF ou PLFSS. */
  suivi?: 'plf' | 'plfss';
  theme: string;
  statut: string;
  notes?: string;
  secret?: string;
  /** Flux volumineux : ne garder que les éléments dont le titre ou la description contient l'un de ces mots. */
  mots_cles?: string[];
  /** Nature des publications de la source (texte officiel, doctrine, jurisprudence…). */
  type_article?: TypeArticle;
  /** Exception à robots.txt validée par l'utilisateur (voir http.ts) ; absent = robots.txt respecté. */
  robots?: Exclude<PolitiqueRobots, 'respecter'>;
}

/** Indicateur d'une API de la couche B (veille/indicateurs.json). */
export interface IndicateurCatalogue {
  source_id: string;
  /** Identifiant de la série (idbank INSEE). */
  serie: string;
  libelle: string;
  unite: string;
  decimales: number;
  /** Page de présentation de la série chez l'émetteur. */
  url: string;
}

export interface Reglages {
  config: ConfigVeille;
  sources: SourceCatalogue[];
  motsCles: MotsCles;
  /** Suivi PLF / PLFSS saisi à la main (veille/suivi.json). */
  suivi: { plf: SuiviTexte | null; plfss: SuiviTexte | null };
  /** Hiérarchie des mesures établie par le pôle ; à défaut, classement par mots-clés. */
  hierarchie?: HierarchieMesures;
  /** Séries suivies par les connecteurs de la couche B (veille/indicateurs.json). */
  indicateurs?: IndicateurCatalogue[];
  /** Échéances saisies à la main (veille/echeances.json). */
  echeances?: FichierEcheances;
}

const RACINE = new URL('../../', import.meta.url);

function lireJson<T>(chemin: string): T {
  return JSON.parse(readFileSync(new URL(chemin, RACINE), 'utf8')) as T;
}

export function verifierConfig(config: ConfigVeille): void {
  const erreurs: string[] = [];
  if (config.recherche_ia !== false) erreurs.push('recherche_ia doit valoir false (recherche IA désactivée : veille à 0 €)');
  if (!(config.fenetre_jours?.defaut > 0)) erreurs.push('fenetre_jours.defaut manquant');
  if (!(config.conservation_jours > 0)) erreurs.push('conservation_jours manquant');
  if (!(config.longueur_resume >= 50)) erreurs.push('longueur_resume doit être d’au moins 50 caractères');
  if (!config.user_agent) erreurs.push('user_agent manquant');
  if (erreurs.length) throw new Error(`veille/config.json invalide : ${erreurs.join(' ; ')}`);
}

export function chargerReglages(): Reglages {
  const config = lireJson<ConfigVeille>('veille/config.json');
  verifierConfig(config);
  const { sources } = lireJson<{ sources: SourceCatalogue[] }>('veille/sources.json');
  const motsCles = lireJson<MotsCles>('veille/mots-cles.json');
  verifierMotsCles(motsCles);
  const suivi = lireJson<{ plf?: SuiviTexte | null; plfss?: SuiviTexte | null }>('veille/suivi.json');
  const hierarchie = lireJson<HierarchieMesures>('veille/hierarchie-mesures.json');
  verifierHierarchie(hierarchie);
  const { indicateurs } = lireJson<{ indicateurs: IndicateurCatalogue[] }>('veille/indicateurs.json');
  const echeances = lireJson<FichierEcheances>('veille/echeances.json');
  const erreursEcheances = verifierFichierEcheances(echeances);
  if (erreursEcheances.length) throw new Error(`veille/echeances.json invalide : ${erreursEcheances.join(' ; ')}`);
  return { config, sources, motsCles, suivi: { plf: suivi.plf ?? null, plfss: suivi.plfss ?? null }, hierarchie, indicateurs, echeances };
}

/** Fenêtre de veille (en jours) d'un thème. */
export function fenetreJours(config: ConfigVeille, theme: string): number {
  return config.fenetre_jours[theme] ?? config.fenetre_jours.defaut;
}

/** Thème du catalogue ramené à la liste officielle (repli : « Fiscal et comptable »). */
export function themeConnu(theme: string): Theme {
  return (THEMES as readonly string[]).includes(theme) ? (theme as Theme) : 'Fiscal et comptable';
}
