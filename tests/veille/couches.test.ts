import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { NewsJson } from '../../src/modules/veille/modele.ts';
import { CHEMINS, collecter, type Depot } from '../../scripts/veille/collecte.ts';
import type { ConfigVeille, ConsigneTheme, Reglages, SourceCatalogue } from '../../scripts/veille/config.ts';
import { collecterCoucheA } from '../../scripts/veille/couche-a.ts';
import { messageTheme, rechercherTheme, fenetreTheme } from '../../scripts/veille/couche-c.ts';
import { Budget, depuisDollars } from '../../scripts/veille/couts.ts';
import { ClientHttp } from '../../scripts/veille/http.ts';
import { ErreurModele, verifierModeleRecherche, type ClientIA, type Message, type Parametres } from '../../scripts/veille/ia.ts';

const octets = (nom: string): Uint8Array<ArrayBuffer> => new Uint8Array(readFileSync(new URL(`../fixtures/veille/${nom}`, import.meta.url)));
const reponseIA = (nom: string) => JSON.parse(readFileSync(new URL(`../fixtures/veille/${nom}`, import.meta.url), 'utf8')) as Message;

const MAINTENANT = new Date('2026-10-08T04:30:00Z');
const CONFIG: ConfigVeille = {
  modele_recherche: 'claude-sonnet-5-5',
  modele_notation: 'claude-haiku-5-5',
  recherches_max_par_theme: 5,
  budget_mensuel_usd: 20,
  fenetre_jours: { defaut: 7, 'Économie et statistiques': 14, 'Rennes et Bretagne': 14 },
  localisation: { type: 'approximate', city: 'Rennes', region: 'Bretagne', country: 'FR', timezone: 'Europe/Paris' },
  conservation_jours: 60,
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

describe('veille · couche A', () => {
  it('isole chaque source : une panne n’empêche pas les autres, 2 nouvelles tentatives', async () => {
    const { client, appels } = fauxHttp({
      'https://www.senat.fr/rss/textes.rss': [{ corps: octets('senat-encodage-trompeur.rss') }],
      'https://panne.fr/flux.rss': [{ statut: 503 }],
      'https://reprise.fr/flux.rss': [{ statut: 500 }, { corps: octets('atom-exemple.xml') }],
    });
    const r = await collecterCoucheA(
      [
        source({ id: 'senat', url: 'https://www.senat.fr/rss/textes.rss' }),
        source({ id: 'panne', url: 'https://panne.fr/flux.rss' }),
        source({ id: 'reprise', url: 'https://reprise.fr/flux.rss', theme: 'Économie et statistiques' }),
      ],
      { config: CONFIG, client, maintenant: MAINTENANT, etatPrecedent: [], delaisNouvellesTentatives: [0, 0], attendre: async () => {} },
    );
    expect(r.etats.map((e) => [e.id, e.etat, e.nb_articles])).toEqual([['senat', 'ok', 2], ['panne', 'erreur', 0], ['reprise', 'ok', 2]]);
    expect(r.etats[1]?.erreur).toBe('HTTP 503');
    expect(appels.filter((u) => u === 'https://panne.fr/flux.rss')).toHaveLength(3);
    expect(r.etats[0]?.derniere_reussite).toBe(MAINTENANT.toISOString());
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

  it('sources en panne, à vérifier ou API : signalées sans requête', async () => {
    const { client, appels } = fauxHttp({});
    const r = await collecterCoucheA(
      [source({ id: 'p', statut: 'en_panne', url: 'https://x.fr/a' }), source({ id: 'v', statut: 'a_verifier', url: 'https://x.fr/b' }), source({ id: 'api', type: 'api', statut: 'a_verifier', secret: 'PISTE_CLIENT_ID' })],
      { config: CONFIG, client, maintenant: MAINTENANT, etatPrecedent: [] },
    );
    expect(r.etats.map((e) => e.etat)).toEqual(['inactive', 'inactive', 'non_configuree']);
    expect(appels).toEqual([]);
  });
});

// --- Couche C : faux client IA, aucune requête réelle, aucun crédit consommé ---

function fauxIA(reponses: Message[], capacites = { web: true, code: true, structured: true }) {
  const requetes: Parametres[] = [];
  const client: ClientIA = {
    models: {
      retrieve: async (id) => ({
        id,
        capabilities: {
          server_tools: { supported: true, web_search: { supported: capacites.web }, code_execution: { supported: capacites.code } },
          structured_outputs: { supported: capacites.structured },
        } as never,
      }),
    },
    beta: {
      messages: {
        create: async (p) => {
          requetes.push(structuredClone(p));
          const r = reponses.length > 1 ? reponses.shift()! : reponses[0]!;
          return structuredClone(r);
        },
      },
    },
  };
  return { client, requetes };
}

const RENNES: ConsigneTheme = { theme: 'Rennes et Bretagne', consigne: 'Vie économique de Rennes.' };
const budget = (plafond = 20) => new Budget({ mois: {} }, '2026-10-08', depuisDollars(plafond));
const optionsC = (client: ClientIA, b = budget()) => ({ client, config: CONFIG, promptSysteme: 'Prompt système.', outil: 'web_search_20260209' as const, budget: b, maintenant: MAINTENANT });

describe('veille · couche C (réponses simulées)', () => {
  it('retient l’article valide, rejette l’URL inventée et la date hors fenêtre', async () => {
    const { client, requetes } = fauxIA([reponseIA('reponse-ia-rennes.json')]);
    const r = await rechercherTheme(optionsC(client), RENNES);
    expect(r.statut).toBe('ok');
    expect(r.articles.map((a) => a.url)).toEqual(['https://www.exemple-rennes.invalid/actualites/implantation-usine']);
    expect(r.rejetes.map((x) => x.raison)).toEqual([
      'URL absente des résultats de recherche (possible URL inventée)',
      'date 2026-08-30 hors de la fenêtre 2026-09-24 – 2026-10-08',
    ]);
    expect(r.recherches).toBe(3);
    // 12 000 × 2 µ$ + 1 500 × 10 µ$ + 3 × 10 000 µ$ = 0,069 $
    expect(r.coutNano).toBe(depuisDollars(0.069));

    const p = requetes[0]!;
    expect(p.model).toBe('claude-sonnet-5-5');
    expect(p.tools).toEqual([{ type: 'web_search_20260209', name: 'web_search', max_uses: 5, user_location: CONFIG.localisation }]);
    expect(p).toMatchObject({ betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', system: 'Prompt système.' });
  });

  it('JSON invalide : un nouvel essai, puis succès', async () => {
    const { client, requetes } = fauxIA([reponseIA('reponse-ia-json-invalide.json'), reponseIA('reponse-ia-rennes.json')]);
    const r = await rechercherTheme(optionsC(client), RENNES);
    expect(requetes).toHaveLength(2);
    expect(r.statut).toBe('ok');
    expect(r.recherches).toBe(5); // 2 + 3 : les deux essais sont facturés
  });

  it('JSON invalide deux fois : thème abandonné pour la journée', async () => {
    const { client, requetes } = fauxIA([reponseIA('reponse-ia-json-invalide.json')]);
    const r = await rechercherTheme(optionsC(client), RENNES);
    expect(requetes).toHaveLength(2);
    expect(r.statut).toBe('abandonne');
    expect(r.erreur).toMatch(/^JSON invalide \(réponse tronquée\)/);
  });

  it('thème inattendu ou objet non conforme : nouvel essai', async () => {
    const mauvais = reponseIA('reponse-ia-rennes.json');
    const dernier = mauvais.content[mauvais.content.length - 1] as { text: string };
    dernier.text = '{"theme": "Loi de finances", "articles": []}';
    const { client } = fauxIA([mauvais]);
    const r = await rechercherTheme(optionsC(client), RENNES);
    expect(r).toMatchObject({ statut: 'abandonne', erreur: 'thème « Loi de finances » au lieu de « Rennes et Bretagne »' });
  });

  it('pause_turn : la réponse partielle est renvoyée telle quelle et la recherche reprend', async () => {
    const pause = { ...reponseIA('reponse-ia-rennes.json'), stop_reason: 'pause_turn' as const };
    pause.content = pause.content.slice(0, 3);
    const { client, requetes } = fauxIA([pause, reponseIA('reponse-ia-rennes.json')]);
    const r = await rechercherTheme(optionsC(client), RENNES);
    expect(r.statut).toBe('ok');
    expect(requetes[1]?.messages).toHaveLength(2);
    expect(requetes[1]?.messages[1]?.role).toBe('assistant');
  });

  it('budget atteint : aucun appel', async () => {
    const { client, requetes } = fauxIA([reponseIA('reponse-ia-rennes.json')]);
    const plein = new Budget({ mois: { '2026-10': { total_usd: 20, jours: {} } } }, '2026-10-08', depuisDollars(20));
    const r = await rechercherTheme(optionsC(client, plein), RENNES);
    expect(requetes).toHaveLength(0);
    expect(r).toMatchObject({ statut: 'abandonne', erreur: 'budget mensuel atteint' });
  });

  it('refus du modèle : thème abandonné, coût compté', async () => {
    const refus = { ...reponseIA('reponse-ia-rennes.json'), stop_reason: 'refusal' as const, stop_details: { type: 'refusal', category: null, explanation: null } as never };
    const { client } = fauxIA([refus]);
    const r = await rechercherTheme(optionsC(client), RENNES);
    expect(r.statut).toBe('abandonne');
    expect(r.coutNano).toBeGreaterThan(0);
  });

  it('fenêtre et message : dates du jour et consigne du thème', () => {
    const f = fenetreTheme(CONFIG, 'Rennes et Bretagne', MAINTENANT);
    expect(f).toEqual({ debut: '2026-09-24', fin: '2026-10-08', jours: 14 });
    const m = messageTheme(RENNES, f);
    expect(m).toContain('du 2026-09-24 au 2026-10-08 inclus');
    expect(m).toContain('Consigne : Vie économique de Rennes.');
    expect(m).toContain('"theme": "Rennes et Bretagne"');
  });

  it('contrôle du modèle via l’API Models : version de l’outil, refus si pas de recherche web', async () => {
    expect(await verifierModeleRecherche(fauxIA([]).client, 'claude-sonnet-5-5')).toBe('web_search_20260209');
    expect(await verifierModeleRecherche(fauxIA([]).client, 'claude-haiku-5-5')).toBe('web_search_20250305');
    await expect(verifierModeleRecherche(fauxIA([], { web: false, code: true, structured: true }).client, 'claude-sonnet-5-5')).rejects.toBeInstanceOf(ErreurModele);
  });
});

// --- Collecte complète, fichiers en mémoire ---

function depotMemoire(initial: Record<string, string> = {}): Depot & { fichiers: Map<string, string> } {
  const fichiers = new Map(Object.entries(initial));
  return { fichiers, lire: (c) => fichiers.get(c) ?? null, ecrire: (c, t) => void fichiers.set(c, t) };
}

const REGLAGES: Reglages = {
  config: CONFIG,
  sources: [
    source({ id: 'senat-textes', nom: 'Sénat — Derniers textes', url: 'https://www.senat.fr/rss/textes.rss' }),
    source({ id: 'bofip-actualites', nom: 'BOFiP-Impôts — Actualités', url: 'https://bofip.impots.gouv.fr/bofip/ext/rss.xml?actualites=1', theme: 'Fiscal et comptable' }),
    source({ id: 'panne', url: 'https://panne.fr/flux.rss' }),
  ],
  themes: [RENNES],
  promptSysteme: 'Prompt système.',
};

const reponseNotation = (ids: string[]): Message => ({
  ...reponseIA('reponse-ia-rennes.json'),
  model: 'claude-haiku-5-5',
  content: [{ type: 'text', text: JSON.stringify({ notes: ids.map((id, i) => ({ id, importance: i === 0 ? 1 : 4, public: ['Expertise comptable'], type: 'texte_officiel', resume: `Résumé ${i}.` })) }), citations: null }],
  usage: { input_tokens: 3_000, output_tokens: 800, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, server_tool_use: null, iterations: null } as never,
});

describe('veille · collecte complète', () => {
  const routes = () => ({
    'https://www.senat.fr/rss/textes.rss': [{ corps: octets('senat-encodage-trompeur.rss') }],
    'https://bofip.impots.gouv.fr/bofip/ext/rss.xml?actualites=1': [{ corps: octets('bofip-sans-pubdate.rss') }],
    'https://panne.fr/flux.rss': [new Error('réseau coupé')],
  });

  it('sans clé : publie les flux, signale la couche C sautée, ne crée pas de coûts', async () => {
    const depot = depotMemoire();
    const bilan = await collecter({ reglages: REGLAGES, http: fauxHttp(routes()).client, ia: null, depot, maintenant: MAINTENANT, delaisNouvellesTentatives: [0, 0] });
    const news = JSON.parse(depot.fichiers.get(CHEMINS.news)!) as NewsJson;
    expect(news.articles).toHaveLength(5); // 2 Sénat + 3 BOFiP (le 3e, sans date, est daté du jour de collecte)
    expect(news.articles.every((a) => a.resume === null && a.importance === null)).toBe(true);
    expect(bilan.etat.couche_c).toMatchObject({ statut: 'sautee', raison: 'clé ANTHROPIC_API_KEY absente : recherche IA non exécutée' });
    expect(bilan.etat.sources.find((s) => s.id === 'panne')).toMatchObject({ etat: 'erreur' });
    expect(depot.fichiers.has(CHEMINS.couts)).toBe(false);
    expect(news.sources.map((s) => s.nom)).toContain('BOFiP-Impôts — Actualités');
  });

  it('avec clé simulée : recherche, notation groupée, coûts cumulés ; 2e exécution identique sans réécriture', async () => {
    const depot = depotMemoire();
    // Ordre des appels : couche C (1 thème), puis notation groupée.
    const premiere = await collecter({ reglages: REGLAGES, http: fauxHttp(routes()).client, ia: iaPourCollecte(), depot, maintenant: MAINTENANT, delaisNouvellesTentatives: [0, 0] });
    const news = JSON.parse(depot.fichiers.get(CHEMINS.news)!) as NewsJson;
    const ia = news.articles.filter((a) => a.origine === 'recherche_ia');
    expect(ia.map((a) => a.titre)).toEqual(['Une entreprise fictive annonce une usine à Rennes']);
    // Notation : le premier article est noté 1 (marginal, conservé), les autres reçoivent note et résumé.
    expect(premiere.etat.notation).toMatchObject({ statut: 'executee', raison: '1 article(s) marginal(aux), masqué(s) par défaut' });
    const flux = news.articles.filter((a) => a.origine === 'flux');
    expect(flux.map((a) => a.importance).sort()).toEqual([1, 4, 4, 4, 4]);
    expect(flux.every((a) => a.resume?.startsWith('Résumé'))).toBe(true);
    const couts = JSON.parse(depot.fichiers.get(CHEMINS.couts)!) as { mois: Record<string, { total_usd: number }> };
    expect(couts.mois['2026-10']?.total_usd).toBeCloseTo(premiere.coutExecutionUsd, 6);
    expect(premiere.etat.couts.jour_usd).toBeCloseTo(premiere.coutExecutionUsd, 6);

    const seconde = await collecter({ reglages: REGLAGES, http: fauxHttp(routes()).client, ia: null, depot, maintenant: new Date('2026-10-08T05:30:00Z'), delaisNouvellesTentatives: [0, 0] });
    expect(seconde.newsModifie).toBe(false);
    expect(seconde.news.articles).toHaveLength(news.articles.length);
  });
});

/** Faux client pour la collecte complète : répond à la couche C, puis à la notation avec les identifiants reçus. */
function iaPourCollecte(): ClientIA {
  return {
    models: fauxIA([]).client.models,
    beta: {
      messages: {
        create: async (p) => {
          if (p.tools?.length) return structuredClone(reponseIA('reponse-ia-rennes.json'));
          const contenu = String(p.messages[0]?.content);
          const ids = [...contenu.matchAll(/"id":"([0-9a-f]{16})"/g)].map((m) => m[1]!);
          return reponseNotation(ids);
        },
      },
    },
  };
}
