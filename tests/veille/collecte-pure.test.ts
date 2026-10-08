import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Article } from '../../src/modules/veille/modele.ts';
import { correspondMotsCles } from '../../scripts/veille/couche-a.ts';
import { Budget, NANO_PAR_RECHERCHE, ajouterDepense, coutReponse, depuisDollars, enDollars } from '../../scripts/veille/couts.ts';
import { decoderOctets, lireEncodageDeclare } from '../../scripts/veille/encodage.ts';
import { decoderEntites, lireFlux } from '../../scripts/veille/flux.ts';
import { appliquerNotes, empreinteNews, fusionnerArticles, repartirConservation, reunir } from '../../scripts/veille/fusion.ts';
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
  it('A et C : métadonnées de A, résumé et notation de C, quel que soit l’ordre', () => {
    const a = article({ titre: 'Titre officiel', source: 'Sénat', source_id: 'senat-textes', date: '2026-10-07', collecte_le: '2026-10-07' });
    const c = article({ titre: 'Titre reformulé', source: 'Presse', origine: 'recherche_ia', resume: 'Résumé IA.', importance: 4, public: ['Audit / CAC'], type: 'texte_officiel', date: '2026-10-08' });
    for (const r of [reunir(a, c), reunir(c, a)]) {
      expect(r).toMatchObject({ titre: 'Titre officiel', source: 'Sénat', source_id: 'senat-textes', date: '2026-10-07', resume: 'Résumé IA.', importance: 4, origine: 'flux_et_ia', collecte_le: '2026-10-07' });
    }
  });

  it('un article déjà publié garde sa date de première collecte et sa note', () => {
    const ancien = article({ importance: 3, resume: 'Ancien résumé.', collecte_le: '2026-10-05' });
    const [r] = fusionnerArticles([ancien], [article({ collecte_le: '2026-10-08' })]);
    expect(r).toMatchObject({ importance: 3, resume: 'Ancien résumé.', collecte_le: '2026-10-05' });
  });

  it('notes : appliquées ; importance 1 conservée (pour ne pas renoter) et comptée', () => {
    const notes = new Map([
      ['a', { id: 'a', theme: 'Sécurité sociale' as const, importance: 4 as const, public: ['Expertise comptable' as const], type: 'doctrine' as const, resume: 'Résumé.' }],
      ['b', { id: 'b', theme: 'Fiscal et comptable' as const, importance: 1 as const, public: [], type: 'presse' as const, resume: null }],
    ]);
    const r = appliquerNotes([article({ id: 'a' }), article({ id: 'b' }), article({ id: 'c' })], notes);
    expect(r.marginaux).toBe(1);
    expect(r.articles.map((x) => [x.id, x.importance, x.resume])).toEqual([['a', 4, 'Résumé.'], ['b', 1, null], ['c', null, null]]);
    expect(r.articles[0]?.theme).toBe('Sécurité sociale'); // thème corrigé par la notation
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

describe('veille · coûts', () => {
  it('jetons et recherches au tarif du modèle (Claude Sonnet 5.5 : 2 $ / 10 $ par million)', () => {
    const c = coutReponse({ input_tokens: 12_000, output_tokens: 1_500, server_tool_use: { web_search_requests: 3 } }, 'claude-sonnet-5-5');
    // 12 000 × 2 µ$ + 1 500 × 10 µ$ = 0,039 $ ; 3 recherches = 0,03 $
    expect(enDollars(c.nano)).toBe(0.069);
    expect(c).toMatchObject({ recherches: 3, tarifConnu: true });
  });

  it('cache : écriture 1,25 ×, lecture 0,1 × ; Haiku au tarif long au-delà de 100 000 jetons', () => {
    expect(enDollars(coutReponse({ input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 }, 'claude-sonnet-5-5').nano)).toBe(2.7);
    expect(enDollars(coutReponse({ input_tokens: 200_000, output_tokens: 0 }, 'claude-haiku-5-5').nano)).toBe(0.1);
  });

  it('détail par tentative prioritaire, modèle inconnu au tarif le plus élevé', () => {
    const c = coutReponse(
      { input_tokens: 1, output_tokens: 1, iterations: [{ type: 'message', model: 'claude-sonnet-5-5', input_tokens: 1_000_000, output_tokens: 0 }, { type: 'fallback_message', model: 'modele-futur', input_tokens: 1_000_000, output_tokens: 0 }] },
      'claude-sonnet-5-5',
    );
    expect(enDollars(c.nano)).toBe(12);
    expect(c.tarifConnu).toBe(false);
    expect(NANO_PAR_RECHERCHE).toBe(10_000_000);
  });

  it('cumul mensuel et plafond', () => {
    let couts = ajouterDepense({ mois: {} }, '2026-10-07', depuisDollars(1.5));
    couts = ajouterDepense(couts, '2026-10-08', depuisDollars(0.25));
    expect(couts.mois['2026-10']).toEqual({ total_usd: 1.75, jours: { '2026-10-07': 1.5, '2026-10-08': 0.25 } });
    const budget = new Budget(couts, '2026-10-08', depuisDollars(2));
    expect(budget.depasse()).toBe(false);
    budget.imputer(depuisDollars(0.25));
    expect(budget.depasse()).toBe(true);
    expect(new Budget(couts, '2026-11-02', depuisDollars(2)).depasse()).toBe(false); // nouveau mois
  });
});
