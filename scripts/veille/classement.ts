/**
 * Classement de la veille par mots-clés (veille/mots-cles.json), sans IA :
 * thème, importance de 1 à 5, public cible, exclusions.
 *
 * Règles (identiques à celles décrites dans le fichier de configuration) :
 *  - texte examiné : titre + résumé, sans accents ni majuscules ;
 *  - un mot-clé reconnaît le début d'un mot (« comptab » trouve « comptabilité ») ; précédé de « = », il ne
 *    reconnaît que le mot ou l'expression exacte (« =plf » ne trouve pas « plfss ») ;
 *  - score d'un thème = somme des poids des mots-clés trouvés (chacun une fois) × coefficient de la nature
 *    de la source (officielle 1, alerte presse moins) + bonus de la source ;
 *  - thème retenu : score le plus élevé, à défaut celui de la source ;
 *  - importance : premier seuil atteint (5, puis 4, 3, 2), sinon 1 (marginal, masqué par défaut à l'écran) ;
 *  - bonus de fraîcheur : ajouté au score de tri (articles récents en tête), sans effet sur l'importance ;
 *  - public : publics dont un mot-clé est trouvé, à défaut le public par défaut du thème retenu ;
 *  - exclusion générale : l'article n'est pas publié ; exclusion de thème : ce thème ne peut pas être attribué.
 */
import { PUBLICS, THEMES, type DetailScore, type Importance, type Origine, type Public, type Theme } from '../../src/modules/veille/modele.ts';

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
  /** Coefficient appliqué aux mots-clés selon la nature de la source (défaut 1). */
  coefficients_origine?: Partial<Record<Origine, number>>;
  /** Bonus de tri pour les articles récents : le premier palier dont l'âge (en jours) n'est pas dépassé s'applique. */
  bonus_fraicheur?: { jours: number; bonus: number }[];
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
  for (const [origine, coef] of Object.entries(m.coefficients_origine ?? {})) {
    if (!['flux', 'api', 'alerte'].includes(origine) || !(Number(coef) >= 0)) erreurs.push(`coefficient d'origine invalide « ${origine} »`);
  }
  for (const palier of m.bonus_fraicheur ?? []) {
    if (!(palier.jours >= 0) || !Number.isFinite(palier.bonus)) erreurs.push('palier de bonus_fraicheur invalide');
  }
  if (erreurs.length) throw new Error(`veille/mots-cles.json invalide : ${erreurs.join(' ; ')}`);
}

export function sansAccents(texte: string): string {
  return texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const cacheMotifs = new Map<string, RegExp>();

/** Mot-clé « exact » : préfixé par « = » dans veille/mots-cles.json. */
export function estExact(mot: string): boolean {
  return mot.startsWith('=');
}

/** Libellé affiché d'un mot-clé (sans le « = » des expressions exactes). */
export function libelleMot(mot: string): string {
  return estExact(mot) ? mot.slice(1) : mot;
}

/**
 * Vrai si le texte (déjà sans accents) contient le mot-clé : au début d'un mot, ou exactement
 * (mot ou expression entière) pour un mot-clé préfixé par « = ».
 */
export function contientMot(texteNormalise: string, mot: string): boolean {
  let motif = cacheMotifs.get(mot);
  if (!motif) {
    const echappe = sansAccents(libelleMot(mot)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    motif = new RegExp(`(^|[^a-z0-9])${echappe}${estExact(mot) ? '($|[^a-z0-9])' : ''}`);
    cacheMotifs.set(mot, motif);
  }
  return motif.test(texteNormalise);
}

export interface Classement {
  exclu: boolean;
  theme: Theme;
  importance: Importance;
  public: Public[];
  /** Score thématique (fixe l'importance). */
  score: number;
  /** Score de tri : score thématique + bonus de fraîcheur. */
  scoreTri: number;
  detail: DetailScore;
}

/** Bonus de fraîcheur d'un article publié le `date` (AAAA-MM-JJ), vu le `aujourdhui`. */
export function bonusFraicheur(date: string, aujourdhui: string | undefined, paliers: MotsCles['bonus_fraicheur']): number {
  if (!aujourdhui || !paliers?.length) return 0;
  const age = Math.round((Date.parse(`${aujourdhui}T12:00:00Z`) - Date.parse(`${date}T12:00:00Z`)) / 86_400_000);
  if (!Number.isFinite(age) || age < 0) return 0;
  const palier = [...paliers].sort((a, b) => a.jours - b.jours).find((p) => age <= p.jours);
  return palier?.bonus ?? 0;
}

const arrondi = (n: number) => Math.round(n * 10) / 10;

export function importanceDepuisScore(score: number, seuils: MotsCles['seuils_importance']): Importance {
  for (const niveau of [5, 4, 3, 2] as const) {
    const seuil = seuils[String(niveau) as '5'];
    if (seuil !== undefined && score >= seuil) return niveau;
  }
  return 1;
}

export function classer(
  article: { titre: string; resume: string | null; source_id: string | null; theme: Theme; origine?: Origine; date?: string },
  regles: MotsCles,
  aujourdhui?: string,
): Classement {
  const texte = sansAccents(`${article.titre} ${article.resume ?? ''}`);
  const bonus = (article.source_id && regles.bonus_sources[article.source_id]) || 0;
  const coefficient = regles.coefficients_origine?.[article.origine ?? 'flux'] ?? 1;
  const fraicheur = article.date ? bonusFraicheur(article.date, aujourdhui, regles.bonus_fraicheur) : 0;

  if (regles.exclusions.some((mot) => contientMot(texte, mot))) {
    const detail = { mots: [], coefficient, bonus_source: 0, bonus_fraicheur: 0, score: 0 };
    return { exclu: true, theme: article.theme, importance: 1, public: [], score: 0, scoreTri: 0, detail };
  }

  let meilleur: { theme: Theme; score: number; mots: DetailScore['mots'] } | null = null;
  for (const theme of THEMES) {
    const regle = regles.themes[theme];
    if (!regle || regle.exclusions.some((mot) => contientMot(texte, mot))) continue;
    const mots: DetailScore['mots'] = [];
    for (const [mot, poids] of Object.entries(regle.mots_cles)) if (contientMot(texte, mot)) mots.push({ mot: libelleMot(mot), poids });
    const score = mots.reduce((total, m) => total + m.poids, 0);
    if (score > 0 && (!meilleur || score > meilleur.score || (score === meilleur.score && theme === article.theme))) {
      meilleur = { theme, score, mots };
    }
  }
  const theme = meilleur?.theme ?? article.theme;
  const score = arrondi((meilleur?.score ?? 0) * coefficient + bonus);

  const publics = PUBLICS.filter((p) => (regles.publics[p] ?? []).some((mot) => contientMot(texte, mot)));
  return {
    exclu: false,
    theme,
    importance: importanceDepuisScore(score, regles.seuils_importance),
    public: publics.length ? publics : [...(regles.themes[theme]?.public_par_defaut ?? [])],
    score,
    scoreTri: arrondi(score + fraicheur),
    detail: { mots: meilleur?.mots ?? [], coefficient, bonus_source: bonus, bonus_fraicheur: fraicheur, score },
  };
}
