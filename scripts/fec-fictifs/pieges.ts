/**
 * FEC « piégés » : le petit FEC propre, dans lequel on injecte des anomalies connues.
 * Chaque piège déclare exactement les constats attendus (code de règle et numéros de ligne du fichier,
 * la ligne 1 étant l'en-tête). Les codes renvoient au tableau des règles (docs/SPEC.md, section 3.2).
 */
import { ajouterJours } from '../../src/core/dates.ts';
import { montantTexte } from './ecriture-fichier.ts';
import type { EcritureFictive, LigneFictive } from './modele.ts';

export interface ConstatAttendu {
  code: string;
  /** Numéros de ligne du fichier concernés (vide pour un constat global). */
  lignes: number[];
  /** Nombre d'occurrences (= nombre de lignes, sauf constats globaux). */
  occurrences: number;
}

export interface Piege {
  nom: string;
  description: string;
  /** Variante d'écriture du fichier (par défaut : format standard). */
  montantSens?: 'montant-sens-pm';
  ecritures: EcritureFictive[];
  /** Calculé après construction, quand les numéros de ligne sont connus. */
  constats: () => ConstatAttendu[];
}

function cloner(ecritures: EcritureFictive[]): EcritureFictive[] {
  return structuredClone(ecritures);
}

function renumeroter(ecritures: EcritureFictive[]): void {
  ecritures.forEach((e, i) => (e.ecritureNum = String(i + 1)));
}

/** Numéro de ligne du fichier de chaque ligne d'écriture (en-tête = 1). */
function numeros(ecritures: EcritureFictive[]): Map<LigneFictive, number> {
  const m = new Map<LigneFictive, number>();
  let n = 1;
  for (const e of ecritures) for (const l of e.lignes) m.set(l, ++n);
  return m;
}

function lignesDe(ecritures: EcritureFictive[], cibles: (EcritureFictive | LigneFictive)[]): number[] {
  const m = numeros(ecritures);
  return cibles
    .flatMap((c) => ('lignes' in c ? c.lignes : [c]))
    .map((l) => m.get(l)!)
    .sort((a, b) => a - b);
}

function parLignes(code: string, ecritures: EcritureFictive[], cibles: (EcritureFictive | LigneFictive)[]): ConstatAttendu {
  const lignes = lignesDe(ecritures, cibles);
  return { code, lignes, occurrences: lignes.length };
}

function global(code: string, occurrences = 1): ConstatAttendu {
  return { code, lignes: [], occurrences };
}

/** n-ième écriture (à partir de 0) d'un journal, éventuellement filtrée. */
function trouver(ecritures: EcritureFictive[], journal: string, rang: number, filtre: (e: EcritureFictive) => boolean = () => true) {
  const e = ecritures.filter((x) => x.journalCode === journal && filtre(x))[rang];
  if (!e) throw new Error(`Écriture ${journal} n° ${rang} introuvable`);
  return e;
}

const estAchat = (e: EcritureFictive) => e.lignes.some((l) => l.compteNum.startsWith('607'));

function ligneDuCompte(e: EcritureFictive, prefixe: string): LigneFictive {
  const l = e.lignes.find((x) => x.compteNum.startsWith(prefixe));
  if (!l) throw new Error(`Pas de ligne ${prefixe} dans l'écriture ${e.ecritureNum}`);
  return l;
}

