/**
 * Écriture d'une CA3 fictive au format PDF (pdf-lib, dépendance de développement), en imitant l'impression
 * d'une déclaration depuis l'espace professionnel : page 1 identification, puis une ligne par case
 * (sections A et B), montants alignés à droite, dernière page de mentions. Deux mises en page pour éprouver la lecture :
 *  - variante 1 : code et libellé dans deux éléments de texte, milliers séparés par une espace insécable,
 *    montants sur la première ligne du libellé, en-têtes de colonnes répétés en page 4 ;
 *  - variante 2 : code et libellé dans le même élément, montants découpés en plusieurs éléments (« 120 »
 *    puis « 000 »), montants sur la dernière ligne du libellé, page décalée de 12 points, en-têtes non répétés.
 * Toutes les lignes de la table des cases sont imprimées ; les cases vides n'ont pas de montant.
 */
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import { CASES_CA3, type CaseCa3 } from '../../src/modules/tva/ca3-cases.ts';
import { fr, type Ca3Fictive } from './donnees.ts';

const LARGEUR = 595.28;
const HAUTEUR = 841.89;
const TAILLE = 8.5;
const INTERLIGNE = 11.5;
const DATE_FIXE = new Date(Date.UTC(2026, 9, 8, 12, 0, 0));

interface Contexte {
  doc: PDFDocument;
  police: PDFFont;
  gras: PDFFont;
  d: Ca3Fictive;
  page: PDFPage;
  y: number;
  dx: number;
  numero: number;
}

const milliers = (n: number, sep: string) => {
  const s = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  return n < 0 ? `-${s}` : s;
};

function texte(c: Contexte, t: string, x: number, options: { gras?: boolean; taille?: number } = {}): void {
  c.page.drawText(t, { x: x + c.dx, y: c.y, size: options.taille ?? TAILLE, font: options.gras ? c.gras : c.police, color: rgb(0, 0, 0) });
}

/** Montant aligné à droite sur l'abscisse donnée ; variante 2 : un élément par groupe de milliers. */
function montant(c: Contexte, euros: number, droite: number): void {
  if (c.d.variante === 1) {
    const t = milliers(euros, ' ');
    texte(c, t, droite - c.police.widthOfTextAtSize(t, TAILLE));
    return;
  }
  const groupes = milliers(euros, ' ').split(' ');
  const largeurEspace = c.police.widthOfTextAtSize(' ', TAILLE);
  let x = droite - c.police.widthOfTextAtSize(groupes.join(' '), TAILLE);
  for (const g of groupes) {
    texte(c, g, x);
    x += c.police.widthOfTextAtSize(g, TAILLE) + largeurEspace;
  }
}

function couper(police: PDFFont, t: string, largeur: number): string[] {
  const lignes: string[] = [];
  let courante = '';
  for (const mot of t.split(' ')) {
    const essai = courante ? `${courante} ${mot}` : mot;
    if (police.widthOfTextAtSize(essai, TAILLE) > largeur && courante) {
      lignes.push(courante);
      courante = mot;
    } else courante = essai;
  }
  if (courante) lignes.push(courante);
  return lignes;
}

function nouvellePage(c: Contexte): void {
  c.page = c.doc.addPage([LARGEUR, HAUTEUR]);
  c.numero++;
  c.y = HAUTEUR - 50;
  const sauve = c.y;
  c.y = 30;
  texte(c, `Page ${c.numero}`, 500, { taille: 7 });
  texte(c, `Date de création du document : ${fr(c.d.dateDepot)}`, 40, { taille: 7 });
  c.y = sauve;
}

function enTetesColonnes(c: Contexte): void {
  texte(c, 'Base hors taxe', 395, { gras: true });
  texte(c, 'Taxe due', 505, { gras: true });
  c.y -= INTERLIGNE * 1.4;
}

function titre(c: Contexte, t: string, gras = true): void {
  c.y -= 4;
  texte(c, t, 40, { gras, taille: gras ? 9.5 : TAILLE });
  c.y -= INTERLIGNE * 1.3;
}

/** Ligne d'une case : code, libellé éventuellement sur plusieurs lignes, montants. */
function ligneCase(c: Contexte, def: Pick<CaseCa3, 'code' | 'libelle' | 'colonnes'>, valeurs: { base?: number; taxe?: number; montant?: number } | undefined, deuxColonnes: boolean): void {
  const largeurLibelle = deuxColonnes ? 280 : 360;
  const lignes = couper(c.police, def.libelle, largeurLibelle);
  if (c.y - lignes.length * INTERLIGNE < 50) {
    nouvellePage(c);
    if (deuxColonnes && c.d.variante === 1) enTetesColonnes(c);
  }
  const ligneMontants = c.d.variante === 1 ? 0 : lignes.length - 1;
  lignes.forEach((l, i) => {
    if (i === 0) {
      if (c.d.variante === 1) {
        texte(c, def.code, 40, { gras: true });
        texte(c, l, 70);
      } else texte(c, `${def.code}   ${l}`, 40);
    } else texte(c, l, c.d.variante === 1 ? 70 : 40 + c.police.widthOfTextAtSize(`${def.code}   `, TAILLE));
    if (i === ligneMontants && valeurs) {
      if (def.colonnes === 2) {
        if (valeurs.base !== undefined) montant(c, valeurs.base, 455);
        if (valeurs.taxe !== undefined) montant(c, valeurs.taxe, 555);
      } else if (valeurs.montant !== undefined) montant(c, valeurs.montant, 555);
    }
    c.y -= INTERLIGNE;
  });
  c.y -= 2;
}

