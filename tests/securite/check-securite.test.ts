import { describe, expect, it } from 'vitest';
import { analyserContenu, analyserProjet, type ListeBlanche } from '../../scripts/check-securite.ts';

const vide: ListeBlanche = { urls: [], fichiersFetch: [] };
const regles = (code: string, liste = vide, fichier = 'src/x.ts') => analyserContenu(fichier, code, liste).map((v) => v.regle);

describe('check:securite', () => {
  it('le projet actuel ne contient aucune violation', () => {
    expect(analyserProjet(new URL('../..', import.meta.url).pathname)).toEqual([]);
  });

  it.each([
    "const u = 'https://cdn.exemple.com/lib.js';",
    '@import url(http://fonts.exemple.com/css);',
    "new URL('wss://serveur.exemple.com')",
    "const u = '//cdn.exemple.com/lib.js';",
    'background: url(//images.exemple.com/a.png);',
    "<img src='//pixel.exemple.com/p.gif'>",
  ])('détecte une URL externe : %s', (code) => {
    expect(regles(code)).toHaveLength(1);
  });

  it.each([
    'new XMLHttpRequest()',
    "new WebSocket('/x')",
    "new EventSource('/flux')",
    "navigator.sendBeacon('/b', donnees)",
    'new RTCPeerConnection()',
    "importScripts('/w.js')",
    "window.open('/x')",
    'const i = new Image();',
    "document.createElement('iframe')",
    "document.createElement('form')",
    "document.createElement('script')",
    '<iframe src="/x"></iframe>',
    '<form action="/x"></form>',
    "fetch('/news.json')",
    'await fetch (url)',
  ])('détecte une API interdite : %s', (code) => {
    expect(regles(code).length).toBeGreaterThan(0);
  });

  it('tolère les espaces de noms XML', () => {
    expect(regles("document.createElementNS('http://www.w3.org/2000/svg', 'svg')")).toEqual([]);
  });

  it("n'autorise fetch que dans les fichiers de la liste blanche", () => {
    const liste: ListeBlanche = { urls: [], fichiersFetch: ['src/modules/veille/news.ts'] };
    const appel = 'fetch(`${import.meta.env.BASE_URL}${nom}`)';
    expect(regles(appel, liste, 'src/modules/veille/news.ts')).toEqual([]);
    expect(regles(appel, liste, 'src/modules/fec/x.ts')).toHaveLength(1);
  });

  it('dans un fichier autorisé : base du site, sans paramètre, news.json et veille-etat.json seulement', () => {
    const liste: ListeBlanche = { urls: [], fichiersFetch: ['src/modules/veille/news.ts'] };
    const f = 'src/modules/veille/news.ts';
    expect(regles("const F = { news: 'news.json', etat: 'veille-etat.json' };", liste, f)).toEqual([]);
    expect(regles("fetch('/autre/news.json')", liste, f)).toHaveLength(1);
    expect(regles('fetch(`${import.meta.env.BASE_URL}news.json?dossier=${id}`)', liste, f)).toHaveLength(1);
    expect(regles("const F = 'dossiers.json';", liste, f)).toEqual(['fichier dossiers.json non autorisé (seuls news.json et veille-etat.json)']);
  });

  it("n'autorise que les URL exactes de la liste blanche", () => {
    const liste: ListeBlanche = { urls: ['https://www.exemple.gouv.fr/page'], fichiersFetch: [] };
    expect(regles("href: 'https://www.exemple.gouv.fr/page'", liste)).toEqual([]);
    expect(regles("href: 'https://www.exemple.gouv.fr/page?siren=123'", liste)).toHaveLength(1);
  });

  it('ignore les chemins relatifs et les commentaires de division', () => {
    expect(regles("import x from './a.ts'; const y = a / b; // commentaire")).toEqual([]);
  });
});
