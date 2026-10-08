/**
 * Simulation d'une PME de négoce fictive : produit les écritures d'un exercice, dans l'ordre chronologique,
 * numérotées sur une séquence continue (les à-nouveaux portent le n° 1, A47 A-1 VII 3°).
 *
 * La simulation est un générateur : les écritures sont produites au fil des jours, ce qui permet d'écrire
 * en flux un FEC de plusieurs millions de lignes sans tout garder en mémoire. Les règlements sont planifiés
 * dès l'émission de la facture : la ligne de facture connaît donc déjà son code et sa date de lettrage.
 */
import { ajouterJours, ajouterMois, estJourOuvre, finDeMois, jourFerie } from '../../src/core/dates.ts';
import { Alea } from './alea.ts';
import { codeLettrage, ligne, tva, type EcritureFictive, type LigneFictive, type Societe } from './modele.ts';
import { genererNoms } from './noms.ts';

export interface ParamsNegoce {
  societe: Societe;
  graine: number;
  nbClients: number;
  nbFournisseurs: number;
  /** Nombre moyen de factures de vente et d'achat par jour ouvré. */
  ventesParJour: number;
  achatsParJour: number;
  /** Nombre de clients rendus créditeurs (double encaissement) et de fournisseurs rendus débiteurs. */
  clientsCrediteurs: number;
  fournisseursDebiteurs: number;
  /** Écritures « pistes d'audit » volontaires : week-end, jour férié, OD sur CA et trésorerie, doublon, libellés génériques. */
  pistes: boolean;
  /** Écritures d'inventaire validées après la clôture (réaliste) ; sinon validées à la clôture. */
  validationApresCloture: boolean;
  /** Libellés propres à certaines lignes (à-nouveaux détaillés). Désactivé pour les jeux convertis en XML. */
  libellesParLigne: boolean;
  /** Un fournisseur facturant en dollars US (Montantdevise / Idevise). */
  devise: boolean;
  /** Facteur d'échelle des masses du bilan, de la paie et du loyer (1 = PME d'environ 4,5 M€ de CA). */
  echelle: number;
}

type Compte = readonly [string, string];

export const COMPTES = {
  capital: ['101300', 'Capital souscrit appelé versé'],
  reserveLegale: ['106100', 'Réserve légale'],
  autresReserves: ['106800', 'Autres réserves'],
  reportANouveau: ['110000', 'Report à nouveau (solde créditeur)'],
  resultat: ['120000', "Résultat de l'exercice (bénéfice)"],
  emprunt: ['164000', 'Emprunts auprès des établissements de crédit'],
  materiel: ['215400', 'Matériel industriel'],
  transport: ['218200', 'Matériel de transport'],
  bureau: ['218300', 'Matériel de bureau et informatique'],
  amortMateriel: ['281540', 'Amortissements du matériel industriel'],
  amortTransport: ['281820', 'Amortissements du matériel de transport'],
  amortBureau: ['281830', 'Amortissements du matériel de bureau'],
  stock: ['370000', 'Stocks de marchandises'],
  fournisseurs: ['401000', 'Fournisseurs'],
  fnp: ['408100', 'Fournisseurs - factures non parvenues'],
  clients: ['411000', 'Clients'],
  fae: ['418100', 'Clients - factures à établir'],
  remunerations: ['421000', 'Personnel - rémunérations dues'],
  urssaf: ['431000', 'Sécurité sociale'],
  tvaADecaisser: ['445510', 'TVA à décaisser'],
  tvaDeductible: ['445660', 'TVA déductible sur autres biens et services'],
  creditTva: ['445670', 'Crédit de TVA à reporter'],
  tvaCollectee: ['445710', 'TVA collectée'],
  tvaFnp: ['445860', 'TVA sur factures non parvenues'],
  tvaFae: ['445870', 'TVA sur factures à établir'],
  attente: ['471000', "Compte d'attente"],
  cca: ['486000', "Charges constatées d'avance"],
  banque1: ['512100', 'Banque Alpha'],
  banque2: ['512200', 'Banque Bêta'],
  banque3: ['512300', 'Banque Gamma'],
  variationStock: ['603700', 'Variation des stocks de marchandises'],
  achats: ['607000', 'Achats de marchandises'],
  loyers: ['613200', 'Locations immobilières'],
  fraisBancaires: ['627000', 'Services bancaires et assimilés'],
  salaires: ['641100', 'Salaires, appointements'],
  chargesSociales: ['645100', "Cotisations à l'URSSAF"],
  interets: ['661100', 'Intérêts des emprunts et dettes'],
  dotations: ['681120', 'Dotations aux amortissements des immobilisations corporelles'],
  ventes: ['707000', 'Ventes de marchandises'],
} as const satisfies Record<string, Compte>;

