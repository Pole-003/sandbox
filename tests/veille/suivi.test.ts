// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { completerSuivi, construireSuivi, fusionnerEtapes, lireEtapesSenat, collecterDossiers } from '../../scripts/veille/dossier.ts';
import { historiqueEtat } from '../../scripts/veille/collecte.ts';
import type { SourceCatalogue } from '../../scripts/veille/config.ts';
import type { MotsCles } from '../../scripts/veille/classement.ts';
import { ClientHttp } from '../../scripts/veille/http.ts';
import { oublierCache } from '../../src/modules/veille/donnees.ts';
import { rendreVeille } from '../../src/modules/veille/ecran.ts';
import {
  dateDeValeur,
  enBase100,
  fraicheurSource,
  lienDuJour,
  metaCarte,
  friseTexte,
  pastilles,
  pointsPeriode,
  prochainesPublications,
  valeurEnClair,
  variationEnClair,
} from '../../src/modules/veille/ecran-suivi.ts';
import { graduations, graphiqueLignes, sparkline } from '../../src/modules/veille/graphiques.ts';
import { articlesDeLEtape, contientMotCle } from '../../src/modules/veille/logique.ts';
import { calculerVariations, CRENEAUX_MARCHES, prochainCreneau, prochaineRecuperation, type IndicateurMarche, type MarchesJson } from '../../src/modules/veille/marches.ts';
import { magasinMemoire } from '../../src/modules/veille/marques.ts';
import type { Article, NewsJson, SuiviTexte } from '../../src/modules/veille/modele.ts';

// --- Données d'exemple ---

function serieQuotidienne(fin: string, n: number, depart: number, pas: number): [string, number][] {
  const points: [string, number][] = [];
  let d = new Date(`${fin}T12:00:00Z`);
  while (points.length < n) {
    const j = d.getUTCDay();
    if (j !== 0 && j !== 6) points.unshift([d.toISOString().slice(0, 10), 0]);
    d = new Date(d.getTime() - 86_400_000);
  }
  return points.map(([date], k) => [date, Math.round((depart + k * pas) * 1e4) / 1e4]);
}

function indicateur(champs: Partial<IndicateurMarche> & Pick<IndicateurMarche, 'id' | 'nom' | 'historique'>): IndicateurMarche {
  const genre = champs.genre ?? 'niveau';
  const dernier = champs.historique.at(-1)!;
  return {
    unite: '$', decimales: 4, genre, nature: 'quotidien officiel', valeur: dernier[1], date_valeur: dernier[0], recupere_le: '2026-10-08T14:20:00Z',
    variations: calculerVariations(champs.historique, genre), complements: [],
    source: { id: 'bce', organisme: 'BCE', libelle: 'Taux de référence', lien: 'https://data.ecb.europa.eu/', conditions: 'Réutilisation libre', secours: false, nature: champs.nature ?? 'quotidien officiel' },
    regle: { frequence: 'quotidienne', heure: '16:15', tolerance_jours_ouvres: 1 },
    prochaine_publication: { date: '2026-10-09', heure: '16:15', estimee: true },
    derniere_tentative: '2026-10-08T14:20:00Z', derniere_reussite: '2026-10-08T14:20:00Z', derniere_erreur: null, remarque: null,
    journal: [{ date: '2026-10-07', etat: 'ok' }, { date: '2026-10-08', etat: 'erreur' }],
    ...champs,
  };
}

