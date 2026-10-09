import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { EtatVeille, NewsJson } from '../../src/modules/veille/modele.ts';
import type { MotsCles } from '../../scripts/veille/classement.ts';
import { CHEMINS, collecter, type Depot } from '../../scripts/veille/collecte.ts';
import { verifierConfig, type ConfigVeille, type Reglages, type SourceCatalogue } from '../../scripts/veille/config.ts';
import { collecterCoucheA } from '../../scripts/veille/couche-a.ts';
import { collecterCoucheB, secretsRequis, type ConnecteurApi } from '../../scripts/veille/couche-b.ts';
import { ClientHttp } from '../../scripts/veille/http.ts';

const octets = (nom: string): Uint8Array<ArrayBuffer> => new Uint8Array(readFileSync(new URL(`../fixtures/veille/${nom}`, import.meta.url)));

const MAINTENANT = new Date('2026-10-08T04:30:00Z');
const CONFIG: ConfigVeille = {
  recherche_ia: false,
  fenetre_jours: { defaut: 7, 'Économie et statistiques': 14, 'Rennes et Bretagne': 14 },
  conservation_jours: 60,
  longueur_resume: 300,
  user_agent: 'Pole003-Veille/1.0 (+https://pole-003.github.io/sandbox)',
};

/** Faux réseau : chaque URL renvoie une suite de réponses (la dernière se répète). robots.txt absent par défaut. */
function fauxHttp(routes: Record<string, ({ statut?: number; corps?: Uint8Array<ArrayBuffer> | string } | Error)[]>) {
  const appels: string[] = [];
  const fetch = (async (entree: URL | string) => {
    const url = String(entree);
    appels.push(url);
    const suite = routes[url];
    if (!suite) return new Response('', { status: 404 });
    const r = suite.length > 1 ? suite.shift()! : suite[0]!;
    if (r instanceof Error) throw r;
    return new Response(r.corps ?? '', { status: r.statut ?? 200 });
  }) as typeof globalThis.fetch;
  const client = new ClientHttp({ userAgent: CONFIG.user_agent, fetch, attendre: async () => {}, maintenant: () => 0 });
  return { client, appels };
}

const source = (s: Partial<SourceCatalogue> & { id: string; url?: string }): SourceCatalogue => ({
  nom: s.id, type: 'rss', theme: 'Loi de finances', statut: 'verifie', ...s,
});

describe('veille · réglages', () => {
  it('recherche_ia doit rester à false', () => {
    expect(() => verifierConfig(CONFIG)).not.toThrow();
    expect(() => verifierConfig({ ...CONFIG, recherche_ia: true })).toThrow(/recherche_ia doit valoir false/);
  });

  it('le veille/config.json du dépôt ne contient plus de paramètre IA', () => {
    const config = JSON.parse(readFileSync(new URL('../../veille/config.json', import.meta.url), 'utf8')) as Record<string, unknown>;
    expect(config.recherche_ia).toBe(false);
    for (const cle of ['modele_recherche', 'modele_notation', 'budget_mensuel_usd', 'recherches_max_par_theme']) expect(config).not.toHaveProperty(cle);
    expect(() => verifierConfig(config as unknown as ConfigVeille)).not.toThrow();
  });
});

