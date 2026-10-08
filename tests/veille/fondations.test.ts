import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyserFlux, analyserPage } from '../../scripts/veille/analyse.ts';
import { dateIsoParis, extraireDateDuTexte, lireDate } from '../../scripts/veille/dates.ts';
import { decoderOctets, lireEncodageDeclare } from '../../scripts/veille/encodage.ts';
import { analyserRobots, estAutorise } from '../../scripts/veille/robots.ts';

const fixture = (nom: string) => new Uint8Array(readFileSync(new URL(`../fixtures/veille/${nom}`, import.meta.url)));
const decoder = (octets: Uint8Array, contentType: string | null = null) =>
  decoderOctets(octets, lireEncodageDeclare(octets, contentType));

describe('veille · encodage', () => {
  it('Sénat : décode en UTF-8 malgré la déclaration iso-8859-15', () => {
    const octets = fixture('senat-encodage-trompeur.rss');
    expect(lireEncodageDeclare(octets, 'application/rss+xml').document).toBe('iso-8859-15');
    const { texte, encodage } = decoder(octets);
    expect(encodage).toBe('utf-8');
    expect(texte).toContain('Sénat');
    expect(texte).not.toContain('Ã©');
  });

  it('octets non UTF-8 : utilise l’encodage déclaré', () => {
    const octets = new Uint8Array([...new TextEncoder().encode('<?xml version="1.0" encoding="iso-8859-15"?><t>'), 0xa4, 0x3c]);
    const { texte, encodage } = decoder(octets);
    expect(encodage).toBe('iso-8859-15');
    expect(texte).toContain('€'); // 0xA4 = € en iso-8859-15
  });

  it('ni UTF-8 ni déclaration : se rabat sur windows-1252', () => {
    const { texte, encodage } = decoder(new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x20, 0x80]));
    expect(encodage).toBe('windows-1252');
    expect(texte).toBe('café €');
  });

  it('lit le charset de l’en-tête HTTP et retire le BOM', () => {
    const octets = new Uint8Array([0xef, 0xbb, 0xbf, 0x41]);
    expect(lireEncodageDeclare(octets, 'text/xml; charset="UTF-8"').entete).toBe('utf-8');
    expect(decoder(octets).texte).toBe('A');
  });
});

describe('veille · dates', () => {
  it.each([
    ['Wed,07 Oct 2026 18:30:00 +0200', '2026-10-07T16:30:00.000Z'],
    ['Wed, 07 Oct 2026 18:30:00 GMT', '2026-10-07T18:30:00.000Z'],
    ['7 Oct 2026', '2026-10-07T00:00:00.000Z'],
    ['2026-10-07T08:30:00+02:00', '2026-10-07T06:30:00.000Z'],
    ['2026-10-07', '2026-10-07T00:00:00.000Z'],
    ['mer., 07 oct. 2026 10:00:00 +0200', '2026-10-07T08:00:00.000Z'],
  ])('lit « %s »', (valeur, attendu) => {
    expect(lireDate(valeur)?.toISOString()).toBe(attendu);
  });

  it.each(['', 'demain', '31/02/2026', 'Mon, 31 Feb 2026'])('rejette « %s »', (valeur) => {
    expect(lireDate(valeur)).toBeNull();
  });

  it('extrait la date d’une description BOFiP', () => {
    expect(dateIsoParis(extraireDateDuTexte('Série IS, publié le 06/10/2026.')!)).toBe('2026-10-06');
    expect(dateIsoParis(extraireDateDuTexte('mis en ligne le 1er octobre 2026')!)).toBe('2026-10-01');
  });

  it('exprime les dates à l’heure de Paris', () => {
    expect(dateIsoParis(new Date('2026-10-07T22:30:00Z'))).toBe('2026-10-08');
  });
});

describe('veille · robots.txt', () => {
  const UA = 'Pole003-Veille/1.0 (+https://pole-003.github.io/sandbox)';

  it('applique le groupe « * » et la règle la plus longue', () => {
    const robots = analyserRobots('User-agent: *\nDisallow: /prive/\nAllow: /prive/public/\nDisallow: /*.pdf$');
    expect(estAutorise(robots, UA, '/rss/textes.rss')).toBe(true);
    expect(estAutorise(robots, UA, '/prive/x')).toBe(false);
    expect(estAutorise(robots, UA, '/prive/public/x')).toBe(true);
    expect(estAutorise(robots, UA, '/doc.pdf')).toBe(false);
    expect(estAutorise(robots, UA, '/doc.pdf?v=1')).toBe(true);
  });

  it('préfère le groupe qui nomme notre robot', () => {
    const robots = analyserRobots('User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nUser-agent: pole003-veille\nAllow: /rss/\nDisallow: /');
    expect(estAutorise(robots, UA, '/rss/a.rss')).toBe(true);
    expect(estAutorise(robots, UA, '/autre')).toBe(false);
  });

  it('« Disallow: » vide autorise tout ; tout interdire bloque', () => {
    expect(estAutorise(analyserRobots('User-agent: *\nDisallow:'), UA, '/x')).toBe(true);
    expect(estAutorise(analyserRobots('User-agent: *\nDisallow: /'), UA, '/x')).toBe(false);
  });
});

describe('veille · analyse des flux', () => {
  it('Sénat : compte les éléments et lit les dates sans espace', () => {
    const r = analyserFlux(decoder(fixture('senat-encodage-trompeur.rss')).texte);
    expect(r).toMatchObject({ format: 'rss', elements: 2, sansDate: 0 });
    expect(dateIsoParis(r.plusRecent!)).toBe('2026-10-07');
  });

  it('BOFiP : dates lues dans la description, éléments sans date comptés', () => {
    const r = analyserFlux(decoder(fixture('bofip-sans-pubdate.rss')).texte);
    expect(r).toMatchObject({ format: 'rss', elements: 3, dateDansDescription: 2, sansDate: 1 });
    expect(dateIsoParis(r.plusRecent!)).toBe('2026-10-06');
  });

  it('Atom : updated et published', () => {
    const r = analyserFlux(decoder(fixture('atom-exemple.xml')).texte);
    expect(r).toMatchObject({ format: 'atom', elements: 2, sansDate: 0 });
    expect(r.plusRecent?.toISOString()).toBe('2026-10-07T08:00:00.000Z');
  });

  it('signale une page HTML reçue à la place d’un flux', () => {
    const r = analyserFlux(decoder(fixture('page-html.html')).texte);
    expect(r.format).toBeNull();
    expect(r.remarque).toBe('page HTML reçue au lieu d’un flux');
  });

  it('page suivie : empreinte stable, sensible au texte visible seulement', () => {
    const a = analyserPage('<html><head><title>PLF</title><script>var t=1</script></head><body>Étape 1</body></html>');
    const b = analyserPage('<html><head><title>PLF</title><script>var t=2</script></head><body>Étape 1</body></html>');
    const c = analyserPage('<html><head><title>PLF</title></head><body>Étape 2</body></html>');
    expect(a.titre).toBe('PLF');
    expect(a.empreinte).toBe(b.empreinte);
    expect(a.empreinte).not.toBe(c.empreinte);
  });
});