export const JOURNAUX = {
  AN: 'A-nouveaux',
  VT: 'Journal des ventes',
  AC: 'Journal des achats',
  BQ1: 'Banque Alpha',
  BQ2: 'Banque Bêta',
  OD: 'Opérations diverses',
} as const;
type CodeJournal = keyof typeof JOURNAUX;

const BANQUE_DU_JOURNAL: Record<'BQ1' | 'BQ2', Compte> = { BQ1: COMPTES.banque1, BQ2: COMPTES.banque2 };

interface Tiers {
  num: string;
  nom: string;
  delai: number;
  journal: 'BQ1' | 'BQ2';
  lettrages: number;
  /** Prochain règlement à enregistrer deux fois (rend le client créditeur ou le fournisseur débiteur). */
  doublePrevu: boolean;
  /** Rôle particulier dans le jeu de test. */
  role: 'normal' | 'crediteur' | 'debiteur-double' | 'debiteur-avoir' | 'volume-solde-nul' | 'loyer' | 'devise';
}

/** Règlement planifié : encaissement client ou paiement fournisseur. */
interface Reglement {
  type: 'client' | 'fournisseur';
  tiers: Tiers;
  montant: number;
  montantDevise: number | null;
  ref: string;
  code: string;
  journal: 'BQ1' | 'BQ2';
}

const TAUX_TVA = 200; // ‰

function prochainJourOuvre(iso: string): string {
  let d = iso;
  while (!estJourOuvre(d)) d = ajouterJours(d, 1);
  return d;
}

function dernierJourOuvre(iso: string): string {
  let d = finDeMois(iso);
  while (!estJourOuvre(d)) d = ajouterJours(d, -1);
  return d;
}

function poidsCumules(n: number, exposant: number, bonus: Map<number, number> = new Map()): number[] {
  const cumul: number[] = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    total += (bonus.get(i) ?? 1) / (i + 1) ** exposant;
    cumul.push(total);
  }
  return cumul;
}

