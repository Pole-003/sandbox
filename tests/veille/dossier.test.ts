import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SourceCatalogue } from '../../scripts/veille/config.ts';
import type { MotsCles } from '../../scripts/veille/classement.ts';
import { anneesCandidates, collecterDossiers, construireSuivi, lireEtapesAN } from '../../scripts/veille/dossier.ts';
import { appliquerHierarchie, construireMesures, lireArticles, texteDepuisDossier, verifierHierarchie, type HierarchieMesures } from '../../scripts/veille/projet-loi.ts';
import { ClientHttp } from '../../scripts/veille/http.ts';

const page = (nom: string) => readFileSync(new URL(`../fixtures/veille/${nom}`, import.meta.url), 'utf8');
const MAINTENANT = new Date('2026-10-08T04:30:00Z');
const MOTS_CLES: MotsCles = {
  seuils_importance: { '5': 9, '4': 6, '3': 3, '2': 1 },
  bonus_sources: { 'an-dossier-plf': 4 },
  exclusions: [],
  themes: {
    'Fiscal et comptable': { public_par_defaut: ['Expertise comptable'], mots_cles: { 'impôt': 2, "crédit d'impôt": 3, 'facturation électronique': 5, pme: 2 }, exclusions: [] },
    'Sécurité sociale': { public_par_defaut: ['Social / paie'], mots_cles: { cotisation: 3, 'allègements généraux': 3 }, exclusions: [] },
  },
  publics: { 'Conseil aux dirigeants': ['pme'] },
};
const OPENDATA_PLF = 'https://www.assemblee-nationale.fr/dyn/opendata/PRJLANR5L17B3210.html';

describe('veille · lecture du dossier législatif (Assemblée nationale)', () => {
  it('lit les étapes et leurs dates, en ignorant le reste de la page', () => {
    expect(lireEtapesAN(page('an-dossier-plf.html'))).toEqual([
      { libelle: "Dépôt à l'Assemblée nationale", date: '2026-10-01' },
      { libelle: "Première lecture à l'Assemblée nationale", date: '2026-10-01' },
    ]);
  });

  it('page sans bloc « Étapes de lecture » : aucune étape', () => {
    expect(lireEtapesAN('<html><body>Autre page</body></html>')).toEqual([]);
  });
});

describe('veille · construction du suivi', () => {
  it('PLF en 1re lecture : étape en cours, étapes restantes, délais de l’article 47', () => {
    const s = construireSuivi('plf', 'PLF 2027', lireEtapesAN(page('an-dossier-plf.html')), '2026-10-08', 'https://exemple.invalid/PLF_2027');
    expect(s.etape_actuelle).toBe("Première lecture à l'Assemblée nationale");
    expect(s.etapes.map((e) => [e.libelle, e.statut])).toEqual([
      ["Dépôt à l'Assemblée nationale", 'fait'],
      ["Première lecture à l'Assemblée nationale", 'en_cours'],
      ['Première lecture au Sénat', 'a_venir'],
      ['Commission mixte paritaire', 'a_venir'],
      ['Conseil constitutionnel', 'a_venir'],
      ['Promulgation', 'a_venir'],
    ]);
    // Dépôt le 01/10 : 40 jours → 10/11, 70 jours → 10/12.
    expect(s.delais?.map((d) => d.date)).toEqual(['2026-11-10', '2026-12-10']);
    expect(s.prochaine_echeance).toMatchObject({ date: '2026-11-10', indicative: true });
    expect(s.prochaine_echeance?.libelle).toContain('1re lecture à l’Assemblée (40 jours, art. 47 de la Constitution)');
  });

  it('PLFSS : délais de l’article 47-1 (20 et 50 jours)', () => {
    const s = construireSuivi('plfss', 'PLFSS 2027', [{ libelle: "Dépôt à l'Assemblée nationale", date: '2026-10-01' }], '2026-10-08', null);
    expect(s.delais?.map((d) => d.date)).toEqual(['2026-10-21', '2026-11-20']);
  });

  it('en CMP : 1re lecture AN passée, prochaine échéance = délai du Parlement ; puis étape suivante une fois le délai passé', () => {
    const etapes = lireEtapesAN(page('an-dossier-plf-cmp.html'));
    const s = construireSuivi('plf', 'PLF 2027', etapes, '2026-12-01', null);
    expect(s.etapes.filter((e) => e.statut === 'a_venir').map((e) => e.libelle)).toEqual(['Conseil constitutionnel', 'Promulgation']);
    expect(s.prochaine_echeance?.date).toBe('2026-12-10');
    const apres = construireSuivi('plf', 'PLF 2027', etapes, '2026-12-16', null);
    expect(apres.prochaine_echeance).toEqual({ libelle: 'Conseil constitutionnel', date: null });
  });

  it('promulgation : toutes les étapes faites', () => {
    const s = construireSuivi('plf', 'PLF 2027', [{ libelle: 'Dépôt', date: '2026-10-01' }, { libelle: 'Promulgation de la loi', date: '2026-12-30' }], '2027-01-05', null);
    expect(s.etapes.every((e) => e.statut === 'fait')).toBe(true);
    expect(s.prochaine_echeance).toBeNull();
  });

  it('années essayées : la suivante, puis l’année en cours', () => {
    expect(anneesCandidates(MAINTENANT)).toEqual([2027, 2026]);
  });
});

