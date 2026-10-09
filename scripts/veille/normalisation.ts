/**
 * Déduplication (docs/VEILLE.md) : URL normalisée, puis similarité de titre.
 */
import { createHash } from 'node:crypto';

/** Paramètres de suivi retirés des URL (en plus de tous les utm_*). */
const PARAMETRES_SUIVI = new Set(['xtor', 'xts', 'at_medium', 'at_campaign', 'fbclid', 'gclid', 'mc_cid', 'mc_eid', 'ref', 'cmpid']);

/** https, sans ancre, sans paramètre de suivi, hôte en minuscules, sans « / » final superflu. */
export function normaliserUrl(adresse: string): string {
  let url: URL;
  try {
    url = new URL(adresse.trim());
  } catch {
    return adresse.trim();
  }
  if (url.protocol === 'http:') url.protocol = 'https:';
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  for (const cle of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(cle) || PARAMETRES_SUIVI.has(cle.toLowerCase())) url.searchParams.delete(cle);
  }
  url.searchParams.sort();
  let texte = url.href;
  if (url.pathname.length > 1 && texte.endsWith('/') && !url.search) texte = texte.slice(0, -1);
  return texte;
}

export function idArticle(adresse: string): string {
  return createHash('sha256').update(normaliserUrl(adresse)).digest('hex').slice(0, 16);
}

const MOTS_VIDES = new Set([
  'le', 'la', 'les', 'l', 'un', 'une', 'des', 'de', 'du', 'd', 'et', 'ou', 'à', 'a', 'au', 'aux', 'en', 'pour', 'sur',
  'par', 'dans', 'avec', 'sans', 'ce', 'cette', 'ces', 'qui', 'que', 'est', 'sont', 'n', 'no', 'nº', '°',
]);

/** Mots significatifs d'un titre : minuscules, sans accents ni ponctuation, sans mots vides. */
export function motsTitre(titre: string): Set<string> {
  const mots = titre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((m) => m.length > 1 && !MOTS_VIDES.has(m));
  return new Set(mots);
}

/** Indice de Jaccard sur les mots significatifs (0 à 1). */
export function similariteTitres(a: string, b: string): number {
  const ma = motsTitre(a);
  const mb = motsTitre(b);
  if (ma.size === 0 || mb.size === 0) return 0;
  let communs = 0;
  for (const mot of ma) if (mb.has(mot)) communs++;
  return communs / (ma.size + mb.size - communs);
}

/** Au-delà de ce seuil, deux titres publiés à moins de 3 jours d'écart désignent la même information. */
export const SEUIL_SIMILARITE = 0.8;
/** Seuil de regroupement de deux articles similaires venant de sources différentes. */
export const SEUIL_REGROUPEMENT = 0.5;
const ECART_MAX_JOURS = 3;

function ecartJours(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
}

/**
 * Regroupe les doublons. `fusionner(conserve, doublon)` décide de ce que l'on garde ;
 * l'ordre d'entrée fait foi (le premier exemplaire est le « conservé »).
 */
export function dedoublonner<T extends { url: string; titre: string; date: string }>(
  elements: readonly T[],
  fusionner: (conserve: T, doublon: T) => T,
  options: {
    /** Adresses déjà rattachées à un élément (autres sources d'un article regroupé). */
    urlsRattachees?: (element: T) => readonly string[];
    /** Regroupement plus large entre sources différentes : seuil de similarité (sous SEUIL_SIMILARITE). */
    seuilSourcesDifferentes?: number;
    source?: (element: T) => string;
  } = {},
): T[] {
  const resultat: T[] = [];
  const parUrl = new Map<string, number>();
  const proche = (r: T, e: T) => {
    if (ecartJours(r.date, e.date) > ECART_MAX_JOURS) return false;
    const sim = similariteTitres(r.titre, e.titre);
    if (sim >= SEUIL_SIMILARITE) return true;
    const { seuilSourcesDifferentes: seuil, source } = options;
    return seuil !== undefined && source !== undefined && sim >= seuil && source(r) !== source(e);
  };
  for (const element of elements) {
    const cle = normaliserUrl(element.url);
    let indice = parUrl.get(cle);
    if (indice === undefined) {
      indice = resultat.findIndex((r) => proche(r, element));
      if (indice < 0) indice = undefined;
    }
    if (indice === undefined) {
      indice = resultat.length;
      resultat.push(element);
    } else {
      resultat[indice] = fusionner(resultat[indice] as T, element);
    }
    parUrl.set(cle, indice);
    for (const url of options.urlsRattachees?.(element) ?? []) parUrl.set(normaliserUrl(url), indice);
  }
  return resultat;
}
