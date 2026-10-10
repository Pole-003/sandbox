/**
 * Exports .xlsx des analyses : balance générale (avec comparaison N-1), balances auxiliaires et âgées,
 * grand-livre filtré, statistiques. Montants numériques en euros, formats français, en-têtes figés,
 * filtres, totaux par formule SOUS.TOTAL (insensibles aux filtres), onglet « Paramètres ».
 */
import { rubriqueSig, type ChiffresCles, type LigneSig } from '../analyses/chiffres-cles.ts';
import type { Workbook, Worksheet } from 'exceljs';
import type { BalanceAuxiliaire, LigneAuxiliaire } from '../analyses/auxiliaire.ts';
import { TRANCHES } from '../analyses/auxiliaire.ts';
import { LIBELLES_CLASSES, type Balance, type LigneBalance, type LigneComparaison } from '../analyses/balance.ts';
import { type ContexteAnalyse, t } from '../analyses/contexte.ts';
import type { GrandLivre } from '../analyses/grand-livre.ts';
import { lignesEcriture } from '../analyses/grand-livre.ts';
import type { Statistiques } from '../analyses/statistiques.ts';
import { LIBELLES_SECTIONS, LIGNES_TFT, presentationTft, type Tft } from '../analyses/tft.ts';
import { ajouterTcd, type ChampTcd } from './tcd.ts';
import { dateExcel, euros, FORMAT_MONTANT, feuilleParametres, feuilleTableau, nomOnglet, type ColonneXlsx, type ExcelJSModule, type Parametres } from './xlsx.ts';

/** Au-delà, l'export du grand-livre est tronqué (limite pratique d'un classeur généré dans le navigateur). */
export const LIGNES_MAX_EXPORT = 200_000;

