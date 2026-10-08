/**
 * Tableau des flux de trésorerie, présentation anglo-saxonne (IAS 7, méthode indirecte) : flux liés aux
 * activités opérationnelles, d'investissement et de financement, calculés à partir de la balance
 * (soldes d'ouverture = à-nouveaux, mouvements de l'exercice, soldes de clôture).
 *
 * Principe : chaque compte hors trésorerie apporte au tableau une ou plusieurs contributions dont la
 * somme vaut −(clôture − ouverture) de ce compte (soldes débit − crédit). Comme la balance est
 * équilibrée à l'ouverture et à la clôture, la somme des flux est exactement la variation de trésorerie ;
 * un écart ne peut venir que d'un FEC déséquilibré et il est affiché.
 *
 * Trésorerie : comptes de classe 5 hors 59 (disponibilités, valeurs mobilières de placement,
 * concours bancaires courants 519 en négatif). Montants en centimes, flux positifs = encaissements.
 */
import type { Balance, LigneBalance } from './balance.ts';
import { calculerChiffresCles } from './chiffres-cles.ts';

export type Section = 'operationnel' | 'investissement' | 'financement';

export type CodeLigne =
  | 'RN'
  | 'AMO'
  | 'DEP'
  | 'PVC'
  | 'STK'
  | 'CLI'
  | 'FRS'
  | 'FIS'
  | 'AOP'
  | 'ACQ'
  | 'CES'
  | 'DIM'
  | 'AIM'
  | 'CAP'
  | 'DIV'
  | 'SUB'
  | 'EMP'
  | 'REM'
  | 'CCA';

interface DefinitionLigne {
  code: CodeLigne;
  section: Section;
  libelle: string;
  /** Comptes concernés, pour l'info-bulle et l'export. */
  comptes: string;
}

export const LIGNES_TFT: DefinitionLigne[] = [
  { code: 'RN', section: 'operationnel', libelle: 'Résultat net', comptes: '6, 7' },
  { code: 'AMO', section: 'operationnel', libelle: 'Dotations aux amortissements', comptes: '28 (crédit)' },
  { code: 'DEP', section: 'operationnel', libelle: 'Variation des dépréciations et provisions', comptes: '14, 15, 29, 39, 49, 59' },
  { code: 'PVC', section: 'operationnel', libelle: 'Élimination des résultats de cession d’immobilisations', comptes: '675, 775' },
  { code: 'STK', section: 'operationnel', libelle: 'Variation des stocks', comptes: '3 hors 39' },
  { code: 'CLI', section: 'operationnel', libelle: 'Variation des créances clients', comptes: '41' },
  { code: 'FRS', section: 'operationnel', libelle: 'Variation des dettes fournisseurs', comptes: '40 hors 404, 405' },
  { code: 'FIS', section: 'operationnel', libelle: 'Variation des dettes et créances fiscales et sociales', comptes: '42, 43, 44' },
  { code: 'AOP', section: 'operationnel', libelle: 'Variation des autres créances et dettes d’exploitation', comptes: '46 hors 462, 47, 48, 1688' },
  { code: 'ACQ', section: 'investissement', libelle: 'Acquisitions d’immobilisations', comptes: '2 hors 28, 29 (débit)' },
  { code: 'CES', section: 'investissement', libelle: 'Cessions d’immobilisations (prix de cession)', comptes: '775' },
  { code: 'DIM', section: 'investissement', libelle: 'Variation des dettes et créances sur immobilisations', comptes: '404, 405, 462' },
  { code: 'AIM', section: 'investissement', libelle: 'Autres mouvements sur immobilisations (sorties, virements, réévaluations)', comptes: '2 (crédit), 28 (débit), 675, 105' },
  { code: 'CAP', section: 'financement', libelle: 'Augmentation de capital, apports et prélèvements de l’exploitant', comptes: '10 hors 105, 106' },
  { code: 'DIV', section: 'financement', libelle: 'Dividendes et autres distributions', comptes: '106, 11, 12, 457' },
  { code: 'SUB', section: 'financement', libelle: 'Subventions d’investissement reçues', comptes: '13' },
  { code: 'EMP', section: 'financement', libelle: 'Nouveaux emprunts', comptes: '16 hors 1688 (crédit)' },
  { code: 'REM', section: 'financement', libelle: 'Remboursements d’emprunts', comptes: '16 hors 1688 (débit)' },
  { code: 'CCA', section: 'financement', libelle: 'Comptes courants d’associés et autres dettes financières', comptes: '17, 18, 45 hors 457' },
];

