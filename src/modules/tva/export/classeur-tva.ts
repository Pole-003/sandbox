/**
 * Feuille de travail Excel du cadrage de TVA (ExcelJS, chargé à la demande), avec formules vivantes :
 *  - « G300 Récap TVA » : récapitulatif des CA3 (cases servies × périodes, totaux en formules, TVA
 *    collectée déclarée = somme des taxes des lignes de taux) ;
 *  - « G340 Contrôle TVA collectée » : en-tête (Entreprise, Exercice, Date, Collaborateur, Chap. G 340),
 *    ventes par compte, synthèse Ventes / TVA / Régularisations / Montant à déclarer par taux, encours N-1
 *    et N par taux (TTC / (1 + taux) × taux), TOTAL, TVA déclarée liée à la feuille G300, ÉCART, tableau de
 *    justification et écart résiduel mis en évidence au-delà du seuil ;
 *  - « Cadrage mensuel » (et contrôles complémentaires), « Anomalies CA3 », « Paramètres ».
 * Montants en euros (numériques), taux en pourcentage ; chaque formule porte aussi son résultat calculé.
 */
import type { Workbook, Worksheet } from 'exceljs';
import { dateExcel, euros, FORMAT_DATE, FORMAT_MONTANT, type ExcelJSModule } from '../../fec/export/xlsx.ts';
import type { MetadonneesDossierFec } from '../../fec/interface-circularisations.ts';
import type { MessageCa3 } from '../ca3/analyse.ts';
import type { CorrectionCa3 } from '../ca3/declaration.ts';
import type { LigneG300 } from '../cadrage/g300.ts';
import type { G340 } from '../cadrage/g340.ts';
import type { ControleComplementaire, LigneMensuelle } from '../cadrage/mensuel.ts';
import { LIBELLES_NATURES, type ParametresCadrage } from '../cadrage/parametres.ts';

export interface DonneesClasseurTva {
  entreprise: string;
  siren: string | null;
  exercice: { debut: string; fin: string };
  periodes: string[];
  g300: LigneG300[];
  g340: G340;
  mensuel: LigneMensuelle[];
  controles: ControleComplementaire[];
  anomalies: { periode: string; message: MessageCa3 }[];
  corrections: { periode: string; correction: CorrectionCa3 }[];
  declarations: { periode: string; source: string; fichier: string | null; empreinte: string | null; millesime: string | null }[];
  parametres: ParametresCadrage;
  fec: MetadonneesDossierFec | null;
  version: string;
  date: Date;
}

const ENTETE = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7EEF8' } } as const;
const TOTAL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F4F7' } } as const;
const FORMAT_TAUX = '0.00%';
const fr = (iso: string) => iso.split('-').reverse().join('/');

function lettre(n: number): string {
  let s = '';
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
  return s;
}

function entete(ws: Worksheet, ligne: number, titres: string[]): void {
  const r = ws.getRow(ligne);
  titres.forEach((t, i) => {
    const c = r.getCell(i + 1);
    c.value = t;
    c.font = { bold: true };
    c.fill = ENTETE;
    c.alignment = { wrapText: true, vertical: 'middle' };
  });
}

const formule = (formula: string, result: number | string | null) => ({ formula, result: result ?? undefined }) as { formula: string; result?: number | string };

