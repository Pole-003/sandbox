// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  developperEcheances,
  echeancesAVenir,
  fusionnerEcheances,
  jourOuvreSuivant,
  nIemeJourOuvreApres,
  verifierFichierEcheances,
  type EcheanceEntreprise,
  type FichierEcheances,
} from '../../src/modules/veille/echeances.ts';
import { blocEcheancesAccueil, delaiEnClair, rendreEcheances } from '../../src/modules/veille/ecran-echeances.ts';
import { categorieCalendrier, collecterCalendrier, lireCalendrier, moisAConsulter, urlCalendrier } from '../../scripts/veille/calendrier-fiscal.ts';
import type { SourceCatalogue } from '../../scripts/veille/config.ts';
import { ClientHttp } from '../../scripts/veille/http.ts';

const SOURCE = { source: 'Urssaf', url: 'https://www.urssaf.fr/x' };

describe('échéances · jours ouvrés et reports', () => {
  it('report au premier jour ouvré suivant (week-end et jours fériés)', () => {
    expect(jourOuvreSuivant('2026-11-01')).toBe('2026-11-02'); // Toussaint, un dimanche
    expect(jourOuvreSuivant('2026-11-11')).toBe('2026-11-12'); // Armistice, un mercredi
    expect(jourOuvreSuivant('2026-12-25')).toBe('2026-12-28'); // Noël un vendredi, puis le week-end
    expect(jourOuvreSuivant('2026-10-15')).toBe('2026-10-15');
  });

  it('n-ième jour ouvré après une date (liasse : 2e jour ouvré après le 1er mai)', () => {
    expect(nIemeJourOuvreApres('2027-05-01', 2)).toBe('2027-05-04'); // 1er mai un samedi
    expect(nIemeJourOuvreApres('2026-05-01', 2)).toBe('2026-05-05'); // 1er mai un vendredi
  });
});

describe('échéances · règles du fichier saisi à la main', () => {
  const fichier: FichierEcheances = {
    mis_a_jour_le: '2026-10-09',
    regles: [
      { id: 'mensuelle', titre: 'Le 5', categorie: 'social', ...SOURCE, mensuelle: { jour: 5 } },
      { id: 'trimestre', titre: 'Trimestre', categorie: 'social', ...SOURCE, mensuelle: { jour: 5, mois: [2, 5, 8, 11] } },
      { id: 'fin', titre: 'Fin de mois', categorie: 'juridique', ...SOURCE, mensuelle: { jour: 31 }, report: false },
      { id: 'annuelle', titre: 'Annuelle', categorie: 'social', ...SOURCE, annuelle: { jour: 1, mois: 3 }, report: false },
      { id: 'liasse', titre: 'Liasse', categorie: 'fiscal', ...SOURCE, jours_ouvres_apres: { jour: 1, mois: 5, rang: 2, plus_jours: 15 } },
    ],
    ponctuelles: [{ id: 'fe', date: '2027-09-01', titre: 'Facturation électronique', categorie: 'fiscal', ...SOURCE }],
  };

  it('développe les règles sur une période, reports appliqués', () => {
    const r = developperEcheances(fichier, '2026-11-01', '2026-12-31');
    expect(r.filter((e) => e.titre === 'Le 5').map((e) => e.date)).toEqual(['2026-11-05', '2026-12-07']); // 5/12 = samedi
    expect(r.filter((e) => e.titre === 'Trimestre').map((e) => e.date)).toEqual(['2026-11-05']);
    expect(r.filter((e) => e.titre === 'Fin de mois').map((e) => e.date)).toEqual(['2026-11-30', '2026-12-31']);
    expect(r.every((e) => e.origine === 'saisie' && e.url === SOURCE.url)).toBe(true);
  });

  it('règles annuelles et « n-ième jour ouvré après », dates ponctuelles', () => {
    const r = developperEcheances(fichier, '2027-01-01', '2027-09-30');
    expect(r.find((e) => e.titre === 'Annuelle')?.date).toBe('2027-03-01');
    expect(r.find((e) => e.titre === 'Liasse')?.date).toBe('2027-05-19');
    expect(r.find((e) => e.titre === 'Facturation électronique')?.date).toBe('2027-09-01');
  });

  it('le fichier du dépôt est valide, chaque échéance a sa source officielle', () => {
    const f = JSON.parse(readFileSync(resolve('veille/echeances.json'), 'utf8')) as FichierEcheances;
    expect(verifierFichierEcheances(f)).toEqual([]);
    expect(developperEcheances(f, '2026-10-09', '2027-10-09').length).toBeGreaterThan(20);
  });

  it('refuse une échéance sans source, une date invalide ou un identifiant en double', () => {
    const erreurs = verifierFichierEcheances({
      mis_a_jour_le: '',
      regles: [{ id: 'a', titre: 'A', categorie: 'social', source: '', url: 'http://x', mensuelle: { jour: 40 } }],
      ponctuelles: [{ id: 'a', date: '2026-02-30', titre: 'B', categorie: 'autre' as never, ...SOURCE }],
    });
    expect(erreurs).toEqual([
      'règle « a » : source officielle (nom et lien https) obligatoire',
      'règle « a » : jour invalide',
      'échéance « a » : identifiant absent ou en double (« a »)',
      'échéance « a » : catégorie inconnue « autre »',
      'échéance « a » : date invalide « 2026-02-30 »',
    ]);
  });
});

const ech = (id: string, date: string, titre: string, origine: EcheanceEntreprise['origine'] = 'saisie'): EcheanceEntreprise => ({
  id, date, titre, detail: null, categorie: 'fiscal', source: 'impots.gouv.fr', url: 'https://www.impots.gouv.fr/x', origine,
});