const DETTE = indicateur({
  id: 'dette', nom: 'Dette publique', unite: 'Md€', decimales: 1, nature: 'trimestriel',
  historique: [['2025-06-30', 3384.2], ['2025-09-30', 3416.8], ['2025-12-31', 3460.5], ['2026-03-31', 3535.9], ['2026-06-30', 3595.5]],
  complements: [{ cle: 'pib', libelle: 'Dette en % du PIB', unite: '% du PIB', decimales: 1, historique: [['2025-06-30', 114.9], ['2025-09-30', 115.4], ['2025-12-31', 115.7], ['2026-03-31', 117.5], ['2026-06-30', 119]], source: 'INSEE', lien: 'https://www.insee.fr/' }],
  regle: { frequence: 'trimestrielle', decalage_jours: 85, heure: '08:45', tolerance_jours_ouvres: 5 },
  prochaine_publication: { date: '2026-12-18', heure: '08:45', estimee: false },
});
const EURUSD = indicateur({ id: 'eurusd', nom: 'EUR/USD', historique: serieQuotidienne('2026-10-08', 520, 1.05, 0.0001) });
const FINS_DE_MOIS = Array.from({ length: 24 }, (_, k) => new Date(Date.UTC(2024, 9 + k, 0)).toISOString().slice(0, 10)); // 30/09/2024 → 31/08/2026
const OAT = indicateur({
  id: 'oat10', nom: 'OAT 10 ans', unite: '%', decimales: 2, genre: 'taux', nature: 'moyenne mensuelle officielle',
  historique: FINS_DE_MOIS.map((d, k) => [d, Math.round((3 + k * 0.04) * 100) / 100]),
  source: { id: 'bce-taux-long-fr', organisme: 'BCE', libelle: 'Taux long terme de la France', lien: 'https://data.ecb.europa.eu/data/datasets/IRS', conditions: 'Réutilisation libre avec mention de la source (BCE)', secours: false, nature: 'moyenne mensuelle officielle' },
  regle: { frequence: 'mensuelle', decalage_jours: 12, heure: null, tolerance_jours_ouvres: 10 },
  prochaine_publication: { date: '2026-10-12', heure: null, estimee: true },
  lien_du_jour: { libelle: 'TEC 10', organisme: 'Banque de France', url: 'https://www.banque-france.fr/fr/statistiques/taux-et-cours/indices-obligataires-2026-10-08', date: '2026-10-08', mention: 'Licence Euronext : consultable sur le site de la Banque de France.' },
});
const BRENT = indicateur({ id: 'brent', nom: 'Brent', unite: '$/baril', decimales: 2, historique: serieQuotidienne('2026-10-06', 500, 80, 0.09), prochaine_publication: { date: '2026-10-14', heure: '19:00', estimee: true } });
const MARCHES: MarchesJson = {
  version: 1, genere_le: '2026-10-08T14:20:00Z', indicateurs: [DETTE, OAT, EURUSD, BRENT],
  evenements: [{ date: '2026-09-10', libelle: 'Réunion BCE', type: 'bce', source: 'https://www.ecb.europa.eu/' }, { date: '2026-10-01', libelle: 'Dépôt du PLF 2027', type: 'plf', source: 'https://www.assemblee-nationale.fr/' }],
};

const article = (id: string, champs: Partial<Article> = {}): Article => ({
  id, titre: `Titre ${id}`, source: 'Assemblée nationale', source_id: 'an-documents', url: `https://exemple.invalid/${id}`, date: '2026-10-05',
  theme: 'Fiscal et comptable', resume: null, importance: 3, public: [], type: 'texte_officiel', origine: 'flux', collecte_le: '2026-10-05', ...champs,
});

const SUIVI: SuiviTexte = {
  texte: 'PLF 2027', etape_actuelle: 'Première lecture à l’Assemblée nationale', prochaine_echeance: null, mis_a_jour_le: '2026-10-08',
  etapes: [
    { libelle: 'Dépôt à l’Assemblée nationale', date: '2026-10-01', statut: 'fait' },
    { libelle: 'Première lecture à l’Assemblée nationale', date: '2026-10-06', statut: 'en_cours' },
    { libelle: 'Première lecture au Sénat', date: null, statut: 'a_venir' },
  ],
  delais: [{ libelle: 'Fin du délai de 1re lecture à l’Assemblée (40 jours, art. 47 de la Constitution)', date: '2026-11-10', indicative: true }],
  echeances_saisies: [{ libelle: 'Vote solennel de la première partie', date: '2026-10-21', source: 'Assemblée nationale, conférence des présidents' }],
  mots_cles: ['=plf', 'projet de loi de finances'],
  url: 'https://www.assemblee-nationale.fr/dyn/17/dossiers/PLF_2027', url_senat: null,
};

