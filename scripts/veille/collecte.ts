/**
 * Collecte quotidienne de la veille : npm run veille:collecte (workflow veille.yml). Coût : 0 €.
 *
 * Couche A (flux) + couche B (API officielles gratuites, optionnelles) + suivi des dossiers PLF / PLFSS →
 * fusion et déduplication →
 * classement par mots-clés → publication de public/news.json, public/veille-etat.json et
 * public/archives/AAAA-MM.json. Aucun appel à un service d'IA.
 *
 * Une source en panne ou une API non configurée ne font jamais échouer la collecte :
 * elles sont signalées dans veille-etat.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Article, EtatVeille, NewsJson, SuiviTexte } from '../../src/modules/veille/modele.ts';
import { collecterAlertes } from './alertes.ts';
import { collecterCalendrier } from './calendrier-fiscal.ts';
import { developperEcheances, fusionnerEcheances } from '../../src/modules/veille/echeances.ts';
import { ajouterJours } from '../../src/core/dates.ts';
import { chargerReglages, themeConnu, type Reglages } from './config.ts';
import { collecterCoucheA } from './couche-a.ts';
import { collecterCoucheB, type ConnecteurApi } from './couche-b.ts';
import { dateIsoParis } from './dates.ts';
import { collecterDossiers, completerSuivi, type SaisieTexte } from './dossier.ts';
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
  const { config, sources, motsCles, suivi, suiviTextes, hierarchie, indicateurs, echeances: echeancesSaisies } = d.reglages;
  const journal = d.journal ?? (() => {});
  const aujourdhui = dateIsoParis(d.maintenant);

  const newsPrecedent = lireJson<NewsJson>(d.depot, CHEMINS.news);
  const etatPrecedent = lireJson<{ sources?: EtatVeille['sources'] }>(d.depot, CHEMINS.etat);
  const sourcesPrecedentes = etatPrecedent?.sources ?? [];

  // --- Couche A : flux ---
  journal(`Couche A : ${sources.filter((s) => s.type === 'rss' || s.type === 'page').length} sources…`);
  const coucheA = await collecterCoucheA(sources, {
    config, client: d.http, maintenant: d.maintenant, etatPrecedent: sourcesPrecedentes,
    ...(d.delaisNouvellesTentatives ? { delaisNouvellesTentatives: d.delaisNouvellesTentatives } : {}),
  });
  for (const e of coucheA.etats.filter((e) => e.etat === 'ok' || e.etat === 'erreur')) {
    journal(`  ${e.etat === 'ok' ? 'OK    ' : 'ÉCHEC '} ${e.id} : ${e.etat === 'ok' ? `${e.nb_articles} article(s) retenu(s)` : e.erreur}`);
  }

  // --- Alertes Google (flux de l'utilisateur, adresses dans un secret) ---
  const alertes = await collecterAlertes(sources, {
    config, client: d.http, maintenant: d.maintenant, env: d.env, etatPrecedent: sourcesPrecedentes,
    ...(d.delaisNouvellesTentatives ? { delaisNouvellesTentatives: d.delaisNouvellesTentatives } : {}),
  });
  for (const e of alertes.etats) journal(`  ${e.etat === 'ok' ? 'OK    ' : e.etat === 'erreur' ? 'ÉCHEC ' : '—     '} ${e.id} : ${e.etat === 'ok' ? `${e.nb_articles} article(s)` : e.erreur}`);

  // --- Couche B : API officielles (optionnelles) ---
  const coucheB = await collecterCoucheB(sources, {
    client: d.http, config, maintenant: d.maintenant, env: d.env, etatPrecedent: sourcesPrecedentes,
    ...(d.connecteurs ? { connecteurs: d.connecteurs } : {}),
    ...(indicateurs ? { indicateurs } : {}),
  });
  journal('Couche B :');
  for (const e of coucheB.etats) journal(`  ${e.etat === 'ok' ? 'OK    ' : e.etat === 'erreur' ? 'ÉCHEC ' : '—     '} ${e.id} : ${e.erreur ?? `${e.nb_articles} élément(s)`}`);
  journal(`Recherche IA : ${RAISON_IA}`);

  // --- Suivi PLF / PLFSS : dossiers législatifs de l'Assemblée nationale ---
  const dossiers = await collecterDossiers(sources, { client: d.http, maintenant: d.maintenant, etatPrecedent: sourcesPrecedentes, motsCles, hierarchie });
  for (const e of dossiers.etats) journal(`  ${e.etat === 'ok' ? 'OK    ' : 'ÉCHEC '} ${e.id} : ${e.nb_elements ?? 0} étape(s)${e.erreur ? ` — ${e.erreur}` : ''}`);
  // Priorité : suivi lu aujourd'hui, sinon celui déjà publié, sinon le secours saisi à la main ;
  // puis la saisie du pôle (veille/suivi-textes.json) le complète.
  const completer = (s: SuiviTexte | null, saisie: SaisieTexte | undefined) => (s ? completerSuivi(s, saisie, aujourdhui) : null);
  const suiviPublie = {
    plf: completer(dossiers.suivi.plf ?? newsPrecedent?.suivi?.plf ?? suivi.plf, suiviTextes?.plf),
    plfss: completer(dossiers.suivi.plfss ?? newsPrecedent?.suivi?.plfss ?? suivi.plfss, suiviTextes?.plfss),
  };

  // --- Échéances : calendrier fiscal officiel + veille/echeances.json ---
  const calendrier = await collecterCalendrier(sources, {
    client: d.http, maintenant: d.maintenant, etatPrecedent: sourcesPrecedentes,
    ...(d.delaisNouvellesTentatives ? { delaisNouvellesTentatives: d.delaisNouvellesTentatives } : {}),
  });
  for (const e of calendrier.etats) journal(`  ${e.etat === 'ok' ? 'OK    ' : 'ÉCHEC '} ${e.id} : ${e.nb_elements ?? 0} échéance(s)${e.erreur ? ` — ${e.erreur}` : ''}`);
  const fenetreEcheances = { du: ajouterJours(aujourdhui, -7), au: ajouterJours(aujourdhui, 100) };
  // Un mois du calendrier illisible aujourd'hui garde les échéances déjà publiées pour ce mois.
  const officielles = [
    ...calendrier.echeances,
    ...(newsPrecedent?.echeances ?? []).filter((e) => e.origine === 'calendrier_officiel' && !calendrier.moisLus.includes(e.date.slice(0, 7))),
  ].filter((e) => e.date >= fenetreEcheances.du && e.date <= fenetreEcheances.au);
  const echeances = fusionnerEcheances(
    officielles,
    echeancesSaisies ? developperEcheances(echeancesSaisies, fenetreEcheances.du, fenetreEcheances.au) : [],
  );

  // --- Fusion et classement ---
  const nouveaux: Article[] = [
    ...coucheA.articles.map((a) => depuisFlux(a, aujourdhui)),
    ...coucheB.articles.map((a) => depuisFlux(a, aujourdhui, 'api')),
    ...alertes.articles.map((a) => depuisFlux(a, aujourdhui, 'alerte')),
    ...dossiers.articles.map((a) => depuisFlux(a, aujourdhui)),
  ];
  const themes = new Map(sources.map((s) => [s.id, themeConnu(s.theme)]));
  const classement = appliquerClassement(
    fusionnerArticles(newsPrecedent?.articles ?? [], nouveaux),
    motsCles,
    (id) => (id ? (themes.get(id) ?? null) : null),
    aujourdhui,
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
    suivi: suiviPublie,
    sources: sourcesCitees(sources),
    echeances,
  };
  const newsModifie = !newsPrecedent || empreinteNews(newsPrecedent) !== empreinteNews(news);
  if (newsModifie) d.depot.ecrire(CHEMINS.news, json(news));

  // Ordre du catalogue pour l'écran « État des sources ».
  const parId = new Map([...coucheA.etats, ...alertes.etats, ...coucheB.etats, ...dossiers.etats, ...calendrier.etats].map((e) => [e.id, e]));
  const etat: EtatVeille = {
    version: 2,
    genere_le: d.maintenant.toISOString(),
    sources: sources.flatMap((s) => {
      const e = parId.get(s.id);
      if (!e) return [];
      const ancien = sourcesPrecedentes.find((p) => p.id === s.id)?.historique ?? [];
      return [{ ...e, historique: historiqueEtat(ancien, aujourdhui, e.etat) }];
    }),
    recherche_ia: { active: false, raison: RAISON_IA },
    classement: { articles: news.articles.length, exclus: classement.exclus, marginaux: classement.marginaux },
  };
  d.depot.ecrire(CHEMINS.etat, json(etat));

  journal(`Publication : ${news.articles.length} article(s) en ligne${newsModifie ? '' : ' (inchangé)'}.`);
  return { news, etat, newsModifie };
}

/** Ajoute l'état du jour à l'historique d'une source (30 jours, une entrée par jour, la dernière collecte du jour l'emporte). */
export function historiqueEtat(ancien: readonly { date: string; etat: EtatVeille['sources'][number]['etat'] }[], aujourdhui: string, etat: EtatVeille['sources'][number]['etat']) {
  const limite = ajouterJours(aujourdhui, -30);
  return [...ancien.filter((h) => h.date !== aujourdhui && h.date > limite), { date: aujourdhui, etat }].sort((a, b) => a.date.localeCompare(b.date));
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
