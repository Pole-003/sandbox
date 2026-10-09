import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Article } from '../../src/modules/veille/modele.ts';
import { collecterAlertes, lireAlertes, nettoyerLienGoogle, themeAlerte } from '../../scripts/veille/alertes.ts';
import { bonusFraicheur, classer, contientMot, sansAccents, verifierMotsCles, type MotsCles } from '../../scripts/veille/classement.ts';
import type { ConfigVeille, SourceCatalogue } from '../../scripts/veille/config.ts';
import { connecteurBodacc, connecteurInsee, formaterValeur, lireComptesBodacc, urlBodacc } from '../../scripts/veille/connecteurs.ts';
import { appliquerClassement, fusionnerArticles, indicateursDuJour } from '../../scripts/veille/fusion.ts';
import { ClientHttp } from '../../scripts/veille/http.ts';
import { finDePeriode, lireSeriesInsee, periodeEnClair, urlSeriesInsee } from '../../scripts/veille/insee.ts';

const fixture = (nom: string) => readFileSync(new URL(`../fixtures/veille/${nom}`, import.meta.url));
const MAINTENANT = new Date('2026-10-09T04:30:00Z');
const CONFIG: ConfigVeille = {
  recherche_ia: false, fenetre_jours: { defaut: 7 }, conservation_jours: 60, longueur_resume: 300,
  user_agent: 'Pole003-Veille/1.0 (+https://pole-003.github.io/sandbox)',
};

/** Faux réseau : réponse par URL exacte ; robots.txt configurable. */
function fauxHttp(routes: Record<string, { statut?: number; corps?: string | Uint8Array<ArrayBuffer> } | Error>) {
  const appels: { url: string; entetes: Record<string, string> }[] = [];
  const fetch = (async (entree: URL | string, init?: RequestInit) => {
    const url = String(entree);
    appels.push({ url, entetes: (init?.headers ?? {}) as Record<string, string> });
    const r = routes[url];
    if (!r) return new Response('', { status: 404 });
    if (r instanceof Error) throw r;
    return new Response(r.corps ?? '', { status: r.statut ?? 200 });
  }) as typeof globalThis.fetch;
  return { client: new ClientHttp({ userAgent: CONFIG.user_agent, fetch, attendre: async () => {}, maintenant: () => 0 }), appels };
}

const REGLES: MotsCles = {
  seuils_importance: { '5': 9, '4': 6, '3': 3, '2': 1 },
  bonus_sources: { 'bofip-actualites': 2 },
  coefficients_origine: { flux: 1, api: 1, alerte: 0.5 },
  bonus_fraicheur: [{ jours: 1, bonus: 2 }, { jours: 3, bonus: 1 }],
  exclusions: ['ordre du jour'],
  themes: {
    'Loi de finances': { public_par_defaut: ['Expertise comptable'], mots_cles: { '=plf': 5, 'loi de finances': 5 }, exclusions: [] },
    'Sécurité sociale': { public_par_defaut: ['Social / paie'], mots_cles: { plfss: 6 }, exclusions: [] },
    'Fiscal et comptable': { public_par_defaut: ['Expertise comptable'], mots_cles: { tva: 3, 'facturation électronique': 5 }, exclusions: [] },
    'Audit et profession': { public_par_defaut: ['Audit / CAC'], mots_cles: { '=audit': 3, 'commissaire aux comptes': 5 }, exclusions: [] },
    'Rennes et Bretagne': { public_par_defaut: ['Conseil aux dirigeants'], mots_cles: { rennes: 5 }, exclusions: ['stade rennais'] },
  },
  publics: {},
};

describe('classement v2 · expressions exactes', () => {
  it('« =plf » ne reconnaît ni « plfss » ni « plfr », mais reconnaît « PLF » isolé', () => {
    expect(contientMot(sansAccents('Le PLF 2027 adopté'), '=plf')).toBe(true);
    expect(contientMot(sansAccents('Le PLFSS 2027'), '=plf')).toBe(false);
    expect(contientMot(sansAccents('Un PLFR en juin'), '=plf')).toBe(false);
    expect(contientMot(sansAccents('Le PLFSS 2027'), 'plf')).toBe(true);
  });

  it('« =audit » ne reconnaît plus « audition » (comptes rendus de l’Assemblée)', () => {
    expect(classer({ titre: 'Audition de M. Dupont', resume: null, source_id: null, theme: 'Loi de finances' }, REGLES).theme).toBe('Loi de finances');
    expect(classer({ titre: 'Audit légal des PME', resume: null, source_id: null, theme: 'Loi de finances' }, REGLES).theme).toBe('Audit et profession');
  });

  it('les expressions exactes acceptent la ponctuation autour', () => {
    expect(contientMot(sansAccents('(PLF) : vote'), '=plf')).toBe(true);
  });
});