const NEWS: NewsJson = {
  version: 1, genere_le: '2026-10-08T04:30:00Z',
  articles: [
    article('a', { titre: 'Commission des finances : examen du PLF', date: '2026-10-07' }),
    article('b', { titre: 'Budget de l’État', theme: 'Loi de finances', date: '2026-10-02' }),
    article('c', { titre: 'Le PLFSS en commission', date: '2026-10-07' }),
  ],
  indicateurs: [{ source_id: 'insee-bdm', libelle: 'Taux de chômage (BIT)', valeur: '8,3 %', periode: '2e trimestre 2026', source: 'INSEE', url: 'https://www.insee.fr/', date_publication: '2026-08-07', collecte_le: '2026-10-08' }],
  suivi: { plf: SUIVI, plfss: null }, sources: [],
};

// --- Logique ---

describe('suivi · logique', () => {
  it('période, base 100 et mise en forme', () => {
    expect(pointsPeriode(EURUSD.historique, 1)[0]![0] >= '2026-09-08').toBe(true);
    const base = enBase100([['2026-10-01', 2], ['2026-10-02', 3]], [['2026-09-30', 10], ['2026-10-02', 5]])!;
    expect(base.a).toEqual([['2026-10-01', 100], ['2026-10-02', 150]]);
    expect(base.b).toEqual([['2026-10-01', 100], ['2026-10-02', 50]]);
    expect(valeurEnClair(OAT, 3.62)).toBe('3,62 %');
    expect(variationEnClair(OAT, { depuis: 'x', absolue: -0.07, relative: null })).toBe('−7 pb');
    expect(variationEnClair(EURUSD, { depuis: 'x', absolue: 0.01, relative: 0.8957 })).toBe('+0,90 %');
  });

  it('ligne sous la carte : nature, organisme et date selon la périodicité ; lien vers la valeur du jour', () => {
    expect(dateDeValeur(OAT)).toBe('août 2026');
    expect(metaCarte(OAT)).toBe('Moyenne mensuelle officielle · BCE · août 2026');
    expect(metaCarte(EURUSD)).toBe('Quotidien officiel · BCE · 08/10/2026');
    expect(metaCarte({ ...EURUSD, source: { ...EURUSD.source, secours: true } })).toBe('Quotidien officiel · BCE (secours) · 08/10/2026');
    const lien = lienDuJour(OAT, 'carte-marche-lien')!;
    expect(lien.textContent).toBe('Taux du jour : TEC 10 du 08/10/2026 · Banque de France (nouvel onglet)');
    expect(lien.querySelector('a')).toMatchObject({ href: OAT.lien_du_jour!.url, target: '_blank', rel: 'noopener noreferrer' });
    expect(lienDuJour({ lien_du_jour: { ...OAT.lien_du_jour!, date: null } }, 'x')!.textContent).toContain('TEC 10 du jour · Banque de France');
    // Seules les adresses https:// sont rendues ; pas de lien sans données.
    expect(lienDuJour({ lien_du_jour: { ...OAT.lien_du_jour!, url: 'javascript:alert(1)' } }, 'x')).toBeNull();
    expect(lienDuJour(EURUSD, 'x')).toBeNull();
  });

  it('pastilles des 30 derniers jours (vert, orange, rouge, gris)', () => {
    const p = pastilles([{ date: '2026-10-08', etat: 'ok' }, { date: '2026-10-07', etat: 'sans_nouveaute' }, { date: '2026-10-06', etat: 'erreur' }], '2026-10-08');
    expect(p).toHaveLength(30);
    expect(p.slice(-3).map((x) => x.couleur)).toEqual(['rouge', 'orange', 'vert']);
    expect(p[0]).toMatchObject({ date: '2026-09-09', couleur: 'gris', libelle: 'pas de collecte' });
  });

  it('fraîcheur d’une source de veille', () => {
    const s = { id: 'x', nom: 'x', type: 'rss' as const, theme: '', statut_catalogue: 'verifie', etat: 'ok' as const, derniere_tentative: null, derniere_reussite: '2026-10-08T04:30:00Z', erreur: null, nb_articles: 0, nb_elements: 0, duree_ms: null };
    expect(fraicheurSource(s, new Date('2026-10-09T08:00:00Z'))).toBe('a_jour');
    expect(fraicheurSource(s, new Date('2026-10-20T08:00:00Z'))).toBe('en_retard');
    expect(fraicheurSource({ ...s, etat: 'erreur' }, new Date('2026-10-09T08:00:00Z'))).toBe('en_panne');
  });

  it('prochaine récupération : créneaux de marches.yml, jours ouvrés', () => {
    expect(prochainCreneau(new Date('2026-10-09T15:00:00Z'), ['07:05', '09:02', '16:20', '19:30']).toISOString()).toBe('2026-10-09T17:30:00.000Z');
    expect(prochainCreneau(new Date('2026-10-09T13:00:00Z'), CRENEAUX_MARCHES).toISOString()).toBe('2026-10-09T13:25:00.000Z');
    expect(prochainCreneau(new Date('2026-10-09T18:00:00Z'), ['07:05', '09:02', '16:20', '19:30']).toISOString()).toBe('2026-10-12T05:05:00.000Z'); // vendredi soir → lundi
    expect(prochaineRecuperation(DETTE, new Date('2026-10-09T08:00:00Z')).toISOString()).toBe('2026-12-18T08:02:00.000Z');
    expect(prochaineRecuperation({ ...EURUSD, derniere_erreur: 'HTTP 503' }, new Date('2026-10-09T08:00:00Z')).toISOString()).toBe('2026-10-09T13:25:00.000Z');
  });

  it('articles liés à une étape : thème ou mot-clé, pendant l’étape', () => {
    expect(contientMotCle('le plf 2027', '=plf')).toBe(true);
    expect(contientMotCle('le plfss 2027', '=plf')).toBe(false);
    expect(articlesDeLEtape(NEWS.articles, SUIVI, 'Loi de finances', 1, '2026-10-08').map((a) => a.id)).toEqual(['a']);
    expect(articlesDeLEtape(NEWS.articles, SUIVI, 'Loi de finances', 0, '2026-10-08').map((a) => a.id)).toEqual(['b']);
    expect(articlesDeLEtape(NEWS.articles, SUIVI, 'Loi de finances', 2, '2026-10-08')).toEqual([]);
  });

  it('prochaines publications groupées (aujourd’hui, cette semaine, ce trimestre)', () => {
    const bloc = prochainesPublications(MARCHES, '2026-10-09');
    expect([...bloc.querySelectorAll('h3')].map((x) => x.textContent)).toEqual(['Aujourd’hui', 'Ce trimestre']);
    expect(bloc.textContent).toContain('Dette publique · BCE18/12/2026 à 08 h 45 (calendrier officiel)');
  });
});

