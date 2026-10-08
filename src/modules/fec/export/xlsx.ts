/**
 * Outils communs aux exports Excel (ExcelJS, chargé à la demande) : feuilles avec en-têtes figés et
 * filtres, montants numériques au format français, onglet « Paramètres », tableaux croisés dynamiques.
 */
import type { Workbook, Worksheet } from 'exceljs';
import { integrerTcd, tcdDeclares } from './tcd.ts';

export type ExcelJSModule = typeof import('exceljs');

/** ExcelJS n'est chargé qu'au premier export (environ 1 Mo). */
export async function chargerExcelJS(): Promise<ExcelJSModule> {
  const m = (await import('exceljs')) as unknown as ExcelJSModule & { default?: ExcelJSModule };
  return m.default ?? m;
}

/** Format numérique : Excel affiche les séparateurs selon la langue du poste (« 1 234,56 » en français). */
export const FORMAT_MONTANT = '#,##0.00;[Red]-#,##0.00';
export const FORMAT_DATE = 'dd/mm/yyyy';
export const FORMAT_ENTIER = '#,##0';

export interface ColonneXlsx<T> {
  titre: string;
  largeur?: number;
  type?: 'texte' | 'montant' | 'date' | 'entier' | 'pourcentage';
  valeur: (ligne: T) => string | number | Date | null;
}

/** Centimes → nombre en euros (deux décimales exactes). */
export function euros(centimes: number): number {
  return Math.round(centimes) / 100;
}

/** Date AAAAMMJJ ou ISO → Date (minuit UTC, lue telle quelle par Excel). */
export function dateExcel(valeur: number | string): Date | null {
  const s = String(valeur).replaceAll('-', '');
  if (!/^\d{8}$/.test(s) || s === '00000000') return null;
  return new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8))));
}

/** Nom d'onglet valide (31 caractères, sans : \ / ? * [ ]). */
export function nomOnglet(nom: string, existants: Set<string>): string {
  let base = nom.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31);
  let n = 2;
  let candidat = base;
  while (existants.has(candidat.toLowerCase())) {
    const suffixe = ` (${n++})`;
    candidat = base.slice(0, 31 - suffixe.length) + suffixe;
  }
  existants.add(candidat.toLowerCase());
  base = candidat;
  return base;
}

/** Feuille tabulaire : en-tête en gras, figé, filtres automatiques, formats par type de colonne. */
export function feuilleTableau<T>(
  classeur: Workbook,
  nom: string,
  colonnes: ColonneXlsx<T>[],
  lignes: Iterable<T>,
  options: { titre?: string[] } = {},
): Worksheet {
  const ws = classeur.addWorksheet(nom);
  const decalage = options.titre ? options.titre.length + 1 : 0;
  options.titre?.forEach((t, i) => {
    const c = ws.getCell(i + 1, 1);
    c.value = t;
    if (i === 0) c.font = { bold: true, size: 13 };
  });
  const entete = ws.getRow(decalage + 1);
  colonnes.forEach((col, i) => {
    const c = entete.getCell(i + 1);
    c.value = col.titre;
    c.font = { bold: true };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7EEF8' } };
    c.alignment = { vertical: 'middle', wrapText: true };
    const colonne = ws.getColumn(i + 1);
    colonne.width = col.largeur ?? (col.type === 'montant' ? 15 : col.type === 'date' ? 12 : 18);
    if (col.type === 'montant') colonne.numFmt = FORMAT_MONTANT;
    else if (col.type === 'date') colonne.numFmt = FORMAT_DATE;
    else if (col.type === 'entier') colonne.numFmt = FORMAT_ENTIER;
    else if (col.type === 'pourcentage') colonne.numFmt = '0.0%';
  });
  let r = decalage + 2;
  for (const ligne of lignes) {
    const row = ws.getRow(r++);
    colonnes.forEach((col, i) => {
      const v = col.valeur(ligne);
      if (v !== null && v !== '') row.getCell(i + 1).value = v;
    });
  }
  ws.views = [{ state: 'frozen', ySplit: decalage + 1 }];
  ws.autoFilter = { from: { row: decalage + 1, column: 1 }, to: { row: Math.max(decalage + 1, r - 1), column: colonnes.length } };
  return ws;
}

export interface Parametres {
  dossier: string;
  siren: string | null;
  exercice: string;
  fichier: string;
  empreinte: string;
  version: string;
}

export function feuilleParametres(classeur: Workbook, p: Parametres, autres: [string, string][] = []): Worksheet {
  const ws = classeur.addWorksheet('Paramètres');
  const lignes: [string, string | Date][] = [
    ['Dossier', p.dossier],
    ['SIREN', p.siren ?? '—'],
    ['Exercice', p.exercice],
    ['Fichier FEC', p.fichier],
    ['Empreinte SHA-256 du FEC', p.empreinte],
    ['Date d’export', new Date()],
    ['Outil', `Sandbox Pôle 003, version ${p.version}`],
    ...autres,
  ];
  lignes.forEach(([k, v], i) => {
    ws.getCell(i + 1, 1).value = k;
    ws.getCell(i + 1, 1).font = { bold: true };
    const c = ws.getCell(i + 1, 2);
    c.value = v;
    if (v instanceof Date) c.numFmt = 'dd/mm/yyyy hh:mm';
  });
  ws.getColumn(1).width = 28;
  ws.getColumn(2).width = 70;
  return ws;
}

/** Classeur → octets .xlsx (avec les tableaux croisés dynamiques déclarés par ajouterTcd). */
export async function octetsClasseur(classeur: Workbook): Promise<Uint8Array> {
  const octets = new Uint8Array(await classeur.xlsx.writeBuffer());
  const tcd = tcdDeclares(classeur);
  if (tcd.length === 0) return octets;
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(octets);
  await integrerTcd(zip, tcd);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
