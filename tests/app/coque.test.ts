// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { monterCoque } from '../../src/app/coque.ts';
import { MODULES } from '../../src/modules/index.ts';

describe('coque', () => {
  let racine: HTMLElement;
  let demonter: () => void;

  const monter = (canal: 'production' | 'beta' = 'production') => {
    demonter = monterCoque(racine, { modules: MODULES, version: '9.8.7', canal });
  };

  beforeEach(() => {
    // L'accueil charge news.json et marches.json : aucun réseau en test.
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: 404 })));
    location.hash = '';
    racine = document.createElement('div');
    document.body.replaceChildren(racine);
  });
  afterEach(() => demonter());

  it('affiche les six modules, Stocks grisé « bientôt » et non cliquable', () => {
    monter();
    const nav = racine.querySelector('nav[aria-label="Modules"]');
    expect([...nav!.querySelectorAll('.nav-libelle')].map((e) => e.textContent)).toEqual([
      'Accueil',
      'Veille',
      'FEC',
      'Circularisations',
      'Stocks',
      'TVA',
    ]);
    const bientot = [...nav!.querySelectorAll('.nav-bientot')];
    expect(bientot.map((e) => e.querySelector('.nav-libelle')?.textContent)).toEqual(['Stocks']);
    for (const e of bientot) {
      expect(e.tagName).toBe('SPAN');
      expect(e.getAttribute('aria-disabled')).toBe('true');
      expect(e.textContent).toContain('bientôt');
    }
    expect(nav!.querySelectorAll('a')).toHaveLength(5);
  });

  it('affiche le badge « 100 % local » et la version', () => {
    monter();
    expect(racine.querySelector('.badge-local')?.textContent).toBe('100 % local · aucune donnée envoyée');
    expect(racine.querySelector('.version')?.textContent).toBe('v9.8.7');
    expect(racine.querySelector('.badge-beta')).toBeNull();
  });

  it('signale le canal bêta', () => {
    monter('beta');
    expect(racine.querySelector('.badge-beta')?.textContent).toBe('Bêta');
  });

  it("ouvre l'accueil par défaut et suit l'ancre", async () => {
    monter();
    expect(racine.querySelector('[aria-current="page"]')?.getAttribute('href')).toBe('#/accueil');
    expect(racine.querySelector('main h1')?.textContent).toBe('Accueil');

    location.hash = '#/fec';
    await new Promise((r) => setTimeout(r, 0));
    expect(racine.querySelector('[aria-current="page"]')?.getAttribute('href')).toBe('#/fec');
    expect(racine.querySelector('.entete-titre')?.textContent).toBe('FEC');
    expect(document.title).toBe('FEC · Sandbox Pôle 003');
    expect(document.activeElement).toBe(racine.querySelector('main h1'));
  });

  it("ne permet pas d'ouvrir un module « bientôt » par l'adresse", async () => {
    location.hash = '#/stocks';
    monter();
    expect(racine.querySelector('[aria-current="page"]')?.getAttribute('href')).toBe('#/accueil');
  });

  it('change de thème au clic', () => {
    monter();
    const bouton = racine.querySelector<HTMLButtonElement>('.entete .bouton-icone:last-child')!;
    const avant = document.documentElement.getAttribute('data-theme');
    bouton.click();
    expect(document.documentElement.getAttribute('data-theme')).not.toBe(avant);
  });
});
