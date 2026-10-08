/**
 * Contrôles automatiques des réponses de la couche C (docs/VEILLE.md), faits par le code et non par l'IA :
 *  - JSON conforme au schéma ;
 *  - toute URL d'article doit figurer parmi les URL citées par l'outil de recherche ;
 *  - date de publication dans la fenêtre de veille.
 */
import {
  PUBLICS,
  TYPES_ARTICLE,
  type Importance,
  type Public,
  type StatutEtape,
  type TypeArticle,
} from '../../src/modules/veille/modele.ts';
import { normaliserUrl } from './normalisation.ts';

export interface ArticleIA {
  titre: string;
  resume: string;
  source: string;
  url: string;
  date_publication: string;
  importance: Importance;
  public: Public[];
  type: TypeArticle;
}

export interface IndicateurIA {
  libelle: string;
  valeur: string;
  periode: string;
  source: string;
  url: string;
  date_publication: string;
}

export interface SuiviIA {
  texte: string;
  etape_actuelle: string;
  etapes: { libelle: string; date: string | null; statut: StatutEtape }[];
  prochaine_echeance: { libelle: string; date: string | null } | null;
}

export interface Rejet {
  titre: string;
  url: string | null;
  raison: string;
}

/** Schéma de réponse envoyé au modèle (même structure que celle vérifiée ci-dessous). */
export function schemaReponse(theme: string): string {
  return JSON.stringify(
    {
      theme,
      articles: [
        {
          titre: '…',
          resume: '… (2 phrases maximum, avec tes propres mots)',
          source: 'émetteur, ex. Assemblée nationale',
          url: 'https://… (URL exacte d’un résultat de recherche)',
          date_publication: 'AAAA-MM-JJ',
          importance: '2 à 5',
          public: [...PUBLICS],
          type: TYPES_ARTICLE.join(' | '),
        },
      ],
      indicateurs: [{ libelle: '…', valeur: '…', periode: '…', source: '…', url: 'https://…', date_publication: 'AAAA-MM-JJ' }],
      suivi_texte: {
        texte: 'PLF 2027',
        etape_actuelle: '…',
        etapes: [{ libelle: '…', date: 'AAAA-MM-JJ ou null', statut: 'fait | en_cours | a_venir' }],
        prochaine_echeance: { libelle: '…', date: 'AAAA-MM-JJ ou null' },
      },
    },
    null,
    2,
  );
}

const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const chaine = (v: unknown, max = 2_000): v is string => typeof v === 'string' && v.trim() !== '' && v.length <= max;

