/**
 * Sélection des tiers et banques à circulariser (SPEC 4.2). Fonction pure : mêmes données FEC,
 * mêmes paramètres et même graine donnent exactement la même sélection.
 */
import type { CompteBancaireFec, DonneesFec, SoldeTiersFec } from '../fec/interface-circularisations.ts';
import { tirageSansRemise } from './alea.ts';
import { proposerEtablissement, seuilEffectif, type ParametresCircularisation, type ParametresPopulation, type Population } from './parametres.ts';

/** Source minimale : l'interface du module FEC (ou un double en test). */
export type SourceSelection = Pick<DonneesFec, 'soldesParTiers' | 'comptesBancaires'>;

export type Motif = 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'F1' | 'F2' | 'F3' | 'F4' | 'F5';

export const LIBELLES_MOTIFS: Record<Motif, string> = {
  C1: 'Solde débiteur ≥ seuil',
  C2: 'Mouvements débiteurs de l’exercice ≥ seuil',
  C3: 'Solde anormal (client créditeur)',
  C4: 'Tirage aléatoire',
  C5: 'Ajout manuel',
  F1: 'Solde créditeur ≥ seuil',
  F2: 'Mouvements créditeurs de l’exercice ≥ seuil',
  F3: 'Solde anormal (fournisseur débiteur)',
  F4: 'Tirage aléatoire',
  F5: 'Ajout manuel',
};

export type Methode = 'Exhaustive' | 'Seuil' | 'Aléatoire' | 'Manuelle';

export interface TiersCandidat {
  cle: string;
  compAuxNum: string | null;
  libelle: string;
  comptes: string[];
  /** Solde de clôture signé (débit − crédit), comptes d'avances compris. */
  solde: number;
  /** Solde hors comptes d'avances (test du solde anormal). */
  soldeHorsAvances: number;
  /** Mouvements de l'exercice hors à-nouveaux. */
  debit: number;
  credit: number;
  motifs: Motif[];
  retenu: boolean;
  methode: Methode | null;
  /** Exclusion manuelle (motifs conservés pour la traçabilité). */
  exclusion: string | null;
  /** Justification d'un ajout manuel. */
  justificationAjout: string | null;
  /** Rang dans le tirage aléatoire (1 = premier tiré). */
  rangTirage: number | null;
  anormal: boolean;
}

export interface Indicateurs {
  nbSelectionnes: number;
  nbTotal: number;
  /** Couverture en valeur absolue des soldes : Σ |solde| retenus / Σ |solde| (0 à 1, null si total nul). */
  couvertureSoldes: number | null;
  /** Couverture des mouvements (débit clients, crédit fournisseurs). */
  couvertureMouvements: number | null;
  nbAnormaux: number;
}

export interface ResultatPopulation {
  population: Population;
  seuils: { solde: number | null; mouvements: number | null };
  /** Tous les tiers de la population, triés par clé. */
  tiers: TiersCandidat[];
  indicateurs: Indicateurs;
}

export interface Etablissement {
  etablissement: string;
  comptes: CompteBancaireFec[];
  solde: number;
  debit: number;
  credit: number;
}

export interface Selection {
  graine: number;
  banques: { comptes: CompteBancaireFec[]; etablissements: Etablissement[] };
  clients: ResultatPopulation;
  fournisseurs: ResultatPopulation;
}

const CODES: Record<Population, { solde: Motif; mouvements: Motif; anormal: Motif; aleatoire: Motif; manuel: Motif }> = {
  clients: { solde: 'C1', mouvements: 'C2', anormal: 'C3', aleatoire: 'C4', manuel: 'C5' },
  fournisseurs: { solde: 'F1', mouvements: 'F2', anormal: 'F3', aleatoire: 'F4', manuel: 'F5' },
};

/** Graine propre à chaque population, dérivée de la graine du dossier (tirages indépendants). */
export function graineDe(graine: number, population: Population): number {
  return (graine ^ (population === 'clients' ? 0x9e3779b9 : 0x85ebca6b)) >>> 0;
}

