/**
 * Classement de la veille par mots-clés (veille/mots-cles.json), sans IA :
 * thème, importance de 1 à 5, public cible, exclusions.
 *
 * Règles (identiques à celles décrites dans le fichier de configuration) :
 *  - texte examiné : titre + résumé, sans accents ni majuscules ;
 *  - un mot-clé reconnaît le début d'un mot (« comptab » trouve « comptabilité ») ;
 *  - score d'un thème = somme des poids des mots-clés trouvés (chacun une fois) + bonus de la source ;
 *  - thème retenu : score le plus élevé, à défaut celui de la source ;
 *  - importance : premier seuil atteint (5, puis 4, 3, 2), sinon 1 (marginal, masqué par défaut à l'écran) ;
 *  - public : publics dont un mot-clé est trouvé, à défaut le public par défaut du thème retenu ;
 *  - exclusion générale : l'article n'est pas publié ; exclusion de thème : ce thème ne peut pas être attribué.
 */
import { PUBLICS, THEMES, type Importance, type Public, type Theme } from '../../src/modules/veille/modele.ts';

export interface RegleTheme {
  public_par_defaut: Public[];
  mots_cles: Record<string, number>;
  exclusions: string[];
}

export interface MotsCles {
  seuils_importance: Partial<Record<'2' | '3' | '4' | '5', number>>;
  bonus_sources: Record<string, number>;
  exclusions: string[];
  themes: Partial<Record<Theme, RegleTheme>>;
  publics: Partial<Record<Public, string[]>>;
}

export function verifierMotsCles(m: MotsCles): void {
  const erreurs: string[] = [];
  for (const [theme, regle] of Object.entries(m.themes ?? {})) {
    if (!(THEMES as readonly string[]).includes(theme)) erreurs.push(`thème inconnu « ${theme} »`);
    for (const [mot, poids] of Object.entries(regle?.mots_cles ?? {})) {
      if (!Number.isFinite(poids)) erreurs.push(`poids invalide pour « ${mot} » (${theme})`);
    }
    for (const p of regle?.public_par_defaut ?? []) if (!(PUBLICS as readonly string[]).includes(p)) erreurs.push(`public inconnu « ${p} » (${theme})`);
  }
  for (const p of Object.keys(m.publics ?? {})) if (!(PUBLICS as readonly string[]).includes(p)) erreurs.push(`public inconnu « ${p} »`);
  for (const [cle, seuil] of Object.entries(m.seuils_importance ?? {})) {
    if (!['2', '3', '4', '5'].includes(cle) || !Number.isFinite(seuil)) erreurs.push(`seuil d'importance invalide « ${cle} »`);
  }
  if (erreurs.length) throw new Error(`veille/mots-cles.json invalide : ${erreurs.join(' ; ')}`);
}

export function sansAccents(texte: string): string {
  return texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const cacheMotifs = new Map<string, RegExp>();

/** Vrai si le texte (déjà sans accents) contient le mot-clé au début d'un mot. */
export function contientMot(texteNormalise: string, mot: string): boolean {
  let motif = cacheMotifs.get(mot);
  if (!motif) {
    const echappe = sansAccents(mot).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    motif = new RegExp(`(^|[^a-z0-9])${echappe}`);
    cacheMotifs.set(mot, motif);
  }
  return motif.test(texteNormalise);
}

export interface Classement {
  exclu: boolean;
  theme: Theme;
  importance: Importance;
  public: Public[];
  score: number;
}

export function importanceDepuisScore(score: number, seuils: MotsCles['seuils_importance']): Importance {
  for (const niveau of [5, 4, 3, 2] as const) {
    const seuil = seuils[String(niveau) as '5'];
    if (seuil !== undefined && score >= seuil) return niveau;
  }
  return 1;
}

export function classer(
  article: { titre: string; resume: string | null; source_id: string | null; theme: Theme },
  regles: MotsCles,
): Classement {
  const texte = sansAccents(`${article.titre} ${article.resume ?? ''}`);
  const bonus = (article.source_id && regles.bonus_sources[article.source_id]) || 0;

  if (regles.exclusions.some((mot) => contientMot(texte, mot))) {
    return { exclu: true, theme: article.theme, importance: 1, public: [], score: 0 };
  }

  let meilleur: { theme: Theme; score: number } | null = null;
  for (const theme of THEMES) {
    const regle = regles.themes[theme];
    if (!regle || regle.exclusions.some((mot) => contientMot(texte, mot))) continue;
    let score = 0;
    for (const [mot, poids] of Object.entries(regle.mots_cles)) if (contientMot(texte, mot)) score += poids;
    if (score > 0 && (!meilleur || score > meilleur.score || (score === meilleur.score && theme === article.theme))) {
      meilleur = { theme, score };
    }
  }
  const theme = meilleur?.theme ?? article.theme;
  const score = (meilleur?.score ?? 0) + bonus;

  const publics = PUBLICS.filter((p) => (regles.publics[p] ?? []).some((mot) => contientMot(texte, mot)));
  return {
    exclu: false,
    theme,
    importance: importanceDepuisScore(score, regles.seuils_importance),
    public: publics.length ? publics : [...(regles.themes[theme]?.public_par_defaut ?? [])],
    score,
  };
}
