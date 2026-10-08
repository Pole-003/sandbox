import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { diagnostiquerSource, rapportMarkdown, type Source } from '../../scripts/veille/diagnostic.ts';
import { ClientHttp } from '../../scripts/veille/http.ts';

const UA = 'Pole003-Veille/1.0 (+https://pole-003.github.io/sandbox)';
const fixture = (nom: string) => new Uint8Array(readFileSync(new URL(`../fixtures/veille/${nom}`, import.meta.url)));

type Route = { statut?: number; corps?: string | Uint8Array<ArrayBuffer>; entetes?: Record<string, string>; erreur?: Error };

/** Faux serveur : URL → réponse. Journalise les requêtes et l'heure simulée de chacune. */
function fauxReseau(routes: Record<string, Route>) {
  let horloge = 0;
  const journal: { url: string; t: number; ua: string | null }[] = [];
  const fetch = (async (entree: URL | string, init?: RequestInit) => {
    const url = String(entree);
    journal.push({ url, t: horloge, ua: new Headers(init?.headers).get('user-agent') });
    const route = routes[url] ?? { statut: 404, corps: 'introuvable' };
    if (route.erreur) throw route.erreur;
    horloge += 120;
    return new Response(route.corps ?? '', { status: route.statut ?? 200, headers: route.entetes });
  }) as typeof globalThis.fetch;
  const client = new ClientHttp({
    userAgent: UA,
    fetch,
    maintenant: () => horloge,
    // Les attentes simultanées se terminent chacune à leur échéance, sans se cumuler.
    attendre: async (ms) => {
      const echeance = horloge + ms;
      await Promise.resolve();
      horloge = Math.max(horloge, echeance);
    },
  });
  return { client, journal };
}

const source = (url: string, type: Source['type'] = 'rss'): Source => ({ id: 'test', nom: 'Test', type, url, theme: 'Fiscal et comptable', statut: 'a_verifier' });
const AUJOURDHUI = new Date('2026-10-08T05:00:00Z');

