/**
 * Analyse rapide d'un document reçu, pour le diagnostic des sources.
 * (Le parseur complet de la couche A s'appuiera sur les mêmes fonctions de date et d'encodage.)
 */
import { createHash } from 'node:crypto';
import { extraireDateDuTexte, lireDate } from './dates.ts';

export type FormatFlux = 'rss' | 'atom' | 'rdf';

export interface AnalyseFlux {
  format: FormatFlux | null;
  /** Explication quand le document n'est pas un flux (page HTML, défi anti-robot…). */
  remarque: string | null;
  elements: number;
  /** Éléments dont aucune date n'a pu être lue, même dans la description. */
  sansDate: number;
  /** Éléments datés seulement grâce à la description (cas du BOFiP). */
  dateDansDescription: number;
  plusRecent: Date | null;
}

const BALISES_DATE = ['pubDate', 'dc:date', 'published', 'updated', 'a10:updated', 'dcterms:modified', 'dcterms:created'];
const BALISES_TEXTE = ['description', 'summary', 'content', 'content:encoded'];

function texteBalise(bloc: string, balise: string): string | null {
  const nom = balise.replace(':', '\\:');
  const m = new RegExp(`<${nom}(?:\\s[^>]*)?>([\\s\\S]*?)</${nom}>`, 'i').exec(bloc);
  if (!m?.[1]) return null;
  return m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1').trim();
}

function detecterFormat(texte: string): { format: FormatFlux | null; remarque: string | null } {
  const debut = texte.slice(0, 4000);
  if (/<rss[\s>]/i.test(debut)) return { format: 'rss', remarque: null };
  if (/<feed[\s>]/i.test(debut)) return { format: 'atom', remarque: null };
  if (/<rdf:RDF[\s>]/i.test(debut)) return { format: 'rdf', remarque: null };
  if (/<html[\s>]|<!doctype html/i.test(debut)) {
    const defi = /captcha|cf-chl|challenge-platform|javascript (?:is )?(?:required|disabled)|activer javascript|enable javascript/i.test(texte);
    return { format: null, remarque: defi ? 'page HTML de défi anti-robot' : 'page HTML reçue au lieu d’un flux' };
  }
  if (texte.trim() === '') return { format: null, remarque: 'réponse vide' };
  return { format: null, remarque: 'contenu non reconnu comme flux RSS/Atom' };
}

export function analyserFlux(texte: string): AnalyseFlux {
  const { format, remarque } = detecterFormat(texte);
  const resultat: AnalyseFlux = { format, remarque, elements: 0, sansDate: 0, dateDansDescription: 0, plusRecent: null };
  if (!format) return resultat;

  const blocs = texte.match(format === 'atom' ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  resultat.elements = blocs.length;

  for (const bloc of blocs) {
    let date: Date | null = null;
    for (const balise of BALISES_DATE) {
      date = lireDate(texteBalise(bloc, balise));
      if (date) break;
    }
    if (!date) {
      for (const balise of BALISES_TEXTE) {
        const contenu = texteBalise(bloc, balise);
        date = contenu ? extraireDateDuTexte(contenu) : null;
        if (date) break;
      }
      if (date) resultat.dateDansDescription++;
    }
    if (!date) {
      resultat.sansDate++;
      continue;
    }
    if (!resultat.plusRecent || date > resultat.plusRecent) resultat.plusRecent = date;
  }
  return resultat;
}

export interface AnalysePage {
  titre: string | null;
  /** Empreinte du texte visible : sert à détecter un changement d'une exécution à l'autre. */
  empreinte: string;
  caracteres: number;
  remarque: string | null;
}

export function analyserPage(texte: string): AnalysePage {
  const titre = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(texte)?.[1]?.replace(/\s+/g, ' ').trim() ?? null;
  const visible = texte
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const defi = /captcha|cf-chl|challenge-platform|enable javascript|activer javascript/i.test(texte);
  return {
    titre,
    empreinte: createHash('sha256').update(visible).digest('hex').slice(0, 16),
    caracteres: visible.length,
    remarque: defi ? 'page de défi anti-robot probable' : visible.length < 200 ? 'peu de texte visible (contenu généré en JavaScript ?)' : null,
  };
}
