// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { oublierCache } from '../../src/modules/veille/donnees.ts';
import { detailScore, rendreVeille } from '../../src/modules/veille/ecran.ts';
import {
  analyserRecherche,
  correspondRecherche,
  CRITERES_PAR_DEFAUT,
  decouperSurlignage,
  estNouveau,
  filtrerArticles,
  lireCriteres,
  lireVisites,
  noterVisite,
} from '../../src/modules/veille/logique.ts';
import { magasinMemoire } from '../../src/modules/veille/marques.ts';
import type { Article, NewsJson } from '../../src/modules/veille/modele.ts';
import { COLONNES_ARTICLES, remplirClasseur } from '../../src/modules/veille/export-xlsx.ts';
import { chargerExcelJS } from '../../src/modules/fec/export/xlsx.ts';
import { cleStockage } from '../../src/core/stockage.ts';

const article = (id: string, champs: Partial<Article> = {}): Article => ({
  id, titre: `Titre ${id}`, source: 'Sénat', source_id: 'senat-textes', url: `https://exemple.invalid/${id}`, date: '2026-10-07',
  theme: 'Loi de finances', resume: `Résumé ${id}.`, importance: 3, public: ['Expertise comptable'], type: 'texte_officiel',
  origine: 'flux', collecte_le: '2026-10-07', ...champs,
});

describe('recherche plein texte', () => {
  it('expressions exactes entre guillemets et termes exclus', () => {
    expect(analyserRecherche('"Loi de finances" TVA -outre-mer')).toEqual({ inclus: ['loi de finances', 'tva'], exclus: ['outre-mer'] });
    expect(analyserRecherche('  ')).toEqual({ inclus: [], exclus: [] });
  });

  it('cherche dans le titre, l’extrait, la source, le thème et les autres sources, sans accents', () => {
    const a = article('a', { titre: 'Évolution de la TVA', resume: 'Taux réduit', autres_sources: [{ source: 'Les Échos', url: 'https://x', titre: 'TVA réforme' }] });
    expect(correspondRecherche(a, 'evolution tva')).toBe(true);
    expect(correspondRecherche(a, 'echos')).toBe(true);
    expect(correspondRecherche(a, '"loi de finances"')).toBe(true); // thème
    expect(correspondRecherche(a, 'tva -reduit')).toBe(false);
    expect(correspondRecherche(a, '"taux plein"')).toBe(false);
  });

  it('surlignage insensible aux accents, sans perte de caractère', () => {
    const m = decouperSurlignage('Réforme de la TVA', ['reforme', 'tva']);
    expect(m).toEqual([{ texte: 'Réforme', surligne: true }, { texte: ' de la ', surligne: false }, { texte: 'TVA', surligne: true }]);
    expect(m.map((x) => x.texte).join('')).toBe('Réforme de la TVA');
    expect(decouperSurlignage('Œuvre', ['oeuvre'])).toEqual([{ texte: 'Œuvre', surligne: false }]);
  });
});

describe('nouveautés depuis la dernière visite', () => {
  it('un nouveau jour fait de la visite courante la visite précédente', () => {
    expect(noterVisite(null, '2026-10-09')).toEqual({ precedente: null, courante: '2026-10-09' });
    expect(noterVisite({ precedente: '2026-10-05', courante: '2026-10-09' }, '2026-10-09')).toEqual({ precedente: '2026-10-05', courante: '2026-10-09' });
    expect(noterVisite({ precedente: '2026-10-05', courante: '2026-10-08' }, '2026-10-09')).toEqual({ precedente: '2026-10-08', courante: '2026-10-09' });
  });

  it('article nouveau : collecté après la visite précédente ; jamais à la première visite', () => {
    expect(estNouveau(article('a', { collecte_le: '2026-10-09' }), '2026-10-08')).toBe(true);
    expect(estNouveau(article('a', { collecte_le: '2026-10-08' }), '2026-10-08')).toBe(false);
    expect(estNouveau(article('a', { collecte_le: '2026-10-09' }), null)).toBe(false);
  });

  it('lecture prudente des préférences enregistrées', () => {
    expect(lireVisites('{"precedente":null,"courante":"2026-10-09"}')).toEqual({ precedente: null, courante: '2026-10-09' });
    expect(lireVisites('{"courante":"hier"}')).toBeNull();
    expect(lireVisites('pas du json')).toBeNull();
    expect(lireCriteres('{"theme":"Inconnu","importanceMin":4,"nouveaux":true,"recherche":42}')).toEqual({ ...CRITERES_PAR_DEFAUT, importanceMin: 4, nouveaux: true });
  });

  it('filtre « nouveaux seulement »', () => {
    const articles = [article('a', { collecte_le: '2026-10-09' }), article('b', { collecte_le: '2026-10-01' })];
    expect(filtrerArticles(articles, { ...CRITERES_PAR_DEFAUT, nouveaux: true }, new Map(), '2026-10-08').map((a) => a.id)).toEqual(['a']);
  });
});

