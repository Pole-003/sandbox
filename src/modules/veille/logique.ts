/**
 * Logique pure de l'écran Veille (sans DOM) : filtres, recherche locale, brief du jour, échéances.
 */
import { PUBLICS, THEMES, type Article, type Importance, type NewsJson, type Public, type SuiviTexte, type Theme } from './modele.ts';

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
  /** Seulement les articles collectés depuis la visite précédente. */
  nouveaux: boolean;
}

export const CRITERES_PAR_DEFAUT: Criteres = {
  theme: '', source: '', importanceMin: 2, public: '', recherche: '', nonLus: false, importants: false, nouveaux: false,
};

/** Minuscules sans accents, pour une recherche insensible aux accents. */
export function normaliser(texte: string): string {
  return texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export interface Recherche {
  /** Mots et expressions (entre guillemets droits) qui doivent tous figurer. */
  inclus: string[];
  /** Mots précédés de « - » qui ne doivent pas figurer. */
  exclus: string[];
}

/** « "loi de finances" tva -outre-mer » → inclus [loi de finances, tva], exclus [outre-mer] (normalisés). */
export function analyserRecherche(saisie: string): Recherche {
  const inclus: string[] = [];
  const exclus: string[] = [];
  for (const m of normaliser(saisie).matchAll(/(-?)"([^"]+)"|(-?)(\S+)/g)) {
    const negatif = (m[1] ?? m[3]) === '-';
    const terme = (m[2] ?? m[4] ?? '').trim();
    if (!terme || terme === '-') continue;
    (negatif ? exclus : inclus).push(terme);
  }
  return { inclus, exclus };
}

/** Texte examiné par la recherche plein texte : titre, résumé, source, thème, publics et autres sources. */
export function texteRecherche(a: Article): string {
  return normaliser(
    [a.titre, a.resume ?? '', a.source, a.theme, ...a.public, ...(a.autres_sources ?? []).flatMap((x) => [x.titre, x.source])].join(' \n '),
  );
}

/** Recherche plein texte locale sur les 60 jours publiés : tous les termes inclus, aucun terme exclu. */
export function correspondRecherche(article: Article, recherche: string | Recherche): boolean {
  const r = typeof recherche === 'string' ? analyserRecherche(recherche) : recherche;
  if (r.inclus.length === 0 && r.exclus.length === 0) return true;
  const texte = texteRecherche(article);
  return r.inclus.every((m) => texte.includes(m)) && !r.exclus.some((m) => texte.includes(m));
}

/**
 * Découpe un texte en morceaux à surligner (insensible aux accents et aux majuscules) :
 * [{ texte, surligne }], dans l'ordre, sans perte de caractère.
 */
export function decouperSurlignage(texte: string, termes: readonly string[]): { texte: string; surligne: boolean }[] {
  if (termes.length === 0 || !texte) return [{ texte, surligne: false }];
  // Correspondance position normalisée → position d'origine (un « é » donne un seul « e »).
  let normalise = '';
  const origine: number[] = [];
  for (let i = 0; i < texte.length; i++) {
    const n = normaliser(texte[i] ?? '');
    for (const c of n) {
      normalise += c;
      origine.push(i);
    }
  }
  const marques = new Array<boolean>(texte.length).fill(false);
  for (const terme of termes) {
    if (!terme) continue;
    for (let p = normalise.indexOf(terme); p >= 0; p = normalise.indexOf(terme, p + 1)) {
      const debut = origine[p] ?? 0;
      const fin = origine[p + terme.length - 1] ?? debut;
      for (let i = debut; i <= fin; i++) marques[i] = true;
    }
  }
  const morceaux: { texte: string; surligne: boolean }[] = [];
  for (let i = 0; i < texte.length; i++) {
    const dernier = morceaux.at(-1);
    if (dernier && dernier.surligne === marques[i]) dernier.texte += texte[i];
    else morceaux.push({ texte: texte[i] ?? '', surligne: Boolean(marques[i]) });
  }
  return morceaux;
}

/** Article collecté depuis la visite précédente (dates AAAA-MM-JJ). */
export function estNouveau(article: Article, visitePrecedente: string | null): boolean {
  return visitePrecedente !== null && article.collecte_le > visitePrecedente;
}

export interface Visites {
  /** Jour de la visite précédente (sert au badge « nouveau »). */
  precedente: string | null;
  /** Jour de la visite en cours. */
  courante: string;
}

/**
 * Met à jour les visites : un nouveau jour fait de la visite courante la visite précédente.
 * Plusieurs ouvertures le même jour gardent les mêmes badges « nouveau ».
 */
export function noterVisite(enregistre: Visites | null, aujourdhui: string): Visites {
  if (!enregistre) return { precedente: null, courante: aujourdhui };
  if (enregistre.courante === aujourdhui) return enregistre;
  return { precedente: enregistre.courante, courante: aujourdhui };
}

export function lireVisites(json: string | null): Visites | null {
  try {
    const v = JSON.parse(json ?? 'null') as Visites | null;
    const date = (x: unknown) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
    return v && date(v.courante) && (v.precedente === null || date(v.precedente)) ? { precedente: v.precedente, courante: v.courante } : null;
  } catch {
    return null;
  }
}

/** Critères mémorisés (localStorage) : chaque champ est contrôlé, les valeurs inconnues reprennent le défaut. */
export function lireCriteres(json: string | null): Criteres {
  const c = { ...CRITERES_PAR_DEFAUT };
  let v: Record<string, unknown>;
  try {
    v = JSON.parse(json ?? '{}') as Record<string, unknown>;
  } catch {
    return c;
  }
  if (typeof v !== 'object' || v === null) return c;
  if ((THEMES as readonly string[]).includes(v.theme as string)) c.theme = v.theme as Theme;
  if (typeof v.source === 'string') c.source = v.source;
  if ([0, 2, 3, 4].includes(v.importanceMin as number)) c.importanceMin = v.importanceMin as Criteres['importanceMin'];
  if ((PUBLICS as readonly string[]).includes(v.public as string)) c.public = v.public as Public;
  if (typeof v.recherche === 'string') c.recherche = v.recherche.slice(0, 200);
  for (const cle of ['nonLus', 'importants', 'nouveaux'] as const) if (typeof v[cle] === 'boolean') c[cle] = v[cle];
  return c;
}

export function filtrerArticles(
  articles: readonly Article[],
  criteres: Criteres,
  marques: ReadonlyMap<string, Marque>,
  visitePrecedente: string | null = null,
): Article[] {
  const recherche = analyserRecherche(criteres.recherche);
  return articles.filter((a) => {
    if (criteres.nouveaux && !estNouveau(a, visitePrecedente)) return false;
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
    return correspondRecherche(a, recherche);
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
