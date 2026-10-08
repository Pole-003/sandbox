/**
 * CA3 fictive en document Word à tableaux (librairie docx), exporté ensuite en PDF par LibreOffice : un
 * second moteur de rendu réel (polices embarquées par LibreOffice, découpage du texte propre à son export).
 * Libellés coupés automatiquement sur plusieurs lignes, montants alignés à droite, en-têtes de colonnes
 * répétés en haut de chaque page pour les tableaux à deux colonnes.
 */
import { AlignmentType, Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, VerticalAlign, WidthType, BorderStyle } from 'docx';
import { CASES_CA3, type CaseCa3 } from '../../src/modules/tva/ca3-cases.ts';
import { fr, type Ca3Fictive } from './donnees.ts';

const milliers = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const LARGEURS_DEUX = [700, 5600, 1500, 1500];
const LARGEURS_UNE = [700, 7100, 1500];
const sansBordure = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const bordures = { top: sansBordure, left: sansBordure, right: sansBordure, bottom: { style: BorderStyle.SINGLE, size: 2, color: 'BBBBBB' } };

const cellule = (texte: string, largeur: number, options: { droite?: boolean; gras?: boolean } = {}) =>
  new TableCell({
    width: { size: largeur, type: WidthType.DXA },
    borders: bordures,
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({ alignment: options.droite ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [new TextRun({ text: texte, bold: options.gras, size: 18 })] })],
  });

function tableau(d: Ca3Fictive, filtre: (c: CaseCa3) => boolean, deux: boolean): Table {
  const largeurs = deux ? LARGEURS_DEUX : LARGEURS_UNE;
  const lignes: TableRow[] = [];
  if (deux) lignes.push(new TableRow({ tableHeader: true, children: [cellule('', largeurs[0]!), cellule('', largeurs[1]!), cellule('Base hors taxe', largeurs[2]!, { droite: true, gras: true }), cellule('Taxe due', largeurs[3]!, { droite: true, gras: true })] }));
  for (const c of CASES_CA3.filter(filtre)) {
    const v = d.cases[c.code];
    const base = v?.base !== undefined ? milliers(v.base) : '';
    const taxe = c.colonnes === 2 ? (v?.taxe !== undefined ? milliers(v.taxe) : '') : v?.montant !== undefined ? milliers(v.montant) : '';
    lignes.push(new TableRow({ cantSplit: true, children: [cellule(c.code, largeurs[0]!, { gras: true }), cellule(c.libelle, largeurs[1]!), ...(deux ? [cellule(base, largeurs[2]!, { droite: true })] : []), cellule(taxe, largeurs.at(-1)!, { droite: true })] }));
    if (d.dontSous?.code === c.code) {
      lignes.push(new TableRow({ children: [cellule('', largeurs[0]!), cellule(d.dontSous.texte, largeurs[1]!), ...(deux ? [cellule('', largeurs[2]!)] : []), cellule(milliers(d.dontSous.montant), largeurs.at(-1)!, { droite: true })] }));
    }
  }
  return new Table({ columnWidths: largeurs, width: { size: largeurs.reduce((a, b) => a + b, 0), type: WidthType.DXA }, rows: lignes });
}

const titre = (t: string, taille = 22) => new Paragraph({ spacing: { before: 240, after: 120 }, children: [new TextRun({ text: t, bold: true, size: taille })] });
const texte = (t: string) => new Paragraph({ children: [new TextRun({ text: t, size: 18 })] });

export async function docxCa3(d: Ca3Fictive): Promise<Uint8Array> {
  const doc = new Document({
    creator: 'Sandbox Pôle 003 (données fictives)',
    styles: { default: { document: { run: { font: 'Liberation Sans' } } } },
    sections: [
      {
        properties: { page: { margin: { top: 800, bottom: 800, left: 900, right: 900 } } },
        children: [
          titre('Identification', 26),
          texte(`Dénomination : ${d.denomination}`),
          texte(`SIREN : ${d.siren}`),
          texte('TVA'),
          texte(`Période déclarée : ${fr(d.debut)} au ${fr(d.fin)}`),
          texte(`Date limite de dépôt : ${fr(d.dateLimite)}`),
          texte(`Date de dépôt : ${fr(d.dateDepot)}`),
          texte(`Date de création du document : ${fr(d.dateDepot)}`),
          titre(`Formulaire 3310-CA3 (applicable à compter du 01/01/${d.millesime})`),
          new Paragraph({ pageBreakBefore: true, children: [new TextRun({ text: 'A - Montant des opérations réalisées', bold: true, size: 24 })] }),
          titre('Opérations taxées (HT)', 20),
          tableau(d, (c) => c.section === 'operations' && /^[AB]/.test(c.code), false),
          titre('Opérations non taxées', 20),
          tableau(d, (c) => c.section === 'operations' && /^[EF]/.test(c.code), false),
          new Paragraph({ pageBreakBefore: true, children: [new TextRun({ text: 'B - Décompte de la TVA à payer', bold: true, size: 24 })] }),
          titre('TVA brute', 20),
          tableau(d, (c) => c.section === 'tva-brute', true),
          titre('TVA déductible', 20),
          tableau(d, (c) => c.section === 'tva-deductible', true),
          titre('TVA due ou crédit de TVA', 20),
          tableau(d, (c) => c.section === 'solde', true),
          titre('Régularisation d’accise sur les énergies', 20),
          tableau(d, (c) => c.section === 'accise', true),
          titre('Détermination du montant à payer et/ou des crédits', 20),
          tableau(d, (c) => c.section === 'determination', true),
          texte('Le crédit de la ligne 27 est à reporter ligne 22 de la prochaine déclaration (3310-CA3G, art 1693 ter du CGI).'),
        ],
      },
    ],
  });
  return new Uint8Array(await Packer.toArrayBuffer(doc));
}
