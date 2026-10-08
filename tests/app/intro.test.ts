// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { calculerTrajectoire, dateLocaleIso, doitJouerIntro } from '../../src/app/intro/decision.ts';
import { lancerIntro } from '../../src/app/intro/intro.ts';

describe('doitJouerIntro', () => {
  const base = { aujourdhui: '2026-10-08', derniereLecture: null, desactivee: false, reduireMouvement: false };

  it('joue au premier lancement du jour', () => {
    expect(doitJouerIntro(base)).toBe(true);
    expect(doitJouerIntro({ ...base, derniereLecture: '2026-10-07' })).toBe(true);
  });

  it('ne rejoue pas le même jour', () => {
    expect(doitJouerIntro({ ...base, derniereLecture: '2026-10-08' })).toBe(false);
  });

  it('respecte la désactivation dans les paramètres', () => {
    expect(doitJouerIntro({ ...base, desactivee: true })).toBe(false);
  });

  it('ne joue pas si le système demande de réduire les animations', () => {
    expect(doitJouerIntro({ ...base, reduireMouvement: true })).toBe(false);
  });
});

describe('dateLocaleIso', () => {
  it('utilise la date locale', () => {
    expect(dateLocaleIso(new Date(2026, 9, 8, 23, 59))).toBe('2026-10-08');
    expect(dateLocaleIso(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
  });
});

describe('calculerTrajectoire', () => {
  const points = calculerTrajectoire(1280, 800);
  const premier = points[0]!;
  const dernier = points.at(-1)!;

  it('part hors champ en bas à gauche et sort hors champ en haut à droite', () => {
    expect(premier.x).toBeLessThan(0);
    expect(premier.y).toBeGreaterThan(400);
    expect(dernier.x).toBeGreaterThan(1280);
    expect(dernier.y).toBeLessThan(400);
  });

  it('avance toujours vers la droite et oriente le nez dans le sens du vol', () => {
    for (let i = 1; i < points.length; i++) {
      expect(points[i]!.x).toBeGreaterThan(points[i - 1]!.x);
      // Entre 0° (vers le haut) et 180° (vers le bas) : la fusée vise la droite.
      expect(points[i]!.angle).toBeGreaterThan(0);
      expect(points[i]!.angle).toBeLessThan(180);
    }
    // Elle monte franchement au départ, puis s'incline vers l'horizontale.
    expect(premier.angle).toBeLessThan(dernier.angle);
  });
});

describe('lancerIntro', () => {
  const maintenant = new Date(2026, 9, 8, 9, 0);
  const fusee = () => document.querySelector('.fusee-vol');

  beforeEach(() => {
    localStorage.clear();
    document.body.replaceChildren();
  });

  it('lance une fusée décorative, sans bloquer l’interface, et mémorise la date', () => {
    expect(lancerIntro({ maintenant, reduireMouvement: false })).toBe(true);
    expect(fusee()?.getAttribute('aria-hidden')).toBe('true');
    expect(fusee()?.querySelector('svg')).not.toBeNull();
    expect(localStorage.getItem('pole003-sandbox-intro-derniere-lecture')).toBe('2026-10-08');
  });

  it('ne se rejoue pas le même jour', () => {
    lancerIntro({ maintenant, reduireMouvement: false });
    document.body.replaceChildren();
    expect(lancerIntro({ maintenant, reduireMouvement: false })).toBe(false);
    expect(fusee()).toBeNull();
  });

  it('ne se joue pas si le système demande de réduire les animations', () => {
    expect(lancerIntro({ maintenant, reduireMouvement: true })).toBe(false);
    expect(fusee()).toBeNull();
  });

  it('ne se joue pas si elle est désactivée', () => {
    localStorage.setItem('pole003-sandbox-intro-desactivee', 'oui');
    expect(lancerIntro({ maintenant, reduireMouvement: false })).toBe(false);
  });
});
