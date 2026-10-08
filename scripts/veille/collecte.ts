/**
 * Collecte quotidienne de la veille : npm run veille:collecte (workflow veille.yml).
 *
 * Couche A (flux) → couche C (recherche IA) → fusion et déduplication → notation des articles
 * de la couche A sans score → publication de public/news.json, public/veille-etat.json,
 * public/archives/AAAA-MM.json, et cumul des coûts dans veille/couts.json.
 *
 * Une source en panne, une clé absente ou un budget épuisé ne font jamais échouer la collecte :
 * ils sont signalés dans veille-etat.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Article, EtatSource, EtatVeille, NewsJson } from '../../src/modules/veille/modele.ts';
import { chargerReglages, type Reglages } from './config.ts';
import { collecterCoucheA, type ArticleFlux } from './couche-a.ts';
import { executerCoucheC, type ResultatTheme } from './couche-c.ts';
import { Budget, depuisDollars, enDollars, totalJourNano, type Couts } from './couts.ts';
import { dateIsoParis } from './dates.ts';
import {
  appliquerNotes,
  completerArchive,
  depuisFlux,
  depuisRecherche,
  empreinteNews,
  fusionnerArticles,
  indicateursDuJour,
  repartirConservation,
  sourcesCitees,
  suiviDuJour,
  trierArticles,
} from './fusion.ts';
import { ClientHttp } from './http.ts';
import { ErreurModele, creerClientIA, verifierModeleNotation, verifierModeleRecherche, type ClientIA } from './ia.ts';
import { idArticle } from './normalisation.ts';
import { noterArticles, type ResultatNotation } from './notation.ts';

/** Accès aux fichiers du dépôt (remplaçable dans les tests). Chemins relatifs à la racine. */
export interface Depot {
  lire(chemin: string): string | null;
  ecrire(chemin: string, contenu: string): void;
}

export const CHEMINS = {
  news: 'public/news.json',
  etat: 'public/veille-etat.json',
  archives: (mois: string) => `public/archives/${mois}.json`,
  couts: 'veille/couts.json',
} as const;

export interface DependancesCollecte {
  reglages: Reglages;
  http: ClientHttp;
  ia: ClientIA | null;
  depot: Depot;
  maintenant: Date;
  journal?: (message: string) => void;
  /** Délais avant les 2 nouvelles tentatives d'une source (par défaut 5 s puis 15 s). */
  delaisNouvellesTentatives?: number[];
}