describe('suivi · graphiques', () => {
  it('graduations rondes', () => {
    expect(graduations(0, 4000)).toEqual([0, 1000, 2000, 3000, 4000]);
    expect(graduations(1.05, 1.13)).toEqual([1.06, 1.08, 1.1, 1.12]);
  });

  it('mini-graphique et graphique détaillé (repères, minimum et maximum, clavier)', () => {
    expect(sparkline([1, 2, 3], 'test').querySelectorAll('path')).toHaveLength(2);
    const g = graphiqueLignes({
      series: [{ nom: 'EUR/USD', classe: 'serie-1', points: pointsPeriode(EURUSD.historique, 3), libelleValeur: () => '1,1186 $' }],
      evenements: MARCHES.evenements, extremes: true, formatAxe: (v) => String(v), description: 'test',
    });
    expect(g.querySelectorAll('.graphique-evenement')).toHaveLength(2);
    expect(g.querySelectorAll('.graphique-extreme')).toHaveLength(2);
    const svg = g.querySelector('svg')!;
    expect(svg.getAttribute('aria-label')).toBe('test');
    svg.dispatchEvent(new Event('focus'));
    svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }));
    expect(g.querySelector('.graphique-infobulle')?.textContent).toMatch(/^\d{2}\/\d{2}\/2026 · 1,1186 \$$/);
  });
});

