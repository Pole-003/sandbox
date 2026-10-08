/**
 * Décodage des octets d'une réponse HTTP (docs/VEILLE.md : « décoder les octets soi-même »).
 *
 * Certains flux annoncent un encodage faux (Sénat : iso-8859-15 déclaré, UTF-8 réel).
 * Ordre d'essai : UTF-8 strict, puis l'encodage déclaré, puis windows-1252 (qui décode tout octet).
 */

export interface EncodageDeclare {
  /** charset de l'en-tête Content-Type. */
  entete: string | null;
  /** encoding="…" du prologue XML, ou <meta charset> d'une page HTML. */
  document: string | null;
}

export interface TexteDecode {
  texte: string;
  /** Encodage effectivement utilisé pour décoder. */
  encodage: string;
  /** Vrai si le contenu ne contient que des octets ASCII (tous les encodages se valent). */
  ascii: boolean;
}

const ALIAS: Record<string, string> = {
  'utf8': 'utf-8',
  'latin1': 'iso-8859-1',
  'latin-1': 'iso-8859-1',
  'latin9': 'iso-8859-15',
  'cp1252': 'windows-1252',
};

export function normaliserEncodage(nom: string | null | undefined): string | null {
  if (!nom) return null;
  const n = nom.trim().replace(/^["']|["']$/g, '').toLowerCase();
  return n === '' ? null : (ALIAS[n] ?? n);
}

/** Lit l'encodage annoncé par l'en-tête et par le document (sur ses 1 024 premiers octets, lus en ASCII). */
export function lireEncodageDeclare(octets: Uint8Array, contentType: string | null): EncodageDeclare {
  const entete = normaliserEncodage(/charset\s*=\s*([^;\s]+)/i.exec(contentType ?? '')?.[1]);
  const debut = new TextDecoder('windows-1252').decode(octets.subarray(0, 1024));
  const document = normaliserEncodage(
    /<\?xml[^>]*\bencoding\s*=\s*["']([^"']+)["']/i.exec(debut)?.[1] ??
      /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(debut)?.[1],
  );
  return { entete, document };
}

function estAscii(octets: Uint8Array): boolean {
  for (const o of octets) if (o > 0x7f) return false;
  return true;
}

/** Caractères windows-1252 des octets 0x80 à 0x9F (les autres octets valent leur point de code). */
const CP1252_C1 =
  '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f' +
  '\u0090‘’“”•–—˜™š›œ\u009džŸ';

/**
 * Décodage windows-1252 fait main : certaines versions de Node décodent « windows-1252 »
 * comme du latin-1 et perdent €, œ, les guillemets typographiques… (octets 0x80 à 0x9F).
 */
export function decoderWindows1252(octets: Uint8Array): string {
  let texte = '';
  for (let i = 0; i < octets.length; i += 8192) {
    const morceau = octets.subarray(i, i + 8192);
    texte += String.fromCharCode(...Array.from(morceau, (o) => (o >= 0x80 && o <= 0x9f ? CP1252_C1.charCodeAt(o - 0x80) : o)));
  }
  return texte;
}

function essayer(octets: Uint8Array, encodage: string, strict: boolean): string | null {
  // Selon le standard WHATWG, « iso-8859-1 » désigne en pratique windows-1252.
  if (encodage === 'windows-1252' || encodage === 'iso-8859-1' || encodage === 'us-ascii') return decoderWindows1252(octets);
  try {
    return new TextDecoder(encodage, { fatal: strict }).decode(octets);
  } catch {
    return null; // encodage inconnu ou octets invalides
  }
}

export function decoderOctets(octets: Uint8Array, declare: EncodageDeclare): TexteDecode {
  const ascii = estAscii(octets);
  const utf8 = essayer(octets, 'utf-8', true);
  if (utf8 !== null) return { texte: utf8.replace(/^﻿/, ''), encodage: 'utf-8', ascii };

  for (const candidat of [declare.document, declare.entete]) {
    if (!candidat || candidat === 'utf-8') continue;
    const texte = essayer(octets, candidat, false);
    if (texte !== null) return { texte, encodage: candidat, ascii };
  }
  return { texte: decoderWindows1252(octets), encodage: 'windows-1252', ascii };
}
