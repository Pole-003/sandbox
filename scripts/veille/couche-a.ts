/**
 * Couche A : collecte des flux RSS/Atom et des pages suivies du catalogue (docs/VEILLE.md).
 *
 * Règle d'or : une source en échec ne fait jamais échouer la collecte. Chaque source est isolée
 * (try/catch, 2 nouvelles tentatives espacées) et son état est consigné pour veille-etat.json.
 */
import type { EtatSource, Theme } from '../../src/modules/veille/modele.ts';
import { analyserFlux, analyserPage } from './analyse.ts';
import { fenetreJours, themeConnu, type ConfigVeille, type SourceCatalogue } from './config.ts';
import { dateIsoParis } from './dates.ts';
import { decoderOctets, lireEncodageDeclare } from './encodage.ts';
import { lireFlux } from './flux.ts';
import { ClientHttp, ErreurCollecte, type Reponse } from './http.ts';

/** Article de la couche A, avant notation et fusion. */
export interface ArticleFlux {
  titre: string;
  url: string;
  date: string;
  theme: Theme;
  source: string;
  source_id: string;
  /** Texte de la source : sert uniquement à la notation, jamais publié. */
  description: string;
}

export interface ResultatCoucheA {
  articles: ArticleFlux[];
  etats: EtatSource[];
}

export interface OptionsCoucheA {
  config: ConfigVeille;
  client: ClientHttp;
  maintenant: Date;
  /** État publié lors de l'exécution précédente (dernière réussite, empreinte des pages). */
  etatPrecedent: EtatSource[];
  /** Délais avant les 2 nouvelles tentatives (ms). */
  delaisNouvellesTentatives?: number[];
  attendre?: (ms: number) => Promise<void>;
}

/** Les sources « verifie » sont collectées ; « en_panne » et « a_verifier » sont ignorées (et signalées). */
export function sourceActive(source: SourceCatalogue): boolean {
  return source.statut === 'verifie';
}

