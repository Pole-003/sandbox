/**
 * Collecte quotidienne de la veille : npm run veille:collecte (workflow veille.yml). Coût : 0 €.
 *
 * Couche A (flux) + couche B (API officielles gratuites, optionnelles) → fusion et déduplication →
 * classement par mots-clés → publication de public/news.json, public/veille-etat.json et
 * public/archives/AAAA-MM.json. Aucun appel à un service d'IA.
 *
 * Une source en panne ou une API non configurée ne font jamais échouer la collecte :
 * elles sont signalées dans veille-etat.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Article, EtatVeille, NewsJson } from '../../src/modules/veille/modele.ts';
import { chargerReglages, themeConnu, type Reglages } from './config.ts';
import { collecterCoucheA } from './couche-a.ts';
import { collecterCoucheB, type ConnecteurApi } from './couche-b.ts';
import { dateIsoParis } from './dates.ts';
import {
  appliquerClassement,
  completerArchive,
  depuisFlux,
  empreinteNews,
  fusionnerArticles,
  indicateursDuJour,
  repartirConservation,
  sourcesCitees,
  trierArticles,
} from './fusion.ts';
import { ClientHttp } from './http.ts';

/** Accès aux fichiers du dépôt (remplaçable dans les tests). Chemins relatifs à la racine. */
export interface Depot {
  lire(chemin: string): string | null;
  ecrire(chemin: string, contenu: string): void;
}

export const CHEMINS = {
  news: 'public/news.json',
  etat: 'public/veille-etat.json',
  archives: (mois: string) => `public/archives/${mois}.json`,
} as const;

export interface DependancesCollecte {
  reglages: Reglages;
  http: ClientHttp;
  depot: Depot;
  maintenant: Date;
  /** Variables d'environnement (identifiants des API de la couche B). */
  env: Readonly<Record<string, string | undefined>>;
  connecteurs?: Readonly<Record<string, ConnecteurApi>>;
  journal?: (message: string) => void;
  /** Délais avant les 2 nouvelles tentatives d'une source (par défaut 5 s puis 15 s). */
  delaisNouvellesTentatives?: number[];
}

export interface Bilan {
  news: NewsJson;
  etat: EtatVeille;
  newsModifie: boolean;
}

function lireJson<T>(depot: Depot, chemin: string): T | null {
  const texte = depot.lire(chemin);
  if (texte === null) return null;
  try {
    return JSON.parse(texte) as T;
  } catch {
    return null; // fichier abîmé : on repart de zéro plutôt que d'échouer
  }
}

const json = (valeur: unknown) => `${JSON.stringify(valeur, null, 2)}\n`;

export const RAISON_IA = 'désactivée : la veille fonctionne à 0 €, sans appel à un service d’IA';

