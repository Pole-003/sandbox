/**
 * Contrôles de conformité portant sur l'ensemble du FEC normalisé (règles L et E).
 * Fonction pure, relancée si l'utilisateur modifie l'exercice ou le journal d'à-nouveaux.
 */
import { formaterMontant } from '../../../core/format.ts';
import type { FecColonnes } from '../donnees/colonnes.ts';
import { dateNombre } from '../import/valeurs.ts';
import { filtreAN, type JournalAN } from '../metadonnees.ts';
import { Constats, type Constat } from './constats.ts';

export interface ContexteControle {
  debut: string;
  fin: string;
  journalAN: JournalAN | null;
  /** En XML, les écritures sont regroupées par journal (schéma) : l'ordre de validation n'est pas contrôlé (E12). */
  xml?: boolean;
}

export type ModeNumerotation = 'globale' | 'par-journal';

/** Lignes dont le libellé diffère du libellé majoritaire de la clé (libellés vides ignorés). */
function libellesMinoritaires(f: FecColonnes, cles: Uint32Array, libelles: Uint32Array, code: string, k: Constats): void {
  const comptes = new Map<number, Map<number, number>>();
  for (let i = 0; i < f.nbLignes; i++) {
    const cle = cles[i]!;
    const lib = libelles[i]!;
    if (cle === 0 || lib === 0) continue;
    let m = comptes.get(cle);
    if (!m) comptes.set(cle, (m = new Map()));
    m.set(lib, (m.get(lib) ?? 0) + 1);
  }
  const majoritaire = new Map<number, number>();
  for (const [cle, m] of comptes) {
    if (m.size < 2) continue;
    let meilleur = -1;
    let n = -1;
    for (const [lib, c] of m) if (c > n) [meilleur, n] = [lib, c];
    majoritaire.set(cle, meilleur);
    k.detail(code, `${f.textes[cle]} : ${[...m.keys()].map((l) => `« ${f.textes[l]} »`).join(', ')}`);
  }
  if (majoritaire.size === 0) return;
  for (let i = 0; i < f.nbLignes; i++) {
    const attendu = majoritaire.get(cles[i]!);
    if (attendu !== undefined && libelles[i] !== 0 && libelles[i] !== attendu) k.ligne(code, f.ligneOrigine[i]!);
  }
}

/** Partie numérique finale d'un numéro d'écriture (« VT000123 » → préfixe « VT », 123). */
function decomposerNumero(num: string): { prefixe: string; n: number } | null {
  const r = /^(.*?)(\d{1,15})$/.exec(num.trim());
  return r ? { prefixe: r[1]!, n: Number(r[2]) } : null;
}

export function modeNumerotation(f: FecColonnes): ModeNumerotation {
  const numeros = new Set<number>();
  for (let i = 0; i < f.nbLignes; i++) numeros.add(f.ecritureNum[i]!);
  // Un numéro réutilisé dans plusieurs journaux pour plus de 1 % des écritures : numérotation par journal (BOFiP § 100).
  return numeros.size >= 0.99 * f.nbEcritures ? 'globale' : 'par-journal';
}

