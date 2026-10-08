/**
 * Notation des articles de la couche A sans score (docs/VEILLE.md) : un seul appel IA groupé
 * pour tous les nouveaux titres du jour, sans recherche web, avec le barème de la couche C.
 * L'appel rédige aussi le résumé publié (avec nos mots), à partir du titre et de l'extrait du flux.
 */
import { PUBLICS, TYPES_ARTICLE, type Importance, type Public, type TypeArticle } from '../../src/modules/veille/modele.ts';
import { coutReponse, type Budget } from './couts.ts';
import { accepteRepliServeur, BETA_REPLI, extraireJson, texteFinal, type ClientIA, type Parametres } from './ia.ts';

export interface ArticleANoter {
  id: string;
  titre: string;
  source: string;
  theme: string;
  date: string;
  /** Extrait du flux (jamais publié). */
  extrait: string;
}

export interface Note {
  id: string;
  importance: Importance;
  public: Public[];
  type: TypeArticle;
  resume: string | null;
}

export interface ResultatNotation {
  notes: Map<string, Note>;
  coutNano: number;
  erreur: string | null;
  /** Articles laissés sans note (au-delà du plafond d'un appel, ou réponse incomplète). */
  nonNotes: number;
}

/** Au-delà, les articles restants seront notés lors d'une prochaine exécution. */
export const ARTICLES_MAX_PAR_APPEL = 150;

/** Barème : repris du prompt système de la couche C pour garantir la même échelle. */
export function consigneNotation(promptSysteme: string): string {
  return [
    promptSysteme,
    '',
    'Tâche particulière : tu ne fais aucune recherche. Tu reçois une liste de publications officielles (titre, émetteur, date, extrait).',
    'Pour chacune, attribue « importance » de 1 à 5 selon le barème ci-dessus (1 compris, pour ce qui est marginal), « public » et « type ».',
    'Rédige « resume » en français, avec tes propres mots, en 2 phrases maximum, uniquement à partir du titre et de l’extrait fournis ;',
    'si l’extrait ne suffit pas pour résumer sans rien inventer, mets « resume » à null.',
    'Réponds uniquement par un objet JSON {"notes": [{"id", "importance", "public", "type", "resume"}]} reprenant chaque « id » reçu.',
  ].join('\n');
}

const SCHEMA_NOTES = {
  type: 'object',
  additionalProperties: false,
  required: ['notes'],
  properties: {
    notes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'importance', 'public', 'type', 'resume'],
        properties: {
          id: { type: 'string' },
          importance: { type: 'integer', enum: [1, 2, 3, 4, 5] },
          public: { type: 'array', items: { type: 'string', enum: [...PUBLICS] } },
          type: { type: 'string', enum: [...TYPES_ARTICLE] },
          resume: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        },
      },
    },
  },
} as const;

export function controlerNote(brut: unknown, ids: ReadonlySet<string>): Note | null {
  if (typeof brut !== 'object' || brut === null) return null;
  const n = brut as Record<string, unknown>;
  if (typeof n.id !== 'string' || !ids.has(n.id)) return null;
  if (!Number.isInteger(n.importance) || (n.importance as number) < 1 || (n.importance as number) > 5) return null;
  if (!Array.isArray(n.public) || !n.public.every((p) => (PUBLICS as readonly unknown[]).includes(p))) return null;
  if (!(TYPES_ARTICLE as readonly unknown[]).includes(n.type)) return null;
  const resume = typeof n.resume === 'string' && n.resume.trim() !== '' && n.resume.length <= 600 ? n.resume.trim() : null;
  return { id: n.id, importance: n.importance as Importance, public: [...new Set(n.public as Public[])], type: n.type as TypeArticle, resume };
}

export interface OptionsNotation {
  client: ClientIA;
  modele: string;
  promptSysteme: string;
  sortiesStructurees: boolean;
  budget: Budget;
}

export async function noterArticles(options: OptionsNotation, articles: readonly ArticleANoter[]): Promise<ResultatNotation> {
  const resultat: ResultatNotation = { notes: new Map(), coutNano: 0, erreur: null, nonNotes: articles.length };
  if (articles.length === 0) return resultat;
  if (options.budget.depasse()) return { ...resultat, erreur: 'budget mensuel atteint' };

  const lot = articles.slice(0, ARTICLES_MAX_PAR_APPEL);
  const ids = new Set(lot.map((a) => a.id));
  const contenu = JSON.stringify(lot.map((a) => ({ id: a.id, titre: a.titre, emetteur: a.source, theme: a.theme, date: a.date, extrait: a.extrait.slice(0, 600) })));
  const parametres: Parametres = {
    model: options.modele,
    max_tokens: 16_000,
    system: consigneNotation(options.promptSysteme),
    messages: [{ role: 'user', content: `Publications à noter :\n${contenu}` }],
    // Notation simple : effort réduit pour limiter le coût.
    output_config: {
      effort: 'low',
      ...(options.sortiesStructurees ? { format: { type: 'json_schema' as const, schema: SCHEMA_NOTES as unknown as Record<string, unknown> } } : {}),
    },
    ...(accepteRepliServeur(options.modele) ? { betas: [BETA_REPLI], fallbacks: 'default' as const } : {}),
  };

  try {
    const reponse = await options.client.beta.messages.create(parametres);
    const cout = coutReponse(reponse.usage, reponse.model);
    options.budget.imputer(cout.nano);
    resultat.coutNano = cout.nano;
    if (reponse.stop_reason === 'refusal') return { ...resultat, erreur: 'requête déclinée par le modèle' };
    const brut = extraireJson(texteFinal(reponse.content)) as { notes?: unknown };
    if (!Array.isArray(brut.notes)) return { ...resultat, erreur: 'réponse sans champ « notes »' };
    for (const n of brut.notes) {
      const note = controlerNote(n, ids);
      if (note) resultat.notes.set(note.id, note);
    }
    resultat.nonNotes = articles.length - resultat.notes.size;
    return resultat;
  } catch (e) {
    return { ...resultat, erreur: e instanceof Error ? e.message : String(e) };
  }
}
