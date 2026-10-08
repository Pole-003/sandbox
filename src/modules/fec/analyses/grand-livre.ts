/**
 * Grand-livre : lignes triées par compte puis date, filtres et solde progressif par compte.
 * Conçu pour des millions de lignes : l'ordre global est calculé une fois, les filtres le parcourent
 * en un seul passage et le résultat est un tableau d'indices (affichage virtualisé).
 */
import type { ContexteAnalyse } from './contexte.ts';

export interface FiltresGrandLivre {
  /** Début du numéro de compte (ex. « 411 »). */
  compte?: string;
  /** CompAuxNum exact. */
  auxiliaire?: string;
  journal?: string;
  /** Période (ISO, bornes incluses). */
  du?: string;
  au?: string;
  /** Montant de la ligne (débit ou crédit), en centimes. */
  montantMin?: number;
  montantMax?: number;
  /** Texte recherché dans le libellé d'écriture, la pièce ou le libellé du compte (sans casse ni accents). */
  libelle?: string;
  lettrage?: 'tous' | 'lettre' | 'non-lettre';
}

export interface GrandLivre {
  /** Indices de lignes, dans l'ordre d'affichage. */
  lignes: Uint32Array;
  /** Solde progressif (débit − crédit) par compte, aligné sur `lignes`. */
  soldes: Float64Array;
  totalDebit: number;
  totalCredit: number;
}

const ordres = new WeakMap<ContexteAnalyse, Uint32Array>();

/** Ordre global : compte, à-nouveaux d'abord, date d'écriture, puis ordre du fichier. */
export function ordreGrandLivre(ctx: ContexteAnalyse): Uint32Array {
  const deja = ordres.get(ctx);
  if (deja) return deja;
  const { f } = ctx;
  // Rang alphabétique de chaque numéro de compte.
  const comptes = [...new Set(f.compteNum)].sort((a, b) => (f.textes[a]! < f.textes[b]! ? -1 : f.textes[a]! > f.textes[b]! ? 1 : 0));
  const rang = new Uint32Array(f.textes.length);
  comptes.forEach((c, r) => (rang[c] = r));
  const cle = new Float64Array(f.nbLignes);
  for (let i = 0; i < f.nbLignes; i++) {
    const date = ctx.an[i] ? 0 : Math.max(0, f.ecritureDate[i]!);
    // rang × 10^8 + date (AAAAMMJJ < 10^8) : exact en double précision.
    cle[i] = rang[f.compteNum[i]!]! * 1e8 + date;
  }
  const ordre = new Uint32Array(f.nbLignes);
  for (let i = 0; i < f.nbLignes; i++) ordre[i] = i;
  ordre.sort((a, b) => cle[a]! - cle[b]! || a - b);
  ordres.set(ctx, ordre);
  return ordre;
}

const normalisations = new WeakMap<string[], string[]>();

function normaliser(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Textes du dictionnaire normalisés (minuscules sans accents), calculés une fois. */
function textesNormalises(textes: string[]): string[] {
  let n = normalisations.get(textes);
  if (!n) normalisations.set(textes, (n = textes.map(normaliser)));
  return n;
}

export function filtrerGrandLivre(ctx: ContexteAnalyse, filtres: FiltresGrandLivre): GrandLivre {
  const { f } = ctx;
  const ordre = ordreGrandLivre(ctx);
  const du = filtres.du ? Number(filtres.du.replaceAll('-', '')) : 0;
  const au = filtres.au ? Number(filtres.au.replaceAll('-', '')) : 99999999;
  const compte = filtres.compte?.trim() ?? '';
  const comptesRetenus = compte ? new Uint8Array(f.textes.length) : null;
  if (comptesRetenus) for (const c of new Set(f.compteNum)) if (f.textes[c]!.startsWith(compte)) comptesRetenus[c] = 1;
  const indiceTexte = (valeur: string | undefined) => (valeur ? f.textes.indexOf(valeur.trim()) : -2);
  const aux = indiceTexte(filtres.auxiliaire);
  const journal = indiceTexte(filtres.journal);
  const recherche = filtres.libelle?.trim() ? normaliser(filtres.libelle.trim()) : '';
  let correspond: Uint8Array | null = null;
  if (recherche) {
    const n = textesNormalises(f.textes);
    correspond = new Uint8Array(n.length);
    for (let k = 0; k < n.length; k++) if (n[k]!.includes(recherche)) correspond[k] = 1;
  }
  const min = filtres.montantMin ?? 0;
  const max = filtres.montantMax ?? Number.POSITIVE_INFINITY;
  const lettrage = filtres.lettrage ?? 'tous';

  const lignes = new Uint32Array(f.nbLignes);
  let n = 0;
  for (let x = 0; x < ordre.length; x++) {
    const i = ordre[x]!;
    if (comptesRetenus && !comptesRetenus[f.compteNum[i]!]) continue;
    if (aux !== -2 && f.compAuxNum[i] !== aux) continue;
    if (journal !== -2 && f.journalCode[i] !== journal) continue;
    const d = f.ecritureDate[i]!;
    if ((filtres.du || filtres.au) && (d < du || d > au)) continue;
    const m = f.debit[i]! || f.credit[i]!;
    if (m < min || m > max) continue;
    if (lettrage === 'lettre' && f.ecritureLet[i] === 0) continue;
    if (lettrage === 'non-lettre' && f.ecritureLet[i] !== 0) continue;
    if (correspond && !correspond[f.ecritureLib[i]!] && !correspond[f.pieceRef[i]!] && !correspond[f.compteLib[i]!] && !correspond[f.compAuxLib[i]!]) continue;
    lignes[n++] = i;
  }
  const resultat = lignes.slice(0, n);
  const soldes = new Float64Array(n);
  let solde = 0;
  let comptePrecedent = -1;
  let totalDebit = 0;
  let totalCredit = 0;
  for (let k = 0; k < n; k++) {
    const i = resultat[k]!;
    if (f.compteNum[i] !== comptePrecedent) {
      solde = 0;
      comptePrecedent = f.compteNum[i]!;
    }
    solde += f.debit[i]! - f.credit[i]!;
    soldes[k] = solde;
    totalDebit += f.debit[i]!;
    totalCredit += f.credit[i]!;
  }
  return { lignes: resultat, soldes, totalDebit, totalCredit };
}

const lignesParEcriture = new WeakMap<ContexteAnalyse, { debut: Uint32Array; lignes: Uint32Array }>();

/** Toutes les lignes d'une écriture (JournalCode + EcritureNum), dans l'ordre du fichier. */
export function lignesEcriture(ctx: ContexteAnalyse, ecriture: number): Uint32Array {
  let index = lignesParEcriture.get(ctx);
  if (!index) {
    const { f } = ctx;
    const compte = new Uint32Array(f.nbEcritures + 1);
    for (let i = 0; i < f.nbLignes; i++) compte[f.ecriture[i]! + 1]!++;
    for (let e = 0; e < f.nbEcritures; e++) compte[e + 1]! += compte[e]!;
    const debut = compte.slice();
    const lignes = new Uint32Array(f.nbLignes);
    const position = compte.slice(0, f.nbEcritures);
    for (let i = 0; i < f.nbLignes; i++) lignes[position[f.ecriture[i]!]!++] = i;
    index = { debut, lignes };
    lignesParEcriture.set(ctx, index);
  }
  return index.lignes.subarray(index.debut[ecriture]!, index.debut[ecriture + 1]!);
}
