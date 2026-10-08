import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Article } from '../../src/modules/veille/modele.ts';
import { correspondMotsCles } from '../../scripts/veille/couche-a.ts';
import { classer, contientMot, importanceDepuisScore, type MotsCles } from '../../scripts/veille/classement.ts';
import { decoderOctets, lireEncodageDeclare } from '../../scripts/veille/encodage.ts';
import { decoderEntites, lireFlux, resumeDepuisDescription } from '../../scripts/veille/flux.ts';
import { appliquerClassement, empreinteNews, fusionnerArticles, repartirConservation } from '../../scripts/veille/fusion.ts';
import { dedoublonner, idArticle, normaliserUrl, similariteTitres } from '../../scripts/veille/normalisation.ts';

const texteFixture = (nom: string) => {
  const octets = new Uint8Array(readFileSync(new URL(`../fixtures/veille/${nom}`, import.meta.url)));
  return decoderOctets(octets, lireEncodageDeclare(octets, null)).texte;
};

describe('veille · parseur de flux', () => {
  it('BOFiP sans pubDate : date tirée de la description, lien conservé', () => {
    const elements = lireFlux(texteFixture('bofip-sans-pubdate.rss'), 'https://bofip.impots.gouv.fr/bofip/ext/rss.xml');
    expect(elements).toHaveLength(3);
    expect(elements[0]).toMatchObject({ titre: "IS — Crédit d'impôt fictif : précisions sur l'assiette", dateDansDescription: true });
    expect(elements[0]?.date?.toISOString().slice(0, 10)).toBe('2026-10-06');
    expect(elements[2]?.date).toBeNull();
  });

  it('Sénat : UTF-8 annoncé iso-8859-15 et vrai iso-8859-15 donnent le même texte propre', () => {
    const trompeur = lireFlux(texteFixture('senat-encodage-trompeur.rss'), 'https://www.senat.fr/rss/textes.rss');
    expect(trompeur[0]?.titre).toBe('Projet de loi de finances pour 2027 — texte adopté en séance');
    expect(trompeur[0]?.date?.toISOString()).toBe('2026-10-07T16:30:00.000Z');
    const iso = lireFlux(texteFixture('senat-iso-8859-15.rss'), 'https://www.senat.fr/themes/rss/therss17.rss');
    expect(iso[0]?.titre).toBe('Réforme fictive de la taxe sur les véhicules - coût 2 000 €');
    expect(iso[0]?.description).toBe('Œuvre fictive, données à vérifier.');
  });

  it('Assemblée : entités décodées et liens http réécrits en https', () => {
    const elements = lireFlux(texteFixture('an-documents.rss'), 'https://www2.assemblee-nationale.fr/feeds/detail/documents-parlementaires');
    expect(elements[0]?.titre).toBe('Projet de loi de finances pour 2027 – rapport général (fictif)');
    expect(elements.every((e) => e.lien.startsWith('https://'))).toBe(true);
    expect(elements[2]?.lien).toBe('https://www.assemblee-nationale.fr/exemple/tva.html?utm_source=rss&id=3');
  });

  it('Atom : lien href et dates ISO', () => {
    const elements = lireFlux(texteFixture('atom-exemple.xml'), 'https://exemple.invalid/flux');
    expect(elements.map((e) => e.lien)).toEqual(['https://exemple.invalid/a', 'https://exemple.invalid/b']);
  });

  it('décode les entités numériques et nommées', () => {
    expect(decoderEntites('&#233;t&eacute; &#x20AC; &amp;amp; &inconnue;')).toBe('été € &amp; &inconnue;');
  });

  it('filtre par mots-clés sans tenir compte des accents ni des majuscules', () => {
    const mots = ['fiscal', 'TVA', 'sécurité sociale'];
    expect(correspondMotsCles('Rapport sur la FISCALITÉ des entreprises', mots)).toBe(true);
    expect(correspondMotsCles('Financement de la securite sociale', mots)).toBe(true);
    expect(correspondMotsCles('Taux de tva réduit', mots)).toBe(true);
    expect(correspondMotsCles('La pêche en Bretagne', mots)).toBe(false);
    expect(correspondMotsCles('Activité ovine', ['tva'])).toBe(false); // pas de correspondance au milieu d'un mot
    expect(correspondMotsCles('Tout passe', undefined)).toBe(true);
  });
});

