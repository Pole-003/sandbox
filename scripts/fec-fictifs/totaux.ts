/**
 * Totaux attendus, calculés par le générateur lui-même (indépendamment du code d'import) :
 * ils servent de référence aux tests de balance et de l'interface Circularisations.
 */
import type { EcritureFictive } from './modele.ts';

export interface TotauxCompte {
  libelle: string;
  /** Solde d'ouverture (à-nouveaux), débit − crédit, en centimes. */
  ouverture: number;
  /** Mouvements de l'exercice hors à-nouveaux. */
  debit: number;
  credit: number;
  /** Solde de clôture = ouverture + débit − crédit. */
  cloture: number;
}

export interface TotauxTiers extends TotauxCompte {
  /** Compte général (collectif) du tiers. */
  compteNum: string;
}

export interface Totaux {
  nbLignes: number;
  nbEcritures: number;
  totalDebit: number;
  totalCredit: number;
  comptes: Record<string, TotauxCompte>;
  /** Clé : CompAuxNum s'il est renseigné, sinon CompteNum (SPEC 4.2). Seuls les comptes 40 et 41 y figurent. */
  tiers: Record<string, TotauxTiers>;
  /** Comptes 512 mouvementés dans l'exercice (y compris soldés à la clôture). */
  banques: string[];
}

export class Totalisateur {
  private readonly t: Totaux = {
    nbLignes: 0,
    nbEcritures: 0,
    totalDebit: 0,
    totalCredit: 0,
    comptes: {},
    tiers: {},
    banques: [],
  };
  private readonly banques = new Set<string>();
  private readonly journalAN: string;

  constructor(journalAN: string) {
    this.journalAN = journalAN;
  }

  ajouter(e: EcritureFictive): void {
    this.t.nbEcritures++;
    const an = e.journalCode === this.journalAN;
    for (const l of e.lignes) {
      this.t.nbLignes++;
      this.t.totalDebit += l.debit;
      this.t.totalCredit += l.credit;
      const cumuler = (cible: TotauxCompte) => {
        if (an) cible.ouverture += l.debit - l.credit;
        else {
          cible.debit += l.debit;
          cible.credit += l.credit;
        }
        cible.cloture += l.debit - l.credit;
      };
      const compte = (this.t.comptes[l.compteNum] ??= {
        libelle: l.compteLib,
        ouverture: 0,
        debit: 0,
        credit: 0,
        cloture: 0,
      });
      cumuler(compte);
      if (/^4[01]/.test(l.compteNum)) {
        const cle = l.compAuxNum || l.compteNum;
        const tiers = (this.t.tiers[cle] ??= {
          compteNum: l.compteNum,
          libelle: l.compAuxLib || l.compteLib,
          ouverture: 0,
          debit: 0,
          credit: 0,
          cloture: 0,
        });
        cumuler(tiers);
      }
      if (!an && l.compteNum.startsWith('512')) this.banques.add(l.compteNum);
    }
  }

  resultat(): Totaux {
    const trier = <T>(o: Record<string, T>) =>
      Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    return {
      ...this.t,
      comptes: trier(this.t.comptes),
      tiers: trier(this.t.tiers),
      banques: [...this.banques].sort(),
    };
  }
}

export function totaliser(ecritures: Iterable<EcritureFictive>, journalAN = 'AN'): Totaux {
  const t = new Totalisateur(journalAN);
  for (const e of ecritures) t.ajouter(e);
  return t.resultat();
}
