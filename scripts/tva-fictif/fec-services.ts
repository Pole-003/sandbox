/**
 * FEC fictif de CONSEIL FICTIF SERVICES SAS (prestations de services, TVA sur les encaissements),
 * exercice du 01/07/2025 au 30/06/2026, cohérent avec les CA3 fictives (scripts/ca3-fictives/donnees.ts) :
 *  - les encaissements HT de chaque mois, par taux, sont exactement les bases déclarées (A1, 08, 9B, E2) ;
 *  - chaque facture est encaissée le mois suivant ; factures de juin 2025 = clients N-1 (à-nouveaux),
 *    factures de juin 2026 = clients N, non encaissés à la clôture ;
 *  - la TVA des factures est portée en 44587 (TVA sur factures non encaissées) puis virée en 445710 (20 %)
 *    ou 445712 (10 %) à l'encaissement ; liquidation mensuelle (4455, 44567, 44566, 44562, 4452) ;
 *  - prestations intracommunautaires autoliquidées par le client (706300, sans TVA, déclarées en E2) ;
 *    achats de prestations auprès d'un prestataire non établi (A3) : TVA autoliquidée 4452 / 44566 ;
 *  - factures à établir N-1 (extournées en juillet, facturées puis encaissées en août) et N ;
 *    produit constaté d'avance N ; créance douteuse N-1 passée en perte (654) en mars 2026.
 * Variante « cutoff » : un encaissement du 30/06/2026 (12 000 € TTC), déclaré dans la CA3 de juin, est
 * comptabilisé le 01/07/2026, donc hors de l'exercice.
 *
 * Le générateur calcule lui-même la TVA théorique attendue (attendus.json), sans le code de l'application.
 */
import { codeLettrage, ligne, type EcritureFictive, type LigneFictive } from '../fec-fictifs/modele.ts';
import { MOIS, SIREN_SERVICES } from '../ca3-fictives/donnees.ts';

export const SOCIETE = { siren: SIREN_SERVICES, raisonSociale: 'CONSEIL FICTIF SERVICES SAS', debut: '2025-07-01', cloture: '2026-06-30' };
export type Variante = 'conforme' | 'cutoff';

const c = (euros: number) => Math.round(euros * 100);
const iso = (a: number, m: number, j: number) => `${a}-${String(m).padStart(2, '0')}-${String(j).padStart(2, '0')}`;
const finDeMois = (a: number, m: number) => new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);

const COMPTES = {
  capital: ['101300', 'Capital souscrit appelé versé'],
  report: ['110000', 'Report à nouveau (solde créditeur)'],
  immo: ['218300', 'Matériel de bureau et informatique'],
  fournisseurs: ['401000', 'Fournisseurs'],
  fournImmo: ['404000', 'Fournisseurs d’immobilisations'],
  clients: ['411000', 'Clients'],
  douteux: ['416000', 'Clients douteux ou litigieux'],
  fae: ['418100', 'Clients – Factures à établir'],
  tvaIntra: ['445200', 'TVA due intracommunautaire'],
  tvaDecaisser: ['445510', 'TVA à décaisser'],
  tvaImmo: ['445620', 'TVA sur immobilisations'],
  tvaDed: ['445660', 'TVA déductible sur autres biens et services'],
  credit: ['445670', 'Crédit de TVA à reporter'],
  tva20: ['445710', 'TVA collectée 20 %'],
  tva10: ['445712', 'TVA collectée 10 %'],
  tvaAttente: ['445870', 'TVA sur factures non encaissées'],
  pca: ['487000', 'Produits constatés d’avance'],
  banque: ['512000', 'Banque'],
  achats: ['604000', 'Achats d’études et prestations de services'],
  honoraires: ['622600', 'Honoraires prestataire non établi (autoliquidation)'],
  pertes: ['654000', 'Pertes sur créances irrécouvrables'],
  regulTva: ['658000', 'Charges diverses de gestion courante'],
  ca20: ['706100', 'Prestations de services 20 %'],
  ca10: ['706200', 'Travaux de rénovation 10 %'],
  caUe: ['706300', 'Prestations UE AUTO LIQ'],
} as const;
type Cle = keyof typeof COMPTES;

