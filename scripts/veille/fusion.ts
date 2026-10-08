/**
 * Fusion, déduplication, classement et conservation (docs/VEILLE.md) :
 *  - déduplication sur URL normalisée puis similarité de titre ;
 *  - classement par mots-clés (veille/mots-cles.json), recalculé à chaque exécution pour que
 *    toute modification des règles s'applique aussi aux articles déjà publiés ;
 *  - 60 jours glissants dans public/news.json ; au-delà, archives mensuelles public/archives/AAAA-MM.json.
 */
import type { Article, Indicateur, NewsJson, SourceCitee } from '../../src/modules/veille/modele.ts';
import { classer, type MotsCles } from './classement.ts';
import type { ArticleFlux } from './couche-a.ts';
import { dedoublonner, idArticle } from './normalisation.ts';

export function depuisFlux(a: ArticleFlux, aujourdhui: string, origine: Article['origine'] = 'flux'): Article {
  return {
    id: idArticle(a.url), titre: a.titre, source: a.source, source_id: a.source_id, url: a.url, date: a.date,
    theme: a.theme, resume: a.resume, importance: null, public: [], type: a.type, origine, collecte_le: aujourdhui,
  };
}

/** Réunit deux exemplaires d'une même information : le premier (déjà publié) prime, ses champs vides sont complétés. */
export function reunir(a: Article, b: Article): Article {
  return {
    ...a,
    resume: a.resume ?? b.resume,
    type: a.type ?? b.type,
    collecte_le: a.collecte_le < b.collecte_le ? a.collecte_le : b.collecte_le,
  };
}

/** Fusionne les articles déjà publiés et ceux du jour (les déjà publiés passent en premier). */
export function fusionnerArticles(precedents: readonly Article[], nouveaux: readonly Article[]): Article[] {
  return dedoublonner([...precedents, ...nouveaux], reunir);
}

/**
 * Classe chaque article par mots-clés. Le thème de départ est celui de la source (catalogue), pour
 * qu'un changement de règles puisse aussi « déclasser » un article. Les articles exclus sont retirés.
 */
export function appliquerClassement(
  articles: readonly Article[],
  regles: MotsCles,
  themeSource: (sourceId: string | null) => Article['theme'] | null,
): { articles: Article[]; exclus: number; marginaux: number } {
  let exclus = 0;
  let marginaux = 0;
  const resultat: Article[] = [];
  for (const a of articles) {
    const c = classer({ ...a, theme: themeSource(a.source_id) ?? a.theme }, regles);
    if (c.exclu) {
      exclus++;
      continue;
    }
    if (c.importance === 1) marginaux++;
    resultat.push({ ...a, theme: c.theme, importance: c.importance, public: c.public });
  }
  return { articles: resultat, exclus, marginaux };
}

export function trierArticles(articles: readonly Article[]): Article[] {
  return [...articles].sort((a, b) => b.date.localeCompare(a.date) || (b.importance ?? 0) - (a.importance ?? 0) || a.titre.localeCompare(b.titre, 'fr'));
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

/** Indicateurs du jour fournis par les API (couche B) ; à défaut, ceux déjà publiés. */
export function indicateursDuJour(nouveaux: readonly Indicateur[], precedents: readonly Indicateur[]): Indicateur[] {
  return nouveaux.length ? [...nouveaux] : [...precedents];
}

/** Contenu comparable d'un news.json (sans l'horodatage), pour n'écrire le fichier que s'il a changé. */
export function empreinteNews(news: NewsJson): string {
  const { genere_le: _genere, ...reste } = news;
  return JSON.stringify(reste);
}

export function sourcesCitees(sources: readonly { id: string; nom: string; url?: string; type: string; statut: string }[]): SourceCitee[] {
  return sources
    .filter((s) => s.type !== 'api' && s.statut === 'verifie')
    .map((s) => {
      let url: string | null = null;
      try {
        url = s.url ? new URL(s.url).origin : null;
      } catch {
        url = null;
      }
      return { id: s.id, nom: s.nom, url };
    });
}
