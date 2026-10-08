/**
 * Logique pure de l'écran Veille (sans DOM) : filtres, recherche locale, brief du jour, échéances.
 */
import type { Article, Importance, NewsJson, Public, SuiviTexte, Theme } from './modele.ts';

export interface Marque {
  lu: boolean;
  important: boolean;
}

export interface Criteres {
  theme: Theme | '';
  /** Émetteur affiché (champ « source »). */
  source: string;
  /** Importance minimale ; les articles non notés passent toujours (sauf si l'on filtre « 4 et plus »). */
  importanceMin: Importance | 0;
  public: Public | '';
  recherche: string;
  nonLus: boolean;
  importants: boolean;
}

export const CRITERES_PAR_DEFAUT: Criteres = {
  theme: '', source: '', importanceMin: 2, public: '', recherche: '', nonLus: false, importants: false,
};

/** Minuscules sans accents, pour une recherche insensible aux accents. */
export function normaliser(texte: string): string {
  return texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Recherche plein texte locale : tous les mots doivent figurer dans le titre, le résumé ou la source. */
export function correspondRecherche(article: Article, recherche: string): boolean {
  const mots = normaliser(recherche).split(/\s+/).filter(Boolean);
  if (mots.length === 0) return true;
  const texte = normaliser(`${article.titre} ${article.resume ?? ''} ${article.source}`);
  return mots.every((m) => texte.includes(m));
}

export function filtrerArticles(
  articles: readonly Article[],
  criteres: Criteres,
  marques: ReadonlyMap<string, Marque>,
): Article[] {
  return articles.filter((a) => {
    if (criteres.theme && a.theme !== criteres.theme) return false;
    if (criteres.source && a.source !== criteres.source) return false;
    if (criteres.importanceMin > 0) {
      // Un article non noté reste visible, sauf si l'on ne veut que l'essentiel (4 et plus).
      if (a.importance === null ? criteres.importanceMin >= 4 : a.importance < criteres.importanceMin) return false;
    }
    if (criteres.public && !a.public.includes(criteres.public)) return false;
    const marque = marques.get(a.id);
    if (criteres.nonLus && marque?.lu) return false;
    if (criteres.importants && !marque?.important) return false;
    return correspondRecherche(a, criteres.recherche);
  });
}

/** Émetteurs présents, triés, pour la liste de filtre. */
export function sourcesPresentes(articles: readonly Article[]): string[] {
  return [...new Set(articles.map((a) => a.source))].sort((a, b) => a.localeCompare(b, 'fr'));
}

/** Brief du jour : les 5 articles d'importance 4 ou 5 les plus récents, tous thèmes confondus. */
export function briefDuJour(news: NewsJson, nombre = 5): Article[] {
  return news.articles
    .filter((a) => (a.importance ?? 0) >= 4)
    .sort((a, b) => b.date.localeCompare(a.date) || (b.importance ?? 0) - (a.importance ?? 0))
    .slice(0, nombre);
}

export interface Echeance {
  texte: string;
  libelle: string;
  date: string | null;
  etapeActuelle: string;
  indicative?: boolean;
}

/** Prochaine échéance du PLF et du PLFSS (quand le suivi en indique une). */
export function prochainesEcheances(news: NewsJson): Echeance[] {
  const resultat: Echeance[] = [];
  for (const suivi of [news.suivi.plf, news.suivi.plfss]) {
    if (!suivi) continue;
    const prochaine = suivi.prochaine_echeance ?? premiereEtapeAVenir(suivi);
    if (prochaine) {
      resultat.push({
        texte: suivi.texte, libelle: prochaine.libelle, date: prochaine.date, etapeActuelle: suivi.etape_actuelle,
        ...('indicative' in prochaine && prochaine.indicative ? { indicative: true } : {}),
      });
    }
  }
  return resultat;
}

function premiereEtapeAVenir(suivi: SuiviTexte): { libelle: string; date: string | null } | null {
  const etape = suivi.etapes.find((e) => e.statut === 'a_venir') ?? suivi.etapes.find((e) => e.statut === 'en_cours');
  return etape ? { libelle: etape.libelle, date: etape.date } : null;
}

/** Âge des données en jours entiers (pour signaler une collecte ancienne). */
export function ageEnJours(genereLe: string, maintenant: Date): number {
  const t = Date.parse(genereLe);
  return Number.isNaN(t) ? Infinity : Math.floor((maintenant.getTime() - t) / 86_400_000);
}
