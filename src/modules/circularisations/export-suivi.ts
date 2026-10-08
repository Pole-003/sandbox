/**
 * Tableau de suivi des circularisations (.xlsx, SPEC 4.4) : un onglet par population, une synthèse
 * en formules vivantes, les décisions manuelles et les paramètres (graine, seuils, empreinte du FEC).
 *
 * Saisie du solde confirmé : montant en valeur absolue + sens D/C (prérempli avec le sens comptable).
 * Écart = solde confirmé signé − solde comptable signé (débit positif) ; écart non justifié = écart − écart justifié.
 */
import type { DataValidation, Workbook, Worksheet } from 'exceljs';
import { dateExcel, euros, FORMAT_DATE, FORMAT_MONTANT, type ExcelJSModule } from '../fec/export/xlsx.ts';
import type { MetadonneesDossierFec } from '../fec/interface-circularisations.ts';
import { seuilEffectif, type ParametresCircularisation, type ParametresPopulation } from './parametres.ts';
import { demandes, type Demande } from './demandes.ts';
import { LIBELLES_MOTIFS, type Selection, type TiersCandidat } from './selection.ts';

export const STATUTS = ['À envoyer', 'Envoyé', 'Relancé', 'Réponse reçue', 'Sans réponse – procédure alternative'];
export const MODES_REPONSE = ['Courrier', 'E-mail', 'Plateforme', 'Aucune'];
export const NATURES_JUSTIFICATION = ['Décalage de règlement', 'Cut-off facturation', 'Litige', 'Erreur du tiers', 'Erreur comptable', 'Autre'];

interface LigneSuivi {
  ref: string;
  population: 'Banque' | 'Client' | 'Fournisseur';
  comptes: string;
  codeTiers: string;
  libelle: string;
  solde: number;
  debit: number;
  credit: number;
  motifs: string;
  methode: string;
}

/** Colonnes du tableau de suivi (lettre, titre, largeur). */
export const COLONNES = [
  ['A', 'Réf.', 9],
  ['B', 'Population', 11],
  ['C', 'Compte(s)', 16],
  ['D', 'Code tiers', 12],
  ['E', 'Tiers / Établissement', 32],
  ['F', 'Solde comptable au {cloture}', 16],
  ['G', 'Sens', 6],
  ['H', 'Mouvements débit exercice', 15],
  ['I', 'Mouvements crédit exercice', 15],
  ['J', 'Motif(s) de sélection', 36],
  ['K', 'Méthode', 11],
  ['L', 'Contact / adresse', 28],
  ['M', 'Date d’envoi', 12],
  ['N', 'Date de relance 1', 12],
  ['O', 'Date de relance 2', 12],
  ['P', 'Date de réponse', 12],
  ['Q', 'Mode de réponse', 12],
  ['R', 'Statut', 22],
  ['S', 'Solde confirmé par le tiers (montant)', 16],
  ['T', 'Sens confirmé', 9],
  ['U', 'Écart', 14],
  ['V', 'Écart justifié', 14],
  ['W', 'Nature de la justification', 22],
  ['X', 'Écart non justifié', 14],
  ['Y', 'Procédure alternative', 32],
  ['Z', 'Réf. feuille de travail', 14],
  ['AA', 'Commentaire', 28],
  ['AB', 'Préparé par', 10],
  ['AC', 'Revu par', 10],
] as const;

const LIGNE_ENTETE = 4;
const PREMIERE = LIGNE_ENTETE + 1;
/** Lignes vides préparées sous les demandes (ajouts en cours de mission). */
const LIGNES_LIBRES = 20;

function liste(valeurs: string[]): string {
  return `"${valeurs.join(',')}"`;
}

