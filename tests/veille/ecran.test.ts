// @vitest-environment happy-dom
import { h } from '../../src/app/dom.ts';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { oublierCache } from '../../src/modules/veille/donnees.ts';
import { ancreVeille, ongletDepuisAncre, rendreVeille } from '../../src/modules/veille/ecran.ts';
import {
  CRITERES_PAR_DEFAUT,
  briefDuJour,
  filtrerArticles,
  prochainesEcheances,
} from '../../src/modules/veille/logique.ts';
import { magasinMemoire, NOM_BASE, ouvrirMagasin } from '../../src/modules/veille/marques.ts';
import type { Article, EtatVeille, NewsJson } from '../../src/modules/veille/modele.ts';
import { contenuEcheances, tableauArticles } from '../../src/modules/accueil/panneaux.ts';

const article = (id: string, champs: Partial<Article> = {}): Article => ({
  id, titre: `Titre ${id}`, source: 'Sénat', source_id: 'senat-textes', url: `https://exemple.invalid/${id}`, date: '2026-10-07',
  theme: 'Loi de finances', resume: `Résumé ${id}.`, importance: 3, public: ['Expertise comptable'], type: 'texte_officiel',
  origine: 'flux', collecte_le: '2026-10-08', ...champs,
});

const NEWS: NewsJson = {
  version: 1,
  genere_le: '2026-10-08T04:31:00Z',
  articles: [
    article('a', { importance: 5, date: '2026-10-08', titre: 'Le Sénat adopte la première partie du PLF', resume: 'Vote des recettes.' }),
    article('b', { importance: 4, theme: 'Fiscal et comptable', source: 'BOFiP-Impôts — Actualités', titre: 'TVA : taux réduit', public: ['Audit / CAC'] }),
    article('c', { importance: 1, titre: 'Information marginale' }),
    article('d', { importance: null, resume: null, titre: 'Non noté' }),
    article('e', { importance: 4, theme: 'Rennes et Bretagne', source: 'Ouest-France', origine: 'api', source_id: 'bodacc-35', titre: 'Usine à Rennes', date: '2026-10-05' }),
  ],
  indicateurs: [{ libelle: 'Inflation sur un an', valeur: '1,8 %', periode: 'septembre 2026', source: 'INSEE', url: 'https://exemple.invalid/ipc', date_publication: '2026-09-30', collecte_le: '2026-10-08' }],
  suivi: {
    plf: {
      texte: 'PLF 2027', etape_actuelle: '1re lecture au Sénat',
      etapes: [{ libelle: 'Dépôt', date: '2026-09-30', statut: 'fait' }, { libelle: '1re lecture AN', date: null, statut: 'en_cours' }, { libelle: 'CMP', date: null, statut: 'a_venir' }],
      prochaine_echeance: { libelle: 'Vote solennel', date: '2026-10-20' }, mis_a_jour_le: '2026-10-08',
      delais: [{ libelle: 'Fin du délai de 1re lecture à l’Assemblée (40 jours, art. 47 de la Constitution)', date: '2026-11-10', indicative: true }],
      source: 'Assemblée nationale — dossier législatif', url: 'https://exemple.invalid/PLF_2027',
      mesures: {
        libelle: 'Projet de loi n° 3210 (texte déposé par le Gouvernement)', url: 'https://exemple.invalid/texte-3210',
        articles: [
          { numero: '1', intitule: 'Autorisation de percevoir les impôts existants', partie: 'Première partie', groupe: 'A – Autorisation', theme: 'Loi de finances', importance: 2, public: [], url: null },
          { numero: '4', intitule: 'Report de la facturation électronique', partie: 'Première partie', groupe: 'B – Mesures fiscales', theme: 'Fiscal et comptable', importance: 4, public: ['Expertise comptable'], url: 'https://exemple.invalid/texte-3210#_Toc4' },
          { numero: '3', intitule: 'Crédit d’impôt recherche des PME', partie: 'Première partie', groupe: 'B – Mesures fiscales', theme: 'Fiscal et comptable', importance: 3, public: ['Conseil aux dirigeants'], url: null },
        ],
      },
    },
    plfss: null,
  },
  sources: [{ id: 'senat-textes', nom: 'Sénat — Derniers textes', url: 'https://exemple.invalid' }],
};

