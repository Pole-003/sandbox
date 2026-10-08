/**
 * Détection de l'encodage et décodage en flux.
 *
 * UTF-8 : TextDecoder natif, mode strict (une séquence invalide signale un fichier mal détecté).
 * Windows-1252 et ISO-8859-15 : table de correspondance, car le TextDecoder de Node 22 décode
 * Windows-1252 comme ISO-8859-1 ; la table garantit le même résultat en navigateur et en test.
 * Les octets 0x80–0x9F (caractères de contrôle, jamais du texte en ISO-8859-15) sont toujours lus
 * comme en Windows-1252 et comptés : leur présence révèle un fichier Windows-1252.
 */

export type Encodage = 'utf-8' | 'iso-8859-15' | 'windows-1252';

export const LIBELLES_ENCODAGE: Record<Encodage, string> = {
  'utf-8': 'UTF-8',
  'iso-8859-15': 'ISO-8859-15',
  'windows-1252': 'Windows-1252',
};

const C1_WINDOWS_1252 =
  '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';
const SPECIFIQUES_8859_15: Record<number, string> = {
  0xa4: '€',
  0xa6: 'Š',
  0xa8: 'š',
  0xb4: 'Ž',
  0xb8: 'ž',
  0xbc: 'Œ',
  0xbd: 'œ',
  0xbe: 'Ÿ',
};

function table(encodage: 'iso-8859-15' | 'windows-1252'): Uint16Array {
  const t = new Uint16Array(256);
  for (let i = 0; i < 256; i++) t[i] = i;
  for (let i = 0; i < 32; i++) t[0x80 + i] = C1_WINDOWS_1252.charCodeAt(i);
  if (encodage === 'iso-8859-15') {
    for (const [octet, caractere] of Object.entries(SPECIFIQUES_8859_15)) t[Number(octet)] = caractere.charCodeAt(0);
  }
  return t;
}

export interface Detection {
  encodage: Encodage;
  bom: boolean;
  /** Aucun octet ≥ 0x80 dans l'échantillon. */
  ascii: boolean;
}

/** Longueur du préfixe ne coupant pas un caractère UTF-8 multi-octets. */
function finCaractereUtf8(octets: Uint8Array): number {
  let i = octets.length;
  let retour = 0;
  while (i > 0 && retour < 4) {
    const o = octets[i - 1]!;
    retour++;
    if ((o & 0xc0) !== 0x80) {
      const attendu = o >= 0xf0 ? 4 : o >= 0xe0 ? 3 : o >= 0xc0 ? 2 : 1;
      return attendu > retour ? i - 1 : octets.length;
    }
    i--;
  }
  return octets.length;
}

/** Détecte l'encodage d'après le début du fichier : BOM, puis UTF-8 strict, sinon Windows-1252 ou ISO-8859-15. */
export function detecterEncodage(echantillon: Uint8Array): Detection {
  if (echantillon[0] === 0xef && echantillon[1] === 0xbb && echantillon[2] === 0xbf) {
    return { encodage: 'utf-8', bom: true, ascii: false };
  }
  if ((echantillon[0] === 0xff && echantillon[1] === 0xfe) || (echantillon[0] === 0xfe && echantillon[1] === 0xff)) {
    throw new ErreurEncodage('Fichier en UTF-16 : réenregistrez-le en UTF-8 ou en ISO-8859-15.');
  }
  let ascii = true;
  let c1 = false;
  for (const o of echantillon) {
    if (o >= 0x80) ascii = false;
    if (o >= 0x80 && o <= 0x9f) c1 = true;
  }
  if (ascii) return { encodage: 'utf-8', bom: false, ascii: true };
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(echantillon.subarray(0, finCaractereUtf8(echantillon)));
    return { encodage: 'utf-8', bom: false, ascii: false };
  } catch {
    return { encodage: c1 ? 'windows-1252' : 'iso-8859-15', bom: false, ascii: false };
  }
}

export class ErreurEncodage extends Error {}

/** Décodeur en flux ; `octetsC1` compte les octets 0x80–0x9F lus en mode mono-octet. */
export class Decodeur {
  readonly encodage: Encodage;
  octetsC1 = 0;
  private readonly utf8: TextDecoder | null;
  private readonly correspondance: Uint16Array | null;

  constructor(encodage: Encodage) {
    this.encodage = encodage;
    this.utf8 = encodage === 'utf-8' ? new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }) : null;
    this.correspondance = encodage === 'utf-8' ? null : table(encodage);
  }

  decoder(octets: Uint8Array, final = false): string {
    if (this.utf8) {
      try {
        return this.utf8.decode(octets, { stream: !final });
      } catch {
        throw new ErreurEncodage('Séquence UTF-8 invalide');
      }
    }
    const t = this.correspondance!;
    let texte = '';
    const bloc = new Uint16Array(Math.min(octets.length, 16384));
    for (let i = 0; i < octets.length; i += bloc.length) {
      const n = Math.min(bloc.length, octets.length - i);
      for (let j = 0; j < n; j++) {
        const o = octets[i + j]!;
        if (o >= 0x80 && o <= 0x9f) this.octetsC1++;
        bloc[j] = t[o]!;
      }
      texte += String.fromCharCode.apply(null, bloc.subarray(0, n) as unknown as number[]);
    }
    return texte;
  }
}
