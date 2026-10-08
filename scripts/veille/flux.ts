/**
 * Parseur RSS/Atom tolérant (couche A, docs/VEILLE.md).
 *
 * Lecture par expressions régulières plutôt que par un parseur XML strict : les flux officiels
 * contiennent souvent du XML approximatif (entités HTML, encodage déclaré faux) qu'un parseur
 * strict rejetterait en bloc. Le décodage des octets est fait en amont (encodage.ts).
 */
import { extraireDateDuTexte, lireDate } from './dates.ts';

export interface ElementFlux {
  titre: string;
  lien: string;
  date: Date | null;
  /** Texte brut de la description, sans balises. Sert à la notation, jamais publié. */
  description: string;
  /** Vrai si la date n'a été trouvée que dans la description (BOFiP). */
  dateDansDescription: boolean;
}

const ENTITES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', agrave: 'à', acirc: 'â', auml: 'ä',
  icirc: 'î', iuml: 'ï', ocirc: 'ô', ouml: 'ö', ugrave: 'ù', ucirc: 'û', uuml: 'ü', ccedil: 'ç',
  Eacute: 'É', Egrave: 'È', Ecirc: 'Ê', Agrave: 'À', Acirc: 'Â', Ccedil: 'Ç', Ocirc: 'Ô', Icirc: 'Î',
  oelig: 'œ', OElig: 'Œ', laquo: '«', raquo: '»', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
  hellip: '…', ndash: '–', mdash: '—', euro: '€', deg: '°', sect: '§', copy: '©', reg: '®',
};

export function decoderEntites(texte: string): string {
  return texte.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (tout, nom: string) => {
    if (nom[0] === '#') {
      const code = nom[1] === 'x' || nom[1] === 'X' ? parseInt(nom.slice(2), 16) : parseInt(nom.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : tout;
    }
    return ENTITES[nom] ?? tout;
  });
}

/** Contenu d'une balise : CDATA déballé, entités décodées une fois (le texte peut contenir du HTML échappé). */
function contenuBalise(bloc: string, balise: string): string | null {
  const nom = balise.replace(':', '\\:');
  const m = new RegExp(`<${nom}(?:\\s[^>]*)?>([\\s\\S]*?)</${nom}>`, 'i').exec(bloc);
  if (!m || m[1] === undefined) return null;
  const brut = m[1].trim();
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(brut);
  return cdata ? (cdata[1] ?? '') : decoderEntites(brut);
}

/** Retire le balisage HTML et normalise les espaces. */
export function texteBrut(html: string): string {
  return decoderEntites(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lien absolu en https (les flux de l'Assemblée et du BOFiP publient encore des liens http). */
export function lienHttps(lien: string, base: string): string | null {
  try {
    const url = new URL(lien.trim(), base);
    if (url.protocol === 'http:') url.protocol = 'https:';
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function lienAtom(bloc: string): string | null {
  const liens = [...bloc.matchAll(/<link\b([^>]*)\/?>/gi)].map((m) => m[1] ?? '');
  const attr = (attributs: string, nom: string) => new RegExp(`\\b${nom}\\s*=\\s*["']([^"']*)["']`, 'i').exec(attributs)?.[1];
  const alternatif = liens.find((a) => !attr(a, 'rel') || attr(a, 'rel') === 'alternate') ?? liens[0];
  return alternatif ? (attr(alternatif, 'href') ?? null) : null;
}

const BALISES_DATE = ['pubDate', 'dc:date', 'published', 'updated', 'a10:updated', 'dcterms:modified', 'dcterms:created'];
const BALISES_DESCRIPTION = ['description', 'summary', 'content:encoded', 'content'];

/** Analyse un flux RSS 2.0, RSS 1.0 (RDF) ou Atom. Les éléments sans titre ou sans lien exploitable sont ignorés. */
export function lireFlux(texte: string, urlFlux: string): ElementFlux[] {
  const atom = /<feed[\s>]/i.test(texte.slice(0, 4000)) && !/<rss[\s>]/i.test(texte.slice(0, 4000));
  const blocs = texte.match(atom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  const elements: ElementFlux[] = [];

  for (const bloc of blocs) {
    const titre = texteBrut(contenuBalise(bloc, 'title') ?? '');
    const lienBrut = atom ? lienAtom(bloc) : (contenuBalise(bloc, 'link') ?? contenuBalise(bloc, 'guid'));
    const lien = lienBrut ? lienHttps(decoderEntites(lienBrut), urlFlux) : null;
    if (!titre || !lien) continue;

    const descriptionHtml = BALISES_DESCRIPTION.map((b) => contenuBalise(bloc, b)).find((d) => d) ?? '';
    const description = texteBrut(descriptionHtml);

    let date: Date | null = null;
    for (const balise of BALISES_DATE) {
      date = lireDate(contenuBalise(bloc, balise));
      if (date) break;
    }
    const dateDansDescription = !date && description !== '';
    if (!date) date = extraireDateDuTexte(description);

    elements.push({ titre, lien, date, description, dateDansDescription: dateDansDescription && date !== null });
  }
  return elements;
}