function fauxHttp(routes: Record<string, string>) {
  const appels: string[] = [];
  const fetch = (async (entree: URL | string) => {
    const url = String(entree);
    appels.push(url);
    return url in routes ? new Response(routes[url]) : new Response('', { status: 404 });
  }) as typeof globalThis.fetch;
  return { client: new ClientHttp({ userAgent: 'test/1.0', fetch, attendre: async () => {}, maintenant: () => 0 }), appels };
}

const PLF: SourceCatalogue = {
  id: 'an-dossier-plf', nom: 'Assemblée nationale — Dossier législatif du PLF', type: 'dossier', suivi: 'plf',
  url: 'https://www.assemblee-nationale.fr/dyn/17/dossiers/PLF_{annee}', theme: 'Loi de finances', statut: 'verifie',
};
const PLFSS: SourceCatalogue = { ...PLF, id: 'an-dossier-plfss', suivi: 'plfss', url: 'https://www.assemblee-nationale.fr/dyn/17/dossiers/PLFSS_{annee}', theme: 'Sécurité sociale' };

describe('veille · collecte des dossiers', () => {
  it('trouve l’année, publie le suivi, signale une panne sans bloquer', async () => {
    const { client, appels } = fauxHttp({
      'https://www.assemblee-nationale.fr/dyn/17/dossiers/PLF_2027': page('an-dossier-plf.html'),
      [OPENDATA_PLF]: page('an-projet-plf-toc.html'),
    });
    const r = await collecterDossiers([PLF, PLFSS], { client, maintenant: MAINTENANT, etatPrecedent: [], motsCles: MOTS_CLES });
    expect(r.suivi.plf).toMatchObject({ texte: 'PLF 2027', source: 'Assemblée nationale — dossier législatif', url: 'https://www.assemblee-nationale.fr/dyn/17/dossiers/PLF_2027' });
    expect(r.suivi.plfss).toBeNull();
    expect(r.etats.map((e) => [e.id, e.etat])).toEqual([['an-dossier-plf', 'ok'], ['an-dossier-plfss', 'erreur']]);
    expect(r.etats[1]?.erreur).toBe('HTTP 404 pour PLFSS 2026');
    expect(appels).toContain('https://www.assemblee-nationale.fr/dyn/17/dossiers/PLFSS_2026'); // repli sur l'année en cours
    expect(r.articles).toEqual([]); // premier relevé : pas d'alerte
    expect(r.suivi.plf?.mesures).toMatchObject({ libelle: 'Projet de loi n° 3210 (texte déposé par le Gouvernement)', url: 'https://www.assemblee-nationale.fr/dyn/17/textes/l17b3210_projet-loi' });
    expect(r.suivi.plf?.mesures?.articles).toHaveLength(5);
  });

  it('texte du projet illisible : suivi des étapes conservé, remarque dans l’état', async () => {
    const { client } = fauxHttp({ 'https://www.assemblee-nationale.fr/dyn/17/dossiers/PLF_2027': page('an-dossier-plf.html'), [OPENDATA_PLF]: '<html>vide</html>' });
    const r = await collecterDossiers([PLF], { client, maintenant: MAINTENANT, etatPrecedent: [], motsCles: MOTS_CLES });
    expect(r.suivi.plf?.etapes.length).toBeGreaterThan(0);
    expect(r.suivi.plf?.mesures).toBeUndefined();
    expect(r.etats[0]).toMatchObject({ etat: 'ok', erreur: 'articles du projet de loi non lus : aucun article reconnu (présentation du texte modifiée ?)' });
  });

  it('nouvelle étape : alerte dans le fil ; aucune alerte si rien ne change ou si l’ancien relevé était une page', async () => {
    const premier = await collecterDossiers([PLF], { client: fauxHttp({ 'https://www.assemblee-nationale.fr/dyn/17/dossiers/PLF_2027': page('an-dossier-plf.html') }).client, maintenant: MAINTENANT, etatPrecedent: [], motsCles: MOTS_CLES });
    const identique = await collecterDossiers([PLF], { client: fauxHttp({ 'https://www.assemblee-nationale.fr/dyn/17/dossiers/PLF_2027': page('an-dossier-plf.html') }).client, maintenant: MAINTENANT, etatPrecedent: premier.etats, motsCles: MOTS_CLES });
    expect(identique.articles).toEqual([]);

    const suite = await collecterDossiers([PLF], { client: fauxHttp({ 'https://www.assemblee-nationale.fr/dyn/17/dossiers/PLF_2027': page('an-dossier-plf-cmp.html') }).client, maintenant: MAINTENANT, etatPrecedent: premier.etats, motsCles: MOTS_CLES });
    expect(suite.articles).toEqual([
      expect.objectContaining({ titre: 'PLF 2027 : nouvelle étape — Commission mixte paritaire', date: '2026-12-15', theme: 'Loi de finances', source_id: 'an-dossier-plf' }),
    ]);

    const ancienRelevePage = [{ ...premier.etats[0]!, type: 'page' as const, empreinte: '8025ca3b9345fc04' }];
    const migration = await collecterDossiers([PLF], { client: fauxHttp({ 'https://www.assemblee-nationale.fr/dyn/17/dossiers/PLF_2027': page('an-dossier-plf.html') }).client, maintenant: MAINTENANT, etatPrecedent: ancienRelevePage, motsCles: MOTS_CLES });
    expect(migration.articles).toEqual([]);
  });

  it('structure de page modifiée : erreur explicite', async () => {
    const { client } = fauxHttp({ 'https://www.assemblee-nationale.fr/dyn/17/dossiers/PLF_2027': '<html><body>Nouvelle maquette</body></html>' });
    const r = await collecterDossiers([PLF], { client, maintenant: MAINTENANT, etatPrecedent: [], motsCles: MOTS_CLES });
    expect(r.etats[0]).toMatchObject({ etat: 'erreur', erreur: 'PLF 2027 : bloc « Étapes de lecture » introuvable (structure de la page modifiée ?)' });
  });
});

