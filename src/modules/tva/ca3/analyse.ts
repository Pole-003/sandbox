/**
 * Lecture d'une CA3 à partir du texte positionné de ses pages (fonction pure, sans pdfjs) : identification,
 * millésime et montants de chaque case.
 *
 * Méthode (jamais l'ordre du texte seul) :
 *  1. les éléments de texte sont découpés en mots, avec une abscisse estimée pour chacun, puis regroupés
 *     par ligne visuelle (ordonnée proche) ;
 *  2. dans une ligne, les mots proches forment des cellules ; un grand écart sépare deux cellules ;
 *  3. un code de case est le premier mot d'une ligne, dans la colonne des codes de la page ;
 *  4. un montant est une cellule purement numérique située dans la zone des montants. Après les en-têtes
 *     « Base hors taxe » et « Taxe due », il est affecté à la colonne dont l'en-tête est le plus proche ;
 *     avant (section A), la zone des montants est la moitié droite de la page ;
 *  5. une ligne sans code (suite d'un libellé sur plusieurs lignes) porte les montants du code précédent
 *     s'il n'en a pas encore ; une ligne « dont … » sans code n'est jamais rattachée.
 * Les nombres des libellés (« 20 % », « art 283-2 », « ligne 27 ») ne sont pas des cellules numériques
 * ou sont hors de la zone des montants.
 */
import { CASES_PAR_CODE, MILLESIMES_CONNUS, MOTIF_CODE } from '../ca3-cases.ts';

export interface ElementTexte {
  texte: string;
  /** Abscisse du début, en points, depuis le bord gauche. */
  x: number;
  /** Ordonnée de la ligne de base, en points, depuis le bas de la page (repère PDF). */
  y: number;
  largeur: number;
  /** Hauteur du texte (taille de police approchée). */
  hauteur: number;
}

export interface PageTexte {
  largeur: number;
  hauteur: number;
  elements: ElementTexte[];
}

/** Montants en centimes (les CA3 sont en euros entiers) ; 22A en centièmes de pour cent. */
export interface ValeurCase {
  base?: number;
  taxe?: number;
  montant?: number;
}

export type Gravite = 'anomalie' | 'avertissement' | 'information';

export interface MessageCa3 {
  gravite: Gravite;
  code: string;
  message: string;
}

export interface IdentificationCa3 {
  denomination: string | null;
  siren: string | null;
  /** Période déclarée, ISO AAAA-MM-JJ. */
  debut: string | null;
  fin: string | null;
  dateLimite: string | null;
  dateDepot: string | null;
  dateCreation: string | null;
  /** Année de la mention « applicable à compter du … ». */
  millesime: string | null;
}

export interface LectureCa3 {
  identification: IdentificationCa3;
  cases: Record<string, ValeurCase>;
  /** Codes lus absents de la table des cases. */
  casesInconnues: string[];
  messages: MessageCa3[];
  /** Aucun texte exploitable (PDF scanné ou image) : saisie manuelle proposée. */
  illisible: boolean;
}

interface Mot {
  texte: string;
  x0: number;
  x1: number;
  yHaut: number;
  taille: number;
}

interface Cellule {
  texte: string;
  x0: number;
  x1: number;
}

interface Ligne {
  page: number;
  yHaut: number;
  taille: number;
  cellules: Cellule[];
}

const ESPACES = /[\s   ]+/g;
const normaliser = (s: string) => s.replace(ESPACES, ' ').trim();
const sansAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Découpe un élément en mots, avec une abscisse estimée au prorata des caractères. */
function mots(e: ElementTexte, hauteurPage: number): Mot[] {
  const texte = e.texte.replace(/[   ]/g, ' ');
  const n = texte.length;
  if (n === 0 || !texte.trim()) return [];
  const parCaractere = e.largeur > 0 ? e.largeur / n : e.hauteur * 0.5;
  const resultat: Mot[] = [];
  for (const m of texte.matchAll(/\S+/g)) {
    const debut = m.index!;
    resultat.push({
      texte: m[0],
      x0: e.x + debut * parCaractere,
      x1: e.x + (debut + m[0].length) * parCaractere,
      yHaut: hauteurPage - e.y,
      taille: e.hauteur || 8,
    });
  }
  return resultat;
}