describe('veille · couche A', () => {
  it('isole chaque source : une panne n’empêche pas les autres, 2 nouvelles tentatives', async () => {
    const { client, appels } = fauxHttp({
      'https://www.senat.fr/rss/textes.rss': [{ corps: octets('senat-encodage-trompeur.rss') }],
      'https://panne.fr/flux.rss': [{ statut: 503 }],
      'https://reprise.fr/flux.rss': [{ statut: 500 }, { corps: octets('atom-exemple.xml') }],
    });
    const r = await collecterCoucheA(
      [
        source({ id: 'senat', url: 'https://www.senat.fr/rss/textes.rss', type_article: 'texte_officiel' }),
        source({ id: 'panne', url: 'https://panne.fr/flux.rss' }),
        source({ id: 'reprise', url: 'https://reprise.fr/flux.rss', theme: 'Économie et statistiques' }),
        source({ id: 'api', type: 'api', secret: 'X' }),
      ],
      { config: CONFIG, client, maintenant: MAINTENANT, etatPrecedent: [], delaisNouvellesTentatives: [0, 0], attendre: async () => {} },
    );
    expect(r.etats.map((e) => [e.id, e.etat, e.nb_articles])).toEqual([['senat', 'ok', 2], ['panne', 'erreur', 0], ['reprise', 'ok', 2]]);
    expect(r.etats[1]?.erreur).toBe('HTTP 503');
    expect(appels.filter((u) => u === 'https://panne.fr/flux.rss')).toHaveLength(3);
    // Résumé = description du flux, type = celui de la source
    expect(r.articles[0]).toMatchObject({ resume: 'Texte n° 1 (exemple fictif) : répartition des crédits, fiscalité des entreprises.', type: 'texte_officiel' });
  });

  it('flux volumineux : mots-clés, fenêtre de dates, liens https', async () => {
    const url = 'https://www2.assemblee-nationale.fr/feeds/detail/documents-parlementaires';
    const { client } = fauxHttp({ [url]: [{ corps: octets('an-documents.rss') }] });
    const r = await collecterCoucheA([source({ id: 'an-documents', url, mots_cles: ['finances', 'fiscal', 'TVA'] })], {
      config: CONFIG, client, maintenant: MAINTENANT, etatPrecedent: [],
    });
    expect(r.articles.map((a) => [a.titre, a.date, a.url])).toEqual([
      ['Projet de loi de finances pour 2027 – rapport général (fictif)', '2026-10-07', 'https://www.assemblee-nationale.fr/exemple/rapport-plf.html'],
      ['Taux de TVA applicable aux travaux (fictif)', '2026-10-06', 'https://www.assemblee-nationale.fr/exemple/tva.html?utm_source=rss&id=3'],
    ]);
    expect(r.etats[0]).toMatchObject({ nb_elements: 4, nb_articles: 2 });
  });

  it('page suivie : changement détecté par rapport à l’exécution précédente', async () => {
    const url = 'https://www.assemblee-nationale.fr/dyn/17/dossiers/PLF_2027';
    const page = (etape: string) => `<html><head><title>PLF 2027</title></head><body>${'Dossier. '.repeat(40)}${etape}</body></html>`;
    const s = source({ id: 'an-dossier-plf', type: 'page', url });
    const premier = await collecterCoucheA([s], { config: CONFIG, client: fauxHttp({ [url]: [{ corps: page('Dépôt') }] }).client, maintenant: MAINTENANT, etatPrecedent: [] });
    expect(premier.articles).toEqual([]); // première exécution : simple relevé
    const identique = await collecterCoucheA([s], { config: CONFIG, client: fauxHttp({ [url]: [{ corps: page('Dépôt') }] }).client, maintenant: MAINTENANT, etatPrecedent: premier.etats });
    expect(identique.articles).toEqual([]);
    const change = await collecterCoucheA([s], { config: CONFIG, client: fauxHttp({ [url]: [{ corps: page('1re lecture') }] }).client, maintenant: MAINTENANT, etatPrecedent: premier.etats });
    expect(change.articles.map((a) => [a.titre, a.date])).toEqual([['an-dossier-plf : page mise à jour', '2026-10-08']]);
  });

  it('sources en panne ou à vérifier : signalées sans requête', async () => {
    const { client, appels } = fauxHttp({});
    const r = await collecterCoucheA(
      [source({ id: 'p', statut: 'en_panne', url: 'https://x.fr/a' }), source({ id: 'v', statut: 'a_verifier', url: 'https://x.fr/b' })],
      { config: CONFIG, client, maintenant: MAINTENANT, etatPrecedent: [] },
    );
    expect(r.etats.map((e) => e.etat)).toEqual(['inactive', 'inactive']);
    expect(appels).toEqual([]);
  });
});