function sansAccents(texte: string): string {
  return texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Vrai si le texte contient l'un des mots-clés (sans tenir compte des accents ni des majuscules). */
export function correspondMotsCles(texte: string, motsCles: readonly string[] | undefined): boolean {
  if (!motsCles || motsCles.length === 0) return true;
  const t = sansAccents(texte);
  return motsCles.some((mot) => {
    const m = sansAccents(mot).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${m}`).test(t);
  });
}

async function avecNouvellesTentatives(
  action: () => Promise<Reponse>,
  delais: readonly number[],
  attendre: (ms: number) => Promise<void>,
): Promise<Reponse> {
  let derniere: unknown;
  for (let essai = 0; essai <= delais.length; essai++) {
    if (essai > 0) await attendre(delais[essai - 1] ?? 0);
    try {
      const reponse = await action();
      // Les erreurs 4xx (hors 408 et 429) ne s'arrangent pas en réessayant.
      if (reponse.statut >= 200 && reponse.statut < 300) return reponse;
      derniere = new ErreurCollecte(`HTTP ${reponse.statut}`);
      if (reponse.statut >= 400 && reponse.statut < 500 && reponse.statut !== 408 && reponse.statut !== 429) break;
    } catch (e) {
      derniere = e;
      // Un refus par robots.txt est définitif : on ne réessaie pas.
      if (e instanceof ErreurCollecte && /robots\.txt/.test(e.message)) break;
    }
  }
  throw derniere instanceof Error ? derniere : new ErreurCollecte(String(derniere));
}

function etatInitial(source: SourceCatalogue, precedent: EtatSource | undefined): EtatSource {
  return {
    id: source.id,
    nom: source.nom,
    type: source.type,
    theme: source.theme,
    statut_catalogue: source.statut,
    etat: 'inactive',
    derniere_tentative: precedent?.derniere_tentative ?? null,
    derniere_reussite: precedent?.derniere_reussite ?? null,
    erreur: null,
    nb_articles: 0,
    nb_elements: null,
    duree_ms: null,
    ...(source.type === 'page' ? { empreinte: precedent?.empreinte ?? null } : {}),
  };
}

async function collecterSource(
  source: SourceCatalogue,
  options: OptionsCoucheA,
  precedent: EtatSource | undefined,
): Promise<{ etat: EtatSource; articles: ArticleFlux[] }> {
  const etat = etatInitial(source, precedent);
  const horodatage = options.maintenant.toISOString();
  const aujourdhui = dateIsoParis(options.maintenant);

  if (source.type === 'api') {
    // Couche B : pas encore développée ; la source est signalée sans être appelée.
    return { etat: { ...etat, etat: 'non_configuree', erreur: source.secret ? `couche B à venir (secret ${source.secret})` : 'couche B à venir' }, articles: [] };
  }
  if (!sourceActive(source) || !source.url) {
    return { etat: { ...etat, erreur: source.statut === 'en_panne' ? 'source en panne dans le catalogue' : 'source à vérifier (non collectée)' }, articles: [] };
  }

  etat.derniere_tentative = horodatage;
  try {
    const reponse = await avecNouvellesTentatives(
      () => options.client.recuperer(source.url as string),
      options.delaisNouvellesTentatives ?? [5_000, 15_000],
      options.attendre ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    );
    const texte = decoderOctets(reponse.octets, lireEncodageDeclare(reponse.octets, reponse.contentType)).texte;
    etat.duree_ms = reponse.dureeMs;
    const theme = themeConnu(source.theme);

    if (source.type === 'page') {
      const page = analyserPage(texte);
      const ancienne = precedent?.empreinte ?? null;
      const articles: ArticleFlux[] =
        ancienne && ancienne !== page.empreinte
          ? [{ titre: `${source.nom} : page mise à jour`, url: source.url, date: aujourdhui, theme, source: source.nom, source_id: source.id, description: page.titre ?? '' }]
          : [];
      return {
        etat: { ...etat, etat: 'ok', derniere_reussite: horodatage, empreinte: page.empreinte, nb_articles: articles.length, nb_elements: null },
        articles,
      };
    }

    const analyse = analyserFlux(texte);
    if (!analyse.format) throw new ErreurCollecte(analyse.remarque ?? 'contenu non reconnu comme flux');
    const elements = lireFlux(texte, reponse.urlFinale);
    const limite = new Date(options.maintenant.getTime() - fenetreJours(options.config, theme) * 86_400_000);
    const articles = elements
      .filter((e) => correspondMotsCles(`${e.titre} ${e.description}`, source.mots_cles))
      // Élément sans date lisible : daté du jour de sa première collecte (la fusion conserve cette date ensuite).
      .filter((e) => !e.date || (e.date >= limite && e.date.getTime() <= options.maintenant.getTime() + 86_400_000))
      .map<ArticleFlux>((e) => ({
        titre: e.titre,
        url: e.lien,
        date: e.date ? dateIsoParis(e.date) : aujourdhui,
        theme,
        source: source.nom,
        source_id: source.id,
        description: e.description.slice(0, 1_000),
      }));
    return { etat: { ...etat, etat: 'ok', derniere_reussite: horodatage, nb_elements: elements.length, nb_articles: articles.length }, articles };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { etat: { ...etat, etat: 'erreur', erreur: message }, articles: [] };
  }
}

export async function collecterCoucheA(sources: readonly SourceCatalogue[], options: OptionsCoucheA): Promise<ResultatCoucheA> {
  const precedents = new Map(options.etatPrecedent.map((e) => [e.id, e]));
  // Domaines différents en parallèle ; le client HTTP limite à 1 requête par seconde et par domaine.
  const resultats = await Promise.all(
    sources.map((s) =>
      collecterSource(s, options, precedents.get(s.id)).catch((e: unknown) => ({
        // Filet de sécurité : même une erreur de programmation reste confinée à la source.
        etat: { ...etatInitial(s, precedents.get(s.id)), etat: 'erreur' as const, erreur: `erreur inattendue : ${e instanceof Error ? e.message : String(e)}` },
        articles: [],
      })),
    ),
  );
  return { articles: resultats.flatMap((r) => r.articles), etats: resultats.map((r) => r.etat) };
}