const CLIENTS = {
  ca20: ['C001', 'ALPHA CONSEIL SA'],
  ca10: ['C002', 'BETA HABITAT SARL'],
  caUe: ['C003', 'GAMMA BERATUNG GMBH'],
  douteux: ['C004', 'DELTA LITIGES SARL'],
} as const;

const l = (cle: Cle, debit: number, credit: number, options: Partial<LigneFictive> = {}) => ligne(COMPTES[cle][0], COMPTES[cle][1], debit, credit, options);
const client = (qui: keyof typeof CLIENTS, cle: Cle, debit: number, credit: number, lettre = '', dateLet = '') =>
  l(cle, debit, credit, { compAuxNum: CLIENTS[qui][0], compAuxLib: CLIENTS[qui][1], ecritureLet: lettre, dateLet });

/** Factures émises en juin 2026, non encaissées à la clôture. */
export const FACTURES_JUIN_2026 = { ca20: 95_000, ca10: 5_000, caUe: 7_000 };
/** Facture à établir N-1 (3 000 € HT à 20 %), extournée le 01/07/2025, facturée en juillet, encaissée en août. */
export const FAE_N1_HT = 3_000;
/** Facture à établir N (5 000 € HT à 20 %), produit constaté d'avance N (2 000 € HT à 20 %). */
export const FAE_N_HT = 5_000;
export const PCA_N_HT = 2_000;
/** Créance douteuse N-1 (1 000 € HT à 20 %) passée en perte en mars 2026. */
export const PERTE_HT = 1_000;
/** Variante cut-off : encaissement de 10 000 € HT (12 000 € TTC) des factures de mai, du 30/06 au 01/07/2026. */
export const CUTOFF_HT = 10_000;
/** Dette de TVA de juin 2025 et fournisseurs N-1, payés en juillet 2025. */
const TVA_JUIN_2025 = 13_000;
const FOURNISSEURS_N1 = 9_000;

