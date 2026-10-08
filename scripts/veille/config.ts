/**
 * Lecture des réglages de la veille (modifiables sans toucher au code) :
 *  - veille/config.json : modèles, budget, fenêtres, localisation, User-Agent ;
 *  - veille/sources.json : catalogue des sources ;
 *  - veille/themes.json : consignes par thème de la couche C ;
 *  - veille/prompt-systeme.md : prompt système de la couche C.
 */
import { readFileSync } from 'node:fs';
import { THEMES, type Theme } from '../../src/modules/veille/modele.ts';

export interface ConfigVeille {
  modele_recherche: string;
  modele_notation: string;
  recherches_max_par_theme: number;
  budget_mensuel_usd: number;
  fenetre_jours: Record<string, number> & { defaut: number };
  localisation: { type: 'approximate'; city?: string; region?: string; country?: string; timezone?: string };
  conservation_jours: number;
  user_agent: string;
}

export interface SourceCatalogue {
  id: string;
  nom: string;
  type: 'rss' | 'page' | 'api';
  url?: string;
  theme: string;
  statut: string;
  notes?: string;
  secret?: string;
  /** Flux volumineux : ne garder que les éléments dont le titre ou la description contient l'un de ces mots. */
  mots_cles?: string[];
}

export interface ConsigneTheme {
  theme: Theme;
  consigne: string;
}

export interface Reglages {
  config: ConfigVeille;
  sources: SourceCatalogue[];
  themes: ConsigneTheme[];
  promptSysteme: string;
}

const RACINE = new URL('../../', import.meta.url);

function lireJson<T>(chemin: string): T {
  return JSON.parse(readFileSync(new URL(chemin, RACINE), 'utf8')) as T;
}

export function verifierConfig(config: ConfigVeille): void {
  const erreurs: string[] = [];
  if (!config.modele_recherche) erreurs.push('modele_recherche manquant');
  if (!config.modele_notation) erreurs.push('modele_notation manquant');
  if (!(config.budget_mensuel_usd >= 0)) erreurs.push('budget_mensuel_usd doit être un nombre positif');
  if (!Number.isInteger(config.recherches_max_par_theme) || config.recherches_max_par_theme < 1) erreurs.push('recherches_max_par_theme doit être un entier ≥ 1');
  if (!(config.fenetre_jours?.defaut > 0)) erreurs.push('fenetre_jours.defaut manquant');
  if (!(config.conservation_jours > 0)) erreurs.push('conservation_jours manquant');
  if (!config.user_agent) erreurs.push('user_agent manquant');
  if (erreurs.length) throw new Error(`veille/config.json invalide : ${erreurs.join(' ; ')}`);
}

export function verifierThemes(themes: ConsigneTheme[]): void {
  for (const t of themes) {
    if (!(THEMES as readonly string[]).includes(t.theme)) throw new Error(`veille/themes.json : thème inconnu « ${t.theme} » (attendus : ${THEMES.join(', ')})`);
    if (!t.consigne?.trim()) throw new Error(`veille/themes.json : consigne vide pour « ${t.theme} »`);
  }
}

export function chargerReglages(): Reglages {
  const config = lireJson<ConfigVeille>('veille/config.json');
  verifierConfig(config);
  const { sources } = lireJson<{ sources: SourceCatalogue[] }>('veille/sources.json');
  const { themes } = lireJson<{ themes: ConsigneTheme[] }>('veille/themes.json');
  verifierThemes(themes);
  const promptSysteme = readFileSync(new URL('veille/prompt-systeme.md', RACINE), 'utf8').trim();
  if (!promptSysteme) throw new Error('veille/prompt-systeme.md est vide');
  return { config, sources, themes, promptSysteme };
}

/** Fenêtre de veille (en jours) d'un thème. */
export function fenetreJours(config: ConfigVeille, theme: string): number {
  return config.fenetre_jours[theme] ?? config.fenetre_jours.defaut;
}

/** Thème du catalogue ramené à la liste officielle (repli : « Fiscal et comptable »). */
export function themeConnu(theme: string): Theme {
  return (THEMES as readonly string[]).includes(theme) ? (theme as Theme) : 'Fiscal et comptable';
}
