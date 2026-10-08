/**
 * Accès à l'API Claude pour la veille (exécuté dans GitHub Actions uniquement).
 *
 * La clé est lue par le SDK dans la variable d'environnement ANTHROPIC_API_KEY (secret GitHub) :
 * elle n'apparaît jamais dans le code, les journaux ou les fichiers publiés.
 */
import Anthropic from '@anthropic-ai/sdk';
import { normaliserUrl } from './normalisation.ts';

type Message = Anthropic.Beta.Messages.BetaMessage;
type Parametres = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

/** Sous-ensemble du client utilisé par la veille (remplaçable par un faux client dans les tests). */
export interface ClientIA {
  models: { retrieve(id: string): Promise<{ id: string; capabilities?: Anthropic.ModelCapabilities | null }> };
  beta: { messages: { create(parametres: Parametres): Promise<Message> } };
}

export function creerClientIA(): ClientIA | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  // 2 nouvelles tentatives automatiques du SDK sur 408/409/429/5xx ; délai de 5 min par appel.
  return new Anthropic({ maxRetries: 2, timeout: 300_000 }) as unknown as ClientIA;
}

/**
 * Versions de l'outil de recherche web (documentation officielle, consultée le 08/10/2026) :
 *  - web_search_20260209 : filtrage dynamique des résultats, pour Claude Opus 4.6 et suivants,
 *    Claude Sonnet 4.6, Claude Sonnet 5 et Claude Sonnet 5.5 ;
 *  - web_search_20250305 : version de base, pour les autres modèles.
 * Le support effectif est contrôlé au démarrage via l'API Models.
 */
export type VersionRecherche = 'web_search_20260209' | 'web_search_20250305';

const FILTRAGE_DYNAMIQUE = [
  /^claude-opus-(4-[6-9]|[5-9])/,
  /^claude-sonnet-(4-[6-9]|[5-9])/,
  /^claude-fable-/,
];

/** Modèles qui acceptent le repli automatique côté serveur en cas de refus (`fallbacks: "default"`). */
const REPLI_SERVEUR = [/^claude-sonnet-5-5/, /^claude-opus-5/, /^claude-fable-5-1/];
export const BETA_REPLI = 'server-side-fallback-2026-07-01';

export function accepteRepliServeur(modele: string): boolean {
  return REPLI_SERVEUR.some((m) => m.test(modele));
}

export class ErreurModele extends Error {
  override name = 'ErreurModele';
}

/** Vérifie via l'API Models que le modèle existe et supporte la recherche web ; renvoie la version d'outil à utiliser. */
export async function verifierModeleRecherche(client: ClientIA, modele: string): Promise<VersionRecherche> {
  let fiche: Awaited<ReturnType<ClientIA['models']['retrieve']>>;
  try {
    fiche = await client.models.retrieve(modele);
  } catch (e) {
    if (e instanceof Anthropic.NotFoundError) throw new ErreurModele(`modèle « ${modele} » inconnu de l'API`);
    throw e;
  }
  const outils = fiche.capabilities?.server_tools;
  if (!outils?.web_search?.supported) throw new ErreurModele(`le modèle « ${modele} » ne prend pas en charge la recherche web`);
  const dynamique = FILTRAGE_DYNAMIQUE.some((m) => m.test(modele)) && outils.code_execution?.supported === true;
  return dynamique ? 'web_search_20260209' : 'web_search_20250305';
}

/** Vérifie que le modèle de notation existe ; indique s'il accepte les sorties structurées. */
export async function verifierModeleNotation(client: ClientIA, modele: string): Promise<{ sortiesStructurees: boolean }> {
  try {
    const fiche = await client.models.retrieve(modele);
    return { sortiesStructurees: fiche.capabilities?.structured_outputs?.supported === true };
  } catch (e) {
    if (e instanceof Anthropic.NotFoundError) throw new ErreurModele(`modèle « ${modele} » inconnu de l'API`);
    throw e;
  }
}

/** URL des résultats de recherche et des citations présents dans une réponse (appels imbriqués compris). */
export function urlsCitees(contenu: readonly Anthropic.Beta.Messages.BetaContentBlock[]): Set<string> {
  const urls = new Set<string>();
  for (const bloc of contenu) {
    if (bloc.type === 'web_search_tool_result' && Array.isArray(bloc.content)) {
      for (const resultat of bloc.content) if (resultat.url) urls.add(normaliserUrl(resultat.url));
    }
    if (bloc.type === 'text') {
      for (const citation of bloc.citations ?? []) {
        if (citation.type === 'web_search_result_location' && citation.url) urls.add(normaliserUrl(citation.url));
      }
    }
  }
  return urls;
}

/** Texte final de la réponse : blocs de texte situés après le dernier appel d'outil. */
export function texteFinal(contenu: readonly Anthropic.Beta.Messages.BetaContentBlock[]): string {
  let dernierOutil = -1;
  contenu.forEach((bloc, i) => {
    if (bloc.type !== 'text' && bloc.type !== 'thinking' && bloc.type !== 'redacted_thinking') dernierOutil = i;
  });
  return contenu
    .slice(dernierOutil + 1)
    .flatMap((b) => (b.type === 'text' ? [b.text] : []))
    .join('');
}

/** Extrait l'objet JSON d'un texte (tolère une clôture ```json et un mot d'introduction). */
export function extraireJson(texte: string): unknown {
  const sansClotures = texte.replace(/```(?:json)?/gi, '');
  const debut = sansClotures.indexOf('{');
  const fin = sansClotures.lastIndexOf('}');
  if (debut < 0 || fin <= debut) throw new SyntaxError('aucun objet JSON dans la réponse');
  return JSON.parse(sansClotures.slice(debut, fin + 1));
}

export type { Message, Parametres };