/** Regroupe les mots en lignes visuelles puis en cellules. */
export function lignesVisuelles(pages: PageTexte[]): Ligne[] {
  const lignes: Ligne[] = [];
  pages.forEach((p, numero) => {
    const tous = p.elements.flatMap((e) => mots(e, p.hauteur)).sort((a, b) => a.yHaut - b.yHaut || a.x0 - b.x0);
    const groupes: Mot[][] = [];
    for (const m of tous) {
      const g = groupes.at(-1);
      if (g && Math.abs(g[0]!.yHaut - m.yHaut) <= Math.max(2, 0.45 * m.taille)) g.push(m);
      else groupes.push([m]);
    }
    for (const g of groupes) {
      g.sort((a, b) => a.x0 - b.x0);
      const taille = Math.max(...g.map((m) => m.taille));
      const cellules: Cellule[] = [];
      for (const m of g) {
        const c = cellules.at(-1);
        // Un espace normal mesure environ 0,3 fois la taille de police : au-delà de 1,2 fois, nouvelle cellule.
        if (c && m.x0 - c.x1 <= 1.2 * taille) {
          c.texte += m.x0 - c.x1 > 0.12 * taille ? ` ${m.texte}` : m.texte;
          c.x1 = m.x1;
        } else cellules.push({ texte: m.texte, x0: m.x0, x1: m.x1 });
      }
      lignes.push({ page: numero, yHaut: g[0]!.yHaut, taille, cellules });
    }
  });
  return lignes;
}

const MOTIF_MONTANT = /^(-?)(\d{1,3}(?: \d{3})+|\d+)(?:,(\d{1,2}))?$/;

/** « 120 000 », « 120 000 € », « −1 000 » → centimes ; null si la cellule n'est pas un montant. */
export function lireMontantCa3(texte: string): number | null {
  const t = normaliser(texte)
    .replace(/[\u2212\u2013]/g, '-')
    .replace(/\s*(?:€|EUR|euros?)$/i, '')
    .replace(/^- /, '-');
  const m = MOTIF_MONTANT.exec(t);
  if (!m) return null;
  const euros = Number(m[2]!.replace(/ /g, ''));
  const centimes = euros * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  return m[1] ? -centimes : centimes;
}