export function ecrituresServices(variante: Variante): EcritureFictive[] {
  const ecritures: EcritureFictive[] = [];
  let numero = 0;
  let lettre = 0;
  const ecrire = (journal: string, libJournal: string, date: string, piece: string, libelle: string, lignes: LigneFictive[]) => {
    const d = lignes.reduce((s, x) => s + x.debit, 0);
    const k = lignes.reduce((s, x) => s + x.credit, 0);
    if (d !== k) throw new Error(`Écriture déséquilibrée ${piece} : ${d} ≠ ${k}`);
    ecritures.push({ journalCode: journal, journalLib: libJournal, ecritureNum: String(++numero), ecritureDate: date, pieceRef: piece, pieceDate: date, ecritureLib: libelle, validDate: date, lignes: lignes.filter((x) => x.debit !== 0 || x.credit !== 0) });
  };
  const VT = ['VT', 'Journal des ventes'] as const;
  const BQ = ['BQ', 'Banque'] as const;
  const AC = ['AC', 'Journal des achats'] as const;
  const OD = ['OD', 'Opérations diverses'] as const;

  // Factures émises le mois m (indice 0 = juillet 2025) : encaissées le mois m + 1.
  const factures = MOIS.map((_, m) => (m < 11 ? { ca20: MOIS[m + 1]!.ca20, ca10: MOIS[m + 1]!.ca10, caUe: MOIS[m + 1]!.e2 } : FACTURES_JUIN_2026));
  // Lettres des factures en cours (par client) : la facture du mois m est lettrée à son encaissement en m + 1.
  const ouvertes: Record<string, { lettre: string; ttc: number }[]> = { ca20: [], ca10: [], caUe: [] };

  // À-nouveaux : factures de juin 2025 (encaissées en juillet = bases de juillet), créance douteuse, FAE N-1.
  const j = MOIS[0]!;
  const an20 = c(j.ca20 * 1.2);
  const an10 = c(j.ca10 * 1.1);
  const anUe = c(j.e2);
  const douteuse = c(PERTE_HT * 1.2);
  const fae1 = c(FAE_N1_HT * 1.2);
  const tvaAttenteN1 = an20 - c(j.ca20) + (an10 - c(j.ca10)) + (douteuse - c(PERTE_HT)) + (fae1 - c(FAE_N1_HT));
  const banqueN1 = c(80_000);
  const debitsAn = an20 + an10 + anUe + douteuse + fae1 + banqueN1;
  const creditsAn = tvaAttenteN1 + c(TVA_JUIN_2025) + c(FOURNISSEURS_N1) + c(10_000);
  for (const [qui, ttc] of [['ca20', an20], ['ca10', an10], ['caUe', anUe]] as const) ouvertes[qui]!.push({ lettre: codeLettrage(lettre++), ttc });
  const lettreDouteuse = codeLettrage(lettre++);
  ecrire('AN', 'A-nouveaux', SOCIETE.debut, 'AN2025', 'Reprise des soldes au 01/07/2025', [
    client('ca20', 'clients', an20, 0, ouvertes.ca20![0]!.lettre, iso(2025, 7, 10)),
    client('ca10', 'clients', an10, 0, ouvertes.ca10![0]!.lettre, iso(2025, 7, 10)),
    client('caUe', 'clients', anUe, 0, ouvertes.caUe![0]!.lettre, iso(2025, 7, 10)),
    client('douteux', 'douteux', douteuse, 0, lettreDouteuse, iso(2026, 3, 31)),
    l('fae', fae1, 0),
    l('banque', banqueN1, 0),
    l('tvaAttente', 0, tvaAttenteN1),
    l('tvaDecaisser', 0, c(TVA_JUIN_2025)),
    l('fournisseurs', 0, c(FOURNISSEURS_N1)),
    l('capital', 0, c(10_000)),
    l('report', 0, debitsAn - creditsAn),
  ]);
  ecrire(...BQ, iso(2025, 7, 15), 'TVA2506', 'Paiement TVA juin 2025', [l('tvaDecaisser', c(TVA_JUIN_2025), 0), l('banque', 0, c(TVA_JUIN_2025))]);
  ecrire(...BQ, iso(2025, 7, 20), 'FRN2506', 'Règlement fournisseurs juin 2025', [l('fournisseurs', c(FOURNISSEURS_N1), 0), l('banque', 0, c(FOURNISSEURS_N1))]);
  ecrire(...OD, iso(2025, 7, 1), 'EXT-FAE', 'Extourne factures à établir au 30/06/2025', [l('ca20', c(FAE_N1_HT), 0), l('tvaAttente', fae1 - c(FAE_N1_HT), 0), l('fae', 0, fae1)]);

  let credit = 0;
  MOIS.forEach((m, k) => {
    const a = m.annee;
    const mo = m.mois;
    const p = `${a}${String(mo).padStart(2, '0')}`;

    // Encaissements du mois (factures du mois précédent), le 10, sauf variante cut-off en juin 2026.
    for (const [qui, compte, taux] of [['ca20', 'tva20', 0.2], ['ca10', 'tva10', 0.1], ['caUe', null, 0]] as const) {
      const ht = qui === 'ca20' ? m.ca20 : qui === 'ca10' ? m.ca10 : m.e2;
      if (!ht) continue;
      const facture = ouvertes[qui]!.shift()!;
      const ttc = c(ht * (1 + taux));
      if (facture.ttc !== ttc) throw new Error(`Encaissement ${qui} ${p} : ${ttc} ≠ facture ${facture.ttc}`);
      const decale = variante === 'cutoff' && qui === 'ca20' && a === 2026 && mo === 6;
      if (decale) {
        // L'encaissement de 12 000 € TTC est comptabilisé le 01/07/2026 : seul le solde est encaissé en juin.
        const reste = ttc - c(CUTOFF_HT * 1.2);
        ecrire(...BQ, iso(a, mo, 10), `ENC${p}A`, `Encaissement ${CLIENTS[qui][1]} (partiel)`, [l('banque', reste, 0), client(qui, 'clients', 0, reste)]);
        const tvaReste = reste - Math.round(reste / 1.2);
        ecrire(...OD, iso(a, mo, 10), `TVAENC${p}A`, 'TVA exigible sur encaissements', [l('tvaAttente', tvaReste, 0), l(compte!, 0, tvaReste)]);
        continue;
      }
      const dateLet = iso(a, mo, 10);
      ecrire(...BQ, dateLet, `ENC${p}${qui}`, `Encaissement ${CLIENTS[qui][1]}`, [l('banque', ttc, 0), client(qui, 'clients', 0, ttc, facture.lettre, dateLet)]);
      if (taux) ecrire(...OD, dateLet, `TVAENC${p}${qui}`, 'TVA exigible sur encaissements', [l('tvaAttente', ttc - c(ht), 0), l(compte!, 0, ttc - c(ht))]);
    }

    // Factures du mois, le 25 (une écriture par taux, libellés de vente).
    const f = factures[k]!;
    for (const [qui, compte, taux, libelle] of [['ca20', 'ca20', 0.2, 'Prestations de conseil'], ['ca10', 'ca10', 0.1, 'Travaux de rénovation'], ['caUe', 'caUe', 0, 'Prestations intracommunautaires – autoliquidation']] as const) {
      const ht = f[qui];
      if (!ht) continue;
      const ttc = c(ht * (1 + taux));
      const lettreFacture = k < 11 ? codeLettrage(lettre++) : '';
      ouvertes[qui]!.push({ lettre: lettreFacture, ttc });
      const suivant = k < 11 ? MOIS[k + 1]! : null;
      ecrire(...VT, iso(a, mo, 25), `F${p}${qui}`, `${libelle} ${CLIENTS[qui][1]}`, [
        client(qui, 'clients', ttc, 0, lettreFacture, suivant ? iso(suivant.annee, suivant.mois, 10) : ''),
        l(compte, 0, c(ht)),
        ...(taux ? [l('tvaAttente', 0, ttc - c(ht))] : []),
      ]);
    }

    // Achats du mois (TVA déductible ligne 20) et prestations autoliquidées (A3).
    const htAchats = m.ded20 * 5;
    ecrire(...AC, iso(a, mo, 5), `A${p}`, 'Achats d’études et prestations', [l('achats', c(htAchats), 0), l('tvaDed', c(m.ded20), 0), l('fournisseurs', 0, c(htAchats + m.ded20))]);
    ecrire(...BQ, iso(a, mo, 28), `REG${p}`, 'Règlement fournisseurs', [l('fournisseurs', c(htAchats + m.ded20), 0), l('banque', 0, c(htAchats + m.ded20))]);
    if (m.a3) {
      ecrire(...AC, iso(a, mo, 12), `A3${p}`, 'Honoraires prestataire non établi – autoliquidation', [l('honoraires', c(m.a3), 0), l('tvaDed', c(m.a3 * 0.2), 0), l('tvaIntra', 0, c(m.a3 * 0.2)), l('fournisseurs', 0, c(m.a3))]);
      ecrire(...BQ, iso(a, mo, 28), `REGA3${p}`, 'Règlement prestataire non établi', [l('fournisseurs', c(m.a3), 0), l('banque', 0, c(m.a3))]);
    }
    if (m.imm19) {
      ecrire(...AC, iso(a, mo, 8), `IMM${p}`, 'Acquisition matériel informatique', [l('immo', c(m.imm19 * 5), 0), l('tvaImmo', c(m.imm19), 0), l('fournImmo', 0, c(m.imm19 * 6))]);
      ecrire(...BQ, iso(a, mo + 1 > 12 ? 1 : mo + 1, 5).replace(/^\d{4}/, String(mo + 1 > 12 ? a + 1 : a)), `REGIMM${p}`, 'Règlement fournisseur d’immobilisation', [l('fournImmo', c(m.imm19 * 6), 0), l('banque', 0, c(m.imm19 * 6))]);
    }
    if (m.autre21) ecrire(...AC, iso(a, mo, 18), `R21${p}`, 'TVA sur facture fournisseur omise', [l('tvaDed', c(m.autre21), 0), l('fournisseurs', 0, c(m.autre21))]);
    if (m.autre21) ecrire(...BQ, iso(a, mo, 28), `REGR21${p}`, 'Règlement complément de TVA', [l('fournisseurs', c(m.autre21), 0), l('banque', 0, c(m.autre21))]);

    // Liquidation de la TVA du mois (telle que déclarée), le dernier jour du mois.
    const t20 = c(m.ca20 * 0.2);
    let t10 = c(m.ca10 * 0.1);
    let ecartDeclaration = 0;
    if (a === 2026 && mo === 2) {
      // CA3 de février : taxe 9B déclarée 500 au lieu de 550 et ligne 16 majorée de 1 000 (voir donnees.ts).
      t10 = c(500);
      ecartDeclaration = c(1_000);
    }
    const autoliq = c(m.a3 * 0.2);
    const brute = t20 + t10 + autoliq + ecartDeclaration;
    const deductible = c(m.ded20 + m.a3 * 0.2 + (m.autre21 ?? 0)) + c(m.imm19) + credit;
    const lignes: LigneFictive[] = [l('tva20', t20, 0), l('tva10', t10, 0), l('tvaIntra', autoliq, 0), l('regulTva', ecartDeclaration, 0), l('tvaDed', 0, c(m.ded20 + m.a3 * 0.2 + (m.autre21 ?? 0))), l('tvaImmo', 0, c(m.imm19))];
    if (credit) lignes.push(l('credit', 0, credit));
    if (brute >= deductible) {
      lignes.push(l('tvaDecaisser', 0, brute - deductible));
      credit = 0;
    } else {
      credit = deductible - brute;
      lignes.push(l('credit', credit, 0));
    }
    ecrire(...OD, finDeMois(a, mo), `CA3${p}`, `Liquidation TVA ${String(mo).padStart(2, '0')}/${a}`, lignes);
    // Paiement de la TVA du mois précédent, le 15 (celle de juin 2025 est payée plus haut).
    if (k > 0) {
      const prec = ecritures.find((e) => e.pieceRef === `CA3${MOIS[k - 1]!.annee}${String(MOIS[k - 1]!.mois).padStart(2, '0')}`)!;
      const due = prec.lignes.find((x) => x.compteNum === COMPTES.tvaDecaisser[0])?.credit ?? 0;
      if (due) ecrire(...BQ, iso(a, mo, 15), `PTVA${p}`, 'Paiement TVA', [l('tvaDecaisser', due, 0), l('banque', 0, due)]);
    }

    // Créance douteuse passée en perte en mars 2026 (TVA non exigible, jamais encaissée, annulée).
    if (a === 2026 && mo === 3) {
      ecrire(...OD, iso(a, mo, 31), 'PERTE2603', 'Créance irrécouvrable DELTA LITIGES', [l('pertes', c(PERTE_HT), 0), l('tvaAttente', douteuse - c(PERTE_HT), 0), client('douteux', 'douteux', 0, douteuse, lettreDouteuse, iso(2026, 3, 31))]);
    }
  });

  // Inventaire au 30/06/2026 : facture à établir et produit constaté d'avance.
  ecrire(...OD, SOCIETE.cloture, 'FAE2606', 'Factures à établir au 30/06/2026', [l('fae', c(FAE_N_HT * 1.2), 0), l('ca20', 0, c(FAE_N_HT)), l('tvaAttente', 0, c(FAE_N_HT * 0.2))]);
  ecrire(...OD, SOCIETE.cloture, 'PCA2606', 'Produits constatés d’avance au 30/06/2026', [l('ca20', c(PCA_N_HT), 0), l('pca', 0, c(PCA_N_HT))]);
  // Ordre chronologique et numérotation continue, comme un logiciel comptable.
  return ecritures
    .map((e, i) => ({ e, i }))
    .sort((x, y) => x.e.ecritureDate.localeCompare(y.e.ecritureDate) || x.i - y.i)
    .map(({ e }, i) => ({ ...e, ecritureNum: String(i + 1) }));
}