describe('classement v2 · poids, fraîcheur, détail', () => {
  const base = { titre: 'TVA et facturation électronique', resume: null, source_id: 'x', theme: 'Fiscal et comptable' as const };

  it('une alerte de presse pèse moins qu’une publication officielle', () => {
    const officiel = classer({ ...base, origine: 'flux' }, REGLES);
    const presse = classer({ ...base, origine: 'alerte' }, REGLES);
    expect(officiel.score).toBe(8);
    expect(presse.score).toBe(4);
    expect(officiel.importance).toBe(4);
    expect(presse.importance).toBe(3);
  });

  it('le bonus de fraîcheur entre dans le score de tri, pas dans l’importance', () => {
    const recent = classer({ ...base, date: '2026-10-09' }, REGLES, '2026-10-09');
    const ancien = classer({ ...base, date: '2026-09-30' }, REGLES, '2026-10-09');
    expect(recent.importance).toBe(ancien.importance);
    expect(recent.scoreTri).toBe(10);
    expect(ancien.scoreTri).toBe(8);
    expect(bonusFraicheur('2026-10-07', '2026-10-09', REGLES.bonus_fraicheur)).toBe(1);
    expect(bonusFraicheur('2026-10-12', '2026-10-09', REGLES.bonus_fraicheur)).toBe(0);
  });

  it('le détail liste les mots-clés reconnus et les bonus (« pourquoi ce score »)', () => {
    const c = classer({ ...base, source_id: 'bofip-actualites', date: '2026-10-08' }, REGLES, '2026-10-09');
    expect(c.detail).toEqual({
      mots: [{ mot: 'tva', poids: 3 }, { mot: 'facturation électronique', poids: 5 }],
      coefficient: 1, bonus_source: 2, bonus_fraicheur: 2, score: 10,
    });
  });

  it('exclusion de thème : « stade rennais » n’est pas classé Rennes et Bretagne', () => {
    expect(classer({ titre: 'Stade rennais : un nouveau stade à Rennes', resume: null, source_id: null, theme: 'Loi de finances' }, REGLES).theme).toBe('Loi de finances');
  });

  it('valide coefficients et paliers de fraîcheur', () => {
    expect(() => verifierMotsCles({ ...REGLES, coefficients_origine: { presse: 1 } as never })).toThrow(/coefficient d'origine/);
    expect(() => verifierMotsCles({ ...REGLES, bonus_fraicheur: [{ jours: -1, bonus: 1 }] })).toThrow(/bonus_fraicheur/);
  });

  it('le mots-cles.json du dépôt est valide et utilise les expressions exactes', () => {
    const m = JSON.parse(readFileSync(new URL('../../veille/mots-cles.json', import.meta.url), 'utf8')) as MotsCles;
    expect(() => verifierMotsCles(m)).not.toThrow();
    expect(m.themes['Loi de finances']?.mots_cles).toHaveProperty('=plf');
    expect(m.coefficients_origine?.alerte).toBeLessThan(1);
  });
});

const article = (a: Partial<Article> & { url: string; titre: string; source: string }): Article => ({
  id: a.url, source_id: null, date: '2026-10-08', theme: 'Fiscal et comptable', resume: null, importance: null, public: [], type: null,
  origine: 'flux', collecte_le: '2026-10-08', ...a,
});

describe('regroupement des articles similaires', () => {
  it('même information, deux sources : un article principal et ses autres sources', () => {
    const r = fusionnerArticles([], [
      article({ url: 'https://bofip.impots.gouv.fr/a', titre: 'TVA : évolutions liées à l’ordonnance du 27 juillet 2026', source: 'BOFiP' }),
      article({ url: 'https://presse.example/b', titre: 'TVA : les évolutions liées à l’ordonnance du 27 juillet', source: 'presse.example (alerte Google)', origine: 'alerte' }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]!.source).toBe('BOFiP');
    expect(r[0]!.autres_sources).toEqual([{ source: 'presse.example (alerte Google)', url: 'https://presse.example/b', titre: 'TVA : les évolutions liées à l’ordonnance du 27 juillet' }]);
  });

  it('une publication officielle devient l’article principal même si l’alerte est arrivée la veille', () => {
    const veille = fusionnerArticles([], [article({ url: 'https://presse.example/b', titre: 'Facturation électronique : calendrier confirmé par décret', source: 'presse', origine: 'alerte' })]);
    const r = fusionnerArticles(veille, [article({ url: 'https://legifrance.gouv.fr/x', titre: 'Décret : calendrier de la facturation électronique confirmé', source: 'Légifrance' })]);
    expect(r).toHaveLength(1);
    expect(r[0]!.source).toBe('Légifrance');
    expect(r[0]!.autres_sources?.map((x) => x.source)).toEqual(['presse']);
  });

  it('une autre source déjà rattachée ne réapparaît pas le lendemain', () => {
    const j1 = fusionnerArticles([], [
      article({ url: 'https://a.fr/1', titre: 'Le PLF 2027 adopté en commission des finances', source: 'A' }),
      article({ url: 'https://b.fr/1', titre: 'PLF 2027 adopté en commission des finances', source: 'B' }),
    ]);
    const j2 = fusionnerArticles(j1, [article({ url: 'https://b.fr/1', titre: 'PLF 2027 adopté en commission des finances', source: 'B' })]);
    expect(j2).toHaveLength(1);
    expect(j2[0]!.autres_sources).toHaveLength(1);
  });

  it('deux titres moyennement proches d’une même source restent séparés', () => {
    const r = fusionnerArticles([], [
      article({ url: 'https://senat.fr/1', titre: 'Modernisation de la radio - texte de la commission', source: 'Sénat' }),
      article({ url: 'https://senat.fr/2', titre: 'Modernisation de la presse - texte de la commission', source: 'Sénat' }),
    ]);
    expect(r).toHaveLength(2);
  });

  it('le thème propre d’une alerte prime sur le thème du catalogue au classement', () => {
    const r = appliquerClassement(
      [article({ url: 'https://p.example/1', titre: 'Un sujet sans mot-clé', source: 'p', source_id: 'alertes-google', theme_source: 'Audit et profession', origine: 'alerte' })],
      REGLES, () => 'Économie et statistiques', '2026-10-09',
    );
    expect(r.articles[0]!.theme).toBe('Audit et profession');
    expect(r.articles[0]!.pourquoi).toMatchObject({ coefficient: 0.5, mots: [] });
  });
});

describe('alertes Google', () => {
  it('lit le secret ligne par ligne « Thème|URL », sans jamais garder une ligne invalide', () => {
    const { alertes, invalides } = lireAlertes('# mes alertes\nFiscal et comptable|https://www.google.com/alerts/feeds/1/2\n\nsans séparateur\nAudit|http://www.google.com/alerts/feeds/1/3\n');
    expect(alertes).toEqual([{ ligne: 2, libelle: 'Fiscal et comptable', url: 'https://www.google.com/alerts/feeds/1/2' }]);
    expect(invalides).toEqual([4, 5]);
  });

  it('nettoie les liens de redirection Google', () => {
    expect(nettoyerLienGoogle('https://www.google.com/url?rct=j&sa=t&url=https://www.lesechos.fr/article?id=1&ct=ga&usg=x')).toBe('https://www.lesechos.fr/article?id=1');
    expect(nettoyerLienGoogle('https://www.google.fr/url?q=https://exemple.fr/a')).toBe('https://exemple.fr/a');
    expect(nettoyerLienGoogle('https://www.google.com/url?rct=j')).toBeNull();
    expect(nettoyerLienGoogle('https://www.google.com/url?url=javascript:alert(1)')).toBeNull();
    expect(nettoyerLienGoogle('https://exemple.fr/direct')).toBe('https://exemple.fr/direct');
  });

  it('thème : le libellé de l’alerte s’il désigne un thème de la veille', () => {
    expect(themeAlerte('fiscal et comptable', 'Économie et statistiques')).toBe('Fiscal et comptable');
    expect(themeAlerte('Facturation électronique', 'Économie et statistiques')).toBe('Économie et statistiques');
  });

  const source: SourceCatalogue = { id: 'alertes-google', nom: 'Alertes Google (presse)', type: 'alerte_google', secret: 'ALERTES_RSS', theme: 'Économie et statistiques', statut: 'verifie', robots: 'ignorer', type_article: 'presse' };
  const URL_FLUX = 'https://www.google.com/alerts/feeds/00000000000000000000/1111111111111111111';

  it('sans le secret : « non configurée », aucun appel réseau', async () => {
    const { client, appels } = fauxHttp({});
    const r = await collecterAlertes([source], { config: CONFIG, client, maintenant: MAINTENANT, env: {}, etatPrecedent: [] });
    expect(r.etats[0]).toMatchObject({ etat: 'non_configuree', erreur: 'non configurée : secret ALERTES_RSS absent' });
    expect(appels).toHaveLength(0);
  });

  it('collecte : robots.txt de Google non consulté, liens nettoyés, fenêtre respectée', async () => {
    const { client, appels } = fauxHttp({ [URL_FLUX]: { corps: new Uint8Array(fixture('alerte-google.xml')) } });
    const r = await collecterAlertes([source], { config: CONFIG, client, maintenant: MAINTENANT, env: { ALERTES_RSS: `Fiscal et comptable|${URL_FLUX}` }, etatPrecedent: [] });
    expect(appels.map((a) => a.url)).toEqual([URL_FLUX]);
    expect(r.articles).toEqual([{
      titre: 'La facturation électronique : le calendrier fictif confirmé',
      url: 'https://presse-fictive.example/economie/facturation-electronique-calendrier',
      date: '2026-10-07', theme: 'Fiscal et comptable', theme_source: 'Fiscal et comptable',
      source: 'presse-fictive.example (alerte Google)', source_id: 'alertes-google',
      resume: 'Les entreprises devront émettre leurs factures par une plateforme agréée : le calendrier fictif est confirmé.',
      type: 'presse',
    }]);
    expect(r.etats[0]).toMatchObject({ etat: 'ok', nb_elements: 3, nb_articles: 1, erreur: null });
  });

  it('un flux en panne : message sans l’adresse du flux (secret)', async () => {
    const { client } = fauxHttp({ [URL_FLUX]: { statut: 404 } });
    const r = await collecterAlertes([source], { config: CONFIG, client, maintenant: MAINTENANT, env: { ALERTES_RSS: `Veille TVA|${URL_FLUX}` }, etatPrecedent: [], delaisNouvellesTentatives: [] });
    expect(r.etats[0]!.etat).toBe('erreur');
    expect(r.etats[0]!.erreur).toBe('alerte « Veille TVA » (ligne 1) : HTTP 404');
    expect(JSON.stringify(r)).not.toContain('alerts/feeds');
  });
});

describe('client HTTP · exceptions à robots.txt', () => {
  const URL_API = 'https://api.insee.fr/series/BDM/V1/data/SERIES_BDM/001688527';
  it('api_documentee : robots.txt injoignable traité comme absent ; respect strict sinon', async () => {
    const { client } = fauxHttp({ 'https://api.insee.fr/robots.txt': { statut: 503 }, [URL_API]: { corps: 'ok' } });
    await expect(client.recuperer(URL_API)).rejects.toThrow(/robots\.txt injoignable/);
    await expect(client.recuperer(URL_API, { robots: 'api_documentee' })).resolves.toMatchObject({ statut: 200 });
  });

  it('api_documentee : une interdiction explicite reste respectée', async () => {
    const { client } = fauxHttp({ 'https://api.exemple.fr/robots.txt': { corps: 'User-agent: *\nDisallow: /api/' }, 'https://api.exemple.fr/api/x': { corps: 'ok' } });
    await expect(client.recuperer('https://api.exemple.fr/api/x', { robots: 'api_documentee' })).rejects.toThrow(/interdit par robots\.txt/);
  });

  it('ignorer : robots.txt n’est pas lu', async () => {
    const { client, appels } = fauxHttp({ 'https://www.google.com/alerts/feeds/1/2': { corps: 'ok' } });
    await client.recuperer('https://www.google.com/alerts/feeds/1/2', { robots: 'ignorer' });
    expect(appels.map((a) => a.url)).toEqual(['https://www.google.com/alerts/feeds/1/2']);
  });

  it('les en-têtes d’authentification ne suivent pas une redirection vers un autre hôte', async () => {
    const appels: { url: string; entetes: Record<string, string> }[] = [];
    const fetch = (async (entree: URL | string, init?: RequestInit) => {
      const url = String(entree);
      appels.push({ url, entetes: init?.headers as Record<string, string> });
      if (url === 'https://a.example/x') return new Response('', { status: 302, headers: { location: 'https://b.example/y' } });
      return new Response('ok');
    }) as typeof globalThis.fetch;
    const client = new ClientHttp({ userAgent: 'test', fetch, attendre: async () => {}, maintenant: () => 0 });
    await client.recuperer('https://a.example/x', { robots: 'ignorer', entetes: { Authorization: 'Apikey secret' } });
    expect(appels[0]!.entetes.Authorization).toBe('Apikey secret');
    expect(appels[1]!.entetes.Authorization).toBeUndefined();
  });
});

describe('INSEE · API BDM', () => {
  const xml = fixture('insee-bdm-indicateurs.xml').toString('utf8');

  it('lit les séries de la réponse enregistrée', () => {
    const series = lireSeriesInsee(xml);
    expect([...series.keys()].sort()).toEqual(['001565530', '001688527', '010755537', '011794844', '011812232']);
    expect(series.get('001688527')).toMatchObject({ derniereMaj: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), observations: [{ periode: '2026-Q2', valeur: 8.3 }] });
  });

  it('périodes en clair et fin de période', () => {
    expect(periodeEnClair('2026-Q1')).toBe('1er trimestre 2026');
    expect(periodeEnClair('2026-Q2')).toBe('2e trimestre 2026');
    expect(periodeEnClair('2026-08')).toBe('août 2026');
    expect(finDePeriode('2026-Q2')).toBe('2026-06-30');
    expect(finDePeriode('2026-02')).toBe('2026-02-28');
    expect(finDePeriode('2025')).toBe('2025-12-31');
    expect(urlSeriesInsee(['1', '2'], 3)).toBe('https://api.insee.fr/series/BDM/V1/data/SERIES_BDM/1+2?lastNObservations=3');
  });

  it('connecteur : indicateurs formatés en français, robots.txt injoignable toléré', async () => {
    const indicateurs = JSON.parse(readFileSync(new URL('../../veille/indicateurs.json', import.meta.url), 'utf8')).indicateurs;
    const url = urlSeriesInsee(indicateurs.map((i: { serie: string }) => i.serie), 1);
    const { client } = fauxHttp({ 'https://api.insee.fr/robots.txt': new Error('ECONNRESET'), [url]: { corps: xml } });
    const source: SourceCatalogue = { id: 'insee-bdm', nom: 'INSEE', type: 'api', theme: 'Économie et statistiques', statut: 'verifie', robots: 'api_documentee' };
    const r = await connecteurInsee.collecter({ source, client, config: CONFIG, maintenant: MAINTENANT, identifiants: {}, indicateurs });
    const chomage = r.indicateurs.find((i) => i.libelle === 'Taux de chômage (BIT)');
    expect(chomage).toMatchObject({ source_id: 'insee-bdm', valeur: '8,3 %', periode: '2e trimestre 2026', source: 'INSEE' });
    expect(r.indicateurs).toHaveLength(5);
  });

  it('formatage des valeurs', () => {
    expect(formaterValeur(93110, 0, 'créations')).toBe('93 110 créations');
    expect(formaterValeur(96.4, 1, '')).toBe('96,4');
  });
});

describe('BODACC · compteurs d’Ille-et-Vilaine', () => {
  it('lit la réponse enregistrée et publie 4 compteurs sans aucun nom', async () => {
    const json = JSON.parse(fixture('bodacc-35-comptes.json').toString('utf8'));
    expect(lireComptesBodacc(json).get('Créations')).toBe(197);
    const url = urlBodacc('35', '2026-10-02', '2026-10-08');
    const { client, appels } = fauxHttp({ [url]: { corps: fixture('bodacc-35-comptes.json').toString('utf8') } });
    const source: SourceCatalogue = { id: 'bodacc-35', nom: 'BODACC', type: 'api', theme: 'Rennes et Bretagne', statut: 'verifie', robots: 'ignorer' };
    const r = await connecteurBodacc.collecter({ source, client, config: CONFIG, maintenant: MAINTENANT, identifiants: {} });
    expect(appels.map((a) => a.url)).toEqual([url]);
    expect(r.indicateurs.map((i) => [i.libelle, i.valeur])).toEqual([
      ['Créations d’entreprises en Ille-et-Vilaine', '197 annonces'],
      ['Procédures collectives en Ille-et-Vilaine', '50 annonces'],
      ['Ventes et cessions de fonds en Ille-et-Vilaine', '24 annonces'],
      ['Radiations en Ille-et-Vilaine', '225 annonces'],
    ]);
    expect(r.indicateurs[0]!.periode).toBe('du 02/10/2026 au 08/10/2026');
  });

  it('réponse inattendue : erreur explicite', () => {
    expect(() => lireComptesBodacc({ error: 'x' })).toThrow(/results/);
  });
});

describe('indicateurs du jour', () => {
  it('une source en panne garde ses indicateurs publiés', () => {
    const ind = (source_id: string, valeur: string) => ({ source_id, libelle: source_id, valeur, periode: '', source: '', url: '', date_publication: '', collecte_le: '' });
    expect(indicateursDuJour([ind('bodacc-35', '2')], [ind('insee-bdm', 'a'), ind('bodacc-35', '1')]).map((i) => i.valeur)).toEqual(['2', 'a']);
  });
});
