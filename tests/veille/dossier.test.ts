import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SourceCatalogue } from '../../scripts/veille/config.ts';
import { anneesCandidates, collecterDossiers, construireSuivi, lireEtapesAN } from '../../scripts/veille/dossier.ts';
import { ClientHttp } from '../../scripts/veille/http.ts';

const page = (nom: string) => readFileSync(new URL(`../fixtures/veille/${nom}`, import.meta.url), 'utf8');
const MAINTENANT = new Date('2026-10-08T04:30:00Z');

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
    const { client, appels } = fauxHttp({ 'https://www.assemblee-nationale.fr/dyn/17/dossiers/PLF_2027': page('an-dossier-plf.html') });
    const r = await collecterDossiers([PLF, PLFSS], { client, maintenant: MAINTENANT, etatPrecedent: [] });
    expect(r.suivi.plf).toMatchObject({ texte: 'PLF 2027', source: 'Assemblée nationale — dossier législatif', url: 'https://www.assemblee-nationale.fr/dyn/17/dossiers/PLF_2027' });
    expect(r.suivi.plfss).toBeNull();
    expect(r.etats.map((e) => [e.id, e.etat])).toEqual([['an-dossier-plf', 'ok'], ['an-dossier-plfss', 'erreur']]);
    expect(r.etats[1]?.erreur).toBe('HTTP 404 pour PLFSS 2026');
    expect(appels).toContain('https://www.assemblee-nationale.fr/dyn/17/dossiers/PLFSS_2026'); // repli sur l'année en cours
    expect(r.articles).toEqual([]); // premier relevé : pas d'alerte
  });

  it('nouvelle étape : alerte dans le fil ; aucune alerte si rien ne change ou si l’ancien relevé était une page', async () => {
    const premier = await collecterDossiers([PLF], { client: fauxHttp({ 'https://www.assemblee-nationale.fr/dyn/17/dossiers/PLF_2027': page('an-dossier-plf.html') }).client, maintenant: MAINTENANT, etatPrecedent: [] });
    const identique = await collecterDossiers([PLF], { client: fauxHttp({ 'https://www.assemblee-nationale.fr/dyn/17/dossiers/PLF_2027': page('an-dossier-plf.html') }).client, maintenant: MAINTENANT, etatPrecedent: premier.etats });
    expect(identique.articles).toEqual([]);

    const suite = await collecterDossiers([PLF], { client: fauxHttp({ 'https://www.assemblee-nationale.fr/dyn/17/dossiers/PLF_2027': page('an-dossier-plf-cmp.html') }).client, maintenant: MAINTENANT, etatPrecedent: premier.etats });
    expect(suite.articles).toEqual([
      expect.objectContaining({ titre: 'PLF 2027 : nouvelle étape — Commission mixte paritaire', date: '2026-12-15', theme: 'Loi de finances', source_id: 'an-dossier-plf' }),
    ]);

    const ancienRelevePage = [{ ...premier.etats[0]!, type: 'page' as const, empreinte: '8025ca3b9345fc04' }];
    const migration = await collecterDossiers([PLF], { client: fauxHttp({ 'https://www.assemblee-nationale.fr/dyn/17/dossiers/PLF_2027': page('an-dossier-plf.html') }).client, maintenant: MAINTENANT, etatPrecedent: ancienRelevePage });
    expect(migration.articles).toEqual([]);
  });

  it('structure de page modifiée : erreur explicite', async () => {
    const { client } = fauxHttp({ 'https://www.assemblee-nationale.fr/dyn/17/dossiers/PLF_2027': '<html><body>Nouvelle maquette</body></html>' });
    const r = await collecterDossiers([PLF], { client, maintenant: MAINTENANT, etatPrecedent: [] });
    expect(r.etats[0]).toMatchObject({ etat: 'erreur', erreur: 'PLF 2027 : bloc « Étapes de lecture » introuvable (structure de la page modifiée ?)' });
  });
});