function feuillePopulation(wb: Workbook, nom: string, lignes: LigneSuivi[], cloture: string, titre: string): { ws: Worksheet; derniere: number } {
  const ws = wb.addWorksheet(nom);
  ws.getCell('A1').value = titre;
  ws.getCell('A1').font = { bold: true, size: 13 };
  ws.getCell('A2').value = 'Saisir le solde confirmé en valeur absolue et son sens (D/C). Les écarts se calculent seuls ; les écarts non justifiés supérieurs au SAI sont mis en évidence.';
  const entete = ws.getRow(LIGNE_ENTETE);
  COLONNES.forEach(([lettre, t, largeur], i) => {
    const c = entete.getCell(i + 1);
    c.value = t.replace('{cloture}', cloture);
    c.font = { bold: true };
    c.alignment = { wrapText: true, vertical: 'middle' };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i >= 11 ? 'FFFDF1DC' : 'FFE7EEF8' } };
    ws.getColumn(lettre).width = largeur;
  });
  entete.height = 42;
  const derniere = PREMIERE + Math.max(lignes.length + LIGNES_LIBRES, 1) - 1;
  for (let r = PREMIERE; r <= derniere; r++) {
    const l = lignes[r - PREMIERE];
    const row = ws.getRow(r);
    if (l) {
      row.getCell('A').value = l.ref;
      row.getCell('B').value = l.population;
      row.getCell('C').value = l.comptes;
      row.getCell('D').value = l.codeTiers || null;
      row.getCell('E').value = l.libelle;
      row.getCell('F').value = euros(l.solde);
      row.getCell('G').value = l.solde > 0 ? 'D' : l.solde < 0 ? 'C' : '';
      row.getCell('H').value = euros(l.debit);
      row.getCell('I').value = euros(l.credit);
      row.getCell('J').value = l.motifs;
      row.getCell('K').value = l.methode;
      row.getCell('R').value = 'À envoyer';
      row.getCell('T').value = l.solde < 0 ? 'C' : 'D';
    }
    row.getCell('U').value = { formula: `IF(S${r}="","",IF(T${r}="C",-S${r},S${r})-F${r})` };
    row.getCell('X').value = { formula: `IF(U${r}="","",U${r}-N(V${r}))` };
    for (const c of ['F', 'H', 'I', 'S', 'U', 'V', 'X']) row.getCell(c).numFmt = FORMAT_MONTANT;
    for (const c of ['M', 'N', 'O', 'P']) row.getCell(c).numFmt = FORMAT_DATE;
  }
  const plage = (c: string) => `${c}${PREMIERE}:${c}${derniere}`;
  // ExcelJS gère les validations par plage à l'exécution, mais ne les déclare pas dans ses types.
  const validations = (ws as Worksheet & { dataValidations: { add(ref: string, v: DataValidation): void } }).dataValidations;
  validations.add(plage('Q'), { type: 'list', allowBlank: true, formulae: [liste(MODES_REPONSE)] });
  validations.add(plage('R'), { type: 'list', allowBlank: true, formulae: [liste(STATUTS)], showErrorMessage: true, errorTitle: 'Statut', error: 'Choisissez un statut de la liste.' });
  validations.add(plage('T'), { type: 'list', allowBlank: true, formulae: ['"D,C"'] });
  validations.add(plage('W'), { type: 'list', allowBlank: true, formulae: [liste(NATURES_JUSTIFICATION)] });
  for (const c of ['M', 'N', 'O', 'P']) {
    validations.add(plage(c), { type: 'date', operator: 'greaterThan', allowBlank: true, formulae: [new Date(Date.UTC(2000, 0, 1))], showErrorMessage: true, error: 'Date attendue (JJ/MM/AAAA).' });
  }
  ws.addConditionalFormatting({
    ref: plage('X'),
    rules: [
      {
        type: 'expression',
        priority: 1,
        formulae: [`AND(X${PREMIERE}<>"",ABS(X${PREMIERE})>SAI)`],
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFCE8E6' } }, font: { color: { argb: 'FF8C1C13' }, bold: true } },
      },
    ],
  });
  ws.addConditionalFormatting({
    ref: `A${PREMIERE}:AC${derniere}`,
    rules: [
      {
        type: 'expression',
        priority: 2,
        formulae: [`$R${PREMIERE}="${STATUTS[4]}"`],
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFDF1DC' } } },
      },
    ],
  });
  ws.views = [{ state: 'frozen', ySplit: LIGNE_ENTETE, xSplit: 1 }];
  ws.autoFilter = { from: { row: LIGNE_ENTETE, column: 1 }, to: { row: derniere, column: COLONNES.length } };
  return { ws, derniere };
}

function ligneTiers(d: Extract<Demande, { tiers: TiersCandidat }>): LigneSuivi {
  const t = d.tiers;
  return {
    ref: d.ref,
    population: d.population === 'clients' ? 'Client' : 'Fournisseur',
    comptes: t.comptes.join(', '),
    codeTiers: t.compAuxNum ?? '',
    libelle: t.libelle,
    solde: t.solde,
    debit: t.debit,
    credit: t.credit,
    motifs: t.motifs
      .map((m) => `${m} ${LIBELLES_MOTIFS[m]}${m.endsWith('4') && t.rangTirage ? ` (n° ${t.rangTirage})` : ''}${m.endsWith('5') && t.justificationAjout ? ` : ${t.justificationAjout}` : ''}`)
      .join(' ; '),
    methode: t.methode ?? '',
  };
}