describe('pourquoi ce score', () => {
  it('liste les mots-clés, le coefficient et les bonus', () => {
    const d = detailScore(article('a', {
      importance: 3,
      pourquoi: { mots: [{ mot: 'tva', poids: 3 }, { mot: 'facturation électronique', poids: 5 }], coefficient: 0.6, bonus_source: 0, bonus_fraicheur: 2, score: 4.8 },
    }))!;
    expect(d.textContent).toContain('Mots-clés détectés : tva (+3), facturation électronique (+5)');
    expect(d.textContent).toContain('× 0,6 (alerte de presse)');
    expect(d.textContent).toContain('Score : 4,8, soit l’importance 3/5');
    expect(d.textContent).toContain('Bonus de fraîcheur pour le tri : +2');
    expect(detailScore(article('b'))).toBeNull();
  });
});

describe('export .xlsx de la sélection', () => {
  it('une ligne par article, lien cliquable, onglet Paramètres', async () => {
    const ExcelJS = await chargerExcelJS();
    const classeur = new ExcelJS.Workbook();
    const articles = [article('a', { importance: 4, pourquoi: { mots: [{ mot: 'plf', poids: 5 }], coefficient: 1, bonus_source: 0, bonus_fraicheur: 0, score: 5 } }), article('b')];
    remplirClasseur(classeur, articles, [['Thème', 'Tous']], '0.15.0');
    const ws = classeur.getWorksheet('Sélection')!;
    const col = (titre: string) => COLONNES_ARTICLES.findIndex((c) => c.titre === titre) + 1;
    expect(ws.getCell(3, col('Titre')).value).toBe('Titre');
    expect(ws.getCell(4, col('Titre')).value).toBe('Titre a');
    expect(ws.getCell(4, col('Lien')).value).toEqual({ text: 'https://exemple.invalid/a', hyperlink: 'https://exemple.invalid/a' });
    expect(ws.getCell(4, col('Mots-clés détectés')).value).toBe('plf (+5)');
    expect(ws.getCell(4, col('Date')).value).toEqual(new Date(Date.UTC(2026, 9, 7)));
    expect(ws.getCell(5, col('Importance (1 à 5)')).value).toBe(3);
    const p = classeur.getWorksheet('Paramètres')!;
    expect(p.getCell(3, 2).value).toBe('Sandbox Pôle 003, version 0.15.0');
    expect(p.getCell(4, 1).value).toBe('Thème');
  });
});

describe('écran du fil : préférences mémorisées', () => {
  let conteneur: HTMLElement;
  const NEWS: NewsJson = {
    version: 1, genere_le: '2026-10-09T04:31:00Z',
    articles: [article('a', { collecte_le: '2026-10-09', titre: 'TVA : réforme' }), article('b', { collecte_le: '2026-10-01', titre: 'Budget' })],
    indicateurs: [], suivi: { plf: null, plfss: null }, sources: [],
  };

  beforeEach(() => {
    oublierCache();
    localStorage.clear();
    conteneur = document.createElement('div');
    document.body.replaceChildren(conteneur);
    location.hash = '#/veille';
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).endsWith('news.json') ? new Response(JSON.stringify(NEWS)) : new Response('', { status: 404 }))));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('badge « nouveau », filtres repris à la visite suivante, recherche surlignée', async () => {
    localStorage.setItem(cleStockage('veille-visites'), JSON.stringify({ precedente: null, courante: '2026-10-08' }));
    await rendreVeille(conteneur, { magasin: magasinMemoire(), maintenant: new Date('2026-10-09T08:00:00Z') });
    expect(conteneur.querySelectorAll('.badge-nouveau')).toHaveLength(1);
    expect(conteneur.textContent).toContain('1 nouveau depuis votre dernière visite.');
    const recherche = conteneur.querySelector<HTMLInputElement>('#fil-recherche')!;
    recherche.value = 'reforme';
    recherche.dispatchEvent(new Event('input'));
    expect(conteneur.querySelector('.article mark')?.textContent).toBe('réforme');
    expect(JSON.parse(localStorage.getItem(cleStockage('veille-filtres-fil'))!).recherche).toBe('reforme');

    // Nouvelle ouverture : la recherche est reprise.
    conteneur.replaceChildren();
    await rendreVeille(conteneur, { magasin: magasinMemoire(), maintenant: new Date('2026-10-09T10:00:00Z') });
    expect(conteneur.querySelector<HTMLInputElement>('#fil-recherche')!.value).toBe('reforme');
    expect(conteneur.querySelector('.compteur')?.textContent).toBe('1 article sur 2');
    conteneur.querySelector<HTMLButtonElement>('.barre-fil-actions .bouton')!.click(); // Réinitialiser
    expect(conteneur.querySelector('.compteur')?.textContent).toBe('2 articles sur 2');
  });
});
