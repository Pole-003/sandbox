/**
 * Fusion, déduplication, classement et conservation (docs/VEILLE.md) :
 *  - déduplication sur URL normalisée puis similarité de titre ; regroupement des articles similaires
 *    venant de sources différentes (l'article principal liste les autres sources) ;
 *  - classement par mots-clés (veille/mots-cles.json), recalculé à chaque exécution pour que
 *    toute modification des règles s'applique aussi aux articles déjà publiés ;
 *  - 60 jours glissants dans public/news.json ; au-delà, archives mensuelles public/archives/AAAA-MM.json.
 */
import type { Article, AutreSource, Indicateur, NewsJson, SourceCitee } from '../../src/modules/veille/modele.ts';
import { classer, type MotsCles } from './classement.ts';
import type { ArticleFlux } from './couche-a.ts';
import { dedoublonner, idArticle, normaliserUrl, SEUIL_REGROUPEMENT } from './normalisation.ts';

export function depuisFlux(a: ArticleFlux, aujourdhui: string, origine: Article['origine'] = 'flux'): Article {
  return {
    id: idArticle(a.url), titre: a.titre, source: a.source, source_id: a.source_id, url: a.url, date: a.date,
    theme: a.theme, resume: a.resume, importance: null, public: [], type: a.type, origine, collecte_le: aujourdhui,
    ...(a.theme_source ? { theme_source: a.theme_source } : {}),
  };
}

/** Une alerte de presse ne prend jamais le pas sur une publication officielle. */
const rangOrigine = (a: Article) => (a.origine === 'alerte' ? 1 : 0);

/**
 * Réunit deux exemplaires d'une même information : le premier (déjà publié) prime, ses champs vides sont
 * complétés ; sauf si le premier est une alerte de presse et le second une publication officielle.
 * Un exemplaire d'une autre source, à une autre adresse, est gardé dans « autres_sources ».
 */
export function reunir(a: Article, b: Article): Article {
  const [principal, second] = rangOrigine(b) < rangOrigine(a) ? [b, a] : [a, b];
  const autres = new Map<string, AutreSource>();
  for (const x of [...(principal.autres_sources ?? []), ...(second.autres_sources ?? [])]) autres.set(normaliserUrl(x.url), x);
  if (second.source !== principal.source && normaliserUrl(second.url) !== normaliserUrl(principal.url)) {
    autres.set(normaliserUrl(second.url), { source: second.source, url: second.url, titre: second.titre });
  }
  autres.delete(normaliserUrl(principal.url));
  const fusion: Article = {
    ...principal,
    resume: principal.resume ?? second.resume,
    type: principal.type ?? second.type,
    collecte_le: principal.collecte_le < second.collecte_le ? principal.collecte_le : second.collecte_le,
  };
  delete fusion.autres_sources;
  return autres.size ? { ...fusion, autres_sources: [...autres.values()] } : fusion;
}

/** Fusionne les articles déjà publiés et ceux du jour (les déjà publiés passent en premier). */
export function fusionnerArticles(precedents: readonly Article[], nouveaux: readonly Article[]): Article[] {
  return dedoublonner([...precedents, ...nouveaux], reunir, {
    urlsRattachees: (a) => (a.autres_sources ?? []).map((x) => x.url),
    seuilSourcesDifferentes: SEUIL_REGROUPEMENT,
    source: (a) => a.source,
  });
}

/**
 * Classe chaque article par mots-clés. Le thème de départ est celui de la source (catalogue), pour
 * qu'un changement de règles puisse aussi « déclasser » un article. Les articles exclus sont retirés.
 */
export function appliquerClassement(
  articles: readonly Article[],
  regles: MotsCles,
  themeSource: (sourceId: string | null) => Article['theme'] | null,
  aujourdhui?: string,
): { articles: Article[]; exclus: number; marginaux: number } {
  let exclus = 0;
  let marginaux = 0;
  const resultat: Article[] = [];
  for (const a of articles) {
    const c = classer({ ...a, theme: a.theme_source ?? themeSource(a.source_id) ?? a.theme }, regles, aujourdhui);
    if (c.exclu) {
      exclus++;
      continue;
    }
    if (c.importance === 1) marginaux++;
    resultat.push({ ...a, theme: c.theme, importance: c.importance, public: c.public, score: c.scoreTri, pourquoi: c.detail });
  }
  return { articles: resultat, exclus, marginaux };
}

export function trierArticles(articles: readonly Article[]): Article[] {
  return [...articles].sort(
    (a, b) =>
      b.date.localeCompare(a.date) || (b.importance ?? 0) - (a.importance ?? 0) || (b.score ?? 0) - (a.score ?? 0) || a.titre.localeCompare(b.titre, 'fr'),
  );
}

/** Sépare les articles à garder (date ≥ limite) de ceux à archiver, regroupés par mois AAAA-MM. */
export function repartirConservation(articles: readonly Article[], limite: string): { gardes: Article[]; archives: Map<string, Article[]> } {
  const gardes: Article[] = [];
  const archives = new Map<string, Article[]>();
  for (const a of articles) {
    if (a.date >= limite) {
      gardes.push(a);
      continue;
    }
    const mois = a.date.slice(0, 7);
    archives.set(mois, [...(archives.get(mois) ?? []), a]);
  }
  return { gardes, archives };
}

/** Ajoute des articles à une archive mensuelle existante, sans doublon. */
export function completerArchive(existants: readonly Article[], ajouts: readonly Article[]): Article[] {
  return trierArticles(fusionnerArticles(existants, ajouts));
}

/**
 * Indicateurs du jour fournis par les API (couche B) : ceux d'une source lue aujourd'hui remplacent
 * les siens ; une source en panne garde ses indicateurs déjà publiés.
 */
export function indicateursDuJour(nouveaux: readonly Indicateur[], precedents: readonly Indicateur[]): Indicateur[] {
  const lues = new Set(nouveaux.map((i) => i.source_id ?? ''));
  return [...nouveaux, ...precedents.filter((i) => !lues.has(i.source_id ?? ''))];
}

/** Contenu comparable d'un news.json (sans l'horodatage), pour n'écrire le fichier que s'il a changé. */
export function empreinteNews(news: NewsJson): string {
  const { genere_le: _genere, ...reste } = news;
  return JSON.stringify(reste);
}

export function sourcesCitees(sources: readonly { id: string; nom: string; url?: string; type: string; statut: string }[]): SourceCitee[] {
  return sources
    .filter((s) => ['rss', 'page', 'dossier', 'calendrier'].includes(s.type) && s.statut === 'verifie')
    .map((s) => {
      let url: string | null = null;
      try {
        url = s.url ? new URL(s.url.replace('{annee}', '2000')).origin : null;
      } catch {
        url = null;
      }
      return { id: s.id, nom: s.nom, url };
    });
}