export async function collecter(d: DependancesCollecte): Promise<Bilan> {
  const { config, sources, motsCles, suivi } = d.reglages;
  const journal = d.journal ?? (() => {});
  const aujourdhui = dateIsoParis(d.maintenant);

  const newsPrecedent = lireJson<NewsJson>(d.depot, CHEMINS.news);
  const etatPrecedent = lireJson<{ sources?: EtatVeille['sources'] }>(d.depot, CHEMINS.etat);
  const sourcesPrecedentes = etatPrecedent?.sources ?? [];

  // --- Couche A : flux ---
  journal(`Couche A : ${sources.filter((s) => s.type !== 'api').length} sources…`);
  const coucheA = await collecterCoucheA(sources, {
    config, client: d.http, maintenant: d.maintenant, etatPrecedent: sourcesPrecedentes,
    ...(d.delaisNouvellesTentatives ? { delaisNouvellesTentatives: d.delaisNouvellesTentatives } : {}),
  });
  for (const e of coucheA.etats.filter((e) => e.etat === 'ok' || e.etat === 'erreur')) {
    journal(`  ${e.etat === 'ok' ? 'OK    ' : 'ÉCHEC '} ${e.id} : ${e.etat === 'ok' ? `${e.nb_articles} article(s) retenu(s)` : e.erreur}`);
  }

  // --- Couche B : API officielles (optionnelles) ---
  const coucheB = await collecterCoucheB(sources, {
    client: d.http, config, maintenant: d.maintenant, env: d.env, etatPrecedent: sourcesPrecedentes,
    ...(d.connecteurs ? { connecteurs: d.connecteurs } : {}),
  });
  journal('Couche B :');
  for (const e of coucheB.etats) journal(`  ${e.etat === 'ok' ? 'OK    ' : e.etat === 'erreur' ? 'ÉCHEC ' : '—     '} ${e.id} : ${e.erreur ?? `${e.nb_articles} élément(s)`}`);
  journal(`Recherche IA : ${RAISON_IA}`);

  // --- Fusion et classement ---
  const nouveaux: Article[] = [
    ...coucheA.articles.map((a) => depuisFlux(a, aujourdhui)),
    ...coucheB.articles.map((a) => depuisFlux(a, aujourdhui, 'api')),
  ];
  const themes = new Map(sources.map((s) => [s.id, themeConnu(s.theme)]));
  const classement = appliquerClassement(
    fusionnerArticles(newsPrecedent?.articles ?? [], nouveaux),
    motsCles,
    (id) => (id ? (themes.get(id) ?? null) : null),
  );
  journal(`Classement : ${classement.articles.length} article(s), ${classement.exclus} exclu(s), ${classement.marginaux} marginal(aux)`);

  // --- Conservation et archives ---
  const limite = dateIsoParis(new Date(d.maintenant.getTime() - config.conservation_jours * 86_400_000));
  const { gardes, archives } = repartirConservation(classement.articles, limite);
  for (const [mois, ajouts] of archives) {
    const existante = lireJson<{ articles: Article[] }>(d.depot, CHEMINS.archives(mois))?.articles ?? [];
    d.depot.ecrire(CHEMINS.archives(mois), json({ mois, articles: completerArchive(existante, ajouts) }));
  }

  const news: NewsJson = {
    version: 1,
    genere_le: d.maintenant.toISOString(),
    articles: trierArticles(gardes),
    indicateurs: indicateursDuJour(coucheB.indicateurs, newsPrecedent?.indicateurs ?? []),
    suivi,
    sources: sourcesCitees(sources),
  };
  const newsModifie = !newsPrecedent || empreinteNews(newsPrecedent) !== empreinteNews(news);
  if (newsModifie) d.depot.ecrire(CHEMINS.news, json(news));

  // Ordre du catalogue pour l'écran « État des sources ».
  const parId = new Map([...coucheA.etats, ...coucheB.etats].map((e) => [e.id, e]));
  const etat: EtatVeille = {
    version: 2,
    genere_le: d.maintenant.toISOString(),
    sources: sources.flatMap((s) => parId.get(s.id) ?? []),
    recherche_ia: { active: false, raison: RAISON_IA },
    classement: { articles: news.articles.length, exclus: classement.exclus, marginaux: classement.marginaux },
  };
  d.depot.ecrire(CHEMINS.etat, json(etat));

  journal(`Publication : ${news.articles.length} article(s) en ligne${newsModifie ? '' : ' (inchangé)'}.`);
  return { news, etat, newsModifie };
}

/** Dépôt réel : fichiers sous la racine du projet. */
export function depotFichiers(racine: URL): Depot {
  return {
    lire(chemin) {
      const url = new URL(chemin, racine);
      return existsSync(url) ? readFileSync(url, 'utf8') : null;
    },
    ecrire(chemin, contenu) {
      const url = new URL(chemin, racine);
      mkdirSync(new URL('.', url), { recursive: true });
      writeFileSync(url, contenu);
    },
  };
}

async function principal(): Promise<void> {
  const reglages = chargerReglages();
  const bilan = await collecter({
    reglages,
    http: new ClientHttp({ userAgent: reglages.config.user_agent, delaiMaxMs: 20_000, intervalleParDomaineMs: 1_000 }),
    depot: depotFichiers(new URL('../../', import.meta.url)),
    maintenant: new Date(),
    env: process.env,
    journal: (m) => console.log(m),
  });
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lignes = [
      '## Collecte de la veille',
      '',
      `- Articles en ligne : ${bilan.news.articles.length}${bilan.newsModifie ? '' : ' (inchangé)'}`,
      `- Sources en échec : ${bilan.etat.sources.filter((s) => s.etat === 'erreur').map((s) => s.id).join(', ') || 'aucune'}`,
      `- API non configurées : ${bilan.etat.sources.filter((s) => s.etat === 'non_configuree').map((s) => s.id).join(', ') || 'aucune'}`,
      `- Classement : ${bilan.etat.classement.exclus} exclu(s), ${bilan.etat.classement.marginaux} marginal(aux)`,
      `- Recherche IA : ${RAISON_IA}`,
      '',
    ];
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, lignes.join('\n'), { flag: 'a' });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  principal().catch((e: unknown) => {
    console.error('La collecte a échoué :', e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