describe('veille · couche B', () => {
  const piste = source({ id: 'piste-legifrance', type: 'api', statut: 'a_verifier', secret: 'PISTE_CLIENT_ID / PISTE_CLIENT_SECRET' });
  const bodacc = source({ id: 'bodacc-35', type: 'api', statut: 'a_verifier', theme: 'Rennes et Bretagne' });

  it('noms des secrets lus dans le catalogue', () => {
    expect(secretsRequis(piste)).toEqual(['PISTE_CLIENT_ID', 'PISTE_CLIENT_SECRET']);
    expect(secretsRequis(bodacc)).toEqual([]);
  });

  it('sans identifiants (ou valeur vide) : non configurée, sans requête ni valeur dans le message', async () => {
    const { client, appels } = fauxHttp({});
    const r = await collecterCoucheB([piste], { client, config: CONFIG, maintenant: MAINTENANT, env: { PISTE_CLIENT_ID: 'id-secret', PISTE_CLIENT_SECRET: '' }, etatPrecedent: [] });
    expect(r.etats[0]).toMatchObject({ etat: 'non_configuree', erreur: 'non configurée : identifiants absents (PISTE_CLIENT_SECRET)' });
    expect(JSON.stringify(r.etats)).not.toContain('id-secret');
    expect(appels).toEqual([]);
  });

  it('identifiants présents mais pas de connecteur : non configurée', async () => {
    const r = await collecterCoucheB([piste, bodacc], { client: fauxHttp({}).client, config: CONFIG, maintenant: MAINTENANT, env: { PISTE_CLIENT_ID: 'a', PISTE_CLIENT_SECRET: 'b' }, etatPrecedent: [], connecteurs: {} });
    expect(r.etats.map((e) => e.erreur)).toEqual(['non configurée : identifiants présents, connecteur à développer', 'non configurée : connecteur à développer']);
  });

  it('connecteur : identifiants transmis, panne isolée', async () => {
    const recus: Record<string, string>[] = [];
    const connecteurs: Record<string, ConnecteurApi> = {
      'piste-legifrance': {
        collecter: async (ctx) => {
          recus.push(ctx.identifiants);
          return { articles: [{ titre: 'Décret fictif', url: 'https://exemple.invalid/jorf/1', date: '2026-10-08', theme: 'Fiscal et comptable', source: 'Légifrance', source_id: 'piste-legifrance', resume: null, type: 'texte_officiel' }], indicateurs: [] };
        },
      },
      'bodacc-35': {
        collecter: async () => {
          throw new Error('HTTP 500');
        },
      },
    };
    const r = await collecterCoucheB([piste, bodacc], { client: fauxHttp({}).client, config: CONFIG, maintenant: MAINTENANT, env: { PISTE_CLIENT_ID: 'a', PISTE_CLIENT_SECRET: 'b' }, etatPrecedent: [], connecteurs });
    expect(recus).toEqual([{ PISTE_CLIENT_ID: 'a', PISTE_CLIENT_SECRET: 'b' }]);
    expect(r.etats.map((e) => [e.etat, e.erreur])).toEqual([['ok', null], ['erreur', 'HTTP 500']]);
    expect(r.articles).toHaveLength(1);
  });
});

// --- Collecte complète, fichiers en mémoire ---

function depotMemoire(initial: Record<string, string> = {}): Depot & { fichiers: Map<string, string> } {
  const fichiers = new Map(Object.entries(initial));
  return { fichiers, lire: (c) => fichiers.get(c) ?? null, ecrire: (c, t) => void fichiers.set(c, t) };
}

const MOTS_CLES: MotsCles = {
  seuils_importance: { '5': 9, '4': 6, '3': 3, '2': 1 },
  bonus_sources: { 'bofip-actualites': 2 },
  exclusions: ["rapport d'information"],
  themes: {
    'Loi de finances': { public_par_defaut: ['Expertise comptable'], mots_cles: { 'loi de finances': 5 }, exclusions: [] },
    'Fiscal et comptable': { public_par_defaut: ['Expertise comptable'], mots_cles: { tva: 3, "crédit d'impôt": 3 }, exclusions: [] },
  },
  publics: {},
};