function lettre(colonne: number): string {
  let s = '';
  for (let n = colonne; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Ligne de total en SOUS.TOTAL(9 ; …) sous un tableau créé par feuilleTableau. */
function ligneTotal(ws: Worksheet, premiere: number, derniere: number, colonnesSommees: number[], libelle = 'Total'): void {
  const r = ws.getRow(derniere + 1);
  r.getCell(1).value = libelle;
  r.font = { bold: true };
  for (const c of colonnesSommees) {
    const l = lettre(c);
    // ARRONDI : la somme de montants décimaux laisse un résidu (−5,8E-11) que le format afficherait « -0,00 » en rouge.
    r.getCell(c).value = { formula: `ROUND(SUBTOTAL(9,${l}${premiere}:${l}${derniere}),2)` };
    r.getCell(c).numFmt = ws.getColumn(c).numFmt ?? "";
  }
}

function nouveauClasseur(ExcelJS: ExcelJSModule): Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sandbox Pôle 003';
  wb.created = new Date();
  return wb;
}

const colonnesSoldes = <T extends { ouverture: number; debit: number; credit: number; cloture: number }>(): ColonneXlsx<T>[] => [
  { titre: 'Solde d’ouverture', type: 'montant', valeur: (l) => euros(l.ouverture) },
  { titre: 'Mouvements débit', type: 'montant', valeur: (l) => euros(l.debit) },
  { titre: 'Mouvements crédit', type: 'montant', valeur: (l) => euros(l.credit) },
  { titre: 'Solde de clôture', type: 'montant', valeur: (l) => euros(l.cloture) },
  { titre: 'Sens', largeur: 6, valeur: (l) => (l.cloture > 0 ? 'D' : l.cloture < 0 ? 'C' : '') },
];

const CHAMPS_SOLDES: ChampTcd[] = [
  { nom: 'Solde d’ouverture', type: 'montant' },
  { nom: 'Mouvements débit', type: 'montant' },
  { nom: 'Mouvements crédit', type: 'montant' },
  { nom: 'Solde de clôture', type: 'montant' },
];
const soldes = (l: { ouverture: number; debit: number; credit: number; cloture: number }) => [l.ouverture, l.debit, l.credit, l.cloture];
const NOTE_TCD = 'Tableau croisé dynamique (actualisé à l’ouverture dans Excel) ; données sources dans l’onglet voisin. Développez ou réduisez les niveaux avec les boutons + / −.';

/** TCD de la balance : classe → sous-classe → compte ; soldes et mouvements (et N-1 si disponible). */
function tcdBalance(wb: Workbook, balance: Balance, comparaison: LigneComparaison[] | null, parametres: Parametres): void {
  const sousClasses = new Map(balance.classes.flatMap((c) => c.sousGroupes.map((g) => [g.code, g.libelle] as const)));
  const libelleClasse = (c: string) => `${c} – ${LIBELLES_CLASSES[c] ?? 'Comptes non codifiés'}`;
  const libelleSousClasse = (s: string) => `${s} – ${sousClasses.get(s) ?? ''}`.replace(/ – $/, '');
  const n1 = new Map((comparaison ?? []).map((c) => [c.compteNum, c]));
  const vide = { ouverture: 0, debit: 0, credit: 0, cloture: 0 };
  const comptes = new Map(balance.comptes.map((c) => [c.compteNum, c]));
  // Union des comptes N et N-1 quand la comparaison est disponible.
  const numeros = comparaison ? comparaison.map((c) => c.compteNum) : balance.comptes.map((c) => c.compteNum);
  const lignes = numeros.map((num) => {
    const c = comptes.get(num);
    const libelle = c?.compteLib ?? n1.get(num)?.compteLib ?? '';
    const classe = /^\d/.test(num) ? num[0]! : '?';
    const sous = /^\d\d/.test(num) ? num.slice(0, 2) : `${classe}?`;
    const base = [libelleClasse(classe), libelleSousClasse(sous), `${num} – ${libelle}`, ...soldes(c ?? vide)];
    if (!comparaison) return base;
    const x = n1.get(num)!;
    return [...base, x.clotureN1 ?? 0, (c?.cloture ?? 0) - (x.clotureN1 ?? 0)];
  });
  const champs: ChampTcd[] = [
    { nom: 'Classe', type: 'texte', largeur: 30 },
    { nom: 'Sous-classe', type: 'texte', largeur: 34 },
    { nom: 'Compte', type: 'texte', largeur: 44 },
    ...CHAMPS_SOLDES,
    ...(comparaison ? ([{ nom: 'Solde N-1', type: 'montant' }, { nom: 'Variation', type: 'montant' }] satisfies ChampTcd[]) : []),
  ];
  ajouterTcd(wb, {
    nom: 'TCD_Balance',
    feuilleCible: 'TCD Balance',
    feuilleSource: 'Données TCD',
    titre: [`Balance générale — ${parametres.dossier}`, `Exercice ${parametres.exercice}`, NOTE_TCD],
    champs,
    lignes,
    axes: [0, 1, 2],
    valeurs: champs.map((_, k) => k).filter((k) => k >= 3),
  });
}

export function classeurBalanceGenerale(
  ExcelJS: ExcelJSModule,
  balance: Balance,
  comparaison: LigneComparaison[] | null,
  parametres: Parametres,
): Workbook {
  const wb = nouveauClasseur(ExcelJS);
  tcdBalance(wb, balance, comparaison, parametres);
  const colonnes: ColonneXlsx<LigneBalance>[] = [
    { titre: 'Classe', largeur: 7, valeur: (l) => l.compteNum[0] ?? '' },
    { titre: 'Sous-classe', largeur: 9, valeur: (l) => l.compteNum.slice(0, 2) },
    { titre: 'Compte', largeur: 12, valeur: (l) => l.compteNum },
    { titre: 'Libellé', largeur: 40, valeur: (l) => l.compteLib },
    ...colonnesSoldes<LigneBalance>(),
  ];
  const titre = [`Balance générale — ${parametres.dossier}`, `Exercice ${parametres.exercice}`];
  const ws = feuilleTableau(wb, 'Balance générale', colonnes, balance.comptes, { titre });
  const premiere = titre.length + 3;
  ligneTotal(ws, premiere, premiere + balance.comptes.length - 1, [5, 6, 7, 8]);

  const classes = feuilleTableau(
    wb,
    'Par classe',
    [
      { titre: 'Classe / sous-classe', largeur: 12, valeur: (g: { code: string }) => g.code },
      { titre: 'Libellé', largeur: 40, valeur: (g: { libelle: string }) => g.libelle },
      ...colonnesSoldes(),
    ] as ColonneXlsx<Balance['classes'][number]>[],
    balance.classes.flatMap((c) => [c, ...c.sousGroupes]),
    { titre },
  );
  classes.eachRow((row, n) => {
    const v = String(row.getCell(1).value ?? '');
    if (n > titre.length + 2 && v.length === 1) row.font = { bold: true };
  });

  if (comparaison) {
    feuilleTableau(
      wb,
      'Comparaison N-1',
      [
        { titre: 'Compte', largeur: 12, valeur: (l: LigneComparaison) => l.compteNum },
        { titre: 'Libellé', largeur: 40, valeur: (l) => l.compteLib },
        { titre: 'Solde N', type: 'montant', valeur: (l) => euros(l.clotureN) },
        { titre: 'Solde N-1', type: 'montant', valeur: (l) => (l.clotureN1 === null ? null : euros(l.clotureN1)) },
        { titre: 'Variation', type: 'montant', valeur: (l) => euros(l.variation) },
        { titre: 'Variation %', type: 'pourcentage', valeur: (l) => (l.variationPct === null ? null : l.variationPct / 100) },
      ],
      comparaison,
      { titre },
    );
  }
  feuilleParametres(wb, parametres);
  return wb;
}

export function classeurChiffresCles(
  ExcelJS: ExcelJSModule,
  c: ChiffresCles,
  n1: ChiffresCles | null,
  parametres: Parametres,
  balances: { n: Balance; n1: Balance | null },
): Workbook {
  const wb = nouveauClasseur(ExcelJS);
  // TCD : contribution de chaque compte de gestion au résultat (produits +, charges −), par rubrique des SIG.
  const comptes = new Map<string, { libelle: string; n: number; n1: number }>();
  for (const [cle, b] of [['n', balances.n], ['n1', balances.n1]] as const) {
    for (const l of b?.comptes ?? []) {
      if (!rubriqueSig(l.compteNum)) continue;
      const x = comptes.get(l.compteNum) ?? { libelle: l.compteLib, n: 0, n1: 0 };
      x[cle] = -l.cloture;
      comptes.set(l.compteNum, x);
    }
  }
  ajouterTcd(wb, {
    nom: 'TCD_SIG',
    feuilleCible: 'TCD SIG',
    feuilleSource: 'Données TCD',
    titre: [
      `Soldes intermédiaires de gestion par compte — ${parametres.dossier}`,
      `Exercice ${parametres.exercice} ; produits en positif, charges en négatif : le total général est le résultat de l’exercice`,
      NOTE_TCD,
    ],
    champs: [
      { nom: 'Rubrique', type: 'texte', largeur: 70 },
      { nom: 'Compte', type: 'texte', largeur: 44 },
      { nom: 'Exercice N', type: 'montant' },
      ...(balances.n1 ? ([{ nom: 'Exercice N-1', type: 'montant' }] satisfies ChampTcd[]) : []),
    ],
    lignes: [...comptes].map(([num, x]) => [rubriqueSig(num)!, `${num} – ${x.libelle}`, x.n, ...(balances.n1 ? [x.n1] : [])]),
    axes: [0, 1],
    valeurs: balances.n1 ? [2, 3] : [2],
  });
  const titre = [`Chiffres clés et soldes intermédiaires de gestion — ${parametres.dossier}`, `Exercice ${parametres.exercice}`];
  const avant = new Map((n1?.sig ?? []).map((l) => [l.code, l.montant]));
  const colonnes: ColonneXlsx<LigneSig>[] = [
    { titre: 'Rubrique', largeur: 62, valeur: (l) => `${l.nature === 'produit' ? '+' : l.nature === 'charge' ? '−' : '='} ${l.libelle}` },
    { titre: 'Comptes', largeur: 26, valeur: (l) => l.comptes },
    { titre: 'Exercice N', type: 'montant', valeur: (l) => euros(l.montant) },
    ...(n1
      ? ([
          { titre: 'Exercice N-1', type: 'montant', valeur: (l) => (avant.has(l.code) ? euros(avant.get(l.code)!) : null) },
          { titre: 'Variation', type: 'montant', valeur: (l) => (avant.has(l.code) ? euros(l.montant - avant.get(l.code)!) : null) },
          { titre: 'Variation %', type: 'pourcentage', valeur: (l) => (avant.get(l.code) ? (l.montant - avant.get(l.code)!) / Math.abs(avant.get(l.code)!) : null) },
        ] satisfies ColonneXlsx<LigneSig>[])
      : []),
  ];
  const ws = feuilleTableau(wb, 'SIG', colonnes, c.sig, { titre });
  ws.eachRow((row, n) => {
    if (n > titre.length + 2 && String(row.getCell(1).value ?? '').startsWith('=')) row.font = { bold: true };
  });
  const cles: [string, (x: ChiffresCles) => number | null][] = [
    ['Chiffre d’affaires (comptes 70)', (x) => x.chiffreAffaires],
    ['Total des produits (classe 7)', (x) => x.totalProduits],
    ['Total des charges (classe 6)', (x) => x.totalCharges],
    ['Résultat de l’exercice', (x) => x.resultat],
    ['Solde créditeur du compte 12 à la clôture', (x) => x.resultatCompte12],
  ];
  feuilleTableau(
    wb,
    'Chiffres clés',
    [
      { titre: 'Indicateur', largeur: 44, valeur: (l: (typeof cles)[number]) => l[0] },
      { titre: 'Exercice N', type: 'montant', valeur: (l) => { const v = l[1](c); return v === null ? null : euros(v); } },
      ...(n1 ? ([{ titre: 'Exercice N-1', type: 'montant', valeur: (l) => { const v = l[1](n1); return v === null ? null : euros(v); } }] satisfies ColonneXlsx<(typeof cles)[number]>[]) : []),
    ],
    cles,
    { titre },
  );
  feuilleParametres(wb, parametres, c.gestionSoldee ? [['Remarque', 'Comptes de gestion soldés dans le FEC : résultat lu au compte 12.']] : []);
  return wb;
}

/**
 * Tableau des flux de trésorerie : TCD (section → rubrique → compte, total général = variation de
 * trésorerie), tableau présenté (N, N-1, variation) et paramètres.
 */
export function classeurTft(ExcelJS: ExcelJSModule, t: Tft, n1: Tft | null, parametres: Parametres): Workbook {
  const wb = nouveauClasseur(ExcelJS);
  const ordreSection = { operationnel: 1, investissement: 2, financement: 3 } as const;
  const rubrique = new Map(LIGNES_TFT.map((l, k) => [l.code, { section: l.section, libelle: `${String(k + 1).padStart(2, '0')} ${l.libelle}` }]));
  const lignes = new Map<string, (string | number)[]>();
  for (const [colonne, x] of [[3, t], [4, n1]] as const) {
    for (const c of x?.contributions ?? []) {
      const r = rubrique.get(c.code)!;
      const cle = `${c.code}|${c.compteNum}`;
      const l = lignes.get(cle) ?? [
        `${ordreSection[r.section]} ${LIBELLES_SECTIONS[r.section].titre} (${LIBELLES_SECTIONS[r.section].anglais})`,
        r.libelle,
        `${c.compteNum} – ${c.compteLib}`,
        0,
        ...(n1 ? [0] : []),
      ];
      l[colonne] = Number(l[colonne]) + c.montant;
      lignes.set(cle, l);
    }
  }
  ajouterTcd(wb, {
    nom: 'TCD_TFT',
    feuilleCible: 'TCD TFT',
    feuilleSource: 'Données TCD',
    titre: [
      `Tableau des flux de trésorerie par compte — ${parametres.dossier}`,
      `Exercice ${parametres.exercice} ; encaissements en positif, décaissements en négatif : le total général est la variation de trésorerie`,
      NOTE_TCD,
    ],
    champs: [
      { nom: 'Section', type: 'texte', largeur: 48 },
      { nom: 'Rubrique', type: 'texte', largeur: 60 },
      { nom: 'Compte', type: 'texte', largeur: 44 },
      { nom: 'Exercice N', type: 'montant' },
      ...(n1 ? ([{ nom: 'Exercice N-1', type: 'montant' }] satisfies ChampTcd[]) : []),
    ],
    lignes: [...lignes.values()],
    axes: [0, 1, 2],
    valeurs: n1 ? [3, 4] : [3],
  });

  const ws = wb.addWorksheet('TFT');
  ws.getCell('A1').value = `Tableau des flux de trésorerie (méthode indirecte, IAS 7) — ${parametres.dossier}`;
  ws.getCell('A1').font = { bold: true, size: 13 };
  ws.getCell('A2').value = `Exercice ${parametres.exercice}`;
  const titres = ['Rubrique', 'Comptes', 'Exercice N', ...(n1 ? ['Exercice N-1', 'Variation'] : [])];
  const entete = ws.getRow(4);
  titres.forEach((x, k) => {
    entete.getCell(k + 1).value = x;
    entete.getCell(k + 1).font = { bold: true };
    entete.getCell(k + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7EEF8' } };
  });
  let r = 5;
  for (const l of presentationTft()) {
    if (l.nature === 'ecart' && t.ecart === 0 && (n1?.ecart ?? 0) === 0) continue;
    const row = ws.getRow(r++);
    row.getCell(1).value = l.libelle;
    if (l.nature === 'section') {
      row.font = { bold: true };
      row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F4F7' } };
      continue;
    }
    row.getCell(2).value = l.comptes;
    const v = l.montant(t) ?? 0;
    row.getCell(3).value = euros(v);
    if (n1) {
      const a = l.montant(n1) ?? 0;
      row.getCell(4).value = euros(a);
      row.getCell(5).value = euros(v - a);
    }
    if (l.nature !== 'detail') row.font = { bold: true };
    if (l.nature === 'detail') row.getCell(1).alignment = { indent: 1 };
  }
  ws.getColumn(1).width = 64;
  ws.getColumn(2).width = 30;
  for (let k = 3; k <= titres.length; k++) {
    ws.getColumn(k).width = 18;
    ws.getColumn(k).numFmt = FORMAT_MONTANT;
  }
  ws.views = [{ state: 'frozen', ySplit: 4 }];
  feuilleParametres(wb, parametres, [
    ['Trésorerie', 'Comptes de classe 5 hors 59 (disponibilités, VMP, concours bancaires courants)'],
    ['Méthode', 'Indirecte (IAS 7) : chaque compte de bilan hors trésorerie est rattaché à une rubrique ; la somme des flux est égale à la variation de trésorerie'],
    ['Contrôle', t.ecart === 0 ? 'Somme des flux = variation de trésorerie' : `Écart de ${euros(t.ecart)} € : balance déséquilibrée`],
  ]);
  return wb;
}

export function classeurBalancesAuxiliaires(ExcelJS: ExcelJSModule, balances: BalanceAuxiliaire[], parametres: Parametres): Workbook {
  const wb = nouveauClasseur(ExcelJS);
  for (const b of balances) {
    const nom = b.population === 'clients' ? 'Clients' : 'Fournisseurs';
    ajouterTcd(wb, {
      nom: `TCD_${nom}`,
      feuilleCible: `TCD ${nom}`,
      feuilleSource: `Données ${nom}`,
      titre: [`Balance auxiliaire ${nom.toLowerCase()} — ${parametres.dossier}`, `Exercice ${parametres.exercice} ; balance âgée des montants non lettrés à la clôture`, NOTE_TCD],
      champs: [
        { nom: 'Compte collectif', type: 'texte', largeur: 18 },
        { nom: 'Tiers', type: 'texte', largeur: 44 },
        ...CHAMPS_SOLDES,
        { nom: 'Non lettré', type: 'montant' },
        ...TRANCHES.map((tr): ChampTcd => ({ nom: tr.libelle, type: 'montant' })),
      ],
      lignes: b.tiers.map((l) => [l.comptes.join(', ') || '—', `${l.cle} – ${l.libelle}`, ...soldes(l), l.nonLettre, ...l.agee]),
      axes: [0, 1],
      valeurs: [2, 3, 4, 5, 6, ...TRANCHES.map((_, k) => 7 + k)],
    });
  }
  for (const b of balances) {
    const nom = b.population === 'clients' ? 'Clients' : 'Fournisseurs';
    const titre = [`Balance auxiliaire ${nom.toLowerCase()} — ${parametres.dossier}`, `Exercice ${parametres.exercice} ; balance âgée des montants non lettrés à la clôture`];
    const colonnes: ColonneXlsx<LigneAuxiliaire>[] = [
      { titre: 'Code tiers', largeur: 14, valeur: (l) => l.cle },
      { titre: 'Tiers', largeur: 34, valeur: (l) => l.libelle },
      { titre: 'Compte(s)', largeur: 14, valeur: (l) => l.comptes.join(', ') },
      ...colonnesSoldes<LigneAuxiliaire>(),
      { titre: 'Non lettré', type: 'montant', valeur: (l) => euros(l.nonLettre) },
      ...TRANCHES.map((tr, k): ColonneXlsx<LigneAuxiliaire> => ({ titre: tr.libelle, type: 'montant', valeur: (l) => euros(l.agee[k]!) })),
    ];
    const ws = feuilleTableau(wb, nom, colonnes, b.tiers, { titre });
    const premiere = titre.length + 3;
    ligneTotal(ws, premiere, premiere + b.tiers.length - 1, [4, 5, 6, 7, 9, ...TRANCHES.map((_, k) => 10 + k)]);
  }
  feuilleParametres(wb, parametres);
  return wb;
}

function colonnesLignes(ctx: ContexteAnalyse): ColonneXlsx<number>[] {
  const { f } = ctx;
  return [
    { titre: 'Compte', largeur: 12, valeur: (i) => t(f, 'compteNum', i) },
    { titre: 'Libellé du compte', largeur: 28, valeur: (i) => t(f, 'compteLib', i) },
    { titre: 'Date', type: 'date', valeur: (i) => dateExcel(f.ecritureDate[i]!) },
    { titre: 'Journal', largeur: 8, valeur: (i) => t(f, 'journalCode', i) },
    { titre: 'N° écriture', largeur: 11, valeur: (i) => t(f, 'ecritureNum', i) },
    { titre: 'Pièce', largeur: 14, valeur: (i) => t(f, 'pieceRef', i) },
    { titre: 'Auxiliaire', largeur: 12, valeur: (i) => t(f, 'compAuxNum', i) },
    { titre: 'Libellé', largeur: 40, valeur: (i) => t(f, 'ecritureLib', i) },
    { titre: 'Débit', type: 'montant', valeur: (i) => euros(f.debit[i]!) },
    { titre: 'Crédit', type: 'montant', valeur: (i) => euros(f.credit[i]!) },
    { titre: 'Lettrage', largeur: 9, valeur: (i) => t(f, 'ecritureLet', i) },
    { titre: 'À-nouveau', largeur: 9, valeur: (i) => (ctx.an[i] ? 'oui' : '') },
    { titre: 'Ligne du fichier', type: 'entier', largeur: 10, valeur: (i) => f.ligneOrigine[i]! },
  ];
}

export function classeurGrandLivre(ExcelJS: ExcelJSModule, ctx: ContexteAnalyse, gl: GrandLivre, filtres: string, parametres: Parametres): Workbook {
  const wb = nouveauClasseur(ExcelJS);
  const n = Math.min(gl.lignes.length, LIGNES_MAX_EXPORT);
  const titre = [
    `Grand-livre — ${parametres.dossier}`,
    `Filtres : ${filtres || 'aucun'}${gl.lignes.length > n ? ` — ${n.toLocaleString('fr-FR')} premières lignes sur ${gl.lignes.length.toLocaleString('fr-FR')} : affinez les filtres pour un export complet` : ''}`,
  ];
  const colonnes = colonnesLignes(ctx);
  const indices = Array.from({ length: n }, (_, k) => k);
  const ws = feuilleTableau(
    wb,
    'Grand-livre',
    [
      ...colonnes.map((c): ColonneXlsx<number> => ({ ...c, valeur: (k) => c.valeur(gl.lignes[k]!) })),
      { titre: 'Solde progressif', type: 'montant', valeur: (k) => euros(gl.soldes[k]!) },
    ],
    indices,
    { titre },
  );
  const premiere = titre.length + 3;
  ligneTotal(ws, premiere, premiere + n - 1, [9, 10]);
  feuilleParametres(wb, parametres, [['Filtres du grand-livre', filtres || 'aucun']]);
  return wb;
}

export function classeurStatistiques(ExcelJS: ExcelJSModule, ctx: ContexteAnalyse, s: Statistiques, parametres: Parametres): Workbook {
  const wb = nouveauClasseur(ExcelJS);
  const noms = new Set(['paramètres']);
  const titre = [`Statistiques d’écritures — ${parametres.dossier}`, 'Pistes d’investigation, pas des conclusions.'];
  const lignesJM = s.journaux.map((j, r) => ({ j, nb: s.ecrituresParJournalMois[r]! }));
  feuilleTableau(
    wb,
    nomOnglet('Écritures par journal et mois', noms),
    [
      { titre: 'Journal', largeur: 10, valeur: (l: (typeof lignesJM)[number]) => l.j },
      ...s.mois.map((m, c): ColonneXlsx<(typeof lignesJM)[number]> => ({ titre: `${m.slice(5)}/${m.slice(0, 4)}`, type: 'entier', largeur: 9, valeur: (l) => l.nb[c]! })),
      { titre: 'Total', type: 'entier', largeur: 9, valeur: (l) => l.nb.reduce((a, b) => a + b, 0) },
    ],
    lignesJM,
    { titre },
  );
  feuilleTableau(
    wb,
    nomOnglet('Indicateurs', noms),
    [
      { titre: 'Indicateur', largeur: 50, valeur: (i: Statistiques['indicateurs'][number]) => i.libelle },
      { titre: 'Écritures', type: 'entier', largeur: 11, valeur: (i) => i.ecritures.length },
      { titre: 'Critère', largeur: 80, valeur: (i) => i.description },
    ],
    s.indicateurs,
    { titre },
  );
  feuilleTableau(
    wb,
    nomOnglet('Benford', noms),
    [
      { titre: 'Premier chiffre', type: 'entier', largeur: 10, valeur: (d: number) => d + 1 },
      { titre: 'Observé', type: 'entier', valeur: (d) => s.benford.observes[d]! },
      { titre: 'Observé %', type: 'pourcentage', valeur: (d) => (s.benford.total ? s.benford.observes[d]! / s.benford.total : 0) },
      { titre: 'Attendu %', type: 'pourcentage', valeur: (d) => s.benford.attendues[d]! },
    ],
    [0, 1, 2, 3, 4, 5, 6, 7, 8],
    { titre: [...titre, `Écart absolu moyen : ${s.benford.mad.toFixed(4)} — conformité ${s.benford.conformite}`] },
  );
  for (const ind of s.indicateurs) {
    if (ind.ecritures.length === 0) continue;
    const lignes = ind.ecritures.slice(0, 20_000).flatMap((e) => Array.from(lignesEcriture(ctx, e)));
    feuilleTableau(wb, nomOnglet(ind.libelle, noms), colonnesLignes(ctx), lignes, {
      titre: [ind.libelle, ind.description, `${ind.ecritures.length} écriture(s)`],
    });
  }
  feuilleParametres(wb, parametres);
  return wb;
}
