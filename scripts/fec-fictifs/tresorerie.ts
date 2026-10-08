/**
 * Comptabilités de trésorerie (recettes-dépenses) fictives : BNC (A47 A-1 VIII 7°, 22 zones)
 * et BA (VIII 5°, 21 zones). Les zones DateRglt, ModeRglt, NatOp (et IdClient en BNC) sont renseignées.
 */
import { ajouterJours, estJourOuvre, finDeMois } from '../../src/core/dates.ts';
import { Alea } from './alea.ts';
import { ligne, type EcritureFictive, type Societe } from './modele.ts';

interface Nature {
  compte: readonly [string, string];
  natOp: string;
  sens: 'recette' | 'depense';
  min: number;
  max: number;
  frequence: number;
}

const NATURES_BNC: Nature[] = [
  { compte: ['706000', 'Honoraires'], natOp: "Honoraires mission de maîtrise d'œuvre", sens: 'recette', min: 80_000, max: 1_500_000, frequence: 5 },
  { compte: ['706100', 'Honoraires esquisse'], natOp: 'Honoraires esquisse', sens: 'recette', min: 30_000, max: 300_000, frequence: 2 },
  { compte: ['613200', 'Loyer du cabinet'], natOp: 'Loyer cabinet', sens: 'depense', min: 120_000, max: 120_000, frequence: 1 },
  { compte: ['606400', 'Fournitures de bureau'], natOp: 'Fournitures', sens: 'depense', min: 1_500, max: 40_000, frequence: 2 },
  { compte: ['625100', 'Frais de déplacement'], natOp: 'Déplacements chantier', sens: 'depense', min: 2_000, max: 25_000, frequence: 2 },
  { compte: ['651000', 'Licences logicielles'], natOp: 'Abonnement logiciel de CAO', sens: 'depense', min: 9_900, max: 9_900, frequence: 1 },
];

const NATURES_BA: Nature[] = [
  { compte: ['701100', 'Ventes de céréales'], natOp: 'Vente de blé tendre', sens: 'recette', min: 150_000, max: 2_500_000, frequence: 3 },
  { compte: ['741000', "Aides et subventions d'exploitation"], natOp: 'Aides PAC', sens: 'recette', min: 400_000, max: 1_200_000, frequence: 1 },
  { compte: ['601200', 'Engrais et amendements'], natOp: 'Achat engrais', sens: 'depense', min: 50_000, max: 800_000, frequence: 2 },
  { compte: ['606100', 'Carburants'], natOp: 'Gazole non routier', sens: 'depense', min: 20_000, max: 250_000, frequence: 2 },
  { compte: ['615500', 'Entretien du matériel'], natOp: 'Réparation tracteur', sens: 'depense', min: 15_000, max: 300_000, frequence: 1 },
];

const MODES = ['VIR', 'CHQ', 'CB', 'PRLV'];

export function genererTresorerie(societe: Societe, graine: number): EcritureFictive[] {
  const alea = new Alea(graine);
  const bnc = societe.regime === 'bnc-tresorerie';
  const natures = bnc ? NATURES_BNC : NATURES_BA;
  const cumul: number[] = [];
  natures.reduce((s, n) => (cumul.push(s + n.frequence), s + n.frequence), 0);
  const banque = ['512000', 'Banque'] as const;
  const ecritures: EcritureFictive[] = [];
  let num = 0;
  const ecrire = (e: Omit<EcritureFictive, 'ecritureNum' | 'journalCode' | 'journalLib'>, journal = ['BQ', 'Banque']) =>
    ecritures.push({ journalCode: journal[0]!, journalLib: journal[1]!, ecritureNum: String(++num), ...e });

  const soldeInitial = alea.entier(500_000, 2_000_000);
  ecrire({
    ecritureDate: societe.debut,
    pieceRef: 'AN',
    pieceDate: societe.debut,
    ecritureLib: 'A nouveaux',
    validDate: finDeMois(societe.debut),
    dateRglt: societe.debut,
    modeRglt: 'Report',
    natOp: 'Reprise du solde de trésorerie',
    idClient: bnc ? '' : undefined,
    lignes: [ligne(banque[0], banque[1], soldeInitial, 0), ligne('108000', "Compte de l'exploitant", 0, soldeInitial)],
  }, ['AN', 'A-nouveaux']);

  let piece = 0;
  for (let jour = societe.debut; jour <= societe.cloture; jour = ajouterJours(jour, 1)) {
    if (!estJourOuvre(jour) || !alea.probabilite(0.45)) continue;
    const nature = natures[alea.indicePondere(cumul)]!;
    const montant = nature.min === nature.max ? nature.min : alea.montantLog(nature.min, nature.max);
    const mode = alea.choix(MODES);
    const reference = `${nature.sens === 'recette' ? 'R' : 'D'}${String(++piece).padStart(4, '0')}`;
    const idClient = bnc && nature.sens === 'recette' ? `CLI${String(alea.entier(1, 25)).padStart(3, '0')}` : '';
    const dateDocument = ajouterJours(jour, -alea.entier(0, 10));
    const lignes =
      nature.sens === 'recette'
        ? [ligne(banque[0], banque[1], montant, 0), ligne(nature.compte[0], nature.compte[1], 0, montant)]
        : [ligne(nature.compte[0], nature.compte[1], montant, 0), ligne(banque[0], banque[1], 0, montant)];
    ecrire({
      ecritureDate: jour,
      pieceRef: reference,
      pieceDate: dateDocument < societe.debut ? societe.debut : dateDocument,
      ecritureLib: `${nature.natOp}${idClient ? ` ${idClient}` : ''}`,
      validDate: finDeMois(jour),
      dateRglt: jour,
      modeRglt: mode,
      natOp: nature.natOp,
      idClient: bnc ? idClient : undefined,
      lignes,
    });
  }
  return ecritures;
}