// ---- G300 ----------------------------------------------------------------------------------------------
function feuilleG300(wb: Workbook, d: DonneesClasseurTva): { cellule: string } {
  const ws = wb.addWorksheet('G300 Récap TVA');
  ws.getCell('A1').value = `Récapitulatif des déclarations de TVA — ${d.entreprise}`;
  ws.getCell('A1').font = { bold: true, size: 13 };
  ws.getCell('A2').value = `Exercice du ${fr(d.exercice.debut)} au ${fr(d.exercice.fin)}${d.siren ? ` — SIREN ${d.siren}` : ''}`;
  ws.getCell('A3').value = 'Chap. G 300 — montants déclarés (euros), d’après les CA3 lues ou saisies ; corrections tracées dans l’onglet « Anomalies CA3 ».';
  const L = 5;
  const n = d.periodes.length;
  entete(ws, L, ['Case', 'Libellé', ...d.periodes, 'Total']);
  ws.getColumn(1).width = 8;
  ws.getColumn(2).width = 58;
  for (let k = 0; k <= n; k++) {
    ws.getColumn(3 + k).width = 13;
    ws.getColumn(3 + k).numFmt = FORMAT_MONTANT;
  }
  const colTotal = lettre(3 + n);
  let r = L + 1;
  let bloc = '';
  const lignesTaxes: number[] = [];
  let celluleCollectee = '';
  for (const l of d.g300) {
    if (l.bloc !== bloc && l.bloc !== 'collectee') {
      bloc = l.bloc;
      const t = ws.getRow(r++);
      t.getCell(1).value = { operations: 'Opérations réalisées (HT)', taux: 'TVA brute par taux', collectee: '', brute: 'Autres éléments de TVA brute', deductible: 'TVA déductible', solde: 'TVA due, crédit et montant à payer' }[l.bloc];
      t.font = { bold: true, italic: true };
    }
    const row = ws.getRow(r);
    if (l.code === 'COLLECTEE') {
      row.getCell(1).value = '';
      row.getCell(2).value = l.libelle;
      for (let k = 0; k < n; k++) {
        const col = lettre(3 + k);
        row.getCell(3 + k).value = formule(lignesTaxes.length ? lignesTaxes.map((x) => `${col}${x}`).join('+') : '0', euros(l.valeurs[k] ?? 0));
      }
      row.getCell(3 + n).value = formule(`SUM(C${r}:${lettre(2 + n)}${r})`, euros(l.total ?? 0));
      row.font = { bold: true };
      row.eachCell((c) => (c.fill = TOTAL));
      celluleCollectee = `${colTotal}${r}`;
    } else {
      row.getCell(1).value = l.code;
      row.getCell(2).value = l.libelle;
      l.valeurs.forEach((v, k) => {
        if (v !== null) row.getCell(3 + k).value = l.colonne && l.code === '22A' ? v / 10000 : euros(v);
      });
      if (l.code === '22A') for (let k = 0; k < n; k++) row.getCell(3 + k).numFmt = FORMAT_TAUX;
      if (l.total !== null) row.getCell(3 + n).value = formule(`SUM(C${r}:${lettre(2 + n)}${r})`, euros(l.total));
      if (l.bloc === 'taux' && l.colonne === 'taxe') lignesTaxes.push(r);
    }
    r++;
  }
  ws.views = [{ state: 'frozen', ySplit: L, xSplit: 2 }];
  wb.definedNames.add(`'G300 Récap TVA'!$${colTotal}$${celluleCollectee.slice(colTotal.length)}`, 'TVA_DECLAREE');
  return { cellule: celluleCollectee };
}