function lignesDe(c: Contexte, codes: (code: CaseCa3) => boolean, deuxColonnes: boolean): void {
  for (const def of CASES_CA3.filter(codes)) {
    const valeurs = c.d.cases[def.code];
    const euros = valeurs && { base: valeurs.base, taxe: valeurs.taxe, montant: valeurs.montant };
    ligneCase(c, def, euros, deuxColonnes);
    if (c.d.dontSous?.code === def.code) {
      texte(c, c.d.dontSous.texte, 70);
      montant(c, c.d.dontSous.montant, 555);
      c.y -= INTERLIGNE + 2;
    }
  }
}

export async function pdfCa3(d: Ca3Fictive): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setCreationDate(DATE_FIXE);
  doc.setModificationDate(DATE_FIXE);
  doc.setProducer('scripts/generer-ca3-fictives.ts (données fictives)');
  doc.setCreator('Sandbox Pôle 003');
  doc.setTitle(`CA3 fictive ${d.denomination} ${d.debut}`);
  if (d.scanne) {
    // Image simulée : des rectangles gris, aucun texte.
    for (let p = 0; p < 3; p++) {
      const page = doc.addPage([LARGEUR, HAUTEUR]);
      for (let k = 0; k < 40; k++) page.drawRectangle({ x: 40, y: 780 - k * 18, width: 200 + ((k * 37) % 300), height: 6, color: rgb(0.6, 0.6, 0.6) });
    }
    return doc.save({ useObjectStreams: false });
  }
  const c: Contexte = { doc, police: await doc.embedFont(StandardFonts.Helvetica), gras: await doc.embedFont(StandardFonts.HelveticaBold), d, page: undefined as unknown as PDFPage, y: 0, dx: d.variante === 2 ? 12 : 0, numero: 0 };

  // Page 1 : identification.
  nouvellePage(c);
  titre(c, 'Identification');
  for (const t of [`Dénomination : ${d.denomination}`, `SIREN : ${d.siren}`, 'TVA', `Période déclarée : ${fr(d.debut)} au ${fr(d.fin)}`, `Date limite de dépôt : ${fr(d.dateLimite)}`, `Date de dépôt : ${fr(d.dateDepot)}`, `Date de création du document : ${fr(d.dateDepot)}`]) {
    texte(c, t, 50);
    c.y -= INTERLIGNE * 1.2;
  }
  c.y -= 10;
  texte(c, `Formulaire 3310-CA3 (applicable à compter du 01/01/${d.millesime})`, 40, { gras: true });
  c.y -= INTERLIGNE * 2;
  texte(c, 'Déclaration de taxe sur la valeur ajoutée et taxes assimilées – régime réel normal.', 40);

  // Page 2 : section A, une colonne.
  nouvellePage(c);
  titre(c, 'A - Montant des opérations réalisées');
  titre(c, 'Opérations taxées (HT)', false);
  lignesDe(c, (k) => k.section === 'operations' && /^[AB]/.test(k.code), false);
  titre(c, 'Opérations non taxées', false);
  lignesDe(c, (k) => k.section === 'operations' && /^[EF]/.test(k.code), false);
  for (const s of d.casesSupplementaires ?? []) ligneCase(c, { code: s.code, libelle: s.libelle, colonnes: 1 }, { montant: s.montant }, false);

  // Page 3 : TVA brute, deux colonnes.
  nouvellePage(c);
  titre(c, 'B - Décompte de la TVA à payer');
  texte(c, 'TVA brute', 40, { gras: true });
  enTetesColonnes(c);
  lignesDe(c, (k) => k.section === 'tva-brute', true);

  // Page 4 : TVA déductible, solde, accise, détermination.
  nouvellePage(c);
  if (d.variante === 1) enTetesColonnes(c);
  titre(c, 'TVA déductible');
  lignesDe(c, (k) => k.section === 'tva-deductible', true);
  titre(c, 'TVA due ou crédit de TVA');
  lignesDe(c, (k) => k.section === 'solde', true);
  titre(c, 'Consommateurs d’énergie : régularisation d’accise sur les énergies');
  lignesDe(c, (k) => k.section === 'accise', true);
  titre(c, 'Détermination du montant à payer et/ou des crédits');
  lignesDe(c, (k) => k.section === 'determination', true);

  // Page 5 : mentions (nombres non montants : ligne 27, 3310-CA3G, art 283-2).
  nouvellePage(c);
  for (const t of [
    'Le crédit de la ligne 27 est à reporter ligne 22 de la prochaine déclaration.',
    'Les sociétés membres d’un groupe déclarent sur la 3310-CA3G (art 1693 ter du CGI).',
    'Autoliquidation : voir art 283-2 du code général des impôts.',
    `Numéro de télédéclaration : ${d.debut.replaceAll('-', '')}-${d.siren.slice(-4)}`,
  ]) {
    texte(c, t, 40);
    c.y -= INTERLIGNE * 1.3;
  }
  return doc.save({ useObjectStreams: false });
}
