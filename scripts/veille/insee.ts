/**
 * Lecture des réponses de l'API BDM de l'INSEE (SDMX-ML « StructureSpecificData »), partagée par
 * la veille (indicateurs de la couche B) et le suivi des marchés (dette publique).
 *
 * API ouverte, sans clé : https://api.insee.fr/series/BDM/V1/data/SERIES_BDM/<idbank>+<idbank>…
 * Son robots.txt est injoignable depuis GitHub Actions (connexion coupée, 09/10/2026) : les appels
 * utilisent la politique « api_documentee » (voir http.ts).
 */
import { decoderEntites } from './flux.ts';

export interface ObservationInsee {
  /** Période SDMX : « 2026 », « 2026-Q2 », « 2026-08 ». */
  periode: string;
  valeur: number;
}

export interface SerieInsee {
  idbank: string;
  titre: string;
  /** Date de dernière mise à jour de la série (AAAA-MM-JJ), quand l'INSEE la fournit. */
  derniereMaj: string | null;
  /** Observations triées de la plus ancienne à la plus récente. */
  observations: ObservationInsee[];
}

export const URL_API_BDM = 'https://api.insee.fr/series/BDM/V1/data/SERIES_BDM';

export function urlSeriesInsee(idbanks: readonly string[], dernieres?: number): string {
  return `${URL_API_BDM}/${idbanks.join('+')}${dernieres ? `?lastNObservations=${dernieres}` : ''}`;
}

const attribut = (balise: string, nom: string) => {
  const v = new RegExp(`\\b${nom}="([^"]*)"`).exec(balise)?.[1];
  return v === undefined ? null : decoderEntites(v);
};

/** Séries d'une réponse BDM, par idbank. Les observations sans valeur numérique sont ignorées. */
export function lireSeriesInsee(xml: string): Map<string, SerieInsee> {
  const series = new Map<string, SerieInsee>();
  for (const m of xml.matchAll(/<Series\b([^>]*)>([\s\S]*?)<\/Series>/g)) {
    const entete = m[1] ?? '';
    const idbank = attribut(entete, 'IDBANK');
    if (!idbank) continue;
    const observations: ObservationInsee[] = [];
    for (const o of (m[2] ?? '').matchAll(/<Obs\b([^>]*)\/?>/g)) {
      const periode = attribut(o[1] ?? '', 'TIME_PERIOD');
      const valeur = Number(attribut(o[1] ?? '', 'OBS_VALUE'));
      if (periode && attribut(o[1] ?? '', 'OBS_VALUE') !== null && Number.isFinite(valeur)) observations.push({ periode, valeur });
    }
    observations.sort((a, b) => a.periode.localeCompare(b.periode));
    series.set(idbank, { idbank, titre: attribut(entete, 'TITLE_FR') ?? idbank, derniereMaj: attribut(entete, 'LAST_UPDATE'), observations });
  }
  return series;
}

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** « 2026-Q2 » → « 2e trimestre 2026 », « 2026-08 » → « août 2026 », « 2026 » → « 2026 ». */
export function periodeEnClair(periode: string): string {
  const t = /^(\d{4})-Q([1-4])$/.exec(periode);
  if (t) return `${t[2] === '1' ? '1er' : `${t[2]}e`} trimestre ${t[1]}`;
  const m = /^(\d{4})-(\d{2})$/.exec(periode);
  if (m) return `${MOIS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
  return periode;
}

/** Date de fin d'une période SDMX (AAAA-MM-JJ) : « 2026-Q2 » → « 2026-06-30 ». */
export function finDePeriode(periode: string): string {
  const fin = (annee: number, mois: number) => new Date(Date.UTC(annee, mois, 0)).toISOString().slice(0, 10);
  const t = /^(\d{4})-Q([1-4])$/.exec(periode);
  if (t) return fin(Number(t[1]), Number(t[2]) * 3);
  const m = /^(\d{4})-(\d{2})$/.exec(periode);
  if (m) return fin(Number(m[1]), Number(m[2]));
  const a = /^(\d{4})$/.exec(periode);
  if (a) return `${a[1]}-12-31`;
  return periode.slice(0, 10);
}