const dateFr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export function classeurSuivi(
  ExcelJS: ExcelJSModule,
  selection: Selection,
  parametres: ParametresCircularisation,
  fec: MetadonneesDossierFec,
  version: string,
  selectionLe: Date,
): Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sandbox Pôle 003';
  wb.created = selectionLe;
  const cloture = dateFr(parametres.dateCloture);
  const synthese = wb.addWorksheet('Synthèse');

  const liste = demandes(selection);
  const banques: LigneSuivi[] = liste.banques.flatMap((d) => {
    if (d.population !== 'banques') return [];
    const e = d.etablissement;
    return [
      {
        ref: d.ref,
        population: 'Banque',
        comptes: e.comptes.map((c) => `${c.compteNum}${c.cloture === 0 ? ' (soldé)' : ''}`).join(', '),
        codeTiers: '',
        libelle: e.etablissement,
        solde: e.solde,
        debit: e.debit,
        credit: e.credit,
        motifs: 'Banques : sélection exhaustive (comptes mouvementés dans l’exercice, même soldés)',
        methode: 'Exhaustive',
      },
    ];
  });
  const tiers = (population: 'clients' | 'fournisseurs') => liste[population].flatMap((d) => ('tiers' in d ? [ligneTiers(d)] : []));
  const feuilles = [
    { nom: 'Banques', ...feuillePopulation(wb, 'Banques', banques, cloture, `Banques — ${fec.nomDossier} — clôture ${cloture}`) },
    { nom: 'Clients', ...feuillePopulation(wb, 'Clients', tiers('clients'), cloture, `Clients — ${fec.nomDossier} — clôture ${cloture}`) },
    { nom: 'Fournisseurs', ...feuillePopulation(wb, 'Fournisseurs', tiers('fournisseurs'), cloture, `Fournisseurs — ${fec.nomDossier} — clôture ${cloture}`) },
  ];

  // Décisions manuelles (traçabilité), puis paramètres.
  const decisions = wb.addWorksheet('Décisions manuelles');
  decisions.addRow(['Population', 'Code tiers', 'Décision', 'Justification', 'Date']).font = { bold: true };
  for (const d of parametres.manuels) decisions.addRow([d.population === 'clients' ? 'Clients' : 'Fournisseurs', d.cle, d.action === 'ajout' ? 'Ajout' : 'Exclusion', d.justification, d.le.slice(0, 10)]);
  for (const [c, l] of [
    ['A', 14],
    ['B', 14],
    ['C', 12],
    ['D', 60],
    ['E', 12],
  ] as const)
    decisions.getColumn(c).width = l;

  const param = wb.addWorksheet('Paramètres');
  const critere = (p: ParametresPopulation, cle: 'solde' | 'mouvements') =>
    p[cle].actif ? `${p[cle].mode === 'pct-sp' ? `${p[cle].valeur} % du SP = ` : ''}${seuilEffectif(p[cle], parametres.sp) === null ? 'SP non saisi' : `${(seuilEffectif(p[cle], parametres.sp)! / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €`}` : 'désactivé';
  const lignes: [string, string | number | Date | null][] = [
    ['Dossier', fec.nomDossier],
    ['SIREN', fec.siren ?? '—'],
    ['Date de clôture', dateExcel(parametres.dateCloture)],
    ['Seuil de signification (SS)', parametres.ss === null ? null : euros(parametres.ss)],
    ['Seuil de planification (SP)', parametres.sp === null ? null : euros(parametres.sp)],
    ['Seuil des anomalies insignifiantes (SAI)', parametres.sai === null ? 0 : euros(parametres.sai)],
    ['C1 Solde débiteur ≥', critere(parametres.clients, 'solde')],
    ['C2 Mouvements débiteurs ≥', critere(parametres.clients, 'mouvements')],
    ['C3 Solde anormal', parametres.clients.anormal.actif ? `actif (hors ${parametres.clients.avances.join(', ')})` : 'désactivé'],
    ['C4 Tirages aléatoires', parametres.clients.aleatoire.actif ? parametres.clients.aleatoire.nombre : 'désactivé'],
    ['F1 Solde créditeur ≥', critere(parametres.fournisseurs, 'solde')],
    ['F2 Mouvements créditeurs ≥', critere(parametres.fournisseurs, 'mouvements')],
    ['F3 Solde anormal', parametres.fournisseurs.anormal.actif ? `actif (hors ${parametres.fournisseurs.avances.join(', ')})` : 'désactivé'],
    ['F4 Tirages aléatoires', parametres.fournisseurs.aleatoire.actif ? parametres.fournisseurs.aleatoire.nombre : 'désactivé'],
    ['Préfixes clients (exclus)', `${parametres.clients.prefixes.join(', ')} (${parametres.clients.exclus.join(', ') || 'aucun'})`],
    ['Préfixes fournisseurs (exclus)', `${parametres.fournisseurs.prefixes.join(', ')} (${parametres.fournisseurs.exclus.join(', ') || 'aucun'})`],
    ['Préfixes banques', [...parametres.banques.prefixes, ...(parametres.banques.inclureVmp ? ['50'] : [])].join(', ')],
    ['Graine du tirage aléatoire (mulberry32, tirage uniforme sans remise)', parametres.graine],
    ['Date et heure de la sélection', selectionLe],
    ['Fichier FEC', fec.nomFichier],
    ['Empreinte SHA-256 du FEC', fec.empreinte],
    ['Exercice', `${dateFr(fec.exercice.debut)} – ${dateFr(fec.exercice.fin)}`],
    ['Outil', `Sandbox Pôle 003, version ${version}`],
  ];
  lignes.forEach(([k, v], i) => {
    param.getCell(i + 1, 1).value = k;
    param.getCell(i + 1, 1).font = { bold: true };
    const c = param.getCell(i + 1, 2);
    c.value = v;
    if (v instanceof Date) c.numFmt = k.startsWith('Date et heure') ? 'dd/mm/yyyy hh:mm' : FORMAT_DATE;
    if (k.includes('(S') && typeof v === 'number') c.numFmt = FORMAT_MONTANT;
  });
  param.getColumn(1).width = 58;
  param.getColumn(2).width = 70;
  const ligneSai = lignes.findIndex(([k]) => k.includes('(SAI)')) + 1;
  wb.definedNames.add(`'Paramètres'!$B$${ligneSai}`, 'SAI');

  // Synthèse en formules vivantes.
  synthese.getCell('A1').value = `Synthèse des circularisations — ${fec.nomDossier} — clôture ${cloture}`;
  synthese.getCell('A1').font = { bold: true, size: 13 };
  synthese.getCell('A2').value = `Graine ${parametres.graine} · sélection du ${selectionLe.toLocaleString('fr-FR')}`;
  const titres = ['Population', 'Demandes', 'Réponses reçues', 'Taux de réponse', 'Couverture en valeur des réponses', 'Total des écarts', 'Écarts non justifiés', 'Comparaison au SAI'];
  const entete = synthese.getRow(4);
  titres.forEach((t, i) => {
    entete.getCell(i + 1).value = t;
    entete.getCell(i + 1).font = { bold: true };
    entete.getCell(i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7EEF8' } };
    synthese.getColumn(i + 1).width = i === 0 ? 16 : 18;
  });
  feuilles.forEach((f, k) => {
    const r = 5 + k;
    const p = (c: string) => `'${f.nom}'!$${c}$${PREMIERE}:$${c}$${f.derniere}`;
    const row = synthese.getRow(r);
    row.getCell(1).value = f.nom;
    row.getCell(2).value = { formula: `COUNTA(${p('A')})` };
    row.getCell(3).value = { formula: `COUNTIF(${p('R')},"Réponse reçue")` };
    row.getCell(4).value = { formula: `IF(B${r}=0,"",C${r}/B${r})` };
    row.getCell(5).value = { formula: `IF(SUMPRODUCT(ABS(${p('F')}))=0,"",SUMPRODUCT((${p('R')}="Réponse reçue")*ABS(${p('F')}))/SUMPRODUCT(ABS(${p('F')})))` };
    row.getCell(6).value = { formula: `SUM(${p('U')})` };
    row.getCell(7).value = { formula: `SUM(${p('X')})` };
    row.getCell(8).value = { formula: `IF(ABS(G${r})>SAI,"Supérieur au SAI","Inférieur ou égal au SAI")` };
  });
  const total = synthese.getRow(8);
  total.getCell(1).value = 'Total';
  total.font = { bold: true };
  total.getCell(2).value = { formula: 'SUM(B5:B7)' };
  total.getCell(3).value = { formula: 'SUM(C5:C7)' };
  total.getCell(4).value = { formula: 'IF(B8=0,"",C8/B8)' };
  total.getCell(6).value = { formula: 'SUM(F5:F7)' };
  total.getCell(7).value = { formula: 'SUM(G5:G7)' };
  total.getCell(8).value = { formula: 'IF(ABS(G8)>SAI,"Supérieur au SAI","Inférieur ou égal au SAI")' };
  for (let r = 5; r <= 8; r++) {
    synthese.getCell(r, 4).numFmt = '0.0%';
    synthese.getCell(r, 5).numFmt = '0.0%';
    synthese.getCell(r, 6).numFmt = FORMAT_MONTANT;
    synthese.getCell(r, 7).numFmt = FORMAT_MONTANT;
  }
  synthese.addConditionalFormatting({
    ref: 'H5:H8',
    rules: [{ type: 'containsText', operator: 'containsText', text: 'Supérieur', priority: 1, style: { font: { color: { argb: 'FF8C1C13' }, bold: true } } }],
  });
  return wb;
}