describe('échéances · fusion et période', () => {
  it('le calendrier officiel l’emporte à date et intitulé égaux', () => {
    const r = fusionnerEcheances([ech('o', '2026-10-15', 'Taxe sur les salaires', 'calendrier_officiel')], [ech('s', '2026-10-15', 'taxe sur  les salaires'), ech('t', '2026-10-01', 'Autre')]);
    expect(r.map((e) => e.id)).toEqual(['t', 'o']);
  });

  it('15 prochains jours, aujourd’hui compris', () => {
    const liste = [ech('a', '2026-10-08', 'Passée'), ech('b', '2026-10-09', 'Aujourd’hui'), ech('c', '2026-10-23', 'J+14'), ech('d', '2026-10-24', 'J+15')];
    expect(echeancesAVenir(liste, '2026-10-09').map((e) => e.id)).toEqual(['b', 'c']);
  });
});

const fixture = () => readFileSync(resolve('tests/fixtures/veille/impots-calendrier-2026-10.html'), 'utf8');

describe('calendrier fiscal officiel (impots.gouv.fr)', () => {
  it('lit la page d’octobre 2026 enregistrée', () => {
    const r = lireCalendrier(fixture(), '2026-10', urlCalendrier('2026-10'));
    expect(r.length).toBeGreaterThanOrEqual(15);
    expect(r[0]).toMatchObject({
      date: '2026-10-05', titre: 'Prélèvement à la source – DSN', categorie: 'social', origine: 'calendrier_officiel',
      url: 'https://www.impots.gouv.fr/professionnel/calendrier-fiscal/2026-10',
    });
    expect(r[0]!.detail).toMatch(/^Date limite pour la télédéclaration DSN de septembre 2026/);
    const tva = r.find((e) => e.titre === 'TVA régime réel normal d’imposition' || e.titre.startsWith('TVA régime réel normal'));
    expect(tva).toMatchObject({ date: '2026-10-15', categorie: 'fiscal' });
    expect(new Set(r.map((e) => e.id)).size).toBe(r.length);
  });

  it('page sans la structure attendue : erreur explicite', () => {
    expect(() => lireCalendrier('<html><body>Maintenance</body></html>', '2026-10', 'u')).toThrow(/structure de la page modifiée/);
  });

  it('catégorie et mois consultés (passage d’année)', () => {
    expect(categorieCalendrier('Prélèvement à la source – PASRAU')).toBe('social');
    expect(categorieCalendrier('Taxe sur les salaires')).toBe('fiscal');
    expect(moisAConsulter(new Date('2026-12-15T10:00:00Z'))).toEqual(['2026-12', '2027-01', '2027-02']);
  });

  it('un mois illisible n’empêche pas les autres', async () => {
    const pages: Record<string, string> = { [urlCalendrier('2026-10')]: fixture(), [urlCalendrier('2026-11')]: fixture().replace('Octobre 2026', 'Novembre 2026').replaceAll('octobre', 'novembre') };
    const fetch = (async (u: URL | string) => {
      const corps = pages[String(u)];
      if (String(u).endsWith('/robots.txt')) return new Response('', { status: 404 });
      return corps ? new Response(corps) : new Response('', { status: 503 });
    }) as typeof globalThis.fetch;
    const client = new ClientHttp({ userAgent: 'test', fetch, attendre: async () => {}, maintenant: () => 0 });
    const source: SourceCatalogue = { id: 'impots-calendrier-fiscal', nom: 'Calendrier', type: 'calendrier', theme: 'Fiscal et comptable', statut: 'verifie', url: 'https://www.impots.gouv.fr/professionnel/calendrier-fiscal' };
    const r = await collecterCalendrier([source], { client, maintenant: new Date('2026-10-09T04:30:00Z'), etatPrecedent: [], delaisNouvellesTentatives: [] });
    expect(r.moisLus).toEqual(['2026-10', '2026-11']);
    expect(r.etats[0]).toMatchObject({ etat: 'ok', erreur: '2026-12 : HTTP 503' });
    expect(r.echeances.some((e) => e.date.startsWith('2026-11'))).toBe(true);
  });
});

describe('écran Échéances', () => {
  const liste = [
    ech('a', '2026-10-09', 'DSN'), { ...ech('b', '2026-10-12', 'Index égalité'), categorie: 'social' as const }, ech('c', '2026-11-30', 'Lointaine'),
  ];

  it('délai en clair', () => {
    expect(delaiEnClair('2026-10-09', '2026-10-09')).toBe('Aujourd’hui');
    expect(delaiEnClair('2026-10-10', '2026-10-09')).toBe('Demain');
    expect(delaiEnClair('2026-10-12', '2026-10-09')).toBe('Dans 3 jours');
  });

  it('groupe par jour et filtre par catégorie', () => {
    const c = document.createElement('div');
    rendreEcheances(c, liste, '2026-10-09');
    expect(c.querySelectorAll('.echeances-jour')).toHaveLength(2); // 30 jours par défaut
    expect(c.querySelector('.echeances-aujourdhui .echeances-date')?.textContent).toContain('vendredi 09/10/2026');
    const select = c.querySelector<HTMLSelectElement>('#echeances-categorie')!;
    select.value = 'social';
    select.dispatchEvent(new Event('change'));
    expect(c.querySelector('.compteur')?.textContent).toBe('1 échéance');
    const lien = c.querySelector('a')!;
    expect(lien.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('accueil : bloc des 15 prochains jours, absent s’il n’y a rien', () => {
    expect(blocEcheancesAccueil([], '2026-10-09')).toBeNull();
    const bloc = blocEcheancesAccueil(liste, '2026-10-09')!;
    expect(bloc.querySelectorAll('li')).toHaveLength(2);
    expect(bloc.querySelector('a[href="#/veille/echeances"]')).not.toBeNull();
  });
});
