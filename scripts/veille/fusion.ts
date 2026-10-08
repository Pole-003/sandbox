/**
 * Fusion, déduplication et conservation (docs/VEILLE.md) :
 *  - un article trouvé par la couche A et par la couche C garde les métadonnées de A et le résumé de C ;
 *  - 60 jours glissants dans public/news.json ; au-delà, archives mensuelles public/archives/AAAA-MM.json.
 */
import type { Article, Indicateur, NewsJson, SourceCitee, SuiviTexte, Theme } from '../../src/modules/veille/modele.ts';
import type { ArticleFlux } from './couche-a.ts';
import type { ResultatTheme } from './couche-c.ts';
import { dedoublonner, idArticle } from './normalisation.ts';
import type { Note } from './notation.ts';

export function depuisFlux(a: ArticleFlux, aujourdhui: string): Article {
  return {
    id: idArticle(a.url), titre: a.titre, source: a.source, source_id: a.source_id, url: a.url, date: a.date,
    theme: a.theme, resume: null, importance: null, public: [], type: null, origine: 'flux', collecte_le: aujourdhui,
  };
}

export function depuisRecherche(r: ResultatTheme, aujourdhui: string): Article[] {
  return r.articles.map((a) => ({
    id: idArticle(a.url), titre: a.titre, source: a.source, source_id: null, url: a.url, date: a.date_publication,
    theme: r.theme, resume: a.resume, importance: a.importance, public: a.public, type: a.type,
    origine: 'recherche_ia' as const, collecte_le: aujourdhui,
  }));
}

const vientDuFlux = (a: Article) => a.origine !== 'recherche_ia';
const vientDeLIa = (a: Article) => a.origine !== 'flux';

/**
 * Réunit deux exemplaires d'une même information.
 * Métadonnées (titre, émetteur, lien, date, thème) : celles du flux si l'un des deux en vient.
 * Résumé et notation : ceux de la recherche IA si l'un des deux en vient, sinon le premier renseigné.
 */
export function reunir(a: Article, b: Article): Article {
  const meta = vientDuFlux(a) || !vientDuFlux(b) ? a : b;
  const ia = vientDeLIa(a) && a.resume ? a : vientDeLIa(b) && b.resume ? b : null;
  const autre = meta === a ? b : a;
  const origine = (vientDuFlux(a) || vientDuFlux(b)) && (vientDeLIa(a) || vientDeLIa(b)) ? 'flux_et_ia' : meta.origine;
  return {
    ...meta,
    resume: ia?.resume ?? meta.resume ?? autre.resume,
    importance: ia?.importance ?? meta.importance ?? autre.importance,
    public: ia?.public.length ? ia.public : meta.public.length ? meta.public : autre.public,
    type: ia?.type ?? meta.type ?? autre.type,
    origine,
    collecte_le: a.collecte_le < b.collecte_le ? a.collecte_le : b.collecte_le,
  };
}

/** Fusionne les articles déjà publiés et ceux du jour (les déjà publiés passent en premier). */
export function fusionnerArticles(precedents: readonly Article[], nouveaux: readonly Article[]): Article[] {
  return dedoublonner([...precedents, ...nouveaux], reunir);
}

/**
 * Applique les notes de la notation groupée. Les articles notés 1 (marginaux) restent dans news.json
 * avec cette note, pour ne pas être renotés chaque jour ; l'interface les masque par défaut.
 */
export function appliquerNotes(articles: readonly Article[], notes: ReadonlyMap<string, Note>): { articles: Article[]; marginaux: number } {
  let marginaux = 0;
  const resultat = articles.map((a) => {
    const note = notes.get(a.id);
    if (!note) return a;
    if (note.importance === 1) marginaux++;
    return { ...a, importance: note.importance, public: note.public, type: note.type, resume: a.resume ?? note.resume };
  });
  return { articles: resultat, marginaux };
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

export function indicateursDuJour(resultats: readonly ResultatTheme[], precedents: readonly Indicateur[], aujourdhui: string): Indicateur[] {
  const economie = resultats.find((r) => r.theme === 'Économie et statistiques' && r.statut === 'ok');
  if (!economie || economie.indicateurs.length === 0) return [...precedents];
  return economie.indicateurs.map((i) => ({ ...i, verifie_par_api: false, collecte_le: aujourdhui }));
}

export function suiviDuJour(resultats: readonly ResultatTheme[], theme: Theme, precedent: SuiviTexte | null, aujourdhui: string): SuiviTexte | null {
  const suivi = resultats.find((r) => r.theme === theme && r.statut === 'ok')?.suivi;
  return suivi ? { ...suivi, mis_a_jour_le: aujourdhui } : precedent;
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
