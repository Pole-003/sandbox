/**
 * Lecture des réponses des sources d'indicateurs (veille/marches-sources.json) : CSV de la BCE, de FRED
 * et de Webstat, SDMX de l'INSEE, page « Informations rapides » de l'INSEE (prochaine publication).
 * Fonctions pures, testées sur les réponses enregistrées dans tests/fixtures/marches/.
 */
import { finDePeriode, lireSeriesInsee } from '../veille/insee.ts';
import { decoderEntites } from '../veille/flux.ts';

/** CSV avec champs entre guillemets (virgules et guillemets doublés à l'intérieur). */
export function lireCsv(texte: string, separateur = ','): string[][] {
  const lignes: string[][] = [];
  let ligne: string[] = [];
  let champ = '';
  let guillemets = false;
  const t = texte.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (guillemets) {
      if (c === '"' && t[i + 1] === '"') {
        champ += '"';
        i++;
      } else if (c === '"') guillemets = false;
      else champ += c;
    } else if (c === '"') guillemets = true;
    else if (c === separateur) {
      ligne.push(champ);
      champ = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      ligne.push(champ);
      if (ligne.some((x) => x !== '')) lignes.push(ligne);
      ligne = [];
      champ = '';
    } else champ += c;
  }
  ligne.push(champ);
  if (ligne.some((x) => x !== '')) lignes.push(ligne);
  return lignes;
}

/** Date d'une période (« 2026-10-08 », « 2026-08 », « 2026-Q2 », « 2026-10-08T00:00:00+02:00 ») → AAAA-MM-JJ. */
export function dateDePeriode(periode: string): string | null {
  const p = periode.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(p)) return p.slice(0, 10);
  if (/^\d{4}-(\d{2}|Q[1-4])$/.test(p) || /^\d{4}$/.test(p)) return finDePeriode(p);
  return null;
}

export interface Emplacement {
  /** Colonne de date (CSV), ou liste de noms possibles, la première présente est retenue. */
  date?: string | string[];
  /** Colonne de valeur (CSV) ou idbank (INSEE). */
  valeur: string | string[];
  multiplicateur?: number;
  /** INSEE : séries associées lues dans la même réponse, par clé. */
  complements?: Record<string, string>;
}

export interface Lecture {
  historique: [string, number][];
  complements: Record<string, [string, number][]>;
  /** Date de mise à jour annoncée par la source (INSEE : LAST_UPDATE). */
  miseAJour: string | null;
}

const arrondir = (n: number) => Math.round(n * 1e6) / 1e6;

function trier(points: [string, number][]): [string, number][] {
  const parDate = new Map(points);
  return [...parDate].sort((a, b) => a[0].localeCompare(b[0]));
}

/** CSV « date,valeur » : les valeurs non numériques (« . » de FRED les jours fériés, « NaN ») sont ignorées. */
export function lireSerieCsv(texte: string, e: Emplacement, separateur = ','): Lecture {
  const lignes = lireCsv(texte, separateur);
  const entete = (lignes[0] ?? []).map((x) => x.trim());
  const indice = (noms: string | string[] | undefined) => [noms ?? []].flat().map((n) => entete.indexOf(n)).find((i) => i >= 0) ?? -1;
  const iDate = indice(e.date);
  const iValeur = indice(e.valeur);
  if (iDate < 0 || iValeur < 0) {
    throw new Error(`colonnes introuvables (${[e.date].flat().join(' / ')} ; ${[e.valeur].flat().join(' / ')}) : réponse inattendue`);
  }
  const m = e.multiplicateur ?? 1;
  const points: [string, number][] = [];
  for (const l of lignes.slice(1)) {
    const date = dateDePeriode(l[iDate] ?? '');
    const brut = (l[iValeur] ?? '').trim().replace(',', '.');
    const valeur = Number(brut);
    if (date && brut !== '' && Number.isFinite(valeur)) points.push([date, arrondir(valeur * m)]);
  }
  if (points.length === 0) throw new Error('aucune valeur lisible dans la réponse');
  return { historique: trier(points), complements: {}, miseAJour: null };
}

/** Réponse SDMX de l'API BDM : série principale et séries associées, par idbank. */
export function lireSerieInsee(xml: string, e: Emplacement): Lecture {
  const series = lireSeriesInsee(xml);
  const m = e.multiplicateur ?? 1;
  const convertir = (idbank: string, multiplicateur: number): [string, number][] =>
    trier((series.get(idbank)?.observations ?? []).map((o) => [finDePeriode(o.periode), arrondir(o.valeur * multiplicateur)] as [string, number]));
  const idbank = [e.valeur].flat()[0] ?? '';
  const historique = convertir(idbank, m);
  if (historique.length === 0) throw new Error(`série ${idbank} absente de la réponse de l'INSEE`);
  const complements = Object.fromEntries(Object.entries(e.complements ?? {}).map(([cle, id]) => [cle, convertir(id, 1)]));
  return { historique, complements, miseAJour: series.get(idbank)?.derniereMaj ?? null };
}

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/**
 * « Prochaine publication : le 18 décembre 2026 à 8h45. » d'une page « Informations rapides » de l'INSEE
 * → { date: '2026-12-18', heure: '08:45' } ; null si la mention est absente.
 */
export function lireProchainePublicationInsee(html: string): { date: string; heure: string | null } | null {
  const texte = decoderEntites(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
  const m = /Prochaine publication\s*:\s*le\s+(\d{1,2})(?:er)?\s+([a-zéû]+)\s+(\d{4})(?:\s+à\s+(\d{1,2})\s*h\s*(\d{2})?)?/i.exec(texte);
  if (!m) return null;
  const mois = MOIS.indexOf((m[2] ?? '').toLowerCase());
  if (mois < 0) return null;
  const date = `${m[3]}-${String(mois + 1).padStart(2, '0')}-${(m[1] ?? '').padStart(2, '0')}`;
  const heure = m[4] ? `${m[4].padStart(2, '0')}:${m[5] ?? '00'}` : null;
  return { date, heure };
}