const ETAT: EtatVeille = {
  version: 2,
  genere_le: '2026-10-08T04:31:00Z',
  sources: [
    { id: 'senat-textes', nom: 'Sénat — Derniers textes', type: 'rss', theme: 'Loi de finances', statut_catalogue: 'verifie', etat: 'ok', derniere_tentative: null, derniere_reussite: '2026-10-08T04:30:10Z', erreur: null, nb_articles: 2, nb_elements: 27, duree_ms: 120 },
    { id: 'insee-bdm', nom: 'INSEE — Séries BDM', type: 'api', theme: 'Économie et statistiques', statut_catalogue: 'a_verifier', etat: 'non_configuree', derniere_tentative: null, derniere_reussite: null, erreur: 'non configurée : identifiants absents (INSEE_API_KEY)', nb_articles: 0, nb_elements: null, duree_ms: null },
  ],
  recherche_ia: { active: false, raison: 'désactivée : la veille fonctionne à 0 €, sans appel à un service d’IA' },
  classement: { articles: 5, exclus: 2, marginaux: 1 },
};

describe('veille · logique de l’écran', () => {
  it('par défaut : importance 2 et plus, non notés visibles, marginaux masqués', () => {
    expect(filtrerArticles(NEWS.articles, CRITERES_PAR_DEFAUT, new Map()).map((a) => a.id)).toEqual(['a', 'b', 'd', 'e']);
  });

  it('filtres combinés : thème, source, importance 4+, public, recherche sans accents, marques', () => {
    const f = (c: Partial<typeof CRITERES_PAR_DEFAUT>, marques = new Map()) => filtrerArticles(NEWS.articles, { ...CRITERES_PAR_DEFAUT, ...c }, marques).map((a) => a.id);
    expect(f({ theme: 'Fiscal et comptable' })).toEqual(['b']);
    expect(f({ source: 'Ouest-France' })).toEqual(['e']);
    expect(f({ importanceMin: 4 })).toEqual(['a', 'b', 'e']);
    expect(f({ importanceMin: 0 })).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(f({ public: 'Audit / CAC' })).toEqual(['b']);
    expect(f({ recherche: 'senat PREMIERE' })).toEqual(['a']);
    expect(f({ recherche: 'recettes' })).toEqual(['a']); // dans le résumé
    const marques = new Map([['a', { lu: true, important: false }], ['b', { lu: false, important: true }]]);
    expect(f({ nonLus: true }, marques)).toEqual(['b', 'd', 'e']);
    expect(f({ importants: true }, marques)).toEqual(['b']);
  });

  it('brief : importance 4 ou 5, du plus récent au plus ancien, 5 au plus', () => {
    expect(briefDuJour(NEWS).map((a) => a.id)).toEqual(['a', 'b', 'e']);
    const beaucoup = { ...NEWS, articles: Array.from({ length: 8 }, (_, i) => article(`x${i}`, { importance: 5 })) };
    expect(briefDuJour(beaucoup)).toHaveLength(5);
  });

  it('échéances : prochaine échéance du suivi, sinon première étape à venir', () => {
    expect(prochainesEcheances(NEWS)).toEqual([{ texte: 'PLF 2027', libelle: 'Vote solennel', date: '2026-10-20', etapeActuelle: '1re lecture au Sénat' }]);
    const sansEcheance = { ...NEWS, suivi: { plf: { ...NEWS.suivi.plf!, prochaine_echeance: null }, plfss: null } };
    expect(prochainesEcheances(sansEcheance)[0]?.libelle).toBe('CMP');
  });

  it('onglet demandé par l’adresse, anciennes adresses comprises', () => {
    expect(ongletDepuisAncre('#/veille')).toBe('fil');
    expect(ongletDepuisAncre('#/veille/inconnu')).toBe('fil');
    expect(ancreVeille('#/veille/suivi/sources')).toEqual({ onglet: 'suivi', sous: 'sources' });
    expect(ancreVeille('#/veille/suivi')).toEqual({ onglet: 'suivi', sous: 'marches' });
    expect(ancreVeille('#/veille/plf')).toEqual({ onglet: 'suivi', sous: 'plf' });
    expect(ancreVeille('#/veille/indicateurs')).toEqual({ onglet: 'suivi', sous: 'marches' });
    expect(ancreVeille('#/veille/echeances')).toEqual({ onglet: 'echeances', sous: 'marches' });
  });
});