export function construirePieges(base: EcritureFictive[], debut: string, cloture: string): Piege[] {
  const pieges: Piege[] = [];

  {
    const ecritures = cloner(base);
    const e = trouver(ecritures, 'VT', 10);
    ligneDuCompte(e, '707').credit += 10_000;
    pieges.push({
      nom: 'desequilibre',
      description: "Une facture de vente dont la ligne de chiffre d'affaires est majorée de 100,00 € : écriture, journal VT, mois et total général déséquilibrés.",
      ecritures,
      constats: () => [parLignes('E01', ecritures, [e]), global('E02'), global('E03'), global('E04')],
    });
  }

  {
    const ecritures = cloner(base);
    const a = trouver(ecritures, 'AC', 3);
    const b = trouver(ecritures, 'VT', 20);
    const c = trouver(ecritures, 'VT', 30);
    for (const l of a.lignes) l.brut = { EcritureDate: `${a.ecritureDate.slice(0, 4)}0231` };
    for (const l of b.lignes) l.brut = { PieceDate: `${b.pieceDate.slice(0, 4)}1301` };
    const [annee, mois, jour] = c.ecritureDate.split('-');
    for (const l of c.lignes) l.brut = { EcritureDate: `${jour}/${mois}/${annee}` };
    pieges.push({
      nom: 'dates-invalides',
      description:
        "EcritureDate « AAAA0231 » (31 février) sur une facture d'achat, PieceDate « AAAA1301 » (mois 13) sur une facture de vente : dates inexistantes. Une autre facture de vente porte une EcritureDate valide mais au format JJ/MM/AAAA.",
      ecritures,
      constats: () => [parLignes('D03', ecritures, [a, b]), parLignes('D04', ecritures, [c])],
    });
  }

  {
    const ecritures = cloner(base);
    const apres = trouver(ecritures, 'BQ1', 5, (e) => e.ecritureLib === 'Frais bancaires');
    ecritures.splice(ecritures.indexOf(apres), 1);
    apres.ecritureDate = apres.pieceDate = ajouterJours(cloture, 15);
    apres.validDate = ajouterJours(cloture, 20);
    ecritures.push(apres);
    const avant = trouver(ecritures, 'BQ2', 0);
    ecritures.splice(ecritures.indexOf(avant), 1);
    avant.ecritureDate = avant.pieceDate = ajouterJours(debut, -12);
    avant.validDate = ecritures[0]!.validDate;
    ecritures.splice(1, 0, avant);
    renumeroter(ecritures);
    pieges.push({
      nom: 'hors-exercice',
      description:
        "Une écriture datée 12 jours avant l'ouverture (placée juste après les à-nouveaux) et une écriture de frais bancaires datée 15 jours après la clôture, validée 20 jours après (placée en fin de fichier).",
      ecritures,
      constats: () => [parLignes('E07', ecritures, [avant, apres]), parLignes('E09', ecritures, [apres])],
    });
  }

  {
    const ecritures = cloner(base);
    const cibles: EcritureFictive[] = [];
    let moisPrecedent = '';
    let moisVus = 0;
    for (const e of ecritures) {
      const mois = e.ecritureDate.slice(0, 7);
      if (mois !== moisPrecedent) {
        moisVus++;
        if (moisVus >= 3 && Number(e.ecritureDate.slice(8)) >= 2 && cibles.length < 2) cibles.push(e);
      }
      moisPrecedent = mois;
    }
    for (const e of cibles) e.validDate = ajouterJours(e.ecritureDate, -1);
    pieges.push({
      nom: 'validdate-anterieure',
      description:
        "Deux écritures (les premières de leur mois) validées la veille de leur date de comptabilisation. Elles restent classées dans l'ordre chronologique de validation.",
      ecritures,
      constats: () => [parLignes('E08', ecritures, cibles)],
    });
  }

  {
    const ecritures = cloner(base);
    const iTrou = 40;
    let iDoublon = 80;
    while (ecritures[iDoublon]!.journalCode === ecritures[iDoublon + 1]!.journalCode) iDoublon++;
    let compteur = 0;
    ecritures.forEach((e, i) => {
      if (i === iTrou) compteur += 2;
      if (i === iDoublon + 1) e.ecritureNum = String(compteur);
      else e.ecritureNum = String(++compteur);
    });
    const trou = ecritures[iTrou]!;
    const doublons = [ecritures[iDoublon]!, ecritures[iDoublon + 1]!];
    pieges.push({
      nom: 'numerotation',
      description: `Trou de deux numéros avant l'écriture n° ${trou.ecritureNum} ; le n° ${doublons[0]!.ecritureNum} est porté par deux écritures de journaux différents (${doublons[0]!.journalCode} et ${doublons[1]!.journalCode}).`,
      ecritures,
      constats: () => [
        { code: 'E10', lignes: [lignesDe(ecritures, [trou])[0]!], occurrences: 1 },
        parLignes('E11', ecritures, doublons),
      ],
    });
  }

  {
    const ecritures = cloner(base);
    const l = ligneDuCompte(trouver(ecritures, 'AC', 7, estAchat), '607');
    l.compteLib = 'Achats marchandises';
    pieges.push({
      nom: 'libelle-compte',
      description: '« Achats marchandises » au lieu de « Achats de marchandises » sur une ligne du compte 607000.',
      ecritures,
      constats: () => [parLignes('L01', ecritures, [l])],
    });
  }

  {
    const ecritures = cloner(base);
    const e = trouver(ecritures, 'VT', 15);
    const l411 = ligneDuCompte(e, '411');
    const l707 = ligneDuCompte(e, '707');
    l411.credit = 1_000;
    l707.debit = 1_000;
    pieges.push({
      nom: 'debit-credit-meme-ligne',
      description: "Une facture de vente dont les lignes client et chiffre d'affaires portent chacune un débit et un crédit (10,00 €) ; l'écriture reste équilibrée.",
      ecritures,
      constats: () => [parLignes('D11', ecritures, [l411, l707])],
    });
  }

  {
    const ecritures = cloner(base);
    const a = trouver(ecritures, 'AC', 5).lignes[0]!;
    const b = trouver(ecritures, 'VT', 25).lignes[1]!;
    const c = trouver(ecritures, 'BQ1', 3).lignes[0]!;
    a.brut = { PieceRef: '' };
    b.compteLib = '';
    c.brut = { EcritureLib: '' };
    pieges.push({
      nom: 'zone-obligatoire-vide',
      description: 'PieceRef vide sur une ligne, CompteLib vide sur une autre, EcritureLib vide sur une troisième.',
      ecritures,
      constats: () => [parLignes('D01', ecritures, [a, b, c])],
    });
  }

  {
    const ecritures = cloner(base);
    const a = ligneDuCompte(trouver(ecritures, 'VT', 4), '411');
    const b = ligneDuCompte(trouver(ecritures, 'AC', 9), '401');
    a.compAuxLib = '';
    b.compAuxLib = '';
    pieges.push({
      nom: 'auxiliaire-sans-libelle',
      description: 'CompAuxNum renseigné sans CompAuxLib sur une ligne client et une ligne fournisseur.',
      ecritures,
      constats: () => [parLignes('D13', ecritures, [a, b])],
    });
  }

  {
    const ecritures = cloner(base);
    const enEuros = (e: EcritureFictive) => estAchat(e) && !e.lignes.some((l) => l.idevise);
    const a = ligneDuCompte(trouver(ecritures, 'AC', 2, enEuros), '607');
    const b = ligneDuCompte(trouver(ecritures, 'AC', 6, enEuros), '607');
    a.brut = { Idevise: 'USD' };
    b.brut = { Montantdevise: montantTexte(b.debit) };
    pieges.push({
      nom: 'devise-incomplete',
      description: 'Idevise « USD » sans Montantdevise sur une ligne ; Montantdevise sans Idevise sur une autre.',
      ecritures,
      constats: () => [parLignes('D14', ecritures, [a, b])],
    });
  }

  {
    const ecritures = cloner(base).filter((e) => e.journalCode !== 'AN');
    renumeroter(ecritures);
    pieges.push({
      nom: 'sans-a-nouveaux',
      description: "L'écriture d'à-nouveaux est supprimée (numérotation reprise à 1).",
      ecritures,
      constats: () => [global('E13')],
    });
  }

  {
    const ecritures = cloner(base);
    const tronquee = trouver(ecritures, 'BQ1', 2).lignes[1]!;
    tronquee.zonesEnMoins = 1;
    const compte = ligneDuCompte(
      trouver(ecritures, 'OD', 1, (e) => e.lignes.some((l) => l.compteNum.startsWith('6'))),
      '6',
    );
    compte.compteNum = `X${compte.compteNum.slice(1)}`;
    compte.compteLib = 'Compte mal codifié';
    const montant = trouver(ecritures, 'AC', 11).lignes[0]!;
    montant.brut = { Credit: 'néant' };
    const porteur = trouver(ecritures, 'VT', 35);
    const vide: LigneFictive = { ...porteur.lignes[0]!, brutLigne: '', debit: 0, credit: 0 };
    porteur.lignes.push(vide);
    pieges.push({
      nom: 'structure',
      description:
        "Une ligne à laquelle il manque la dernière zone, un CompteNum ne commençant pas par trois chiffres, un montant non numérique (« néant » au lieu de 0,00) et une ligne vide.",
      ecritures,
      constats: () => [
        parLignes('S11', ecritures, [tronquee]),
        parLignes('D10', ecritures, [compte]),
        parLignes('D05', ecritures, [montant]),
        parLignes('S12', ecritures, [vide]),
      ],
    });
  }

  {
    const ecritures = cloner(base);
    const l = trouver(ecritures, 'VT', 12).lignes[0]!;
    l.brut = { Sens: '+ 1' };
    pieges.push({
      nom: 'sens-invalide',
      description: 'Variante Montant/Sens (+1/-1) dont une ligne porte le sens « + 1 » (espace interdit par le X de l\'article A47 A-1).',
      montantSens: 'montant-sens-pm',
      ecritures,
      constats: () => [parLignes('D09', ecritures, [l])],
    });
  }

  return pieges;
}