describe('suivi · frise interactive', () => {
  it('étape en cours mise en avant, échéances à venir, clic sur une étape', () => {
    const f = friseTexte(SUIVI, 'Loi de finances', 'Loi de finances', NEWS, '2026-10-08');
    expect(f.querySelector('[aria-current="step"]')?.textContent).toContain('depuis le 06/10/2026');
    expect(f.querySelector('.echeances-texte')?.textContent).toContain('21/10/2026 Vote solennel de la première partie (source : Assemblée nationale, conférence des présidents)');
    expect(f.querySelector('.articles-etape')?.textContent).toContain('Commission des finances : examen du PLF');
    const boutons = f.querySelectorAll<HTMLButtonElement>('.etape-frise');
    boutons[0]!.click();
    expect(boutons[0]!.getAttribute('aria-pressed')).toBe('true');
    expect(f.querySelector('.articles-etape')?.textContent).toContain('Budget de l’État');
    boutons[2]!.click();
    expect(f.querySelector('.articles-etape')?.textContent).toContain('Étape à venir');
  });
});

describe('suivi · écran', () => {
  let conteneur: HTMLElement;
  let appels: string[];
  beforeEach(() => {
    oublierCache();
    localStorage.clear();
    conteneur = document.createElement('div');
    document.body.replaceChildren(conteneur);
    location.hash = '#/veille/suivi';
    appels = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      appels.push(String(url));
      if (String(url).endsWith('news.json')) return new Response(JSON.stringify(NEWS));
      if (String(url).endsWith('marches.json')) return new Response(JSON.stringify(MARCHES));
      return new Response('', { status: 404 });
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('marchés : cartes, détail, comparateur base 100, dette, compteur, relecture à la reprise', async () => {
    await rendreVeille(conteneur, { magasin: magasinMemoire(), maintenant: new Date('2026-10-09T10:00:00Z') });
    await vi.waitFor(() => expect(conteneur.querySelectorAll('.carte-marche')).toHaveLength(4));
    const cartes = [...conteneur.querySelectorAll('.carte-marche')];
    expect(cartes.map((c) => c.querySelector('.carte-marche-nom')?.textContent)).toEqual(['Dette publique', 'OAT 10 ans', 'EUR/USD', 'Brent']);
    expect(cartes[0]!.textContent).toContain('3\u202f595,5');
    expect(cartes[0]!.textContent).toContain('119,0 % du PIB');
    expect(cartes[2]!.querySelector('.badge-fraicheur')?.textContent).toBe('À jour');
    // OAT : moyenne mensuelle de la BCE sur la carte, lien vers le TEC 10 du jour sous la carte (hors du bouton).
    expect(cartes[1]!.querySelector('.carte-marche-meta')?.textContent).toBe('Moyenne mensuelle officielle · BCE · août 2026');
    expect(cartes[1]!.querySelector('a')).toBeNull();
    const lienOat = cartes[1]!.parentElement!.querySelector<HTMLAnchorElement>('.carte-marche-lien a')!;
    expect(lienOat.href).toBe('https://www.banque-france.fr/fr/statistiques/taux-et-cours/indices-obligataires-2026-10-08');
    expect(conteneur.querySelectorAll('.carte-marche-lien')).toHaveLength(1);
    (cartes[1] as HTMLButtonElement).click();
    expect(conteneur.querySelector('.source-marche .lien-du-jour a')?.textContent).toContain('TEC 10 du 08/10/2026');
    expect(conteneur.querySelector('.source-marche')?.textContent).toContain('Licence Euronext');
    expect(conteneur.querySelector('.carte-marche[data-id="oat10"]')?.getAttribute('aria-pressed')).toBe('true');
    conteneur.querySelector<HTMLButtonElement>('.carte-marche[data-id="dette"]')!.click();
    cartes.splice(0, cartes.length, ...conteneur.querySelectorAll('.carte-marche'));
    // Dette : barres trimestrielles et courbe en % du PIB (deux panneaux, une échelle chacun).
    expect(conteneur.querySelectorAll('.graphique-barre')).toHaveLength(5);
    expect(conteneur.querySelector('.compteur-montant')?.textContent).toMatch(/^3\u202f\d{3}\u202f\d{3}\u202f\d{3}\u202f\d{3} €$/);
    expect(conteneur.querySelector('.mention-estimation')?.textContent).toBe('Estimation, ce n’est pas un chiffre officiel');
    expect(conteneur.querySelector('.methode-texte')?.textContent).toContain('3\u202f595,5 Md€ au 30/06/2026');

    (cartes[2] as HTMLButtonElement).click();
    expect(conteneur.querySelector('.detail-marche h2')?.textContent).toBe('EUR/USD');
    expect(conteneur.querySelectorAll('.graphique-evenement').length).toBeGreaterThan(0);
    const caseComparer = conteneur.querySelector<HTMLInputElement>('#comparer-base100')!;
    caseComparer.checked = true;
    caseComparer.dispatchEvent(new Event('change'));
    expect(conteneur.querySelectorAll('.graphique-ligne')).toHaveLength(2);
    expect(conteneur.querySelector('.legende-graphique')?.textContent).toContain('base 100');
    conteneur.querySelector<HTMLButtonElement>('.periodes button')!.click(); // 1 mois
    expect(conteneur.querySelector('.periodes button')?.getAttribute('aria-pressed')).toBe('true');

    expect(conteneur.querySelector('.conjoncture')?.textContent).toContain('8,3 %');
    const avant = appels.filter((u) => u.endsWith('marches.json')).length;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(appels.filter((u) => u.endsWith('marches.json')).length).toBe(avant + 1));
  });

  it('état des sources : une ligne par indicateur, avec les pastilles et la prochaine récupération', async () => {
    location.hash = '#/veille/suivi/sources';
    await rendreVeille(conteneur, { magasin: magasinMemoire(), maintenant: new Date('2026-10-09T10:00:00Z') });
    await vi.waitFor(() => expect(conteneur.textContent).toContain('EUR/USD — BCE'));
    const ligne = [...conteneur.querySelectorAll('tr')].find((tr) => tr.textContent?.startsWith('EUR/USD'))!;
    expect(ligne.querySelectorAll('.pastille')).toHaveLength(30);
    expect(ligne.querySelector('.pastille-rouge')).not.toBeNull();
    expect(ligne.textContent).toContain('09/10/2026 16 h 20');
  });
});

// --- Collecte : Sénat, saisie du pôle, historique ---

describe('suivi PLF / PLFSS · Sénat et saisie du pôle', () => {
  const html = readFileSync(resolve('tests/fixtures/veille/senat-dossier-pjlf2026.html'), 'utf8');

  it('lit les étapes du dossier du Sénat (réponse enregistrée)', () => {
    const etapes = lireEtapesSenat(html);
    expect(etapes[0]).toEqual({ libelle: 'Première lecture - Assemblée nationale', date: '2025-10-14' });
    expect(etapes.map((e) => e.libelle)).toContain('CMP');
    expect(etapes.at(-1)).toEqual({ libelle: 'Loi - Promulgation', date: '2026-02-19' });
    expect(lireEtapesSenat('<html></html>')).toEqual([]);
  });

  it('fusion : les étapes absentes du dossier de l’Assemblée sont ajoutées, sans doublon', () => {
    const an = [{ libelle: 'Dépôt à l’Assemblée nationale', date: '2025-10-14' }, { libelle: 'Première lecture à l’Assemblée nationale', date: '2025-10-14' }];
    const f = fusionnerEtapes(an, lireEtapesSenat(html));
    expect(f.filter((e) => /premi[eè]re lecture.*assembl/i.test(e.libelle))).toHaveLength(1);
    expect(f.map((e) => e.libelle)).toContain('Première lecture - Sénat');
    expect(f.map((e) => e.libelle)).toContain('nouvelle lecture - Sénat');
    const suivi = construireSuivi('plf', 'PLF 2026', f, '2026-03-01', null);
    expect(suivi.etapes.filter((e) => e.statut === 'a_venir')).toEqual([]);
  });

  it('dossier du Sénat : même année que l’Assemblée, 404 normal tant que le texte n’est pas transmis', async () => {
    const an = readFileSync(resolve('tests/fixtures/veille/an-dossier-plf.html'), 'utf8');
    const fetch = (async (u: URL | string) => {
      const url = String(u);
      if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
      if (url === 'https://www.assemblee-nationale.fr/dyn/17/dossiers/PLF_2027') return new Response(an);
      return new Response('', { status: 404 });
    }) as typeof globalThis.fetch;
    const client = new ClientHttp({ userAgent: 'test', fetch, attendre: async () => {}, maintenant: () => 0 });
    const sources: SourceCatalogue[] = [
      { id: 'an-dossier-plf', nom: 'AN', type: 'dossier', suivi: 'plf', url: 'https://www.assemblee-nationale.fr/dyn/17/dossiers/PLF_{annee}', theme: 'Loi de finances', statut: 'verifie' },
      { id: 'senat-dossier-plf', nom: 'Sénat', type: 'dossier', chambre: 'senat', suivi: 'plf', url: 'https://www.senat.fr/dossier-legislatif/pjlf{annee}.html', theme: 'Loi de finances', statut: 'verifie' },
    ];
    const regles: MotsCles = { seuils_importance: {}, bonus_sources: {}, exclusions: [], themes: {}, publics: {} };
    const r = await collecterDossiers(sources, { client, maintenant: new Date('2026-10-08T04:30:00Z'), etatPrecedent: [], motsCles: regles });
    const senat = r.etats.find((e) => e.id === 'senat-dossier-plf')!;
    expect(senat).toMatchObject({ etat: 'ok', erreur: 'pas encore de dossier au Sénat pour le PLF 2027' });
  });

  it('saisie du pôle : mots-clés, échéances à venir, étape ajoutée ; idempotent', () => {
    const base: SuiviTexte = { ...SUIVI, mots_cles: undefined, echeances_saisies: undefined };
    const saisie = {
      mots_cles: ['=plf'],
      etapes: [{ libelle: 'Première lecture au Sénat', date: '2026-11-20', source: 'Sénat, ordre du jour' }],
      echeances: [{ libelle: 'Vote solennel', date: '2026-10-21', source: 'AN' }, { libelle: 'Passée', date: '2026-10-01', source: 'AN' }],
      secours: null,
    };
    const une = completerSuivi(base, saisie, '2026-10-08');
    expect(une.mots_cles).toEqual(['=plf']);
    expect(une.echeances_saisies?.map((e) => e.libelle)).toEqual(['Vote solennel']);
    const senat = une.etapes.filter((e) => /au S[ée]nat/.test(e.libelle));
    expect(senat).toEqual([{ libelle: 'Première lecture au Sénat', date: '2026-11-20', statut: 'a_venir', saisie: { source: 'Sénat, ordre du jour' } }]);
    expect(completerSuivi(une, saisie, '2026-10-08').etapes).toEqual(une.etapes);
  });

  it('historique de l’état des sources : une entrée par jour, 30 jours', () => {
    const h = historiqueEtat([{ date: '2026-09-01', etat: 'ok' }, { date: '2026-10-08', etat: 'erreur' }], '2026-10-08', 'ok');
    expect(h).toEqual([{ date: '2026-10-08', etat: 'ok' }]);
  });
});