/** Valeurs attendues du cadrage, calculées directement à partir des données (centimes). */
export function attendusServices(variante: Variante) {
  const tvaCorrecte = MOIS.reduce((s, m) => s + c(m.ca20 * 0.2) + c(m.ca10 * 0.1) + c(m.a3 * 0.2), 0);
  const tvaDeclaree = tvaCorrecte - c(50); // février : 9B déclarée 500 au lieu de 550
  const cutoff = variante === 'cutoff' ? c(CUTOFF_HT * 0.2) : 0;
  const j = MOIS[0]!;
  const caParTaux = {
    2000: c(MOIS.slice(1).reduce((s, m) => s + m.ca20, 0) + FACTURES_JUIN_2026.ca20 - FAE_N1_HT + FAE_N_HT - PCA_N_HT),
    1000: c(MOIS.slice(1).reduce((s, m) => s + m.ca10, 0) + FACTURES_JUIN_2026.ca10),
    0: c(MOIS.slice(1).reduce((s, m) => s + m.e2, 0) + FACTURES_JUIN_2026.caUe),
  };
  return {
    tvaCollecteeDeclaree: tvaDeclaree,
    tvaTheorique: tvaCorrecte - cutoff,
    ecart: tvaCorrecte - cutoff - tvaDeclaree,
    caParTaux,
    tvaSurCa: Math.round(caParTaux[2000] * 0.2) + Math.round(caParTaux[1000] * 0.1),
    /** Encours TTC par taux (centimes), pour une ventilation exacte. */
    encours: {
      clientsN1: { 2000: c(j.ca20 * 1.2), 1000: c(j.ca10 * 1.1), 0: c(j.e2) },
      douteuxN1: { 2000: c(PERTE_HT * 1.2) },
      clientsN: { 2000: c(FACTURES_JUIN_2026.ca20 * 1.2) + (variante === 'cutoff' ? c(CUTOFF_HT * 1.2) : 0), 1000: c(FACTURES_JUIN_2026.ca10 * 1.1), 0: c(FACTURES_JUIN_2026.caUe) },
      faeN1: { 2000: c(FAE_N1_HT * 1.2) },
      faeN: { 2000: c(FAE_N_HT * 1.2) },
      pcaN: { 2000: -c(PCA_N_HT) },
    },
    perteHt: c(PERTE_HT),
    autoliquidationAchats: MOIS.reduce((s, m) => s + c(m.a3 * 0.2), 0),
    /** TVA comptabilisée au crédit des 4457 par mois (TVA exigible sur encaissements). */
    tva4457ParMois: Object.fromEntries(MOIS.map((m) => [`${m.annee}-${String(m.mois).padStart(2, '0')}`, c(m.ca20 * 0.2) + c(m.ca10 * 0.1) - (variante === 'cutoff' && m.annee === 2026 && m.mois === 6 ? cutoff : 0)])),
    /** Solde de 4455 à la clôture = TVA due de juin 2026 (ligne 28 de la dernière CA3). */
    solde4455: c(19_010),
    solde44567: 0,
  };
}