// ---- G340 ----------------------------------------------------------------------------------------------
function feuilleG340(wb: Workbook, d: DonneesClasseurTva, collectee: string): void {
  const ws = wb.addWorksheet('G340 Contrôle TVA collectée');
  const g = d.g340;
  const p = d.parametres;
  [
    ['Entreprise', d.entreprise],
    ['Exercice', `du ${fr(d.exercice.debut)} au ${fr(d.exercice.fin)}`],
    ['Date', d.date],
    ['Collaborateur', p.collaborateur],
    ['Chap.', 'G 340'],
  ].forEach(([k, v], i) => {
    ws.getCell(i + 1, 1).value = k as string;
    ws.getCell(i + 1, 1).font = { bold: true };
    ws.getCell(i + 1, 2).value = v as string | Date;
    if (v instanceof Date) ws.getCell(i + 1, 2).numFmt = FORMAT_DATE;
  });
  ws.getCell('D1').value = 'Contrôle de la TVA collectée';
  ws.getCell('D1').font = { bold: true, size: 14 };
  ws.getCell('D2').value = `Régime : ${p.regime === 'encaissements' ? 'encaissements' : p.regime === 'debits' ? 'débits' : 'mixte'} ; ${g.ventilation.description}`;
  const largeurs = [14, 40, 15, 15, 11, 15, 9, 15, 10, 14];
  largeurs.forEach((w, i) => (ws.getColumn(i + 1).width = w));

  // Ventes par compte.
  let r = 8;
  ws.getCell(`A${r - 1}`).value = 'Ventes';
  ws.getCell(`A${r - 1}`).font = { bold: true };
  entete(ws, r, ['N° de compte', 'Libellé', 'CA HT', 'CA exonéré', '% du CA soumis', 'CA imposable', 'Taux', 'Montant de TVA', 'Case CA3', 'Taux proposé']);
  const premiereVente = r + 1;
  for (const l of g.lignes) {
    r++;
    const row = ws.getRow(r);
    row.getCell(1).value = l.compteNum;
    row.getCell(2).value = l.nature === 'imposable' ? l.compteLib : `${l.compteLib} (${LIBELLES_NATURES[l.nature]})`;
    row.getCell(3).value = euros(l.ca);
    row.getCell(4).value = euros(l.exonere);
    row.getCell(5).value = formule(`IF(C${r}=0,"",F${r}/C${r})`, l.pctSoumis ?? '');
    row.getCell(6).value = formule(`C${r}-D${r}`, euros(l.ca - l.exonere));
    row.getCell(7).value = l.taux ? l.taux / 10000 : 0;
    row.getCell(8).value = formule(`ROUND(F${r}*G${r},2)`, euros(l.tva));
    row.getCell(9).value = l.caseCa3 ?? '';
    row.getCell(10).value = { observe: 'observé', libelle: 'libellé', saisie: 'saisi', 'a-saisir': 'à saisir' }[l.source];
  }
  const derniereVente = r;
  r++;
  const totalVentes = r;
  const rowT = ws.getRow(r);
  rowT.getCell(1).value = 'Total';
  for (const col of ['C', 'D', 'F', 'H']) rowT.getCell(col).value = formule(`SUM(${col}${premiereVente}:${col}${derniereVente})`, null);
  rowT.getCell('C').value = formule(`SUM(C${premiereVente}:C${derniereVente})`, euros(g.caTotal));
  rowT.getCell('F').value = formule(`SUM(F${premiereVente}:F${derniereVente})`, euros(g.caImposable));
  rowT.getCell('H').value = formule(`SUM(H${premiereVente}:H${derniereVente})`, euros(g.tvaSurCa));
  rowT.font = { bold: true };
  rowT.eachCell((c) => (c.fill = TOTAL));
  for (let i = premiereVente; i <= totalVentes; i++) {
    for (const col of ['C', 'D', 'F', 'H']) ws.getCell(`${col}${i}`).numFmt = FORMAT_MONTANT;
    ws.getCell(`E${i}`).numFmt = '0.0%';
    ws.getCell(`G${i}`).numFmt = FORMAT_TAUX;
  }

  // Régularisations : encours N-1 et N par taux.
  r += 2;
  ws.getCell(`A${r}`).value = p.regime === 'debits' ? 'Régularisations (régime des débits : pas de régularisation des encours)' : 'Régularisations (régime des encaissements)';
  ws.getCell(`A${r}`).font = { bold: true };
  r++;
  entete(ws, r, ['Nature', 'Comptes', 'Taux', 'Montant N-1', 'Montant N', 'Base', 'TVA N-1', 'TVA N', 'Régularisation', 'Source N-1']);
  const premiereRegul = r + 1;
  for (const reg of g.regularisations) {
    for (const x of reg.parTaux) {
      r++;
      const row = ws.getRow(r);
      const ttc = reg.cle !== 'pca' && reg.cle !== 'pertes' && reg.cle !== 'autoliquidation';
      row.getCell(1).value = reg.libelle;
      row.getCell(2).value = reg.comptes.join(', ');
      row.getCell(3).value = x.taux / 10000;
      row.getCell(4).value = euros(x.n1);
      row.getCell(5).value = euros(x.n);
      row.getCell(6).value = reg.cle === 'autoliquidation' ? 'TVA' : ttc ? 'TTC' : 'HT';
      if (reg.cle === 'autoliquidation') {
        row.getCell(7).value = 0;
        row.getCell(8).value = formule(`E${r}`, euros(x.tvaN));
        row.getCell(9).value = formule(`H${r}`, euros(x.tvaN));
      } else {
        const tva = (col: string) => (ttc ? `ROUND(${col}${r}*C${r}/(1+C${r}),2)` : `ROUND(${col}${r}*C${r},2)`);
        row.getCell(7).value = formule(tva('D'), euros(x.tvaN1));
        row.getCell(8).value = formule(tva('E'), euros(x.tvaN));
        row.getCell(9).value = reg.cle === 'pertes' ? formule(`-H${r}`, euros(-x.tvaN)) : formule(`G${r}-H${r}`, euros(x.tvaN1 - x.tvaN));
      }
      row.getCell(10).value = reg.sourceN1 === 'an' ? 'à-nouveaux' : reg.sourceN1 === 'fec-n1' ? 'FEC N-1' : reg.sourceN1 === 'saisie' ? 'saisi' : '';
      ws.getCell(`C${r}`).numFmt = FORMAT_TAUX;
      for (const col of ['D', 'E', 'G', 'H', 'I']) ws.getCell(`${col}${r}`).numFmt = FORMAT_MONTANT;
    }
  }
  const derniereRegul = Math.max(r, premiereRegul);
  r++;
  const totalRegul = r;
  ws.getCell(`A${r}`).value = 'Total des régularisations';
  ws.getCell(`I${r}`).value = formule(g.regularisations.length ? `SUM(I${premiereRegul}:I${derniereRegul})` : '0', euros(g.totalRegularisations));
  ws.getCell(`I${r}`).numFmt = FORMAT_MONTANT;
  ws.getRow(r).font = { bold: true };

  // Synthèse par taux : Ventes / TVA / Régularisations / Montant à déclarer, rapprochée de la CA3.
  r += 2;
  ws.getCell(`A${r}`).value = 'Synthèse par taux';
  ws.getCell(`A${r}`).font = { bold: true };
  r++;
  entete(ws, r, ['Taux', 'Nature', 'Ventes', 'TVA', 'Régularisations', 'Montant à déclarer', 'Case CA3', 'Base déclarée', 'Taxe déclarée', 'Écart taxe']);
  for (const s of g.syntheseParTaux) {
    r++;
    const row = ws.getRow(r);
    const t = s.taux ?? 0;
    row.getCell(1).value = t / 10000;
    row.getCell(2).value = LIBELLES_NATURES[s.nature];
    // Ventes imposables : CA imposable des comptes au même taux ; non imposables : CA des comptes de la même case.
    const ventes = s.nature === 'imposable' ? `SUMIFS(F${premiereVente}:F${derniereVente},G${premiereVente}:G${derniereVente},A${r})` : `SUMIFS(C${premiereVente}:C${derniereVente},I${premiereVente}:I${derniereVente},G${r})`;
    row.getCell(3).value = formule(ventes, euros(s.ventes));
    row.getCell(4).value = formule(s.nature === 'imposable' ? `SUMIFS(H${premiereVente}:H${derniereVente},G${premiereVente}:G${derniereVente},A${r})` : '0', euros(s.tvaVentes));
    row.getCell(5).value = formule(s.nature === 'imposable' && g.regularisations.length ? `SUMIFS(I${premiereRegul}:I${derniereRegul},C${premiereRegul}:C${derniereRegul},A${r})` : '0', euros(s.regularisations));
    row.getCell(6).value = formule(`D${r}+E${r}`, euros(s.aDeclarer));
    row.getCell(7).value = s.caseCa3 ?? '';
    if (s.baseDeclaree !== null) row.getCell(8).value = euros(s.baseDeclaree);
    if (s.taxeDeclaree !== null) {
      row.getCell(9).value = euros(s.taxeDeclaree);
      row.getCell(10).value = formule(`F${r}-I${r}`, euros(s.aDeclarer - s.taxeDeclaree));
    }
    ws.getCell(`A${r}`).numFmt = FORMAT_TAUX;
    for (const col of ['C', 'D', 'E', 'F', 'H', 'I', 'J']) ws.getCell(`${col}${r}`).numFmt = FORMAT_MONTANT;
  }

  // Total, TVA déclarée (feuille G300), écart, seuil.
  r += 2;
  const ligneTotal = r;
  const resume: [string, ReturnType<typeof formule> | number, number][] = [
    ['TOTAL TVA collectée théorique', formule(`H${totalVentes}+I${totalRegul}`, euros(g.tvaTheorique)), g.tvaTheorique],
    ['TVA collectée déclarée (G300)', formule(`'G300 Récap TVA'!${collectee}`, euros(g.tvaDeclaree)), g.tvaDeclaree],
    ['ÉCART (théorique − déclarée)', formule(`H${ligneTotal}-H${ligneTotal + 1}`, euros(g.ecart)), g.ecart],
    ['Seuil d’écart acceptable', euros(p.seuil), p.seuil],
  ];
  resume.forEach(([libelle, v], i) => {
    ws.getCell(`F${r + i}`).value = libelle;
    ws.getCell(`F${r + i}`).font = { bold: true };
    ws.getCell(`H${r + i}`).value = v as never;
    ws.getCell(`H${r + i}`).numFmt = FORMAT_MONTANT;
    ws.getCell(`H${r + i}`).font = { bold: true };
  });
  const ligneEcart = r + 2;
  const ligneSeuil = r + 3;
  wb.definedNames.add(`'G340 Contrôle TVA collectée'!$H$${ligneTotal}`, 'TVA_THEORIQUE');
  wb.definedNames.add(`'G340 Contrôle TVA collectée'!$H$${ligneSeuil}`, 'SEUIL_TVA');

  // Justification de l'écart.
  r += 6;
  ws.getCell(`A${r}`).value = 'Justification de l’écart';
  ws.getCell(`A${r}`).font = { bold: true };
  r++;
  entete(ws, r, ['Libellé', '', 'Montant', 'Commentaire', '', '', '', 'Référence de pièce']);
  ws.mergeCells(`A${r}:B${r}`);
  const premiereJ = r + 1;
  const lignesJ = Math.max(d.parametres.justifications.length, 0) + 6;
  for (let k = 0; k < lignesJ; k++) {
    r++;
    const j = d.parametres.justifications[k];
    ws.mergeCells(`A${r}:B${r}`);
    ws.mergeCells(`D${r}:G${r}`);
    if (j) {
      ws.getCell(`A${r}`).value = j.libelle;
      ws.getCell(`C${r}`).value = euros(j.montant);
      ws.getCell(`D${r}`).value = j.commentaire;
      ws.getCell(`H${r}`).value = j.piece;
    }
    ws.getCell(`C${r}`).numFmt = FORMAT_MONTANT;
  }
  r++;
  ws.getCell(`A${r}`).value = 'Total justifié';
  ws.getCell(`C${r}`).value = formule(`SUM(C${premiereJ}:C${r - 1})`, euros(g.justifie));
  ws.getCell(`C${r}`).numFmt = FORMAT_MONTANT;
  ws.getRow(r).font = { bold: true };
  r++;
  ws.getCell(`A${r}`).value = 'Écart résiduel non justifié';
  ws.getCell(`C${r}`).value = formule(`H${ligneEcart}-C${r - 1}`, euros(g.residuel));
  ws.getCell(`C${r}`).numFmt = FORMAT_MONTANT;
  ws.getCell(`D${r}`).value = formule(`IF(ABS(C${r})>H${ligneSeuil},"Supérieur au seuil","Inférieur ou égal au seuil")`, g.depasseSeuil ? 'Supérieur au seuil' : 'Inférieur ou égal au seuil');
  ws.getRow(r).font = { bold: true };
  ws.addConditionalFormatting({
    ref: `A${r}:D${r}`,
    rules: [{ type: 'expression', priority: 1, formulae: [`ABS($C$${r})>$H$${ligneSeuil}`], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFCE8E6' } }, font: { color: { argb: 'FF8C1C13' }, bold: true } } }],
  });
  wb.definedNames.add(`'G340 Contrôle TVA collectée'!$C$${r}`, 'ECART_RESIDUEL');
  ws.views = [{ state: 'frozen', ySplit: 0 }];
}

// ---- Cadrage mensuel -----------------------------------------------------------------------------------
function feuilleMensuelle(wb: Workbook, d: DonneesClasseurTva): void {
  const ws = wb.addWorksheet('Cadrage mensuel');
  ws.getCell('A1').value = `Cadrage par période — ${d.entreprise}`;
  ws.getCell('A1').font = { bold: true, size: 13 };
  ws.getCell('A2').value = 'La CA3 d’une période, déposée le mois suivant, est rapprochée des écritures de la période (date de dépôt indiquée).';
  entete(ws, 4, ['Période', 'Date de dépôt', 'TVA collectée déclarée', 'TVA au crédit des 4457', 'TVA autoliquidée (4452)', 'Écart TVA', 'CA déclaré', 'CA comptabilisé', 'Écart CA']);
  [14, 12, 16, 16, 16, 14, 16, 16, 14].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  let r = 4;
  for (const m of d.mensuel) {
    r++;
    const row = ws.getRow(r);
    row.getCell(1).value = m.periode;
    if (m.dateDepot) {
      row.getCell(2).value = dateExcel(m.dateDepot);
      row.getCell(2).numFmt = FORMAT_DATE;
    }
    if (m.tvaDeclaree !== null) row.getCell(3).value = euros(m.tvaDeclaree);
    row.getCell(4).value = euros(m.tva4457);
    row.getCell(5).value = euros(m.tvaAutoliquidee);
    if (m.ecartTva !== null) row.getCell(6).value = formule(`C${r}-D${r}-E${r}`, euros(m.ecartTva));
    if (m.caDeclare !== null) row.getCell(7).value = euros(m.caDeclare);
    row.getCell(8).value = euros(m.caComptabilise);
    if (m.ecartCa !== null) row.getCell(9).value = formule(`G${r}-H${r}`, euros(m.ecartCa));
  }
  r++;
  const tot = ws.getRow(r);
  tot.getCell(1).value = 'Total';
  for (const col of ['C', 'D', 'E', 'F', 'G', 'H', 'I']) tot.getCell(col).value = formule(`SUM(${col}5:${col}${r - 1})`, null);
  tot.font = { bold: true };
  tot.eachCell((c) => (c.fill = TOTAL));
  for (let i = 5; i <= r; i++) for (const col of ['C', 'D', 'E', 'F', 'G', 'H', 'I']) ws.getCell(`${col}${i}`).numFmt = FORMAT_MONTANT;
  ws.addConditionalFormatting({
    ref: `F5:F${r - 1}`,
    rules: [{ type: 'expression', priority: 1, formulae: ['AND(F5<>"",ABS(F5)>=1)'], style: { font: { color: { argb: 'FF8C1C13' }, bold: true } } }],
  });

  r += 2;
  ws.getCell(`A${r}`).value = 'Contrôles complémentaires';
  ws.getCell(`A${r}`).font = { bold: true };
  r++;
  entete(ws, r, ['Contrôle', '', '', 'Comptabilité', 'Déclaration', 'Écart', 'Explication']);
  for (const c of d.controles) {
    r++;
    ws.mergeCells(`A${r}:C${r}`);
    ws.getCell(`A${r}`).value = c.libelle;
    ws.getCell(`A${r}`).alignment = { wrapText: true };
    ws.getCell(`D${r}`).value = euros(c.comptable);
    if (c.declare !== null) {
      ws.getCell(`E${r}`).value = euros(c.declare);
      ws.getCell(`F${r}`).value = formule(`D${r}-E${r}`, euros(c.ecart ?? 0));
    }
    ws.getCell(`G${r}`).value = c.explication;
    for (const col of ['D', 'E', 'F']) ws.getCell(`${col}${r}`).numFmt = FORMAT_MONTANT;
    ws.getRow(r).height = 30;
  }
  ws.views = [{ state: 'frozen', ySplit: 4 }];
}

function feuilleAnomalies(wb: Workbook, d: DonneesClasseurTva): void {
  const ws = wb.addWorksheet('Anomalies CA3');
  entete(ws, 1, ['Période', 'Gravité', 'Contrôle', 'Message']);
  [16, 14, 16, 110].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  d.anomalies.forEach((a, i) => {
    const row = ws.getRow(i + 2);
    row.values = [a.periode, { anomalie: 'Anomalie', avertissement: 'Avertissement', information: 'Information' }[a.message.gravite], a.message.code, a.message.message];
  });
  let r = d.anomalies.length + 4;
  ws.getCell(`A${r}`).value = 'Corrections tracées';
  ws.getCell(`A${r}`).font = { bold: true };
  r++;
  entete(ws, r, ['Période', 'Case', 'Colonne', 'Valeur lue ou précédente', 'Nouvelle valeur', 'Date', 'Motif']);
  for (const { periode, correction: c } of d.corrections) {
    r++;
    ws.getRow(r).values = [periode, c.code, c.colonne === 'base' ? 'Base hors taxe' : c.colonne === 'taxe' ? 'Taxe due' : 'Montant', c.avant === null ? 'vide' : euros(c.avant), c.apres === null ? 'vide' : euros(c.apres), new Date(c.le), c.motif];
    ws.getCell(`F${r}`).numFmt = 'dd/mm/yyyy hh:mm';
  }
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

function feuilleParametres(wb: Workbook, d: DonneesClasseurTva): void {
  const ws = wb.addWorksheet('Paramètres');
  const p = d.parametres;
  const lignes: [string, string | number | Date][] = [
    ['Entreprise', d.entreprise],
    ['SIREN', d.siren ?? '—'],
    ['Exercice', `du ${fr(d.exercice.debut)} au ${fr(d.exercice.fin)}`],
    ['Régime d’exigibilité', p.regime === 'encaissements' ? 'Encaissements' : p.regime === 'debits' ? 'Débits' : 'Mixte (par compte)'],
    ['Seuil d’écart acceptable (€)', euros(p.seuil)],
    ['Méthode de ventilation des encours', d.g340.ventilation.description],
    ['Comptes de produits retenus', p.prefixesProduits.join(', ')],
    ['Comptes de TVA collectée observés', p.prefixesTva.join(', ')],
    ...Object.entries(p.prefixesEncours).map(([k, v]) => [`Comptes d’encours : ${k}`, v.join(', ')] as [string, string]),
    ['Pertes sur créances irrécouvrables', p.prefixesPertes.join(', ')],
    ['TVA autoliquidée sur achats', p.prefixesAutoliquidation.join(', ')],
    ['Fichier FEC', d.fec?.nomFichier ?? '—'],
    ['Empreinte SHA-256 du FEC', d.fec?.empreinte ?? '—'],
    ['Date et heure de l’export', d.date],
    ['Outil', `Sandbox Pôle 003, version ${d.version}`],
  ];
  lignes.forEach(([k, v], i) => {
    ws.getCell(i + 1, 1).value = k;
    ws.getCell(i + 1, 1).font = { bold: true };
    ws.getCell(i + 1, 2).value = v;
    if (v instanceof Date) ws.getCell(i + 1, 2).numFmt = 'dd/mm/yyyy hh:mm';
  });
  let r = lignes.length + 2;
  entete(ws, r, ['Déclaration', 'Source', 'Fichier', 'Millésime', 'Empreinte SHA-256 du PDF']);
  for (const x of d.declarations) {
    r++;
    ws.getRow(r).values = [x.periode, x.source, x.fichier ?? '—', x.millesime ?? '—', x.empreinte ?? '—'];
  }
  ws.getColumn(1).width = 40;
  ws.getColumn(2).width = 60;
  ws.getColumn(3).width = 36;
  ws.getColumn(5).width = 70;
}

export function classeurCadrageTva(ExcelJS: ExcelJSModule, d: DonneesClasseurTva): Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sandbox Pôle 003';
  wb.created = d.date;
  // Recalcul complet à l'ouverture : les résultats écrits avec les formules ne servent qu'à l'aperçu.
  wb.calcProperties = { ...wb.calcProperties, fullCalcOnLoad: true };
  const { cellule } = feuilleG300(wb, d);
  feuilleG340(wb, d, cellule);
  feuilleMensuelle(wb, d);
  feuilleAnomalies(wb, d);
  feuilleParametres(wb, d);
  // Impression : paysage, une page de large.
  for (const ws of wb.worksheets) ws.pageSetup = { ...ws.pageSetup, orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return wb;
}
