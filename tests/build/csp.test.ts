import { describe, expect, it } from 'vitest';
import { BALISE_CSP, CSP, injecterCsp } from '../../config/csp.ts';
import { verifierIndex, verifierUrls } from '../../scripts/verifier-build.ts';

const HTML = '<!doctype html><html><head><meta charset="UTF-8" /><script type="module" src="/a.js"></script></head><body></body></html>';

describe('CSP de production', () => {
  it('correspond mot pour mot à CLAUDE.md', () => {
    expect(CSP).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; form-action 'none'; base-uri 'none'; object-src 'none'",
    );
  });

  it('est injectée en tête de <head>, avant les scripts', () => {
    const sortie = injecterCsp(HTML);
    expect(sortie.indexOf(BALISE_CSP)).toBeGreaterThan(0);
    expect(sortie.indexOf(BALISE_CSP)).toBeLessThan(sortie.indexOf('<script'));
    expect(verifierIndex(sortie)).toEqual([]);
  });

  it('refuse une double injection', () => {
    expect(() => injecterCsp(injecterCsp(HTML))).toThrow();
  });

  it('la vérification du build détecte les défauts', () => {
    expect(verifierIndex(HTML)).not.toEqual([]);
    expect(verifierIndex(injecterCsp(HTML.replace('</head>', '<script>alert(1)</script></head>')))).toContain(
      'Script en ligne détecté.',
    );
    expect(verifierIndex(injecterCsp(HTML.replace('<body>', '<body style="color:red">')))).toContain(
      'Attribut style= en ligne détecté.',
    );
  });

  it('la vérification du build détecte les URL externes', () => {
    expect(verifierUrls('a.js', 'x="https://evil.exemple.com/p"', [])).toHaveLength(1);
    expect(verifierUrls('a.js', 'createElementNS("http://www.w3.org/2000/svg")', [])).toEqual([]);
  });
});