function selectionnerPopulation(
  source: SourceSelection,
  population: Population,
  p: ParametresPopulation,
  parametres: ParametresCircularisation,
): ResultatPopulation {
  const codes = CODES[population];
  const clients = population === 'clients';
  const complets = source.soldesParTiers(p.prefixes, p.exclus);
  const horsAvances = new Map(source.soldesParTiers(p.prefixes, [...p.exclus, ...p.avances]).map((t) => [t.cle, t.cloture]));
  const seuilSolde = p.solde.actif ? seuilEffectif(p.solde, parametres.sp) : null;
  const seuilMouvements = p.mouvements.actif ? seuilEffectif(p.mouvements, parametres.sp) : null;

  const tiers: TiersCandidat[] = complets
    .map((t: SoldeTiersFec) => {
      const soldeHorsAvances = horsAvances.get(t.cle) ?? 0;
      const anormal = clients ? soldeHorsAvances < 0 : soldeHorsAvances > 0;
      const motifs: Motif[] = [];
      const soldeSens = clients ? t.cloture : -t.cloture;
      if (seuilSolde !== null && soldeSens > 0 && soldeSens >= seuilSolde) motifs.push(codes.solde);
      const mouvement = clients ? t.debit : t.credit;
      if (seuilMouvements !== null && mouvement > 0 && mouvement >= seuilMouvements) motifs.push(codes.mouvements);
      if (p.anormal.actif && anormal) motifs.push(codes.anormal);
      return {
        cle: t.cle,
        compAuxNum: t.compAuxNum,
        libelle: t.libelle,
        comptes: t.comptes,
        solde: t.cloture,
        soldeHorsAvances,
        debit: t.debit,
        credit: t.credit,
        motifs,
        retenu: false,
        methode: null,
        exclusion: null,
        justificationAjout: null,
        rangTirage: null,
        anormal,
      };
    })
    .sort((a, b) => (a.cle < b.cle ? -1 : a.cle > b.cle ? 1 : 0));

  // Tirage aléatoire parmi les tiers non retenus par les critères précédents et à solde non nul.
  if (p.aleatoire.actif && p.aleatoire.nombre > 0) {
    const candidats = tiers.filter((t) => t.motifs.length === 0 && t.solde !== 0);
    tirageSansRemise(candidats, p.aleatoire.nombre, graineDe(parametres.graine, population)).forEach((t, rang) => {
      t.motifs.push(codes.aleatoire);
      t.rangTirage = rang + 1;
    });
  }

  // Décisions manuelles (la dernière décision sur un tiers l'emporte) ; justification obligatoire.
  const parCle = new Map(tiers.map((t) => [t.cle, t]));
  for (const d of parametres.manuels) {
    if (d.population !== population || !d.justification.trim()) continue;
    const t = parCle.get(d.cle);
    if (!t) continue;
    if (d.action === 'ajout') {
      if (!t.motifs.includes(codes.manuel)) t.motifs.push(codes.manuel);
      t.justificationAjout = d.justification.trim();
      t.exclusion = null;
    } else {
      t.exclusion = d.justification.trim();
      t.motifs = t.motifs.filter((m) => m !== codes.manuel);
      t.justificationAjout = null;
    }
  }

  for (const t of tiers) {
    t.retenu = t.motifs.length > 0 && t.exclusion === null;
    t.methode = !t.retenu
      ? null
      : t.motifs.some((m) => m === codes.solde || m === codes.mouvements || m === codes.anormal)
        ? 'Seuil'
        : t.motifs.includes(codes.aleatoire)
          ? 'Aléatoire'
          : 'Manuelle';
  }

  const retenus = tiers.filter((t) => t.retenu);
  const somme = (liste: TiersCandidat[], f: (t: TiersCandidat) => number) => liste.reduce((s, t) => s + f(t), 0);
  const totalSoldes = somme(tiers, (t) => Math.abs(t.solde));
  const mouvements = (t: TiersCandidat) => (clients ? t.debit : t.credit);
  const totalMouvements = somme(tiers, mouvements);
  return {
    population,
    seuils: { solde: seuilSolde, mouvements: seuilMouvements },
    tiers,
    indicateurs: {
      nbSelectionnes: retenus.length,
      nbTotal: tiers.length,
      couvertureSoldes: totalSoldes ? somme(retenus, (t) => Math.abs(t.solde)) / totalSoldes : null,
      couvertureMouvements: totalMouvements ? somme(retenus, mouvements) / totalMouvements : null,
      nbAnormaux: tiers.filter((t) => t.anormal).length,
    },
  };
}

export function selectionner(source: SourceSelection, parametres: ParametresCircularisation): Selection {
  const prefixes = [...parametres.banques.prefixes, ...(parametres.banques.inclureVmp ? ['50'] : [])];
  const comptes = source.comptesBancaires(prefixes);
  const parEtablissement = new Map<string, Etablissement>();
  for (const c of comptes) {
    const nom = parametres.banques.etablissements[c.compteNum] ?? proposerEtablissement(c.compteLib);
    const cle = nom === 'À préciser' ? `À préciser (${c.compteNum})` : nom;
    let e = parEtablissement.get(cle);
    if (!e) parEtablissement.set(cle, (e = { etablissement: cle, comptes: [], solde: 0, debit: 0, credit: 0 }));
    e.comptes.push(c);
    e.solde += c.cloture;
    e.debit += c.debit;
    e.credit += c.credit;
  }
  return {
    graine: parametres.graine,
    banques: { comptes, etablissements: [...parEtablissement.values()].sort((a, b) => a.etablissement.localeCompare(b.etablissement, 'fr')) },
    clients: selectionnerPopulation(source, 'clients', parametres.clients, parametres),
    fournisseurs: selectionnerPopulation(source, 'fournisseurs', parametres.fournisseurs, parametres),
  };
}