export const LIBELLES_SECTIONS: Record<Section, { titre: string; anglais: string; flux: string }> = {
  operationnel: { titre: 'Activités opérationnelles', anglais: 'Operating activities', flux: 'Flux de trésorerie liés aux activités opérationnelles' },
  investissement: { titre: 'Activités d’investissement', anglais: 'Investing activities', flux: 'Flux de trésorerie liés aux activités d’investissement' },
  financement: { titre: 'Activités de financement', anglais: 'Financing activities', flux: 'Flux de trésorerie liés aux activités de financement' },
};

export interface Contribution {
  code: CodeLigne;
  compteNum: string;
  compteLib: string;
  montant: number;
}

export interface Tft {
  lignes: Record<CodeLigne, number>;
  /** Capacité d'autofinancement (résultat net + retraitements sans incidence sur la trésorerie). */
  caf: number;
  /** Variation du besoin en fonds de roulement, en flux (négatif = hausse du BFR). */
  variationBfr: number;
  flux: Record<Section, number>;
  tresorerieOuverture: number;
  tresorerieCloture: number;
  variationTresorerie: number;
  /** Variation de trésorerie − somme des flux : nul si la balance est équilibrée. */
  ecart: number;
  /** Comptes de gestion soldés dans le FEC : le résultat est repris du compte 12. */
  gestionSoldee: boolean;
  contributions: Contribution[];
}

const commence = (c: string, prefixes: string[]) => prefixes.some((p) => c.startsWith(p));

export const estTresorerie = (compteNum: string) => compteNum.startsWith('5') && !compteNum.startsWith('59');

/** Contributions d'un compte hors trésorerie ; leur somme vaut toujours −(clôture − ouverture). */
function contributionsDu(l: LigneBalance): [CodeLigne, number][] {
  const c = l.compteNum;
  const delta = l.cloture - l.ouverture;
  const flux = -delta;
  if (/^[67]/.test(c)) {
    if (c.startsWith('675')) return [['RN', flux], ['PVC', delta], ['AIM', flux]];
    if (c.startsWith('775')) return [['RN', flux], ['PVC', delta], ['CES', flux]];
    return [['RN', flux]];
  }
  if (c.startsWith('28')) return [['AMO', l.credit], ['AIM', -l.debit]];
  if (commence(c, ['29', '39', '49', '59', '14', '15'])) return [['DEP', flux]];
  if (c.startsWith('2')) return [['ACQ', -l.debit], ['AIM', l.credit]];
  if (c.startsWith('105')) return [['AIM', flux]];
  if (c.startsWith('3')) return [['STK', flux]];
  if (commence(c, ['404', '405', '462'])) return [['DIM', flux]];
  if (c.startsWith('41')) return [['CLI', flux]];
  if (c.startsWith('40')) return [['FRS', flux]];
  if (commence(c, ['42', '43', '44'])) return [['FIS', flux]];
  if (commence(c, ['106', '11', '12', '457'])) return [['DIV', flux]];
  if (c.startsWith('10')) return [['CAP', flux]];
  if (c.startsWith('13')) return [['SUB', flux]];
  if (c.startsWith('1688')) return [['AOP', flux]];
  if (c.startsWith('16')) return [['EMP', l.credit], ['REM', -l.debit]];
  if (commence(c, ['17', '18', '45'])) return [['CCA', flux]];
  // 46, 47, 48, classes 8 et 9, comptes non codifiés.
  return [['AOP', flux]];
}