describe('veille · écran', () => {
  let conteneur: HTMLElement;
  let appels: { url: string; init: RequestInit | undefined }[];

  const servir = (fichiers: Record<string, unknown>) => {
    appels = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      appels.push({ url, init });
      const nom = url.split('/').pop() ?? '';
      return nom in fichiers ? new Response(JSON.stringify(fichiers[nom])) : new Response('', { status: 404 });
    });
  };

  beforeEach(() => {
    oublierCache();
    location.hash = '#/veille';
    conteneur = document.createElement('main');
    document.body.replaceChildren(conteneur);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('ne charge que news.json, veille-etat.json et marches.json, sur la même origine, sans paramètre', async () => {
    servir({ 'news.json': NEWS, 'veille-etat.json': ETAT });
    await rendreVeille(conteneur, { magasin: magasinMemoire(), maintenant: new Date('2026-10-08T08:00:00Z') });
    expect(appels.map((a) => a.url).sort()).toEqual(['/news.json', '/veille-etat.json']);
    expect(appels.every((a) => (a.init?.method ?? 'GET') === 'GET' && !a.url.includes('?'))).toBe(true);
    // L'onglet « Suivi » charge en plus marches.json, de la même façon.
    conteneur.querySelector<HTMLButtonElement>('#onglet-suivi')!.click();
    await vi.waitFor(() => expect(appels.map((a) => a.url)).toContain('/marches.json'));
    expect(new Set(appels.map((a) => a.url))).toEqual(new Set(['/news.json', '/veille-etat.json', '/marches.json']));
    expect(appels.every((a) => (a.init?.method ?? 'GET') === 'GET' && !a.url.includes('?') && a.init?.credentials === 'omit')).toBe(true);
  });

  it('fil : articles, liens externes sûrs, mention de la source', async () => {
    servir({ 'news.json': NEWS, 'veille-etat.json': ETAT });
    await rendreVeille(conteneur, { magasin: magasinMemoire(), maintenant: new Date('2026-10-08T08:00:00Z') });
    const cartes = [...conteneur.querySelectorAll('article.article')];
    expect(cartes.map((c) => c.getAttribute('data-id'))).toEqual(['a', 'b', 'd', 'e']);
    for (const lien of conteneur.querySelectorAll<HTMLAnchorElement>('a[target="_blank"]')) {
      expect(lien.rel).toBe('noopener noreferrer');
    }
    expect(cartes[0]?.textContent).toContain('Source : Sénat');
    expect(cartes[0]?.textContent).toContain('Importance 5/5');
    expect(conteneur.querySelector('[data-id="e"] .badge-api')?.textContent).toBe('API officielle');
    expect(conteneur.textContent).not.toMatch(/Recherche IA|Source IA/);
    expect(conteneur.querySelector('.mention-sources')?.textContent).toContain('Sénat — Derniers textes');
    expect(conteneur.querySelector('[role="status"]')?.textContent).toContain('Collecte du 08/10/2026');
  });

  it('« lu » et « important » : mémorisés localement, filtrables', async () => {
    servir({ 'news.json': NEWS, 'veille-etat.json': ETAT });
    const magasin = magasinMemoire();
    await rendreVeille(conteneur, { magasin });
    conteneur.querySelector<HTMLButtonElement>('[data-id="a"] [data-marque="lu"]')!.click();
    expect((await magasin.toutes()).get('a')).toEqual({ lu: true, important: false });
    expect(conteneur.querySelector('[data-id="a"] [data-marque="lu"]')?.getAttribute('aria-pressed')).toBe('true');
    const nonLus = [...conteneur.querySelectorAll<HTMLInputElement>('.champ-cases input')][0]!;
    nonLus.checked = true;
    nonLus.dispatchEvent(new Event('change'));
    expect(conteneur.querySelector('[data-id="a"]')).toBeNull();
    expect(conteneur.querySelector('.compteur')?.textContent).toBe('3 articles sur 5');
  });

  it('onglets : Suivi (PLF / PLFSS, état des sources), Rennes', async () => {
    servir({ 'news.json': NEWS, 'veille-etat.json': ETAT });
    await rendreVeille(conteneur, { magasin: magasinMemoire(), maintenant: new Date('2026-10-08T08:00:00Z') });
    const onglet = (id: string) => conteneur.querySelector<HTMLButtonElement>(`#onglet-${id}`)!;

    onglet('suivi').click();
    conteneur.querySelector<HTMLButtonElement>('#sous-onglet-plf')!.click();
    expect(location.hash).toBe('#/veille/suivi/plf');
    expect(conteneur.querySelector('.frise-interactive [aria-current="step"]')?.textContent).toContain('1re lecture AN');
    expect(conteneur.querySelector('.panneau')?.textContent).toContain('Pas encore de suivi');
    expect(conteneur.querySelector('.echeances-texte')?.textContent).toContain('10/11/2026 Fin du délai de 1re lecture à l’Assemblée');
    expect(conteneur.querySelector<HTMLAnchorElement>('.suivi a[href="https://exemple.invalid/PLF_2027"]')?.rel).toBe('noopener noreferrer');
    expect(conteneur.querySelector('.articles-etape')?.textContent).toContain('Le Sénat adopte la première partie du PLF');
    const mesures = conteneur.querySelector('.mesures')!;
    expect([...mesures.querySelectorAll('.paliers-mesures .palier')].map((t) => t.textContent)).toEqual(['Important (1)', 'À suivre (1)']);
    expect([...mesures.querySelectorAll('.paliers-mesures .liste-mesures > li')].map((li) => li.textContent?.split(' Importance')[0])).toEqual([
      'Art. 4 — Report de la facturation électronique (nouvel onglet)',
      'Art. 3 — Crédit d’impôt recherche des PME',
    ]);
    expect(mesures.querySelector('.note')?.textContent).toContain('choisies par nos mots-clés');
    expect(mesures.querySelector('summary')?.textContent).toBe('Tous les articles du projet (3)');
    expect(mesures.querySelector<HTMLAnchorElement>('a[href="https://exemple.invalid/texte-3210#_Toc4"]')?.rel).toBe('noopener noreferrer');

    conteneur.querySelector<HTMLButtonElement>('#sous-onglet-sources')!.click();
    const panneau = conteneur.querySelector('.panneau')?.textContent ?? '';
    expect(panneau).toContain('Sénat — Derniers textes');
    expect(panneau).toContain('Non configurée');
    expect(panneau).toContain('identifiants absents (INSEE_API_KEY)');
    expect(panneau).toContain('Recherche IA : désactivée : la veille fonctionne à 0 €');
    expect(panneau).toContain('dont 1 marginal(aux) masqué(s) par défaut ; 2 exclu(s)');
    expect(panneau).toContain('Coût : 0 €');

    onglet('rennes').click();
    expect([...conteneur.querySelectorAll('article.article')].map((c) => c.getAttribute('data-id'))).toEqual(['e']);
  });

  it('suivi : hiérarchie du pôle, par palier, avec la rubrique', async () => {
    const plf = NEWS.suivi.plf!;
    const mesures = {
      ...plf.mesures!,
      hierarchie: { origine: 'pole' as const, etablie_le: '2026-10-08' },
      articles: plf.mesures!.articles.map((a) => (a.numero === '1' ? { ...a, importance: 5 as const, rubrique: 'Finances publiques' } : { ...a, importance: 2 as const, rubrique: null })),
    };
    servir({ 'news.json': { ...NEWS, suivi: { ...NEWS.suivi, plf: { ...plf, mesures } } }, 'veille-etat.json': ETAT });
    location.hash = '#/veille/plf';
    await rendreVeille(conteneur, { magasin: magasinMemoire() });
    expect(location.hash).toBe('#/veille/suivi/plf');
    const carte = conteneur.querySelector('.mesures')!;
    expect([...carte.querySelectorAll('.palier')].map((t) => t.textContent)).toEqual(['Essentiel pour nos dossiers (1)']);
    expect(carte.querySelector('.paliers-mesures .puce-rubrique')?.textContent).toBe('Finances publiques');
    expect(carte.querySelector('.note')?.textContent).toContain('Hiérarchie établie par le pôle le 08/10/2026');
  });

  it('navigation au clavier entre les onglets (flèches, Début, Fin)', async () => {
    servir({ 'news.json': NEWS, 'veille-etat.json': ETAT });
    await rendreVeille(conteneur, { magasin: magasinMemoire() });
    const fil = conteneur.querySelector<HTMLButtonElement>('#onglet-fil')!;
    fil.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(conteneur.querySelector('#onglet-echeances')?.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement?.id).toBe('onglet-echeances');
    conteneur.querySelector<HTMLButtonElement>('#onglet-echeances')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }));
    expect(document.activeElement?.id).toBe('onglet-rennes');
  });

  it('pas encore de collecte : message explicite', async () => {
    servir({});
    await rendreVeille(conteneur, { magasin: magasinMemoire() });
    expect(conteneur.textContent).toContain('Aucune collecte n’a encore été publiée');
  });

  it('collecte ancienne : avertissement', async () => {
    servir({ 'news.json': NEWS, 'veille-etat.json': ETAT });
    await rendreVeille(conteneur, { magasin: magasinMemoire(), maintenant: new Date('2026-10-15T08:00:00Z') });
    expect(conteneur.querySelector('.alerte-texte')?.textContent).toContain('date de 7 jours');
  });

  it('écran quitté pendant le chargement : rien n’est ajouté', async () => {
    servir({ 'news.json': NEWS, 'veille-etat.json': ETAT });
    const annulation = { annule: false };
    const rendu = rendreVeille(conteneur, { magasin: magasinMemoire(), annulation });
    annulation.annule = true;
    await rendu;
    expect(conteneur.querySelector('.onglets')).toBeNull();
  });

  it('accueil : 3 articles importants et la prochaine échéance du PLF', () => {
    const articles = tableauArticles(NEWS);
    expect(articles.querySelectorAll('.brief-liste tbody tr')).toHaveLength(3);
    const echeances = h('div', {}, ...contenuEcheances(NEWS, '2026-10-09'));
    expect(echeances.textContent).toContain('PLF 2027');
    expect(echeances.textContent).toContain('Vote solennel');
    expect(echeances.textContent).toContain('20/10/2026');
    expect(echeances.querySelector('a[href="#/veille/suivi/plf"]')).not.toBeNull();
  });
});

describe('veille · marques en IndexedDB', () => {
  it('base préfixée, version 1, marques conservées d’une ouverture à l’autre', async () => {
    const fabrique = new IDBFactory();
    expect(NOM_BASE).toBe('pole003-sandbox-veille');
    const magasin = await ouvrirMagasin(fabrique);
    expect(magasin.persistant).toBe(true);
    await magasin.enregistrer('a', { lu: true, important: false });
    await magasin.enregistrer('b', { lu: false, important: true });
    await magasin.enregistrer('b', { lu: false, important: false }); // décochée : supprimée
    const relu = await ouvrirMagasin(fabrique);
    expect([...(await relu.toutes())]).toEqual([['a', { lu: true, important: false }]]);
  });

  it('sans IndexedDB : marques en mémoire seulement, signalé', async () => {
    const magasin = await ouvrirMagasin(undefined);
    expect(magasin.persistant).toBe(false);
  });
});
