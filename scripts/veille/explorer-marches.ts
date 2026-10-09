/**
 * Exploration des sources des indicateurs de marché et des API sans clé : npm run veille:explorer-marches
 *
 * Lecture seule, sans coût, sans secret : pour chaque URL candidate, vérifie robots.txt (avec le même
 * client que la collecte), puis affiche le statut HTTP, le type de contenu, le temps de réponse et la
 * dernière observation lisible (date et valeur). Sert à valider les sources avant d'écrire les
 * connecteurs (docs/VEILLE.md, « Suivi des marchés »). Les sources à clé (Webstat, EIA) ne sont
 * testées que pour vérifier qu'elles refusent l'accès anonyme.
 */
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ClientHttp, ErreurCollecte } from './http.ts';

export interface Candidat {
  id: string;
  indicateur: string;
  url: string;
  /** Extrait « date valeur » de la réponse, ou null si illisible. */
  lire?: (texte: string) => string | null;
}

/** Dernière observation d'une réponse SDMX-ML de l'INSEE (BDM). */
export function derniereObservationInsee(xml: string): string | null {
  const obs = [...xml.matchAll(/TIME_PERIOD="([^"]+)"\s+OBS_VALUE="([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`);
  // L'INSEE renvoie les observations de la plus récente à la plus ancienne.
  return obs[0] ?? null;
}

/** Dernière ligne d'un CSV « date,valeur » (BCE format csvdata, FRED). */
export function derniereLigneCsv(csv: string, colonneDate: string, colonneValeur: string): string | null {
  const lignes = csv.trim().split(/\r?\n/);
  const entete = (lignes[0] ?? '').split(',');
  const iDate = entete.indexOf(colonneDate);
  const iValeur = entete.indexOf(colonneValeur);
  if (iDate < 0 || iValeur < 0 || lignes.length < 2) return null;
  const derniere = (lignes[lignes.length - 1] ?? '').split(',');
  return `${derniere[iDate]} ${derniere[iValeur]}`;
}

const INSEE = 'https://api.insee.fr/series/BDM/V1/data/SERIES_BDM';
const BCE = 'https://data-api.ecb.europa.eu/service/data';

export const CANDIDATS: Candidat[] = [
  { id: 'insee-dette-maastricht', indicateur: 'Dette publique (Md€, trimestrielle)', url: `${INSEE}/010777616?lastNObservations=2`, lire: derniereObservationInsee },
  { id: 'insee-dette-pib', indicateur: 'Dette publique (% du PIB, trimestrielle)', url: `${INSEE}/010777608?lastNObservations=2`, lire: derniereObservationInsee },
  { id: 'insee-dette-negociable', indicateur: "Dette négociable de l'État (M€, mensuelle, données AFT)", url: `${INSEE}/001711531?lastNObservations=2`, lire: derniereObservationInsee },
  { id: 'insee-page-ir-dette', indicateur: 'Dette : page Informations rapides (prochaine publication)', url: 'https://www.insee.fr/fr/statistiques/9053525', lire: (t) => /Prochaine publication\s*(?:&nbsp;|\s)*:\s*([^<.]+)/i.exec(t)?.[1]?.trim() ?? null },
  { id: 'aft-dette-negociable', indicateur: "Dette négociable de l'État (site de l'AFT)", url: 'https://www.aft.gouv.fr/fr/dette-negociable-etat' },
  { id: 'bdf-webstat-tec10', indicateur: 'OAT 10 ans, TEC 10 quotidien (clé requise)', url: 'https://webstat.banque-france.fr/api/explore/v2.1/catalog/datasets/observations/exports/csv?refine=series_key:%22FM.D.FR.EUR.FR2.BB.FRMOYTEC10.HSTA%22&limit=1' },
  { id: 'bce-taux-long-fr', indicateur: 'OAT 10 ans, taux de convergence mensuel (BCE, sans clé)', url: `${BCE}/IRS/M.FR.L.L40.CI.0000.EUR.N.Z?lastNObservations=2&format=csvdata`, lire: (t) => derniereLigneCsv(t, 'TIME_PERIOD', 'OBS_VALUE') },
  { id: 'bce-eur-usd', indicateur: 'EUR/USD, taux de référence quotidien', url: `${BCE}/EXR/D.USD.EUR.SP00.A?lastNObservations=2&format=csvdata`, lire: (t) => derniereLigneCsv(t, 'TIME_PERIOD', 'OBS_VALUE') },
  { id: 'eia-brent-api', indicateur: 'Brent, API EIA v2 (clé requise)', url: 'https://api.eia.gov/v2/petroleum/pri/spt/data/?frequency=daily&data[0]=value&facets[series][]=RBRTE&sort[0][column]=period&sort[0][direction]=desc&length=1' },
  { id: 'fred-brent-csv', indicateur: 'Brent, FRED DCOILBRENTEU (sans clé, données EIA)', url: 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=DCOILBRENTEU', lire: (t) => derniereLigneCsv(t, 'observation_date', 'DCOILBRENTEU') },
  { id: 'bodacc-35', indicateur: 'BODACC Ille-et-Vilaine (open data DILA, sans clé)', url: 'https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records?where=numerodepartement%3D%2235%22&order_by=dateparution%20desc&limit=1&select=dateparution,familleavis_lib', lire: (t) => /"dateparution":\s*"([^"]+)"/.exec(t)?.[1] ?? null },
];

export interface ResultatExploration {
  id: string;
  indicateur: string;
  robots: string;
  http: number | null;
  contentType: string | null;
  dureeMs: number | null;
  derniere: string | null;
  message: string | null;
}

export async function explorer(client: ClientHttp, c: Candidat): Promise<ResultatExploration> {
  const base: ResultatExploration = { id: c.id, indicateur: c.indicateur, robots: '—', http: null, contentType: null, dureeMs: null, derniere: null, message: null };
  try {
    const droit = await client.autorise(new URL(c.url));
    base.robots = droit.autorise ? `autorisé (${droit.detail})` : `refusé (${droit.detail})`;
    if (!droit.autorise) return base;
    const r = await client.recuperer(c.url);
    const texte = new TextDecoder().decode(r.octets);
    const lu = r.statut >= 200 && r.statut < 300 && c.lire ? c.lire(texte) : null;
    return {
      ...base,
      http: r.statut,
      contentType: r.contentType?.split(';')[0]?.trim() ?? null,
      dureeMs: r.dureeMs,
      derniere: lu,
      message: r.statut >= 400 ? texte.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160) : null,
    };
  } catch (e) {
    return { ...base, message: e instanceof ErreurCollecte ? e.message : String(e) };
  }
}

function cellule(v: string | number | null): string {
  return v === null || v === '' ? '—' : String(v).replace(/\|/g, '\\|');
}

export function rapportMarkdown(resultats: ResultatExploration[], horodatage: Date): string {
  const lignes = [
    `## Exploration des sources des indicateurs — ${horodatage.toISOString()}`,
    '',
    '| Source | Indicateur | robots.txt | HTTP | Contenu | Temps | Dernière observation | Détail |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const r of resultats) {
    const temps = r.dureeMs === null ? null : `${(r.dureeMs / 1000).toFixed(1).replace('.', ',')} s`;
    lignes.push(`| ${r.id} | ${cellule(r.indicateur)} | ${cellule(r.robots)} | ${cellule(r.http)} | ${cellule(r.contentType)} | ${cellule(temps)} | ${cellule(r.derniere)} | ${cellule(r.message)} |`);
  }
  return lignes.join('\n');
}

async function principal(): Promise<void> {
  const client = new ClientHttp({ userAgent: 'Pole003-Veille/1.0 (+https://pole-003.github.io/sandbox)', delaiMaxMs: 20_000, intervalleParDomaineMs: 1_000 });
  const resultats = await Promise.all(CANDIDATS.map((c) => explorer(client, c)));
  const rapport = rapportMarkdown(resultats, new Date());
  console.log(`\n${rapport}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${rapport}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  principal().catch((e: unknown) => {
    console.error("L'exploration a échoué :", e);
    process.exit(1);
  });
}