describe('veille · déduplication', () => {
  it('normalise les URL : https, sans utm_*, sans ancre', () => {
    expect(normaliserUrl('http://Exemple.fr/a/?utm_source=x&id=2&utm_medium=y#haut')).toBe('https://exemple.fr/a/?id=2');
    expect(normaliserUrl('https://exemple.fr/a/')).toBe('https://exemple.fr/a');
    expect(idArticle('http://exemple.fr/a#x')).toBe(idArticle('https://exemple.fr/a'));
  });

  it('similarité de titre : mêmes mots significatifs malgré accents et ponctuation', () => {
    expect(similariteTitres('PLF 2027 : le Sénat adopte la première partie', 'PLF 2027 – le sénat adopte la premiere partie')).toBe(1);
    expect(similariteTitres('PLF 2027 : le Sénat adopte la première partie', 'Inflation de septembre')).toBe(0);
  });

  it('fusionne par URL normalisée puis par titre proche à date voisine', () => {
    const elements = [
      { url: 'https://a.fr/1?utm_source=rss', titre: 'Titre A', date: '2026-10-07', n: 1 },
      { url: 'https://a.fr/1', titre: 'Autre titre', date: '2026-10-07', n: 2 },
      { url: 'https://b.fr/x', titre: 'Le Sénat adopte le PLF 2027', date: '2026-10-07', n: 3 },
      { url: 'https://c.fr/y', titre: 'Le Sénat adopte le PLF 2027', date: '2026-10-08', n: 4 },
      { url: 'https://d.fr/z', titre: 'Le Sénat adopte le PLF 2027', date: '2026-09-01', n: 5 },
    ];
    const r = dedoublonner(elements, (a, b) => ({ ...a, n: a.n * 10 + b.n }));
    expect(r.map((e) => e.n)).toEqual([12, 34, 5]);
  });
});

const article = (champs: Partial<Article>): Article => ({
  id: 'x', titre: 'Titre', source: 'Source', source_id: null, url: 'https://exemple.fr/a', date: '2026-10-07',
  theme: 'Fiscal et comptable', resume: null, importance: null, public: [], type: null, origine: 'flux', collecte_le: '2026-10-08', ...champs,
});

describe('veille · fusion', () => {
  it('un article déjà publié garde sa date de première collecte ; un résumé manquant est complété', () => {
    const ancien = article({ resume: null, collecte_le: '2026-10-05' });
    const [r] = fusionnerArticles([ancien], [article({ resume: 'Extrait du flux.', collecte_le: '2026-10-08' })]);
    expect(r).toMatchObject({ resume: 'Extrait du flux.', collecte_le: '2026-10-05' });
  });

  it('conservation : 60 jours en ligne, le reste archivé par mois', () => {
    const r = repartirConservation(
      [article({ id: '1', date: '2026-10-01' }), article({ id: '2', date: '2026-08-05' }), article({ id: '3', date: '2026-07-30' })],
      '2026-08-09',
    );
    expect(r.gardes.map((a) => a.id)).toEqual(['1']);
    expect([...r.archives.entries()].map(([m, l]) => [m, l.map((a) => a.id)])).toEqual([['2026-08', ['2']], ['2026-07', ['3']]]);
  });

  it('empreinte de news.json indépendante de l’horodatage', () => {
    const base = { version: 1 as const, articles: [], indicateurs: [], suivi: { plf: null, plfss: null }, sources: [] };
    expect(empreinteNews({ ...base, genere_le: '2026-10-08T04:30:00Z' })).toBe(empreinteNews({ ...base, genere_le: '2026-10-09T04:30:00Z' }));
  });
});

describe('veille · résumé repris du flux', () => {
  it('nettoie le HTML et tronque à 300 caractères entre deux mots, sans reformuler', () => {
    const long = `<p>Le <b>Sénat</b> a adopté&nbsp;le texte.</p> ${'Mot '.repeat(120)}`;
    const r = resumeDepuisDescription(long, 'Titre', 300)!;
    expect(r.startsWith('Le Sénat a adopté le texte. Mot Mot')).toBe(true); // espaces (y compris insécables) normalisées
    expect(r.length).toBeLessThanOrEqual(300);
    expect(r.endsWith('Mot…')).toBe(true);
    expect(resumeDepuisDescription('Court texte.', 'Titre', 300)).toBe('Court texte.');
  });

  it('description vide ou identique au titre : pas de résumé', () => {
    expect(resumeDepuisDescription('', 'Titre', 300)).toBeNull();
    expect(resumeDepuisDescription('<p>Mon titre</p>', 'Mon Titre', 300)).toBeNull();
  });
});

