// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dateLocaleIso, deciderIntro } from '../../src/app/intro/decision.ts';
import { lancerIntro } from '../../src/app/intro/intro.ts';

describe('deciderIntro', () => {
  const base = { aujourdhui: '2026-10-08', derniereLecture: null, desactivee: false, reduireMouvement: false };

  it('joue l’animation au premier lancement du jour', () => {
    expect(deciderIntro(base)).toBe('animee');
    expect(deciderIntro({ ...base, derniereLecture: '2026-10-07' })).toBe('animee');
  });

  it('ne la rejoue pas le même jour', () => {
    expect(deciderIntro({ ...base, derniereLecture: '2026-10-08' })).toBe('aucune');
  });

  it('respecte la désactivation dans les paramètres', () => {
    expect(deciderIntro({ ...base, desactivee: true })).toBe('aucune');
  });

  it('passe en version statique si le système demande de réduire les animations', () => {
    expect(deciderIntro({ ...base, reduireMouvement: true })).toBe('statique');
  });
});

describe('dateLocaleIso', () => {
  it('utilise la date locale', () => {
    expect(dateLocaleIso(new Date(2026, 9, 8, 23, 59))).toBe('2026-10-08');
    expect(dateLocaleIso(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
  });
});

describe('lancerIntro', () => {
  let application: HTMLElement;
  const maintenant = new Date(2026, 9, 8, 9, 0);

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    application = document.createElement('div');
    document.body.replaceChildren(application);
  });
  afterEach(() => vi.useRealTimers());

  const intro = () => document.querySelector('.intro');

  it('affiche le titre, rend l’application inerte et mémorise la date', () => {
    expect(lancerIntro({ application, maintenant, reduireMouvement: false })).toBe('animee');
    expect(intro()?.textContent).toContain('Pôle 003 - Innovation');
    expect(intro()?.querySelector('svg.intro-scene')).not.toBeNull();
    expect(application.inert).toBe(true);
    expect(localStorage.getItem('pole003-sandbox-intro-derniere-lecture')).toBe('2026-10-08');
  });

  it('se retire au bout de 3 s au plus, même sans événement de fin d’animation', () => {
    lancerIntro({ application, maintenant, reduireMouvement: false });
    vi.advanceTimersByTime(3000);
    expect(intro()).toBeNull();
    expect(application.inert).toBe(false);
  });

  it('se passe d’une touche', () => {
    lancerIntro({ application, maintenant, reduireMouvement: false });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(intro()?.classList.contains('intro-passee')).toBe(true);
  });

  it('version statique : se passe d’un clic immédiatement, sinon dure 1 s', () => {
    expect(lancerIntro({ application, maintenant, reduireMouvement: true })).toBe('statique');
    expect(intro()?.classList.contains('intro-statique')).toBe(true);
    intro()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(intro()).toBeNull();

    localStorage.clear();
    lancerIntro({ application, maintenant, reduireMouvement: true });
    vi.advanceTimersByTime(1000);
    expect(intro()).toBeNull();
  });

  it('ne se rejoue pas le même jour', () => {
    lancerIntro({ application, maintenant, reduireMouvement: false });
    vi.advanceTimersByTime(3000);
    expect(lancerIntro({ application, maintenant, reduireMouvement: false })).toBe('aucune');
    expect(intro()).toBeNull();
  });

  it('ne se joue pas si elle est désactivée', () => {
    localStorage.setItem('pole003-sandbox-intro-desactivee', 'oui');
    expect(lancerIntro({ application, maintenant, reduireMouvement: false })).toBe('aucune');
  });
});