export interface Bilan {
  news: NewsJson;
  etat: EtatVeille;
  newsModifie: boolean;
  coutExecutionUsd: number;
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

export async function collecter(d: DependancesCollecte): Promise<Bilan> {
  const { config, sources, themes, promptSysteme } = d.reglages;
  const journal = d.journal ?? (() => {});
  const aujourdhui = dateIsoParis(d.maintenant);
  const mois = aujourdhui.slice(0, 7);

  const newsPrecedent = lireJson<NewsJson>(d.depot, CHEMINS.news);
  const etatPrecedent = lireJson<EtatVeille>(d.depot, CHEMINS.etat);
  const coutsInitiaux: Couts = (() => {
    const t = d.depot.lire(CHEMINS.couts);
    try {
      return t ? { mois: (JSON.parse(t) as Couts).mois ?? {} } : { mois: {} };
    } catch {
      return { mois: {} };
    }
  })();
  const budget = new Budget(coutsInitiaux, aujourdhui, depuisDollars(config.budget_mensuel_usd));

  // --- Couche A ---
  journal(`Couche A : ${sources.filter((s) => s.type !== 'api').length} sources…`);
  const coucheA = await collecterCoucheA(sources, {
    config, client: d.http, maintenant: d.maintenant, etatPrecedent: etatPrecedent?.sources ?? [],
    ...(d.delaisNouvellesTentatives ? { delaisNouvellesTentatives: d.delaisNouvellesTentatives } : {}),
  });
  for (const e of coucheA.etats.filter((e) => e.etat === 'ok' || e.etat === 'erreur')) {
    journal(`  ${e.etat === 'ok' ? 'OK    ' : 'ÉCHEC '} ${e.id} : ${e.etat === 'ok' ? `${e.nb_articles} article(s) retenu(s)` : e.erreur}`);
  }

  // --- Couche C ---
  let resultatsC: ResultatTheme[] = [];
  const coucheC: EtatVeille['couche_c'] = { statut: 'sautee', raison: null, modele: config.modele_recherche, outil: null, themes: [] };
  if (!d.ia) {
    coucheC.raison = 'clé ANTHROPIC_API_KEY absente : recherche IA non exécutée';
  } else if (budget.depasse()) {
    coucheC.raison = `budget mensuel atteint (${enDollars(budget.moisNano).toFixed(2)} $ sur ${config.budget_mensuel_usd} $) : reprise le mois prochain`;
  } else {
    try {
      const outil = await verifierModeleRecherche(d.ia, config.modele_recherche);
      coucheC.outil = outil;
      journal(`Couche C : modèle ${config.modele_recherche}, outil ${outil}`);
      resultatsC = await executerCoucheC(
        { client: d.ia, config, promptSysteme, outil, budget, maintenant: d.maintenant, journal },
        themes,
      );
      const abandons = resultatsC.filter((r) => r.statut !== 'ok');
      coucheC.statut = abandons.length === 0 ? 'executee' : 'partielle';
      coucheC.raison = abandons.length ? `${abandons.length} thème(s) abandonné(s) pour la journée` : null;
    } catch (e) {
      coucheC.raison = e instanceof ErreurModele ? e.message : `erreur : ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  coucheC.themes = resultatsC.map((r) => ({
    theme: r.theme, statut: r.statut, retenus: r.articles.length + r.indicateurs.length, rejetes: r.rejetes.length,
    recherches: r.recherches, cout_usd: enDollars(r.coutNano), erreur: r.erreur,
  }));
  for (const r of resultatsC) {
    journal(`  ${r.theme} : ${r.statut}, ${r.articles.length} article(s), ${r.rejetes.length} rejet(s), ${enDollars(r.coutNano).toFixed(4)} $${r.erreur ? ` (${r.erreur})` : ''}`);
  }
  if (coucheC.statut === 'sautee') journal(`Couche C sautée : ${coucheC.raison}`);

  // --- Fusion ---
  const nouveaux: Article[] = [
    ...coucheA.articles.map((a) => depuisFlux(a, aujourdhui)),
    ...resultatsC.flatMap((r) => depuisRecherche(r, aujourdhui)),
  ];
  let articles = fusionnerArticles(newsPrecedent?.articles ?? [], nouveaux);

  // --- Notation des articles de la couche A sans score ---
  const extraits = new Map<string, ArticleFlux>(coucheA.articles.map((a) => [idArticle(a.url), a]));
  const aNoter = articles.filter((a) => a.importance === null && a.origine === 'flux' && extraits.has(a.id));
  let notation: ResultatNotation | null = null;
  const etatNotation: EtatVeille['notation'] = { statut: 'sautee', raison: null, notes: 0, cout_usd: 0 };
  if (aNoter.length === 0) {
    etatNotation.raison = 'aucun nouvel article à noter';
  } else if (!d.ia) {
    etatNotation.raison = 'clé ANTHROPIC_API_KEY absente : articles publiés sans note ni résumé';
  } else if (budget.depasse()) {
    etatNotation.raison = 'budget mensuel atteint';
  } else {
    try {
      const { sortiesStructurees } = await verifierModeleNotation(d.ia, config.modele_notation);
      notation = await noterArticles(
        { client: d.ia, modele: config.modele_notation, promptSysteme, sortiesStructurees, budget },
        aNoter.map((a) => ({ id: a.id, titre: a.titre, source: a.source, theme: a.theme, date: a.date, extrait: extraits.get(a.id)?.description ?? '' })),
      );
      const { articles: notes, marginaux } = appliquerNotes(articles, notation.notes);
      articles = notes;
      etatNotation.statut = notation.erreur ? 'echec' : 'executee';
      etatNotation.notes = notation.notes.size;
      etatNotation.cout_usd = enDollars(notation.coutNano);
      const remarques = [marginaux ? `${marginaux} article(s) marginal(aux), masqué(s) par défaut` : '', notation.nonNotes ? `${notation.nonNotes} non noté(s)` : ''];
      etatNotation.raison = notation.erreur ?? (remarques.filter(Boolean).join(' ; ') || null);
    } catch (e) {
      etatNotation.statut = 'echec';
      etatNotation.raison = e instanceof Error ? e.message : String(e);
    }
  }
  journal(`Notation : ${etatNotation.statut}${etatNotation.raison ? ` (${etatNotation.raison})` : ''}`);

  // --- Conservation et archives ---
  const limite = dateIsoParis(new Date(d.maintenant.getTime() - config.conservation_jours * 86_400_000));
  const { gardes, archives } = repartirConservation(articles, limite);
  for (const [moisArchive, ajouts] of archives) {
    const existante = lireJson<{ articles: Article[] }>(d.depot, CHEMINS.archives(moisArchive))?.articles ?? [];
    d.depot.ecrire(CHEMINS.archives(moisArchive), json({ mois: moisArchive, articles: completerArchive(existante, ajouts) }));
  }

  const news: NewsJson = {
    version: 1,
    genere_le: d.maintenant.toISOString(),
    articles: trierArticles(gardes),
    indicateurs: indicateursDuJour(resultatsC, newsPrecedent?.indicateurs ?? [], aujourdhui),
    suivi: {
      plf: suiviDuJour(resultatsC, 'Loi de finances', newsPrecedent?.suivi?.plf ?? null, aujourdhui),
      plfss: suiviDuJour(resultatsC, 'Sécurité sociale', newsPrecedent?.suivi?.plfss ?? null, aujourdhui),
    },
    sources: sourcesCitees(sources),
  };
  const newsModifie = !newsPrecedent || empreinteNews(newsPrecedent) !== empreinteNews(news);
  if (newsModifie) d.depot.ecrire(CHEMINS.news, json(news));

  const etat: EtatVeille = {
    version: 1,
    genere_le: d.maintenant.toISOString(),
    sources: coucheA.etats satisfies EtatSource[],
    couche_c: coucheC,
    notation: etatNotation,
    couts: {
      mois,
      jour_usd: enDollars(totalJourNano(budget.etat, aujourdhui)),
      mois_usd: enDollars(budget.moisNano),
      budget_mensuel_usd: config.budget_mensuel_usd,
    },
  };
  d.depot.ecrire(CHEMINS.etat, json(etat));
  if (budget.executionNano > 0) d.depot.ecrire(CHEMINS.couts, json({ ...budget.etat }));

  const coutExecutionUsd = enDollars(budget.executionNano);
  journal(`Publication : ${news.articles.length} article(s) en ligne${newsModifie ? '' : ' (inchangé)'} ; coût de l'exécution ${coutExecutionUsd.toFixed(4)} $, mois ${etat.couts.mois_usd.toFixed(4)} $ / ${config.budget_mensuel_usd} $`);
  return { news, etat, newsModifie, coutExecutionUsd };
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
  const racine = new URL('../../', import.meta.url);
  const reglages = chargerReglages();
  const bilan = await collecter({
    reglages,
    http: new ClientHttp({ userAgent: reglages.config.user_agent, delaiMaxMs: 20_000, intervalleParDomaineMs: 1_000 }),
    ia: creerClientIA(),
    depot: depotFichiers(racine),
    maintenant: new Date(),
    journal: (m) => console.log(m),
  });
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lignes = [
      '## Collecte de la veille',
      '',
      `- Articles en ligne : ${bilan.news.articles.length}${bilan.newsModifie ? '' : ' (inchangé)'}`,
      `- Sources en échec : ${bilan.etat.sources.filter((s) => s.etat === 'erreur').map((s) => s.id).join(', ') || 'aucune'}`,
      `- Recherche IA : ${bilan.etat.couche_c.statut}${bilan.etat.couche_c.raison ? ` (${bilan.etat.couche_c.raison})` : ''}`,
      `- Notation : ${bilan.etat.notation.statut}${bilan.etat.notation.raison ? ` (${bilan.etat.notation.raison})` : ''}`,
      `- Coût de l'exécution : ${bilan.coutExecutionUsd.toFixed(4)} $ ; mois : ${bilan.etat.couts.mois_usd.toFixed(4)} $ / ${bilan.etat.couts.budget_mensuel_usd} $`,
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