export function calculerTft(b: Balance): Tft {
  const lignes = Object.fromEntries(LIGNES_TFT.map((l) => [l.code, 0])) as Record<CodeLigne, number>;
  const contributions: Contribution[] = [];
  let tresorerieOuverture = 0;
  let tresorerieCloture = 0;
  for (const l of b.comptes) {
    if (estTresorerie(l.compteNum)) {
      tresorerieOuverture += l.ouverture;
      tresorerieCloture += l.cloture;
      continue;
    }
    for (const [code, montant] of contributionsDu(l)) {
      if (montant === 0) continue;
      lignes[code] += montant;
      contributions.push({ code, compteNum: l.compteNum, compteLib: l.compteLib, montant });
    }
  }
  // Comptes de gestion soldés dans le FEC (écriture de détermination du résultat) : le résultat de
  // l'exercice est passé du compte 12 au résultat net, pour ne pas apparaître en financement.
  const chiffres = calculerChiffresCles(b);
  if (chiffres.gestionSoldee) {
    const c12 = b.comptes.find((c) => c.compteNum.startsWith('12'))!;
    lignes.RN += chiffres.resultat;
    lignes.DIV -= chiffres.resultat;
    contributions.push({ code: 'RN', compteNum: c12.compteNum, compteLib: c12.compteLib, montant: chiffres.resultat });
    contributions.push({ code: 'DIV', compteNum: c12.compteNum, compteLib: c12.compteLib, montant: -chiffres.resultat });
  }
  const somme = (codes: CodeLigne[]) => codes.reduce((s, k) => s + lignes[k], 0);
  const caf = somme(['RN', 'AMO', 'DEP', 'PVC']);
  const variationBfr = somme(['STK', 'CLI', 'FRS', 'FIS', 'AOP']);
  const flux: Record<Section, number> = {
    operationnel: caf + variationBfr,
    investissement: somme(['ACQ', 'CES', 'DIM', 'AIM']),
    financement: somme(['CAP', 'DIV', 'SUB', 'EMP', 'REM', 'CCA']),
  };
  const variationTresorerie = tresorerieCloture - tresorerieOuverture;
  return {
    lignes,
    caf,
    variationBfr,
    flux,
    tresorerieOuverture,
    tresorerieCloture,
    variationTresorerie,
    ecart: variationTresorerie - (flux.operationnel + flux.investissement + flux.financement),
    gestionSoldee: chiffres.gestionSoldee,
    contributions,
  };
}

export type NatureLigneTft = 'section' | 'detail' | 'sous-total' | 'flux' | 'total' | 'tresorerie' | 'ecart';

export interface LignePresentation {
  cle: string;
  libelle: string;
  comptes: string;
  nature: NatureLigneTft;
  /** null pour un titre de section. */
  montant: (t: Tft) => number | null;
}

/** Présentation du tableau (écran et export), dans l'ordre. */
export function presentationTft(): LignePresentation[] {
  const detail = (code: CodeLigne): LignePresentation => {
    const d = LIGNES_TFT.find((l) => l.code === code)!;
    return { cle: code, libelle: d.libelle, comptes: d.comptes, nature: 'detail', montant: (t) => t.lignes[code] };
  };
  const section = (s: Section): LignePresentation => ({ cle: `S-${s}`, libelle: `${LIBELLES_SECTIONS[s].titre} (${LIBELLES_SECTIONS[s].anglais})`, comptes: '', nature: 'section', montant: () => null });
  const flux = (s: Section): LignePresentation => ({ cle: `F-${s}`, libelle: LIBELLES_SECTIONS[s].flux, comptes: '', nature: 'flux', montant: (t) => t.flux[s] });
  return [
    section('operationnel'),
    detail('RN'),
    detail('AMO'),
    detail('DEP'),
    detail('PVC'),
    { cle: 'CAF', libelle: 'Capacité d’autofinancement', comptes: '', nature: 'sous-total', montant: (t) => t.caf },
    detail('STK'),
    detail('CLI'),
    detail('FRS'),
    detail('FIS'),
    detail('AOP'),
    { cle: 'BFR', libelle: 'Variation du besoin en fonds de roulement', comptes: '', nature: 'sous-total', montant: (t) => t.variationBfr },
    flux('operationnel'),
    section('investissement'),
    detail('ACQ'),
    detail('CES'),
    detail('DIM'),
    detail('AIM'),
    flux('investissement'),
    section('financement'),
    detail('CAP'),
    detail('DIV'),
    detail('SUB'),
    detail('EMP'),
    detail('REM'),
    detail('CCA'),
    flux('financement'),
    { cle: 'VAR', libelle: 'Variation de trésorerie (flux de l’exercice)', comptes: '', nature: 'total', montant: (t) => t.flux.operationnel + t.flux.investissement + t.flux.financement },
    { cle: 'TO', libelle: 'Trésorerie à l’ouverture', comptes: '5 hors 59', nature: 'tresorerie', montant: (t) => t.tresorerieOuverture },
    { cle: 'TC', libelle: 'Trésorerie à la clôture', comptes: '5 hors 59', nature: 'tresorerie', montant: (t) => t.tresorerieCloture },
    { cle: 'DT', libelle: 'Variation de trésorerie (clôture − ouverture)', comptes: '', nature: 'tresorerie', montant: (t) => t.variationTresorerie },
    { cle: 'ECART', libelle: 'Écart (balance déséquilibrée)', comptes: '', nature: 'ecart', montant: (t) => t.ecart },
  ];
}