const REGLAGES: Reglages = {
  config: CONFIG,
  sources: [
    source({ id: 'senat-textes', nom: 'Sénat — Derniers textes', url: 'https://www.senat.fr/rss/textes.rss', type_article: 'texte_officiel' }),
    source({ id: 'bofip-actualites', nom: 'BOFiP-Impôts — Actualités', url: 'https://bofip.impots.gouv.fr/bofip/ext/rss.xml?actualites=1', theme: 'Fiscal et comptable', type_article: 'doctrine' }),
    source({ id: 'panne', url: 'https://panne.fr/flux.rss' }),
    source({ id: 'insee-bdm', nom: 'INSEE — Séries BDM', type: 'api', statut: 'a_verifier', secret: 'INSEE_API_KEY', theme: 'Économie et statistiques' }),
  ],
  motsCles: MOTS_CLES,
  suivi: { plf: null, plfss: null },
};

describe('veille · collecte complète (0 €)', () => {
  const routes = () => ({
    'https://www.senat.fr/rss/textes.rss': [{ corps: octets('senat-encodage-trompeur.rss') }],
    'https://bofip.impots.gouv.fr/bofip/ext/rss.xml?actualites=1': [{ corps: octets('bofip-sans-pubdate.rss') }],
    'https://panne.fr/flux.rss': [new Error('réseau coupé')],
  });
  const lancer = (depot: Depot, maintenant = MAINTENANT, reglages = REGLAGES) =>
    collecter({ reglages, http: fauxHttp(routes()).client, depot, maintenant, env: {}, delaisNouvellesTentatives: [0, 0] });

  it('publie les flux classés par mots-clés, résumés repris des flux, API signalées non configurées', async () => {
    const depot = depotMemoire();
    const bilan = await lancer(depot);
    const news = JSON.parse(depot.fichiers.get(CHEMINS.news)!) as NewsJson;
    const etat = JSON.parse(depot.fichiers.get(CHEMINS.etat)!) as EtatVeille;

    // 2 Sénat + 3 BOFiP, moins le rapport d'information exclu.
    const parTitre = news.articles.map((a) => [a.titre, a.theme, a.importance]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    expect(parTitre).toEqual([
      ['BIC — Actualité fictive sans date', 'Fiscal et comptable', 2],
      ["IS — Crédit d'impôt fictif : précisions sur l'assiette", 'Fiscal et comptable', 3],
      ['Projet de loi de finances pour 2027 — texte adopté en séance', 'Loi de finances', 3],
      ['TVA — Taux applicables : mise à jour fictive', 'Fiscal et comptable', 3],
    ]);
    expect(news.articles.find((a) => a.titre.startsWith('TVA'))).toMatchObject({
      resume: 'Série TVA, publié le 01/10/2026. Actualité fictive.', type: 'doctrine', public: ['Expertise comptable'], origine: 'flux',
    });
    expect(etat).toMatchObject({ version: 2, recherche_ia: { active: false }, classement: { articles: 4, exclus: 1 } });
    expect(etat.sources.map((s) => [s.id, s.etat])).toEqual([['senat-textes', 'ok'], ['bofip-actualites', 'ok'], ['panne', 'erreur'], ['insee-bdm', 'non_configuree']]);
    expect(etat.sources[3]?.erreur).toBe('non configurée : identifiants absents (INSEE_API_KEY)');
    expect(bilan.newsModifie).toBe(true);
    expect([...depot.fichiers.keys()].sort()).toEqual([CHEMINS.news, CHEMINS.etat]);
  });

  it('2e exécution identique : news.json non réécrit', async () => {
    const depot = depotMemoire();
    await lancer(depot);
    const seconde = await lancer(depot, new Date('2026-10-08T05:30:00Z'));
    expect(seconde.newsModifie).toBe(false);
  });

  it('suivi PLF saisi à la main publié tel quel', async () => {
    const plf = { texte: 'PLF 2027', etape_actuelle: 'Dépôt', etapes: [], prochaine_echeance: null, mis_a_jour_le: '2026-10-08' };
    const bilan = await lancer(depotMemoire(), MAINTENANT, { ...REGLAGES, suivi: { plf, plfss: null } });
    expect(bilan.news.suivi.plf).toEqual(plf);
  });
});
