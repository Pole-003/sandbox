/**
 * Couche B : API officielles gratuites (docs/VEILLE.md) : PISTE (Légifrance, Judilibre), INSEE, Banque de France, BODACC.
 *
 * Chaque API est optionnelle. Ses identifiants sont lus dans les variables d'environnement
 * (secrets GitHub) dont les noms figurent dans le champ « secret » du catalogue. S'il en manque,
 * l'API est sautée et signalée « non configurée ». Les messages ne citent que les NOMS des
 * variables, jamais leur valeur.
 *
 * Un connecteur n'est ajouté à CONNECTEURS qu'après validation de l'API par du code exécuté
 * dans GitHub Actions (même démarche que le diagnostic des flux). Tant qu'une API n'a pas de
 * connecteur, elle est signalée « non configurée (connecteur à développer) ».
 */
import type { EtatSource, Indicateur } from '../../src/modules/veille/modele.ts';
import type { ConfigVeille, IndicateurCatalogue, SourceCatalogue } from './config.ts';
import type { ArticleFlux } from './couche-a.ts';
import type { ClientHttp } from './http.ts';
import { connecteurBodacc, connecteurInsee } from './connecteurs.ts';

export interface ContexteConnecteur {
  source: SourceCatalogue;
  client: ClientHttp;
  config: ConfigVeille;
  maintenant: Date;
  /** Identifiants de l'API (valeurs des variables listées dans le catalogue). Ne jamais les journaliser. */
  identifiants: Record<string, string>;
  /** Séries suivies (veille/indicateurs.json). */
  indicateurs?: readonly IndicateurCatalogue[];
}

export interface ConnecteurApi {
  collecter(ctx: ContexteConnecteur): Promise<{ articles: ArticleFlux[]; indicateurs: Indicateur[] }>;
}

/** Connecteurs validés, par identifiant de source (voir connecteurs.ts). */
export const CONNECTEURS: Readonly<Record<string, ConnecteurApi>> = {
  'insee-bdm': connecteurInsee,
  'bodacc-35': connecteurBodacc,
};

/** Noms des variables d'environnement requises : « PISTE_CLIENT_ID / PISTE_CLIENT_SECRET » → deux noms. */
export function secretsRequis(source: SourceCatalogue): string[] {
  return (source.secret ?? '').split(/[/,\s]+/).map((s) => s.trim()).filter(Boolean);
}

export interface OptionsCoucheB {
  client: ClientHttp;
  config: ConfigVeille;
  maintenant: Date;
  env: Readonly<Record<string, string | undefined>>;
  etatPrecedent: EtatSource[];
  connecteurs?: Readonly<Record<string, ConnecteurApi>>;
  indicateurs?: readonly IndicateurCatalogue[];
}

export interface ResultatCoucheB {
  articles: ArticleFlux[];
  indicateurs: Indicateur[];
  etats: EtatSource[];
}

export async function collecterCoucheB(sources: readonly SourceCatalogue[], options: OptionsCoucheB): Promise<ResultatCoucheB> {
  const connecteurs = options.connecteurs ?? CONNECTEURS;
  const precedents = new Map(options.etatPrecedent.map((e) => [e.id, e]));
  const resultat: ResultatCoucheB = { articles: [], indicateurs: [], etats: [] };

  for (const source of sources.filter((s) => s.type === 'api')) {
    const precedent = precedents.get(source.id);
    const etat: EtatSource = {
      id: source.id, nom: source.nom, type: 'api', theme: source.theme, statut_catalogue: source.statut,
      etat: 'non_configuree', derniere_tentative: precedent?.derniere_tentative ?? null,
      derniere_reussite: precedent?.derniere_reussite ?? null, erreur: null, nb_articles: 0, nb_elements: null, duree_ms: null,
    };
    const requis = secretsRequis(source);
    const manquants = requis.filter((nom) => !options.env[nom]);
    const connecteur = connecteurs[source.id];

    if (source.statut === 'en_panne') {
      Object.assign(etat, { etat: 'inactive', erreur: 'source écartée dans le catalogue' });
    } else if (manquants.length > 0) {
      etat.erreur = `non configurée : identifiants absents (${manquants.join(', ')})`;
    } else if (!connecteur) {
      etat.erreur = requis.length ? 'non configurée : identifiants présents, connecteur à développer' : 'non configurée : connecteur à développer';
    } else {
      etat.derniere_tentative = options.maintenant.toISOString();
      const debut = Date.now();
      try {
        const identifiants = Object.fromEntries(requis.map((nom) => [nom, options.env[nom] as string]));
        const r = await connecteur.collecter({
          source, client: options.client, config: options.config, maintenant: options.maintenant, identifiants,
          ...(options.indicateurs ? { indicateurs: options.indicateurs } : {}),
        });
        resultat.articles.push(...r.articles);
        resultat.indicateurs.push(...r.indicateurs);
        Object.assign(etat, { etat: 'ok', derniere_reussite: etat.derniere_tentative, nb_articles: r.articles.length + r.indicateurs.length, duree_ms: Date.now() - debut });
      } catch (e) {
        // Une API en panne ne fait jamais échouer la collecte. Le message ne doit pas contenir d'identifiant.
        Object.assign(etat, { etat: 'erreur', erreur: e instanceof Error ? e.message : String(e), duree_ms: Date.now() - debut });
      }
    }
    resultat.etats.push(etat);
  }
  return resultat;
}