const dateIso = (jjmmaaaa: string | undefined) => {
  const m = jjmmaaaa ? /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(jjmmaaaa) : null;
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

/**
 * Identification : les libellés peuvent être coupés sur deux lignes et la valeur s'intercaler entre les
 * deux morceaux (tableau centré verticalement) : la date est cherchée dans une courte fenêtre de texte,
 * sans chiffre, qui suit le début du libellé.
 */
function lireIdentification(texte: string): IdentificationCa3 {
  const lignes = texte.replace(/[\u00a0\u202f\u2007]/g, ' ');
  const plat = lignes.replace(/\s+/g, ' ');
  const date = '(\\d{2}/\\d{2}/\\d{4})';
  const apres = (libelle: string) => dateIso(new RegExp(`${libelle}[^0-9]{0,45}?${date}`, 'i').exec(plat)?.[1]);
  const periode = new RegExp(`P[ée]riode d[ée]clar[ée]e[^0-9]{0,45}?${date}[^0-9]{0,12}?${date}`, 'i').exec(plat);
  const siren = /SIREN[^0-9]{0,25}?(\d{3} ?\d{3} ?\d{3})(?!\d)/i.exec(plat)?.[1];
  const millesime = new RegExp(`3310-?CA3(?!G)[^0-9]{0,8}(?:\\([^)]{0,60}?|[^0-9]{0,60}?)(?:compter du|partir du)[^0-9]{0,10}${date}`, 'i').exec(plat)?.[1]?.slice(6) ?? null;
  const denomination = /D[ée]nomination\s*:?[ \t]*([^\n]+)/i.exec(lignes)?.[1]?.trim() || null;
  return {
    denomination,
    siren: siren ? siren.replace(/\s/g, '') : null,
    debut: dateIso(periode?.[1]),
    fin: dateIso(periode?.[2]),
    dateLimite: apres('Date limite de d[ée]p[ôo]t'),
    dateDepot: apres('Date de d[ée]p[ôo]t'),
    dateCreation: apres('Date de cr[ée]ation'),
    millesime,
  };
}

interface Colonnes {
  base: number;
  taxe: number;
  /** Début de la zone des montants. */
  debut: number;
}

/** En-têtes « Base hors taxe » et « Taxe due » (ou variantes) sur la même ligne, s'ils y figurent. */
function colonnesDeLigne(l: Ligne): Colonnes | null {
  const base = l.cellules.find((c) => /(^|\s)base (hors taxe|ht|imposable)$/.test(sansAccents(normaliser(c.texte))));
  const taxe = l.cellules.find((c) => /(^|\s)(taxe due|montant de (la )?taxe|tva due|taxe)$/.test(sansAccents(normaliser(c.texte))) && !/base/.test(sansAccents(c.texte)));
  if (!base || !taxe || base === taxe) return null;
  const cb = (base.x0 + base.x1) / 2;
  const ct = (taxe.x0 + taxe.x1) / 2;
  if (ct <= cb) return null;
  return { base: cb, taxe: ct, debut: cb - 0.75 * (ct - cb) };
}

/** Colonnes base / taxe déduites des lignes de taux portant deux montants (document sans en-têtes). */
function colonnesDeduites(lignes: Ligne[], pages: PageTexte[]): Colonnes | null {
  const bases: number[] = [];
  const taxes: number[] = [];
  for (const l of lignes) {
    const code = l.cellules[0]?.texte.split(' ')[0] ?? '';
    if (CASES_PAR_CODE.get(code)?.colonnes !== 2) continue;
    const montants = l.cellules.filter((c) => lireMontantCa3(c.texte) !== null && (c.x0 + c.x1) / 2 >= pages[l.page]!.largeur * 0.5);
    if (montants.length !== 2) continue;
    bases.push((montants[0]!.x0 + montants[0]!.x1) / 2);
    taxes.push((montants[1]!.x0 + montants[1]!.x1) / 2);
  }
  if (bases.length === 0) return null;
  const moyenne = (t: number[]) => t.reduce((a, b) => a + b, 0) / t.length;
  const base = moyenne(bases);
  const taxe = moyenne(taxes);
  return taxe > base ? { base, taxe, debut: base - 0.75 * (taxe - base) } : null;
}

export function analyserCa3(pages: PageTexte[]): LectureCa3 {
  const messages: MessageCa3[] = [];
  const lignes = lignesVisuelles(pages);
  const texteComplet = lignes.map((l) => l.cellules.map((c) => c.texte).join('   ')).join('\n');
  const identification = lireIdentification(texteComplet);
  const cases: Record<string, ValeurCase> = {};
  const casesInconnues: string[] = [];

  const nbCaracteres = texteComplet.replace(/\s/g, '').length;
  const formulaire = /3310-?CA3/i.test(texteComplet);
  if (nbCaracteres < 40 || (!formulaire && !identification.siren)) {
    return {
      identification,
      cases,
      casesInconnues,
      messages: [{ gravite: 'anomalie', code: 'LECTURE', message: 'Aucun texte exploitable : PDF scanné ou image. Saisissez la déclaration manuellement.' }],
      illisible: true,
    };
  }

  // Colonne des codes, par page : abscisse minimale des codes connus en début de ligne.
  const colonneCodes = new Map<number, number>();
  for (const l of lignes) {
    const premier = l.cellules[0]?.texte.split(' ')[0] ?? '';
    if (CASES_PAR_CODE.has(premier)) colonneCodes.set(l.page, Math.min(colonneCodes.get(l.page) ?? Infinity, l.cellules[0]!.x0));
  }

  let colonnes: Colonnes | null = null;
  let courant: { code: string; aMontants: boolean; page: number; yHaut: number } | null = null;
  // Sans en-têtes de colonnes dans tout le document : colonnes déduites des lignes de taux à deux montants.
  const deduites = lignes.some((l) => colonnesDeLigne(l)) ? null : colonnesDeduites(lignes, pages);
  const largeurPage = (p: number) => pages[p]!.largeur;

  for (const l of lignes) {
    const entetes = colonnesDeLigne(l);
    if (entetes) {
      colonnes = entetes;
      courant = null;
      continue;
    }
    const premiereCellule = l.cellules[0];
    if (!premiereCellule) continue;
    const premierMot = premiereCellule.texte.split(' ')[0]!;
    const xCodes = colonneCodes.get(l.page);
    const dansColonneCodes = xCodes !== undefined && premiereCellule.x0 <= xCodes + 1.5 * l.taille;
    const debutZone = colonnes ? colonnes.debut : largeurPage(l.page) * 0.5;
    const montants = l.cellules
      .map((c) => ({ c, v: lireMontantCa3(c.texte) }))
      .filter((x): x is { c: Cellule; v: number } => x.v !== null && (x.c.x0 + x.c.x1) / 2 >= debutZone);
    // Le code ne peut pas être lui-même le montant (cellule réduite au code, dans la zone des montants).
    const reste = premiereCellule.texte.slice(premierMot.length).trim();
    const estCode = dansColonneCodes && MOTIF_CODE.test(premierMot) && (CASES_PAR_CODE.has(premierMot) || /[a-zà-ÿ]/i.test(reste + (l.cellules[1]?.texte ?? '')));
    const montantsUtiles = montants.filter((x) => !(estCode && x.c === premiereCellule && reste === ''));

    if (estCode) {
      const code = premierMot;
      if (!CASES_PAR_CODE.has(code) && !casesInconnues.includes(code)) casesInconnues.push(code);
      courant = { code, aMontants: montantsUtiles.length > 0, page: l.page, yHaut: l.yHaut };
      if (montantsUtiles.length) affecter(code, montantsUtiles);
      continue;
    }
    if (!montantsUtiles.length) continue;
    const texteLigne = sansAccents(l.cellules.map((c) => c.texte).join(' '));
    const ligneDont = /^\(?\s*dont\b/.test(texteLigne);
    // Suite d'un libellé : même page, au plus trois lignes sous le code (jamais un pied de page).
    const proche = courant !== null && courant.page === l.page && l.yHaut - courant.yHaut <= 3.5 * l.taille;
    if (courant && !courant.aMontants && !ligneDont && proche) {
      courant.aMontants = true;
      affecter(courant.code, montantsUtiles);
    } else {
      messages.push({
        gravite: 'information',
        code: 'NON_AFFECTE',
        message: `Montant(s) ${montantsUtiles.map((x) => x.c.texte).join(', ')} sur une ligne sans code (« ${l.cellules.map((c) => c.texte).join(' ').slice(0, 80)} ») : non repris.`,
      });
    }
  }

  function affecter(code: string, montants: { c: Cellule; v: number }[]): void {
    const def = CASES_PAR_CODE.get(code);
    const v: ValeurCase = cases[code] ?? {};
    if (def?.colonnes === 2) {
      for (const m of montants) {
        let colonne: 'base' | 'taxe';
        const reference = colonnes ?? deduites;
        if (reference) {
          const centre = (m.c.x0 + m.c.x1) / 2;
          colonne = Math.abs(centre - reference.base) < Math.abs(centre - reference.taxe) ? 'base' : 'taxe';
        } else {
          colonne = montants.length === 2 && m === montants[0] ? 'base' : 'taxe';
          if (montants.length === 1) messages.push({ gravite: 'avertissement', code: 'COLONNE', message: `Case ${code} : en-têtes de colonnes absents, montant affecté à la taxe due.` });
        }
        if (v[colonne] !== undefined) messages.push({ gravite: 'avertissement', code: 'DOUBLON', message: `Case ${code} : deux montants dans la colonne « ${colonne === 'base' ? 'Base hors taxe' : 'Taxe due'} », le dernier est retenu.` });
        v[colonne] = m.v;
      }
    } else {
      if (montants.length > 1) messages.push({ gravite: 'avertissement', code: 'DOUBLON', message: `Case ${code} : ${montants.length} montants lus sur la ligne, le plus à droite est retenu.` });
      const m = montants.reduce((a, b) => (b.c.x1 > a.c.x1 ? b : a));
      v.montant = m.v;
    }
    cases[code] = v;
  }

  if (!identification.siren) messages.push({ gravite: 'avertissement', code: 'SIREN', message: 'SIREN non trouvé dans le cadre « Identification ».' });
  if (!identification.debut || !identification.fin) messages.push({ gravite: 'anomalie', code: 'PERIODE', message: 'Période déclarée non trouvée : à saisir.' });
  if (!identification.millesime) messages.push({ gravite: 'avertissement', code: 'MILLESIME', message: 'Millésime du formulaire non trouvé (mention « applicable à compter du … »).' });
  else if (!(MILLESIMES_CONNUS as readonly string[]).includes(identification.millesime)) {
    messages.push({ gravite: 'avertissement', code: 'MILLESIME', message: `Formulaire du millésime ${identification.millesime}, non référencé dans la table des cases : vérifiez les montants lus.` });
  }
  if (casesInconnues.length) messages.push({ gravite: 'avertissement', code: 'CASE_INCONNUE', message: `Case(s) inconnue(s) de la table : ${casesInconnues.join(', ')} (montants conservés, non contrôlés).` });
  if (Object.keys(cases).length === 0) messages.push({ gravite: 'avertissement', code: 'VIDE', message: 'Aucune case servie lue : déclaration néant ou mise en page non reconnue.' });
  return { identification, cases, casesInconnues, messages, illisible: false };
}