export function* simulerNegoce(p: ParamsNegoce): Generator<EcritureFictive> {
  const alea = new Alea(p.graine);
  const { debut, cloture } = p.societe;
  const C = COMPTES;

  // ---- Tiers -------------------------------------------------------------------------------------
  const nomsClients = genererNoms(alea, p.nbClients);
  const clients: Tiers[] = nomsClients.map((nom, i) => ({
    num: `C${String(i + 1).padStart(4, '0')}`,
    nom,
    delai: alea.entier(20, 70),
    journal: alea.probabilite(0.7) ? 'BQ1' : 'BQ2',
    lettrages: 0,
    doublePrevu: false,
    role: i >= p.nbClients - p.clientsCrediteurs ? 'crediteur' : 'normal',
  }));
  const nomsFournisseurs = genererNoms(alea, p.nbFournisseurs);
  const fournisseurs: Tiers[] = nomsFournisseurs.map((nom, i) => ({
    num: `F${String(i + 1).padStart(4, '0')}`,
    nom,
    delai: alea.entier(30, 60),
    journal: alea.probabilite(0.8) ? 'BQ1' : 'BQ2',
    lettrages: 0,
    doublePrevu: false,
    role: 'normal',
  }));
  const fVolume = fournisseurs[0]!;
  fVolume.role = 'volume-solde-nul';
  fVolume.nom = 'Grossiste Central Fictif SA';
  fVolume.delai = 10;
  const fLoyer = fournisseurs[1]!;
  fLoyer.role = 'loyer';
  fLoyer.nom = 'SCI des Entrepôts Fictifs';
  for (let k = 0; k < p.fournisseursDebiteurs; k++) {
    const f = fournisseurs[p.nbFournisseurs - 2 - k]!;
    f.role = k === 0 ? 'debiteur-avoir' : 'debiteur-double';
    f.doublePrevu = f.role === 'debiteur-double';
    f.delai = 30;
  }
  const fDevise = p.devise ? fournisseurs[p.nbFournisseurs - 1]! : undefined;
  if (fDevise) {
    fDevise.role = 'devise';
    fDevise.nom = 'Pacific Trading Co (fictif)';
  }
  for (const c of clients) {
    if (c.role !== 'crediteur') continue;
    c.delai = 30;
    c.doublePrevu = true;
  }

  const poidsClients = poidsCumules(clients.length, 0.8);
  // Le fournisseur « volume » concentre une part importante des achats.
  const poidsFournisseurs = poidsCumules(
    fournisseurs.length,
    0.7,
    new Map([
      [0, 6],
      [1, 0],
    ]),
  );

  // ---- Planification -----------------------------------------------------------------------------
  const agenda = new Map<string, Reglement[]>();
  const planifier = (date: string, r: Reglement) => {
    const jour = prochainJourOuvre(date);
    const liste = agenda.get(jour);
    if (liste) liste.push(r);
    else agenda.set(jour, [r]);
    return jour;
  };

  /** Décide du règlement d'une pièce : renvoie le lettrage à porter sur la ligne de tiers. */
  const reglerPlusTard = (
    type: 'client' | 'fournisseur',
    tiers: Tiers,
    dateFacture: string,
    montant: number,
    ref: string,
    options: { delai?: number; impaye?: boolean; nonLettre?: boolean; montantDevise?: number | null } = {},
  ): { ecritureLet: string; dateLet: string } => {
    if (options.impaye) return { ecritureLet: '', dateLet: '' };
    const delai = options.delai ?? tiers.delai + alea.entier(-5, 15);
    let date = prochainJourOuvre(ajouterJours(dateFacture, Math.max(delai, 1)));
    if (date <= debut) date = prochainJourOuvre(ajouterJours(debut, alea.entier(2, 25)));
    if (date > cloture) return { ecritureLet: '', dateLet: '' };
    const lettre = !options.nonLettre;
    const code = lettre ? codeLettrage(tiers.lettrages++) : '';
    const journal = tiers.journal;
    planifier(date, { type, tiers, montant, montantDevise: options.montantDevise ?? null, ref, code, journal });
    // Double règlement non lettré, au plus tard deux mois avant la clôture.
    if (tiers.doublePrevu && date < ajouterJours(cloture, -60)) {
      tiers.doublePrevu = false;
      planifier(ajouterJours(date, 9), { type, tiers, montant, montantDevise: null, ref, code: '', journal });
    }
    return lettre ? { ecritureLet: code, dateLet: date } : { ecritureLet: '', dateLet: '' };
  };

  // ---- Numérotation et validation ----------------------------------------------------------------
  let numero = 0;
  const validationInventaire = p.validationApresCloture ? ajouterJours(cloture, 74) : cloture;
  const ecriture = (
    journal: CodeJournal,
    date: string,
    pieceRef: string,
    libelle: string,
    lignes: LigneFictive[],
    validDate = finDeMois(date) > cloture ? cloture : finDeMois(date),
  ): EcritureFictive => ({
    journalCode: journal,
    journalLib: JOURNAUX[journal],
    ecritureNum: String(++numero),
    ecritureDate: date,
    pieceRef,
    pieceDate: date,
    ecritureLib: libelle,
    validDate,
    lignes,
  });
  const aux = (tiers: Tiers) => ({ compAuxNum: tiers.num, compAuxLib: tiers.nom });
  const pister = (piste: string, e: EcritureFictive) => {
    e.piste = piste;
    return e;
  };

  // ---- Compteurs mensuels de TVA -----------------------------------------------------------------
  const tvaMois = new Map<string, { collectee: number; deductible: number }>();
  const cumulerTva = (date: string, collectee: number, deductible: number) => {
    const mois = date.slice(0, 7);
    const t = tvaMois.get(mois) ?? { collectee: 0, deductible: 0 };
    t.collectee += collectee;
    t.deductible += deductible;
    tvaMois.set(mois, t);
  };

  // ---- À-nouveaux --------------------------------------------------------------------------------
  const lignesAN: LigneFictive[] = [];
  const libAN = (texte: string) => (p.libellesParLigne ? { libelle: texte } : {});
  let numFactureN1 = 0;
  const anneeN1 = String(Number(debut.slice(2, 4)) - 1).padStart(2, '0');

  for (const c of clients) {
    if (!alea.probabilite(0.7)) continue;
    const nb = alea.entier(1, 2);
    for (let k = 0; k < nb; k++) {
      const litige = c.role === 'normal' && alea.probabilite(0.03);
      const dateFacture = ajouterJours(debut, litige ? -alea.entier(150, 300) : -alea.entier(5, 55));
      const ht = alea.montantLog(8_000, 1_500_000);
      const ttc = ht + tva(ht, TAUX_TVA);
      const ref = `FA${anneeN1}${String(++numFactureN1).padStart(5, '0')}`;
      const lettrage = reglerPlusTard('client', c, dateFacture, ttc, ref, { impaye: litige });
      lignesAN.push(ligne(C.clients[0], C.clients[1], ttc, 0, { ...aux(c), ...lettrage, ...libAN(`Facture ${ref}`) }));
    }
  }
  for (const f of fournisseurs) {
    if (f.role === 'loyer' || f.role === 'devise' || !alea.probabilite(0.75)) continue;
    const dateFacture = ajouterJours(debut, -alea.entier(5, 40));
    const ht = alea.montantLog(20_000, 2_000_000);
    const ttc = ht + tva(ht, TAUX_TVA);
    const ref = `${f.num}-${anneeN1}${alea.entier(1000, 9999)}`;
    const lettrage = reglerPlusTard('fournisseur', f, dateFacture, ttc, ref);
    lignesAN.push(ligne(C.fournisseurs[0], C.fournisseurs[1], 0, ttc, { ...aux(f), ...lettrage, ...libAN(`Facture ${ref}`) }));
  }

  // Masses du bilan d'ouverture, proportionnées à l'activité.
  const echelle = p.echelle;
  const arrondi = (x: number) => Math.round(x / 100) * 100;
  const tvaN1 = arrondi(4_200_000 * echelle);
  const urssafN1 = arrondi(2_350_000 * echelle);
  const capitalEmprunt = arrondi(12_000_000 * echelle);
  const echeanceCapital = arrondi(capitalEmprunt / 60);
  const ouverture: [Compte, number][] = [
    [C.materiel, arrondi(8_000_000 * echelle)],
    [C.transport, arrondi(3_500_000 * echelle)],
    [C.bureau, arrondi(1_200_000 * echelle)],
    [C.amortMateriel, -arrondi(3_000_000 * echelle)],
    [C.amortTransport, -arrondi(1_400_000 * echelle)],
    [C.amortBureau, -arrondi(600_000 * echelle)],
    [C.stock, arrondi(15_000_000 * echelle)],
    [C.banque1, arrondi(8_500_000 * echelle)],
    [C.banque2, arrondi(3_200_000 * echelle)],
    [C.banque3, arrondi(1_500_000 * echelle)],
    [C.emprunt, -capitalEmprunt],
    [C.tvaADecaisser, -tvaN1],
    [C.urssaf, -urssafN1],
    [C.capital, -arrondi(5_000_000 * echelle)],
    [C.reserveLegale, -arrondi(500_000 * echelle)],
    [C.resultat, -arrondi(4_500_000 * echelle)],
  ];
  for (const [compte, solde] of ouverture) {
    lignesAN.push(ligne(compte[0], compte[1], Math.max(solde, 0), Math.max(-solde, 0)));
  }
  const ecartAN = lignesAN.reduce((s, l) => s + l.debit - l.credit, 0);
  lignesAN.push(ligne(C.autresReserves[0], C.autresReserves[1], Math.max(-ecartAN, 0), Math.max(ecartAN, 0)));
  yield ecriture('AN', debut, 'AN', 'A nouveaux', lignesAN);

  // Règlements des dettes fiscales et sociales d'ouverture.
  const premierMois = debut;
  const dettesOuverture: { date: string; compte: Compte; montant: number; libelle: string }[] = [
    { date: prochainJourOuvre(ajouterJours(premierMois, 14)), compte: C.urssaf, montant: urssafN1, libelle: 'Cotisations URSSAF' },
    { date: prochainJourOuvre(ajouterJours(premierMois, 19)), compte: C.tvaADecaisser, montant: tvaN1, libelle: 'Paiement TVA' },
  ];

  // ---- Événements ponctuels ----------------------------------------------------------------------
  const moisRelatif = (n: number, jour: number) => prochainJourOuvre(ajouterJours(ajouterMois(debut, n), jour - 1));
  const dateFraisGamma = dernierJourOuvre(ajouterMois(debut, 1));
  const dateClotureGamma = moisRelatif(4, 14);
  const dateAffectation = moisRelatif(5, 15);
  let soldeGamma = ouverture.find(([c]) => c === C.banque3)![1];
  const resultatN1 = -ouverture.find(([c]) => c === C.resultat)![1];

  /** Pistes volontaires (grand FEC propre seulement) : date → type. */
  const pistes = new Map<string, string>();
  if (p.pistes) {
    const annee = Number(cloture.slice(0, 4));
    const anneeDebut = Number(debut.slice(0, 4));
    pistes.set(`${anneeDebut}-09-13`, 'vente');
    pistes.set(`${annee}-01-17`, 'vente');
    pistes.set(`${annee}-03-08`, 'vente');
    pistes.set(`${anneeDebut}-11-11`, 'vente');
    pistes.set(`${annee}-04-06`, 'vente');
    pistes.set(`${annee}-05-14`, 'vente');
    pistes.set(`${annee}-02-10`, 'doublon-achat');
    pistes.set(`${annee}-02-27`, 'libelle-divers');
    pistes.set(`${annee}-03-31`, 'libelle-regul');
    pistes.set(`${annee}-06-26`, 'od-tresorerie');
    pistes.set(`${annee}-06-29`, 'od-chiffre-affaires');
  }

  // ---- Fabriques d'écritures ---------------------------------------------------------------------
  let numFacture = 0;
  let numAvoir = 0;
  let numRecu = 0;
  let numVirement = 0;
  const anneeN = debut.slice(2, 4);

  const vente = (date: string, client: Tiers): EcritureFictive[] => {
    const ht = alea.montantLog(8_000, 2_500_000);
    const t = tva(ht, TAUX_TVA);
    const ttc = ht + t;
    const ref = `FA${anneeN}${String(++numFacture).padStart(5, '0')}`;
    cumulerTva(date, t, 0);
    const avoir = alea.probabilite(0.02);
    const montantAvoirHt = avoir ? Math.round(ht * 0.1) : 0;
    const tAvoir = tva(montantAvoirHt, TAUX_TVA);
    const ttcAvoir = montantAvoirHt + tAvoir;
    const lettrage = reglerPlusTard('client', client, date, ttc - ttcAvoir, ref, {
      impaye: client.role === 'normal' && alea.probabilite(0.025),
      nonLettre: alea.probabilite(0.12),
    });
    const ecritures = [
      ecriture('VT', date, ref, `Facture ${ref} ${client.nom}`, [
        ligne(C.clients[0], C.clients[1], ttc, 0, { ...aux(client), ...lettrage }),
        ligne(C.ventes[0], C.ventes[1], 0, ht),
        ligne(C.tvaCollectee[0], C.tvaCollectee[1], 0, t),
      ]),
    ];
    if (avoir) {
      const refAvoir = `AV${anneeN}${String(++numAvoir).padStart(5, '0')}`;
      cumulerTva(date, -tAvoir, 0);
      ecritures.push(
        ecriture('VT', date, refAvoir, `Avoir ${refAvoir} sur ${ref}`, [
          ligne(C.clients[0], C.clients[1], 0, ttcAvoir, { ...aux(client), ...lettrage }),
          ligne(C.ventes[0], C.ventes[1], montantAvoirHt, 0),
          ligne(C.tvaCollectee[0], C.tvaCollectee[1], tAvoir, 0),
        ]),
      );
    }
    return ecritures;
  };

  const achat = (date: string, f: Tiers, refImposee?: string, htImpose?: number, sansReglement = false): EcritureFictive => {
    const enDevise = f.role === 'devise';
    const ht = htImpose ?? alea.montantLog(enDevise ? 200_000 : 5_000, 3_000_000);
    const t = enDevise ? 0 : tva(ht, TAUX_TVA);
    const ttc = ht + t;
    const montantDevise = enDevise ? Math.round(ht * 1.08) : null;
    const ref = refImposee ?? `${f.num}-${anneeN}${String(alea.entier(10000, 99999))}`;
    cumulerTva(date, 0, t);
    const lettrage = sansReglement
      ? { ecritureLet: '', dateLet: '' }
      : reglerPlusTard('fournisseur', f, date, ttc, ref, {
          delai: f.role === 'volume-solde-nul' ? 10 : undefined,
          nonLettre: f.role === 'normal' && alea.probabilite(0.1),
          montantDevise,
        });
    const devise = enDevise ? { montantDevise, idevise: 'USD' } : {};
    const lignes = [ligne(C.achats[0], C.achats[1], ht, 0, devise)];
    if (t > 0) lignes.push(ligne(C.tvaDeductible[0], C.tvaDeductible[1], t, 0));
    lignes.push(ligne(C.fournisseurs[0], C.fournisseurs[1], 0, ttc, { ...aux(f), ...lettrage, ...devise }));
    return ecriture('AC', date, ref, `Facture ${ref} ${f.nom}`, lignes);
  };

  const reglement = (date: string, r: Reglement): EcritureFictive => {
    const banque = BANQUE_DU_JOURNAL[r.journal];
    const devise = r.montantDevise !== null ? { montantDevise: r.montantDevise, idevise: 'USD' } : {};
    const lettrage = r.code ? { ecritureLet: r.code, dateLet: date } : {};
    if (r.type === 'client') {
      const ref = `RC${anneeN}${String(++numRecu).padStart(5, '0')}`;
      return ecriture(r.journal, date, ref, `Règlement ${r.tiers.nom} ${r.ref}`, [
        ligne(banque[0], banque[1], r.montant, 0),
        ligne(C.clients[0], C.clients[1], 0, r.montant, { ...aux(r.tiers), ...lettrage }),
      ]);
    }
    const ref = `VIR${anneeN}${String(++numVirement).padStart(5, '0')}`;
    return ecriture(r.journal, date, ref, `Virement ${r.tiers.nom} ${r.ref}`, [
      ligne(C.fournisseurs[0], C.fournisseurs[1], r.montant, 0, { ...aux(r.tiers), ...lettrage, ...devise }),
      ligne(banque[0], banque[1], 0, r.montant),
    ]);
  };

  // ---- Paramètres mensuels -----------------------------------------------------------------------
  const brutMensuel = () => arrondi(alea.entier(3_600_000, 4_000_000) * echelle);
  let capitalRestant = capitalEmprunt;
  const urssafDuMois = new Map<string, number>();
  const fournisseurAchat = (date: string): Tiers => {
    for (;;) {
      const f = fournisseurs[alea.indicePondere(poidsFournisseurs)]!;
      if (f.role === 'volume-solde-nul' && date > ajouterJours(cloture, -20)) continue;
      if ((f.role === 'debiteur-double' || f.role === 'debiteur-avoir') && date > ajouterJours(cloture, -60)) continue;
      return f;
    }
  };
  const nombreDuJour = (moyenne: number) => {
    const base = Math.floor(moyenne * (0.6 + 0.8 * alea.suivant()));
    return base + (alea.probabilite(moyenne % 1) ? 1 : 0);
  };

  // ---- Boucle des jours --------------------------------------------------------------------------
  for (let jour = debut; jour <= cloture; jour = ajouterJours(jour, 1)) {
    const ouvre = estJourOuvre(jour);
    const premierOuvre = ouvre && prochainJourOuvre(`${jour.slice(0, 8)}01`) === jour;
    const dernierOuvre = ouvre && dernierJourOuvre(jour) === jour;
    const jourDuMois = Number(jour.slice(8, 10));

    // Loyer : facture le 1er jour ouvré, prélèvement 5 jours plus tard.
    if (premierOuvre) {
      const ht = arrondi(300_000 * echelle);
      const t = tva(ht, TAUX_TVA);
      const ref = `LOY-${jour.slice(0, 7)}`;
      cumulerTva(jour, 0, t);
      const lettrage = reglerPlusTard('fournisseur', fLoyer, jour, ht + t, ref, { delai: 5 });
      yield ecriture('AC', jour, ref, `Loyer ${jour.slice(5, 7)}/${jour.slice(0, 4)} entrepôt`, [
        ligne(C.loyers[0], C.loyers[1], ht, 0),
        ligne(C.tvaDeductible[0], C.tvaDeductible[1], t, 0),
        ligne(C.fournisseurs[0], C.fournisseurs[1], 0, ht + t, { ...aux(fLoyer), ...lettrage }),
      ]);
    }

    // Échéance d'emprunt le 5 (ou jour ouvré suivant).
    if (ouvre && jour === prochainJourOuvre(`${jour.slice(0, 8)}05`) && capitalRestant > 0) {
      const interets = Math.round((capitalRestant * 4) / 1200);
      const capital = Math.min(echeanceCapital, capitalRestant);
      capitalRestant -= capital;
      yield ecriture('BQ1', jour, `ECH-${jour.slice(0, 7)}`, 'Échéance emprunt Banque Alpha', [
        ligne(C.emprunt[0], C.emprunt[1], capital, 0),
        ligne(C.interets[0], C.interets[1], interets, 0),
        ligne(C.banque1[0], C.banque1[1], 0, capital + interets),
      ]);
    }

    for (const dette of dettesOuverture) {
      if (dette.date !== jour) continue;
      yield ecriture('BQ1', jour, `PRL-${jour.slice(0, 7)}-${dette.compte[0]}`, dette.libelle, [
        ligne(dette.compte[0], dette.compte[1], dette.montant, 0),
        ligne(C.banque1[0], C.banque1[1], 0, dette.montant),
      ]);
    }

    // Déclaration de TVA du mois précédent le 20 (ou jour ouvré suivant) et paiement.
    if (ouvre && jour === prochainJourOuvre(`${jour.slice(0, 8)}20`)) {
      const moisPrecedent = ajouterMois(`${jour.slice(0, 8)}01`, -1).slice(0, 7);
      const t = tvaMois.get(moisPrecedent);
      if (t) {
        const solde = t.collectee - t.deductible;
        const lignes = [
          ligne(C.tvaCollectee[0], C.tvaCollectee[1], t.collectee, 0),
          ligne(C.tvaDeductible[0], C.tvaDeductible[1], 0, t.deductible),
          solde >= 0
            ? ligne(C.tvaADecaisser[0], C.tvaADecaisser[1], 0, solde)
            : ligne(C.creditTva[0], C.creditTva[1], -solde, 0),
        ];
        const periode = `${moisPrecedent.slice(5, 7)}/${moisPrecedent.slice(0, 4)}`;
        yield ecriture('OD', jour, `CA3-${moisPrecedent}`, `Déclaration de TVA ${periode}`, lignes);
        if (solde > 0) {
          yield ecriture('BQ1', jour, `TVA-${moisPrecedent}`, `Paiement TVA ${periode}`, [
            ligne(C.tvaADecaisser[0], C.tvaADecaisser[1], solde, 0),
            ligne(C.banque1[0], C.banque1[1], 0, solde),
          ]);
        }
      }
    }

    // Cotisations URSSAF du mois précédent le 15.
    if (ouvre && jour === prochainJourOuvre(`${jour.slice(0, 8)}15`) && jour > ajouterJours(debut, 20)) {
      const moisPrecedent = ajouterMois(`${jour.slice(0, 8)}01`, -1).slice(0, 7);
      const montant = urssafDuMois.get(moisPrecedent);
      if (montant) {
        yield ecriture('BQ1', jour, `URS-${moisPrecedent}`, 'Cotisations URSSAF', [
          ligne(C.urssaf[0], C.urssaf[1], montant, 0),
          ligne(C.banque1[0], C.banque1[1], 0, montant),
        ]);
      }
    }

    // Banque Gamma : frais puis clôture du compte en cours d'exercice (OD touchant la trésorerie).
    if (jour === dateFraisGamma) {
      const frais = 1_800;
      soldeGamma -= frais;
      yield pister('od-tresorerie', ecriture('OD', jour, `GAM-${jour.slice(0, 7)}`, 'Frais de tenue de compte Banque Gamma 18 €', [
        ligne(C.fraisBancaires[0], C.fraisBancaires[1], frais, 0),
        ligne(C.banque3[0], C.banque3[1], 0, frais),
      ]));
    }
    if (jour === dateClotureGamma) {
      yield pister('od-tresorerie', ecriture('OD', jour, 'GAM-CLOTURE', 'Clôture compte Banque Gamma, virement du solde', [
        ligne(C.banque1[0], C.banque1[1], soldeGamma, 0),
        ligne(C.banque3[0], C.banque3[1], 0, soldeGamma),
      ]));
      soldeGamma = 0;
    }
    if (jour === dateAffectation) {
      const legale = Math.round(resultatN1 / 20);
      yield ecriture('OD', jour, 'AG-AFFECT', 'Affectation du résultat N-1 (AGO)', [
        ligne(C.resultat[0], C.resultat[1], resultatN1, 0),
        ligne(C.reserveLegale[0], C.reserveLegale[1], 0, legale),
        ligne(C.autresReserves[0], C.autresReserves[1], 0, resultatN1 - legale),
      ]);
    }

    // Activité courante.
    const piste = pistes.get(jour);
    if (ouvre || piste === 'vente') {
      const nbVentes = piste === 'vente' && !ouvre ? 1 : nombreDuJour(p.ventesParJour);
      for (let k = 0; k < nbVentes; k++) {
        let client = clients[alea.indicePondere(poidsClients)]!;
        if (client.role === 'crediteur' && jour > ajouterJours(cloture, -75)) client = clients[0]!;
        for (const e of vente(jour, client)) {
          if (!ouvre) e.piste = jourFerie(jour) ? 'jour-ferie' : 'week-end';
          yield e;
        }
      }
    }
    if (ouvre) {
      const nbAchats = nombreDuJour(p.achatsParJour);
      for (let k = 0; k < nbAchats; k++) yield achat(jour, fournisseurAchat(jour));
      if (fDevise && jourDuMois === 12) yield achat(jour, fDevise);
    }

    if (piste === 'doublon-achat') {
      const f = fournisseurs[9] ?? fournisseurs[2]!;
      const ref = `${f.num}-${anneeN}77777`;
      const ht = 1_234_500;
      for (const e of [achat(jour, f, ref, ht), achat(jour, f, ref, ht, true)]) {
        e.piste = 'doublon-probable';
        yield e;
      }
    }
    if (piste === 'libelle-divers' || piste === 'libelle-regul') {
      yield pister('libelle-generique', ecriture('OD', jour, `OD-${jour}`, piste === 'libelle-divers' ? 'Divers' : 'Régularisation', [
        ligne(C.fraisBancaires[0], C.fraisBancaires[1], 15_000, 0),
        ligne(C.attente[0], C.attente[1], 0, 15_000),
      ]));
    }
    if (piste === 'od-tresorerie') {
      yield pister('od-tresorerie', ecriture('OD', jour, `OD-${jour}`, 'Virement de régularisation', [
        ligne(C.banque1[0], C.banque1[1], 800_000, 0),
        ligne(C.attente[0], C.attente[1], 0, 800_000),
      ]));
    }
    if (piste === 'od-chiffre-affaires') {
      const client = clients[6] ?? clients[0]!;
      cumulerTva(jour, 250_000, 0);
      yield pister('od-chiffre-affaires', ecriture('OD', jour, `OD-${jour}`, "Régularisation chiffre d'affaires", [
        ligne(C.clients[0], C.clients[1], 1_500_000, 0, aux(client)),
        ligne(C.ventes[0], C.ventes[1], 0, 1_250_000),
        ligne(C.tvaCollectee[0], C.tvaCollectee[1], 0, 250_000),
      ]));
    }

    // Avoir fournisseur reçu après paiement complet : le fournisseur devient débiteur.
    if (jour === dernierJourOuvre(ajouterMois(cloture, -1))) {
      for (const f of fournisseurs) {
        if (f.role !== 'debiteur-avoir') continue;
        const ht = 45_000;
        const t = tva(ht, TAUX_TVA);
        cumulerTva(jour, 0, -t);
        yield ecriture('AC', jour, `${f.num}-AV01`, `Avoir ${f.nom} remise de fin d'année`, [
          ligne(C.fournisseurs[0], C.fournisseurs[1], ht + t, 0, aux(f)),
          ligne(C.achats[0], C.achats[1], 0, ht),
          ligne(C.tvaDeductible[0], C.tvaDeductible[1], 0, t),
        ]);
      }
    }

    for (const r of agenda.get(jour) ?? []) yield reglement(jour, r);
    agenda.delete(jour);

    // Fin de mois : frais bancaires, paie et virement des salaires.
    if (dernierOuvre) {
      for (const journal of ['BQ1', 'BQ2'] as const) {
        const frais = alea.entier(2_500, 6_500);
        yield ecriture(journal, jour, `FRAIS-${jour.slice(0, 7)}`, 'Frais bancaires', [
          ligne(C.fraisBancaires[0], C.fraisBancaires[1], frais, 0),
          ligne(BANQUE_DU_JOURNAL[journal][0], BANQUE_DU_JOURNAL[journal][1], 0, frais),
        ]);
      }
      const brut = brutMensuel();
      const patronales = Math.round(brut * 0.42);
      const salariales = Math.round(brut * 0.22);
      const net = brut - salariales;
      urssafDuMois.set(jour.slice(0, 7), patronales + salariales);
      const periode = `${jour.slice(5, 7)}/${jour.slice(0, 4)}`;
      yield ecriture('OD', jour, `PAIE-${jour.slice(0, 7)}`, `Salaires ${periode}`, [
        ligne(C.salaires[0], C.salaires[1], brut, 0),
        ligne(C.chargesSociales[0], C.chargesSociales[1], patronales, 0),
        ligne(C.remunerations[0], C.remunerations[1], 0, net),
        ligne(C.urssaf[0], C.urssaf[1], 0, patronales + salariales),
      ]);
      yield ecriture('BQ1', jour, `SAL-${jour.slice(0, 7)}`, `Virement salaires ${periode}`, [
        ligne(C.remunerations[0], C.remunerations[1], net, 0),
        ligne(C.banque1[0], C.banque1[1], 0, net),
      ]);
    }
  }

  // ---- Écritures d'inventaire à la date de clôture -----------------------------------------------
  const inv = (ref: string, libelle: string, lignes: LigneFictive[]) => {
    const e = ecriture('OD', cloture, ref, libelle, lignes, validationInventaire);
    if (p.validationApresCloture) e.piste = 'validee-apres-cloture';
    return e;
  };
  const dotation = (compte: Compte, montant: number) => [
    ligne(C.dotations[0], C.dotations[1], montant, 0),
    ligne(compte[0], compte[1], 0, montant),
  ];
  yield inv('INV-AMORT', "Dotations aux amortissements de l'exercice", [
    ...dotation(C.amortMateriel, arrondi(1_600_000 * echelle)),
    ...dotation(C.amortTransport, arrondi(700_000 * echelle)),
    ...dotation(C.amortBureau, arrondi(400_000 * echelle)),
  ]);
  const stockInitial = ouverture.find(([c]) => c === C.stock)![1];
  const stockFinal = arrondi(stockInitial * (0.9 + 0.25 * alea.suivant()));
  yield inv('INV-STOCK', 'Variation des stocks de marchandises', [
    ligne(C.variationStock[0], C.variationStock[1], stockInitial, 0),
    ligne(C.stock[0], C.stock[1], 0, stockInitial),
    ligne(C.stock[0], C.stock[1], stockFinal, 0),
    ligne(C.variationStock[0], C.variationStock[1], 0, stockFinal),
  ]);
  const fnpHt = arrondi(1_850_000 * echelle);
  yield inv('INV-FNP', 'Factures non parvenues', [
    ligne(C.achats[0], C.achats[1], fnpHt, 0),
    ligne(C.tvaFnp[0], C.tvaFnp[1], tva(fnpHt, TAUX_TVA), 0),
    ligne(C.fnp[0], C.fnp[1], 0, fnpHt + tva(fnpHt, TAUX_TVA)),
  ]);
  const faeHt = arrondi(960_000 * echelle);
  yield inv('INV-FAE', 'Factures à établir', [
    ligne(C.fae[0], C.fae[1], faeHt + tva(faeHt, TAUX_TVA), 0),
    ligne(C.ventes[0], C.ventes[1], 0, faeHt),
    ligne(C.tvaFae[0], C.tvaFae[1], 0, tva(faeHt, TAUX_TVA)),
  ]);
  const cca = arrondi(150_000 * echelle);
  yield inv('INV-CCA', "Charges constatées d'avance (loyer)", [
    ligne(C.cca[0], C.cca[1], cca, 0),
    ligne(C.loyers[0], C.loyers[1], 0, cca),
  ]);
}