describe('veille · diagnostic', () => {
  it('flux Sénat valide : encodage réel détecté, User-Agent envoyé', async () => {
    const { client, journal } = fauxReseau({
      'https://www.senat.fr/robots.txt': { corps: 'User-agent: *\nDisallow: /prive/' },
      'https://www.senat.fr/rss/textes.rss': { corps: fixture('senat-encodage-trompeur.rss'), entetes: { 'content-type': 'application/rss+xml' } },
    });
    const r = await diagnostiquerSource(client, source('https://www.senat.fr/rss/textes.rss'), AUJOURDHUI);
    expect(r).toMatchObject({ verdict: 'ok', http: 200, encodageReel: 'utf-8', elements: 2, plusRecent: '2026-10-07' });
    expect(r.encodageDeclare?.document).toBe('iso-8859-15');
    expect(journal.every((j) => j.ua === UA)).toBe(true);
  });

  it('respecte robots.txt : aucune requête vers la ressource interdite', async () => {
    const { client, journal } = fauxReseau({
      'https://exemple.fr/robots.txt': { corps: 'User-agent: *\nDisallow: /flux/' },
    });
    const r = await diagnostiquerSource(client, source('https://exemple.fr/flux/a.rss'), AUJOURDHUI);
    expect(r.verdict).toBe('echec');
    expect(r.message).toContain('interdit par robots.txt');
    expect(journal.map((j) => j.url)).toEqual(['https://exemple.fr/robots.txt']);
  });

  it('robots.txt absent (404) : accès permis ; robots.txt en erreur 5xx : accès refusé', async () => {
    const absent = fauxReseau({ 'https://a.fr/f.rss': { corps: fixture('atom-exemple.xml') } });
    expect((await diagnostiquerSource(absent.client, source('https://a.fr/f.rss'), AUJOURDHUI)).verdict).toBe('ok');

    const panne = fauxReseau({ 'https://b.fr/robots.txt': { statut: 503 } });
    const r = await diagnostiquerSource(panne.client, source('https://b.fr/f.rss'), AUJOURDHUI);
    expect(r.message).toContain('robots.txt injoignable (503)');
  });

  it('suit les redirections et vérifie robots.txt du nouveau domaine', async () => {
    const { client, journal } = fauxReseau({
      'https://ancien.fr/robots.txt': { statut: 404 },
      'https://ancien.fr/rss': { statut: 301, entetes: { location: 'https://nouveau.fr/rss.xml' } },
      'https://nouveau.fr/robots.txt': { statut: 404 },
      'https://nouveau.fr/rss.xml': { corps: fixture('atom-exemple.xml') },
    });
    const r = await diagnostiquerSource(client, source('https://ancien.fr/rss'), AUJOURDHUI);
    expect(r).toMatchObject({ verdict: 'ok', urlFinale: 'https://nouveau.fr/rss.xml' });
    expect(journal.map((j) => j.url)).toContain('https://nouveau.fr/robots.txt');
  });

  it('erreur HTTP, page HTML et panne réseau sont des échecs isolés', async () => {
    const { client } = fauxReseau({
      'https://c.fr/404.rss': { statut: 404 },
      'https://c.fr/page.rss': { corps: fixture('page-html.html') },
      'https://d.fr/robots.txt': { erreur: Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }) },
    });
    const resultats = await Promise.all([
      diagnostiquerSource(client, source('https://c.fr/404.rss'), AUJOURDHUI),
      diagnostiquerSource(client, source('https://c.fr/page.rss'), AUJOURDHUI),
      diagnostiquerSource(client, source('https://d.fr/flux.rss'), AUJOURDHUI),
    ]);
    expect(resultats.map((r) => r.verdict)).toEqual(['echec', 'echec', 'echec']);
    expect(resultats.map((r) => r.message)).toEqual([
      'HTTP 404',
      'page HTML reçue au lieu d’un flux',
      'robots.txt injoignable : erreur réseau : ENOTFOUND (d.fr)',
    ]);
  });

  it('limite à 1 requête par seconde et par domaine (créneaux réservés, même en parallèle)', async () => {
    const attentes: number[] = [];
    const client = new ClientHttp({
      userAgent: UA,
      maintenant: () => 0, // horloge figée : chaque attente reflète le créneau réservé
      attendre: async (ms) => {
        attentes.push(ms);
      },
      fetch: (async (entree: URL | string) => {
        return new Response(String(entree).endsWith('robots.txt') ? '' : fixture('atom-exemple.xml'), {
          status: String(entree).endsWith('robots.txt') ? 404 : 200,
        });
      }) as typeof globalThis.fetch,
    });
    await Promise.all([
      diagnostiquerSource(client, source('https://e.fr/1.rss'), AUJOURDHUI),
      diagnostiquerSource(client, source('https://e.fr/2.rss'), AUJOURDHUI),
      diagnostiquerSource(client, source('https://autre.fr/3.rss'), AUJOURDHUI),
    ]);
    // e.fr : robots.txt (immédiat), puis 1 s, puis 2 s. autre.fr : 1 s seulement (après son robots.txt).
    expect(attentes.sort((a, b) => a - b)).toEqual([1000, 1000, 2000]);
  });

  it('flux qui ne publie plus : à surveiller', async () => {
    const { client } = fauxReseau({ 'https://f.fr/vieux.rss': { corps: fixture('atom-exemple.xml') } });
    const r = await diagnostiquerSource(client, source('https://f.fr/vieux.rss'), new Date('2027-03-01T00:00:00Z'));
    expect(r.verdict).toBe('a_surveiller');
    expect(r.message).toMatch(/rien de publié depuis \d+ jours/);
  });

  it('page suivie : empreinte relevée', async () => {
    const { client } = fauxReseau({
      'https://g.fr/dossier': { corps: `<html><head><title>Dossier PLF 2027</title></head><body>${'Étape. '.repeat(60)}</body></html>` },
    });
    const r = await diagnostiquerSource(client, source('https://g.fr/dossier', 'page'), AUJOURDHUI);
    expect(r).toMatchObject({ verdict: 'ok', message: 'Dossier PLF 2027' });
    expect(r.empreinte).toMatch(/^[0-9a-f]{16}$/);
  });

  it('rapport : tableau Markdown avec bilan, barres verticales échappées', async () => {
    const { client } = fauxReseau({ 'https://h.fr/f.rss': { corps: fixture('atom-exemple.xml') } });
    const r = await diagnostiquerSource(client, { ...source('https://h.fr/f.rss'), id: 'a|b' }, AUJOURDHUI);
    const md = rapportMarkdown([r], AUJOURDHUI);
    expect(md).toContain('| a\\|b | rss | ✅ OK | 200 |');
    expect(md).toContain('07/10/2026');
    expect(md).toContain('Bilan : 1 OK, 0 à surveiller, 0 en échec, sur 1 sources testées.');
  });
});