describe('veille · articles du projet de loi', () => {
  it('présentation par table des matières (PLF) : numéro, intitulé officiel, partie, subdivision, ancre', () => {
    const a = lireArticles(page('an-projet-plf-toc.html'));
    expect(a.map((x) => [x.numero, x.intitule, x.groupe])).toEqual([
      ['1', 'Autorisation de percevoir les impôts existants', 'A – Autorisation de perception des impôts et produits'],
      ['2', 'Indexation fictive du barème de l’impôt sur le revenu', 'B – Mesures fiscales'],
      ['3', 'Aménagement fictif du crédit d’impôt recherche pour les PME', 'B – Mesures fiscales'],
      ['4', 'Report fictif de la généralisation de la facturation électronique', 'B – Mesures fiscales'],
      ['40', 'Crédits du budget général', 'I – Autorisation des crédits des missions et performance'],
    ]);
    expect(a[0]?.partie).toBe('Première partie : conditions générales de l’équilibre financier');
    expect(a[4]?.partie).toBe('Seconde partie : moyens des politiques publiques et dispositions spéciales');
    expect(a[1]?.ancre).toBe('_Toc2');
  });

  it('présentation par blocs (PLFSS) : « 1er », parties, article sans intitulé ignoré', () => {
    const a = lireArticles(page('an-projet-plfss-blocs.html'));
    expect(a.map((x) => [x.numero, x.intitule, x.partie, x.groupe])).toEqual([
      ['1er', 'Rectification fictive des tableaux d’équilibre', 'Dispositions relatives à l’exercice 2026 (exemple fictif)', null],
      ['7', 'Réforme fictive des allègements généraux de cotisations patronales', 'Dispositions relatives aux recettes pour 2027', 'Titre fictif sur les cotisations'],
      ['9', 'Contribution fictive sur les jeux', 'Dispositions relatives aux recettes pour 2027', 'Titre fictif sur les cotisations'],
    ]);
  });

  it('lien du dossier vers le texte : page et version open data', () => {
    expect(texteDepuisDossier(page('an-dossier-plf.html'))).toEqual({
      numero: '3210',
      page: 'https://www.assemblee-nationale.fr/dyn/17/textes/l17b3210_projet-loi',
      opendata: OPENDATA_PLF,
    });
    expect(texteDepuisDossier('<html></html>')).toBeNull();
  });

  it('classement des articles par mots-clés (sans bonus de source) et lien direct', () => {
    const m = construireMesures(lireArticles(page('an-projet-plf-toc.html')), MOTS_CLES, 'Loi de finances', 'PLF', 'https://exemple.invalid/texte', OPENDATA_PLF);
    const par = Object.fromEntries(m.articles.map((a) => [a.numero, a]));
    expect(par['4']).toMatchObject({ importance: 3, theme: 'Fiscal et comptable', url: `${OPENDATA_PLF}#_Toc4` });
    expect(par['3']).toMatchObject({ importance: 3, public: ['Conseil aux dirigeants'] });
    expect(par['40']).toMatchObject({ importance: 1, theme: 'Loi de finances' });
  });
});