const REGLES: MotsCles = {
  seuils_importance: { '5': 9, '4': 6, '3': 3, '2': 1 },
  bonus_sources: { 'bofip-actualites': 2 },
  exclusions: ['compte rendu de réunion'],
  themes: {
    'Loi de finances': { public_par_defaut: ['Expertise comptable', 'Conseil aux dirigeants'], mots_cles: { 'projet de loi de finances': 6, plf: 5, budget: 1 }, exclusions: [] },
    'Fiscal et comptable': { public_par_defaut: ['Expertise comptable'], mots_cles: { tva: 3, 'impôt': 2, comptab: 3 }, exclusions: ['taxe de séjour'] },
    'Rennes et Bretagne': { public_par_defaut: ['Conseil aux dirigeants'], mots_cles: { rennes: 5, bretagne: 4 }, exclusions: [] },
  },
  publics: { 'Audit / CAC': ['commissaire aux comptes'], 'Social / paie': ['cotisation'] },
};
const aClasser = (titre: string, resume: string | null = null, source_id: string | null = 'senat-textes', theme: Article['theme'] = 'Loi de finances') => ({ titre, resume, source_id, theme });

describe('veille · classement par mots-clés', () => {
  it('début de mot, sans accents ni majuscules', () => {
    expect(contientMot('regles comptables', 'comptab')).toBe(true);
    expect(contientMot('la tva intracommunautaire', 'TVA')).toBe(true);
    expect(contientMot('activite ovine', 'tva')).toBe(false);
    expect(contientMot('impot sur le revenu', 'impôt')).toBe(true);
  });

  it('thème au score le plus élevé, importance selon les seuils, public par défaut du thème', () => {
    const c = classer(aClasser('Projet de loi de finances pour 2027 : le PLF adopté', 'Budget de l’État.'), REGLES);
    expect(c).toMatchObject({ exclu: false, theme: 'Loi de finances', score: 12, importance: 5, public: ['Expertise comptable', 'Conseil aux dirigeants'] });
    const tva = classer(aClasser('TVA : nouvelles règles comptables', null, 'senat-textes', 'Loi de finances'), REGLES);
    expect(tva).toMatchObject({ theme: 'Fiscal et comptable', score: 6, importance: 4 });
  });

  it('aucun mot-clé : thème de la source et importance 1 (marginal)', () => {
    expect(classer(aClasser('Accélérer la médecine nucléaire'), REGLES)).toMatchObject({ theme: 'Loi de finances', importance: 1, score: 0 });
  });

  it('bonus de source ajouté au score', () => {
    expect(classer(aClasser('Précisions sur la TVA', null, 'bofip-actualites', 'Fiscal et comptable'), REGLES)).toMatchObject({ score: 5, importance: 3 });
  });

  it('public : déduit des mots-clés de public, sinon celui du thème', () => {
    expect(classer(aClasser('Cotisations : le rôle du commissaire aux comptes en Bretagne'), REGLES).public).toEqual(['Audit / CAC', 'Social / paie']);
  });

  it('exclusions : générale (non publié) et de thème (thème interdit)', () => {
    expect(classer(aClasser('Compte rendu de réunion n° 5'), REGLES).exclu).toBe(true);
    expect(classer(aClasser('TVA et taxe de séjour à Rennes'), REGLES)).toMatchObject({ exclu: false, theme: 'Rennes et Bretagne' });
  });

  it('seuils : premier seuil atteint en partant du plus haut', () => {
    expect([0, 1, 3, 6, 9, 20].map((s) => importanceDepuisScore(s, REGLES.seuils_importance))).toEqual([1, 2, 3, 4, 5, 5]);
  });

  it('appliqué à la publication : exclus retirés, thème de départ = thème de la source', () => {
    const articles = [
      article({ id: '1', titre: 'Compte rendu de réunion', source_id: 'senat-textes' }),
      article({ id: '2', titre: 'Le PLF adopté', theme: 'Fiscal et comptable', source_id: 'senat-textes' }),
      article({ id: '3', titre: 'Sans mot-clé', source_id: 'senat-textes', theme: 'Fiscal et comptable' }),
    ];
    const r = appliquerClassement(articles, REGLES, () => 'Loi de finances');
    expect(r).toMatchObject({ exclus: 1, marginaux: 1 });
    expect(r.articles.map((a) => [a.id, a.theme, a.importance])).toEqual([['2', 'Loi de finances', 3], ['3', 'Loi de finances', 1]]);
  });

  it('le fichier veille/mots-cles.json du dépôt est valide', async () => {
    const { verifierMotsCles } = await import('../../scripts/veille/classement.ts');
    const regles = JSON.parse(readFileSync(new URL('../../veille/mots-cles.json', import.meta.url), 'utf8')) as MotsCles;
    expect(() => verifierMotsCles(regles)).not.toThrow();
    expect(Object.keys(regles.themes)).toHaveLength(6);
  });
});