/** Date ISO AAAA-MM-JJ existante. */
export function estDateIso(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function urlHttps(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

export type ResultatStructure =
  | { ok: true; articles: unknown[]; indicateurs: unknown[]; suivi: unknown }
  | { ok: false; raison: string };

/** Contrôle de la structure d'ensemble : en cas d'échec, le thème est redemandé une fois, puis abandonné. */
export function verifierStructure(reponse: unknown, theme: string): ResultatStructure {
  if (!estObjet(reponse)) return { ok: false, raison: 'la réponse n’est pas un objet JSON' };
  if (reponse.theme !== theme) return { ok: false, raison: `thème « ${String(reponse.theme)} » au lieu de « ${theme} »` };
  if (!Array.isArray(reponse.articles)) return { ok: false, raison: 'champ « articles » absent ou non tableau' };
  if (reponse.indicateurs !== undefined && reponse.indicateurs !== null && !Array.isArray(reponse.indicateurs)) {
    return { ok: false, raison: 'champ « indicateurs » non tableau' };
  }
  if (reponse.suivi_texte !== undefined && reponse.suivi_texte !== null && !estObjet(reponse.suivi_texte)) {
    return { ok: false, raison: 'champ « suivi_texte » non objet' };
  }
  return { ok: true, articles: reponse.articles, indicateurs: (reponse.indicateurs as unknown[] | null) ?? [], suivi: reponse.suivi_texte ?? null };
}

export interface ContexteControle {
  /** URL normalisées citées par l'outil de recherche dans la réponse. */
  urlsCitees: ReadonlySet<string>;
  /** Fenêtre inclusive, AAAA-MM-JJ. */
  debut: string;
  fin: string;
}

type Verdict<T> = { ok: true; valeur: T } | { ok: false; rejet: Rejet };

function rejet(brut: unknown, raison: string): { ok: false; rejet: Rejet } {
  const o = estObjet(brut) ? brut : {};
  return {
    ok: false,
    rejet: {
      titre: typeof o.titre === 'string' ? o.titre : typeof o.libelle === 'string' ? o.libelle : '(sans titre)',
      url: typeof o.url === 'string' ? o.url : null,
      raison,
    },
  };
}

export function controlerArticle(brut: unknown, ctx: ContexteControle): Verdict<ArticleIA> {
  if (!estObjet(brut)) return rejet(brut, 'non conforme au schéma : article non objet');
  const a = brut;
  if (!chaine(a.titre, 300)) return rejet(brut, 'non conforme au schéma : titre absent ou trop long');
  if (!chaine(a.resume, 600)) return rejet(brut, 'non conforme au schéma : résumé absent ou trop long');
  if (!chaine(a.source, 150)) return rejet(brut, 'non conforme au schéma : source absente');
  const url = urlHttps(a.url);
  if (!url) return rejet(brut, 'non conforme au schéma : URL absente ou non https');
  if (!estDateIso(a.date_publication)) return rejet(brut, 'non conforme au schéma : date_publication invalide');
  if (!Number.isInteger(a.importance) || (a.importance as number) < 1 || (a.importance as number) > 5) {
    return rejet(brut, 'non conforme au schéma : importance hors de 1 à 5');
  }
  if (a.importance === 1) return rejet(brut, 'importance 1 (marginal) : exclu par la consigne');
  if (!Array.isArray(a.public) || a.public.length === 0 || !a.public.every((p) => (PUBLICS as readonly unknown[]).includes(p))) {
    return rejet(brut, 'non conforme au schéma : public absent ou inconnu');
  }
  if (!(TYPES_ARTICLE as readonly unknown[]).includes(a.type)) return rejet(brut, 'non conforme au schéma : type inconnu');
  if (!ctx.urlsCitees.has(normaliserUrl(url))) return rejet(brut, 'URL absente des résultats de recherche (possible URL inventée)');
  if (a.date_publication < ctx.debut || a.date_publication > ctx.fin) {
    return rejet(brut, `date ${a.date_publication} hors de la fenêtre ${ctx.debut} – ${ctx.fin}`);
  }
  return {
    ok: true,
    valeur: {
      titre: a.titre.trim(),
      resume: a.resume.trim(),
      source: a.source.trim(),
      url,
      date_publication: a.date_publication,
      importance: a.importance as Importance,
      public: [...new Set(a.public as Public[])],
      type: a.type as TypeArticle,
    },
  };
}

/** Un indicateur publié depuis plus longtemps que ceci n'est plus « le dernier chiffre ». */
const ANCIENNETE_MAX_INDICATEUR_JOURS = 60;

export function controlerIndicateur(brut: unknown, ctx: ContexteControle): Verdict<IndicateurIA> {
  if (!estObjet(brut)) return rejet(brut, 'non conforme au schéma : indicateur non objet');
  const i = brut;
  for (const champ of ['libelle', 'valeur', 'periode', 'source'] as const) {
    if (!chaine(i[champ], 200)) return rejet(brut, `non conforme au schéma : ${champ} absent`);
  }
  const url = urlHttps(i.url);
  if (!url) return rejet(brut, 'non conforme au schéma : URL absente ou non https');
  if (!estDateIso(i.date_publication)) return rejet(brut, 'non conforme au schéma : date_publication invalide');
  if (!ctx.urlsCitees.has(normaliserUrl(url))) return rejet(brut, 'URL absente des résultats de recherche (possible URL inventée)');
  const plusAncienne = new Date(Date.parse(`${ctx.fin}T00:00:00Z`) - ANCIENNETE_MAX_INDICATEUR_JOURS * 86_400_000).toISOString().slice(0, 10);
  if (i.date_publication > ctx.fin || i.date_publication < plusAncienne) {
    return rejet(brut, `date ${i.date_publication} trop ancienne ou future`);
  }
  return {
    ok: true,
    valeur: {
      libelle: (i.libelle as string).trim(),
      valeur: (i.valeur as string).trim(),
      periode: (i.periode as string).trim(),
      source: (i.source as string).trim(),
      url,
      date_publication: i.date_publication,
    },
  };
}

const STATUTS: readonly string[] = ['fait', 'en_cours', 'a_venir'];
const dateOuNull = (v: unknown): string | null => (estDateIso(v) ? v : null);

export function controlerSuivi(brut: unknown): { ok: true; valeur: SuiviIA } | { ok: false; raison: string } {
  if (!estObjet(brut)) return { ok: false, raison: 'suivi_texte non objet' };
  if (!chaine(brut.texte, 100) || !chaine(brut.etape_actuelle, 300)) return { ok: false, raison: 'suivi_texte : texte ou étape actuelle absent' };
  if (!Array.isArray(brut.etapes)) return { ok: false, raison: 'suivi_texte : étapes absentes' };
  const etapes: SuiviIA['etapes'] = [];
  for (const e of brut.etapes) {
    if (!estObjet(e) || !chaine(e.libelle, 200) || !STATUTS.includes(e.statut as string)) {
      return { ok: false, raison: 'suivi_texte : étape non conforme' };
    }
    etapes.push({ libelle: e.libelle.trim(), date: dateOuNull(e.date), statut: e.statut as StatutEtape });
  }
  const echeance = estObjet(brut.prochaine_echeance) && chaine(brut.prochaine_echeance.libelle, 200)
    ? { libelle: brut.prochaine_echeance.libelle.trim(), date: dateOuNull(brut.prochaine_echeance.date) }
    : null;
  return { ok: true, valeur: { texte: brut.texte.trim(), etape_actuelle: brut.etape_actuelle.trim(), etapes, prochaine_echeance: echeance } };
}