export function controlerColonnes(f: FecColonnes, ctx: ContexteControle): Constat[] {
  const k = new Constats();
  const n = f.nbLignes;
  const E = f.nbEcritures;
  const debut = dateNombre(ctx.debut);
  const fin = dateNombre(ctx.fin);
  const estAN = filtreAN(f, ctx.journalAN);
  const lo = f.ligneOrigine;

  // ---- Libellés ----------------------------------------------------------------------------------
  libellesMinoritaires(f, f.compteNum, f.compteLib, 'L01', k);
  libellesMinoritaires(f, f.journalCode, f.journalLib, 'L02', k);
  libellesMinoritaires(f, f.compAuxNum, f.compAuxLib, 'L03', k);
  const comptesDuTiers = new Map<number, Set<number>>();
  for (let i = 0; i < n; i++) {
    const a = f.compAuxNum[i]!;
    if (a === 0) continue;
    let s = comptesDuTiers.get(a);
    if (!s) comptesDuTiers.set(a, (s = new Set()));
    s.add(f.compteNum[i]!);
  }
  for (const [a, s] of comptesDuTiers) {
    if (s.size > 1) k.global('L04', `${f.textes[a]} : ${[...s].map((c) => f.textes[c]).join(', ')}`);
  }

  // ---- Écritures : équilibre, lignes, dates --------------------------------------------------------
  const solde = new Float64Array(E);
  const nbLignes = new Uint32Array(E);
  const dateEcr = new Int32Array(E).fill(-2);
  const dateValid = new Int32Array(E).fill(-2);
  const datesMultiples = new Uint8Array(E);
  const premiereLigne = new Uint32Array(E);
  const journalEcr = new Uint32Array(E);
  const numEcr = new Uint32Array(E);
  const fragmentee = new Uint8Array(E);
  const vue = new Uint8Array(E);
  let precedente = -1;
  let totalDebit = 0;
  let totalCredit = 0;
  const parJournal = new Map<number, number>();
  const parMois = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const e = f.ecriture[i]!;
    const montant = f.debit[i]! - f.credit[i]!;
    totalDebit += f.debit[i]!;
    totalCredit += f.credit[i]!;
    solde[e] = solde[e]! + montant;
    parJournal.set(f.journalCode[i]!, (parJournal.get(f.journalCode[i]!) ?? 0) + montant);
    const d = f.ecritureDate[i]!;
    if (d > 0) {
      const mois = Math.floor(d / 100);
      parMois.set(mois, (parMois.get(mois) ?? 0) + montant);
    }
    if (nbLignes[e] === 0) {
      premiereLigne[e] = i;
      journalEcr[e] = f.journalCode[i]!;
      numEcr[e] = f.ecritureNum[i]!;
    }
    nbLignes[e]!++;
    if (vue[e] && precedente !== e) fragmentee[e] = 1;
    vue[e] = 1;
    precedente = e;
    for (const [col, tab] of [
      [f.ecritureDate, dateEcr],
      [f.validDate, dateValid],
    ] as const) {
      const v = col[i]!;
      if (v <= 0) continue;
      if (tab[e] === -2) tab[e] = v;
      else if (tab[e] !== v) datesMultiples[e] = 1;
    }
  }
  const ecrituresDesequilibrees = new Uint8Array(E);
  for (let e = 0; e < E; e++) if (Math.abs(solde[e]!) > 0.5) ecrituresDesequilibrees[e] = 1;
  for (let i = 0; i < n; i++) {
    const e = f.ecriture[i]!;
    if (ecrituresDesequilibrees[e]) k.ligne('E01', lo[i]!);
    if (nbLignes[e] === 1) k.ligne('E05', lo[i]!);
    if (datesMultiples[e]) k.ligne('E06', lo[i]!);
  }
  if (Math.round(totalDebit) !== Math.round(totalCredit)) {
    k.global('E02', `Débit ${formaterMontant(Math.round(totalDebit))} − crédit ${formaterMontant(Math.round(totalCredit))} = ${formaterMontant(Math.round(totalDebit - totalCredit))}`);
  }
  for (const [j, s] of parJournal) if (Math.abs(s) > 0.5) k.global('E03', `${f.textes[j]} : écart ${formaterMontant(Math.round(s))}`);
  for (const [m, s] of [...parMois].sort((a, b) => a[0] - b[0])) {
    if (Math.abs(s) > 0.5) k.global('E04', `${String(m).slice(4)}/${String(m).slice(0, 4)} : écart ${formaterMontant(Math.round(s))}`);
  }

  let maxValid = 0;
  for (let i = 0; i < n; i++) {
    const d = f.ecritureDate[i]!;
    const v = f.validDate[i]!;
    if (d > 0 && (d < debut || d > fin)) k.ligne('E07', lo[i]!);
    if (d > 0 && v > 0 && v < d) k.ligne('E08', lo[i]!);
    if (v > fin) k.ligne('E09', lo[i]!);
    if (v > 0 && !ctx.xml) {
      if (v < maxValid) k.ligne('E12', lo[i]!);
      else maxValid = v;
    }
  }

  // ---- Numérotation ------------------------------------------------------------------------------
  const mode = modeNumerotation(f);
  const ecrituresAN = new Uint8Array(E);
  for (let i = 0; i < n; i++) if (estAN(i)) ecrituresAN[f.ecriture[i]!] = 1;
  const sequences = new Map<string, { n: number; e: number }[]>();
  const journauxDuNumero = new Map<number, Set<number>>();
  for (let e = 0; e < E; e++) {
    const num = f.textes[numEcr[e]!]!;
    const d = decomposerNumero(num);
    if (!d) continue;
    const cle = mode === 'globale' ? d.prefixe : `${journalEcr[e]}\u0000${d.prefixe}`;
    let s = sequences.get(cle);
    if (!s) sequences.set(cle, (s = []));
    s.push({ n: d.n, e });
    if (mode === 'globale') {
      let j = journauxDuNumero.get(numEcr[e]!);
      if (!j) journauxDuNumero.set(numEcr[e]!, (j = new Set()));
      j.add(e);
    }
  }
  const enDouble = new Uint8Array(E);
  for (let e = 0; e < E; e++) if (fragmentee[e]) enDouble[e] = 1;
  for (const ecritures of journauxDuNumero.values()) if (ecritures.size > 1) for (const e of ecritures) enDouble[e] = 1;
  const debutTrou = new Uint8Array(E);
  const inversion = new Uint8Array(E);
  for (const s of sequences.values()) {
    s.sort((a, b) => a.n - b.n || a.e - b.e);
    let maxDate = 0;
    for (let x = 0; x < s.length; x++) {
      const { n: num, e } = s[x]!;
      if (x > 0 && num - s[x - 1]!.n > 1) {
        debutTrou[e] = 1;
        const de = s[x - 1]!.n + 1;
        k.detail('E10', de === num - 1 ? `n° ${de} manquant` : `n° ${de} à ${num - 1} manquants`);
      }
      if (ecrituresAN[e]) continue;
      const d = dateEcr[e]!;
      if (d > 0) {
        if (d < maxDate) inversion[e] = 1;
        else maxDate = d;
      }
    }
    if (mode === 'globale') {
      let maxAN = -1;
      let minAutre = Number.MAX_SAFE_INTEGER;
      for (const { n: num, e } of s) {
        if (ecrituresAN[e]) maxAN = Math.max(maxAN, num);
        else minAutre = Math.min(minAutre, num);
      }
      if (maxAN > minAutre) k.global('E14', `à-nouveaux jusqu'au n° ${maxAN}, première autre écriture n° ${minAutre}`);
    }
  }
  for (let e = 0; e < E; e++) if (debutTrou[e]) k.ligne('E10', lo[premiereLigne[e]!]!);
  for (let i = 0; i < n; i++) {
    const e = f.ecriture[i]!;
    if (enDouble[e]) k.ligne('E11', lo[i]!);
  }
  for (let e = 0; e < E; e++) if (inversion[e]) k.ligne('E17', lo[premiereLigne[e]!]!);

  // ---- À-nouveaux ---------------------------------------------------------------------------------
  if (!ctx.journalAN) k.global('E13');
  else {
    for (let i = 0; i < n; i++) {
      if (estAN(i) && /^[67]/.test(f.textes[f.compteNum[i]!]!)) k.ligne('E15', lo[i]!);
    }
  }

  // ---- Écritures de solde des comptes de gestion -------------------------------------------------
  const gestion = new Uint32Array(E);
  const resultat = new Uint8Array(E);
  for (let i = 0; i < n; i++) {
    if (f.ecritureDate[i] !== fin) continue;
    const c = f.textes[f.compteNum[i]!]!;
    const e = f.ecriture[i]!;
    if (/^[67]/.test(c)) gestion[e]!++;
    else if (/^12/.test(c)) resultat[e] = 1;
  }
  for (let i = 0; i < n; i++) {
    const e = f.ecriture[i]!;
    if (resultat[e] && gestion[e]! >= 2) k.ligne('E16', lo[i]!);
  }

  return k.resultat();
}