describe('veille · hiérarchie des mesures établie par le pôle', () => {
  const base = () => construireMesures(lireArticles(page('an-projet-plf-toc.html')), MOTS_CLES, 'Loi de finances', 'PLF', 'https://exemple.invalid/texte', OPENDATA_PLF);
  const intitule = (numero: string) => base().articles.find((a) => a.numero === numero)!.intitule;

  it('impose importance et rubrique, plafonne les articles non retenus à 2', () => {
    const hierarchie: HierarchieMesures = {
      textes: { '3210': { texte: 'PLF 2027', etablie_le: '2026-10-08', articles: { '40': { importance: 5, rubrique: 'Finances publiques', intitule: intitule('40') } } } },
    };
    const { mesures, ecarts } = appliquerHierarchie(base(), '3210', hierarchie);
    const par = Object.fromEntries(mesures.articles.map((a) => [a.numero, a]));
    expect(ecarts).toEqual([]);
    expect(mesures.hierarchie).toEqual({ origine: 'pole', etablie_le: '2026-10-08' });
    expect(par['40']).toMatchObject({ importance: 5, rubrique: 'Finances publiques' });
    expect(par['4']).toMatchObject({ importance: 2, rubrique: null }); // 3 par mots-clés, non retenu par le pôle
  });

  it('ignore une ligne dont l’intitulé a changé (renumérotation) et le signale', () => {
    const hierarchie: HierarchieMesures = {
      textes: { '3210': { texte: 'PLF 2027', etablie_le: '2026-10-08', articles: {
        '4': { importance: 5, rubrique: 'Fiscalité des entreprises', intitule: 'Un tout autre article' },
        '999': { importance: 4, rubrique: 'Social et paie', intitule: 'Article disparu' },
      } } },
    };
    const { mesures, ecarts } = appliquerHierarchie(base(), '3210', hierarchie);
    expect(mesures.articles.find((a) => a.numero === '4')).toMatchObject({ importance: 3, rubrique: null });
    expect(ecarts).toEqual(['art. 999 absent du texte', 'art. 4 : intitulé modifié']);
  });

  it('sans hiérarchie pour ce texte, le classement par mots-clés est conservé', () => {
    const { mesures, ecarts } = appliquerHierarchie(base(), '4000', { textes: {} });
    expect(mesures.hierarchie).toEqual({ origine: 'mots-cles', etablie_le: null });
    expect(mesures.articles).toEqual(base().articles);
    expect(ecarts).toEqual([]);
  });

  it('le fichier veille/hierarchie-mesures.json est valide', () => {
    const fichier = JSON.parse(readFileSync(new URL('../../veille/hierarchie-mesures.json', import.meta.url), 'utf8')) as HierarchieMesures;
    expect(() => verifierHierarchie(fichier)).not.toThrow();
    expect(Object.keys(fichier.textes)).toEqual(['3210', '3211']);
    expect(() => verifierHierarchie({ textes: { '1': { texte: 'X', etablie_le: '2026-10-08', articles: { '1': { importance: 7 as 5, rubrique: '', intitule: '' } } } } })).toThrow(/importance de 1 à 5/);
  });
});
