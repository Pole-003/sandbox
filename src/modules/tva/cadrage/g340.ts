/**
 * Contrôle de la TVA collectée (feuille G340) : TVA théorique reconstituée à partir du FEC, comparée à la
 * TVA collectée déclarée sur les CA3 (fonction pure, sans IndexedDB).
 *
 * 1. Chiffre d'affaires par compte de produits (mouvements de l'exercice), taux proposé dans l'ordre :
 *    (a) taux observé dans les écritures de vente (HT du compte rapproché de la TVA des comptes 4457 /
 *    44587 de la même écriture), (b) indice dans le libellé, (c) saisie. Un compte vendu à plusieurs taux
 *    est réparti au prorata des montants observés ; les ventes sans TVA forment le CA exonéré.
 * 2. Régime des encaissements : TVA comprise dans les encours N-1 moins TVA comprise dans les encours N
 *    (clients, clients douteux, avances reçues, factures à établir : TTC / (1 + taux) × taux ; produits
 *    constatés d'avance : HT × taux), ventilés par taux ; TVA sur les pertes sur créances irrécouvrables
 *    (654) retranchée ; TVA autoliquidée sur les achats (4452) ajoutée, car comprise dans la TVA collectée
 *    déclarée (lignes 08 et suivantes).
 * 3. TVA théorique = TVA sur le CA imposable + régularisations ; écart = théorique − déclarée.
 * Régime des débits : pas de régularisation des encours. Régime mixte : régularisations calculées sur la
 * part du chiffre d'affaires des comptes au régime des encaissements.
 */
import type { ObservationVentes, SoldeCompteTva } from '../../fec/interface-tva.ts';
import { CASES_PAR_CODE } from '../ca3-cases.ts';
import type { ValeurCase } from '../ca3/analyse.ts';
import { tvaCollecteeDeclaree } from '../ca3/controles.ts';
import { valeur } from '../ca3/declaration.ts';
import { caseParDefaut, CATEGORIES_ENCOURS, indiceLibelle, LIBELLES_ENCOURS, type CategorieEncours, type Nature, type ParametresCadrage } from './parametres.ts';

export type SourceTaux = 'observe' | 'libelle' | 'saisie' | 'a-saisir';

export interface LigneVente {
  cle: string;
  compteNum: string;
  compteLib: string;
  ca: number;
  exonere: number;
  imposable: number;
  /** Part du CA soumise (0 à 1), null si CA nul. */
  pctSoumis: number | null;
  taux: number | null;
  nature: Nature;
  tva: number;
  caseCa3: string | null;
  source: SourceTaux;
  /** Détail : HT observé par taux, ventes sans TVA, autres écritures. */
  observation: ObservationVentes;
  message: string | null;
}

export interface PartTaux {
  taux: number;
  n1: number;
  n: number;
  tvaN1: number;
  tvaN: number;
}

export interface Regularisation {
  cle: CategorieEncours | 'pertes' | 'autoliquidation';
  libelle: string;
  comptes: string[];
  /** Soldes signés (débit positif) N-1 et N ; pertes : charge de l'exercice ; autoliquidation : TVA. */
  n1: number;
  n: number;
  sourceN1: 'an' | 'fec-n1' | 'saisie' | null;
  parTaux: PartTaux[];
  /** Effet sur la TVA théorique (positif = TVA à ajouter). */
  tva: number;
}

export interface SyntheseTaux {
  taux: number | null;
  nature: Nature;
  caseCa3: string | null;
  ventes: number;
  tvaVentes: number;
  regularisations: number;
  /** TVA à déclarer = TVA sur ventes + régularisations. */
  aDeclarer: number;
  /** Base théorique encaissée (à déclarer / taux), ou ventes pour une opération non imposable. */
  baseTheorique: number;
  baseDeclaree: number | null;
  taxeDeclaree: number | null;
}

export interface G340 {
  lignes: LigneVente[];
  regularisations: Regularisation[];
  syntheseParTaux: SyntheseTaux[];
  ventilation: { methode: 'prorata' | 'manuelle'; description: string; partsTtc: Record<number, number>; partsHt: Record<number, number> };
  caTotal: number;
  caImposable: number;
  tvaSurCa: number;
  totalRegularisations: number;
  tvaTheorique: number;
  tvaDeclaree: number;
  ecart: number;
  justifie: number;
  residuel: number;
  avertissements: string[];
}

export interface EntreeG340 {
  observations: ObservationVentes[];
  comptes: SoldeCompteTva[];
  /** Balance du FEC N-1 (soldes de clôture), si chargé. */
  comptesN1: SoldeCompteTva[] | null;
  /** Valeurs retenues des CA3 de l'exercice. */
  declarations: Record<string, ValeurCase>[];
  parametres: ParametresCadrage;
}

const commence = (num: string, prefixes: readonly string[]) => prefixes.some((p) => num.startsWith(p));
const somme = (comptes: SoldeCompteTva[], prefixes: string[], cle: 'ouverture' | 'cloture' | 'credit' | 'debit') => comptes.reduce((s, c) => (commence(c.compteNum, prefixes) ? s + c[cle] : s), 0);
const tvaTtc = (ttc: number, taux: number) => Math.round((ttc * taux) / (10000 + taux));
const tvaHt = (ht: number, taux: number) => Math.round((ht * taux) / 10000);
const pct = (bp: number) => `${(bp / 100).toLocaleString('fr-FR')} %`;

/** Lignes de chiffre d'affaires : une par compte, ou par taux si le compte est vendu à plusieurs taux. */
export function lignesVentes(observations: ObservationVentes[], p: ParametresCadrage): LigneVente[] {
  const lignes: LigneVente[] = [];
  for (const o of observations) {
    const r = p.comptes[o.compteNum] ?? {};
    if (r.exclu) continue;
    const observes = Object.entries(o.parTaux)
      .map(([t, ht]) => ({ taux: Number(t), ht }))
      .filter((x) => x.ht !== 0)
      .sort((a, b) => Math.abs(b.ht) - Math.abs(a.ht));
    const totalObserve = observes.reduce((s, x) => s + x.ht, 0);
    let exonere = r.exonere ?? (observes.length ? o.sansTva : 0);
    let message: string | null = null;
    let repartition: { taux: number | null; nature: Nature; part: number; source: SourceTaux }[];

    if (r.taux !== undefined || r.nature !== undefined) {
      const nature: Nature = r.nature ?? (r.taux ? 'imposable' : 'exoneree');
      const taux = nature === 'imposable' ? (r.taux ?? null) : null;
      if (nature !== 'imposable') exonere = r.exonere ?? o.ca;
      repartition = [{ taux, nature, part: 1, source: 'saisie' }];
    } else if (observes.length) {
      // Répartition au prorata des montants observés ; un taux pesant moins de 1 % rejoint le taux principal.
      const significatifs = observes.filter((x) => Math.abs(x.ht) >= Math.abs(totalObserve) * 0.01);
      const base = significatifs.reduce((s, x) => s + x.ht, 0) || 1;
      repartition = significatifs.map((x) => ({ taux: x.taux, nature: 'imposable' as Nature, part: x.ht / base, source: 'observe' as SourceTaux }));
      if (o.tauxInconnu) message = `Écritures avec TVA ne correspondant à aucun taux connu : ${(o.tauxInconnu / 100).toLocaleString('fr-FR')} € HT.`;
    } else if (o.nbEcrituresVente > 0 && o.sansTva !== 0) {
      // Ventes facturées sans TVA : nature d'après le libellé (autoliquidation, export…), sinon exonérée.
      const indice = indiceLibelle(o.compteLib);
      const nature: Nature = indice?.nature && indice.nature !== 'imposable' ? indice.nature : 'exoneree';
      exonere = o.ca;
      repartition = [{ taux: null, nature, part: 1, source: 'observe' }];
    } else {
      const indice = indiceLibelle(o.compteLib);
      if (indice) {
        const nature = indice.nature ?? 'imposable';
        if (nature !== 'imposable') exonere = o.ca;
        repartition = [{ taux: nature === 'imposable' ? (indice.taux ?? null) : null, nature, part: 1, source: 'libelle' }];
      } else {
        repartition = [{ taux: null, nature: 'imposable', part: 1, source: 'a-saisir' }];
        message = 'Aucune écriture de vente avec TVA ni indice dans le libellé : taux à saisir.';
      }
    }

    const imposableTotal = o.ca - exonere;
    let reste = imposableTotal;
    repartition.forEach((x, k) => {
      const dernier = k === repartition.length - 1;
      const imposable = x.nature === 'imposable' ? (dernier ? reste : Math.round(imposableTotal * x.part)) : 0;
      reste -= imposable;
      const ca = repartition.length === 1 ? o.ca : imposable + (k === 0 ? exonere : 0);
      const exo = repartition.length === 1 ? exonere : k === 0 ? exonere : 0;
      const taux = x.taux ?? null;
      lignes.push({
        cle: repartition.length === 1 ? o.compteNum : `${o.compteNum}@${taux}`,
        compteNum: o.compteNum,
        compteLib: o.compteLib,
        ca,
        exonere: exo,
        imposable: x.nature === 'imposable' ? imposable : 0,
        pctSoumis: ca ? (x.nature === 'imposable' ? imposable : 0) / ca : null,
        taux: x.nature === 'imposable' ? taux : null,
        nature: x.nature,
        tva: x.nature === 'imposable' && taux ? tvaHt(imposable, taux) : 0,
        caseCa3: r.caseCa3 ?? caseParDefaut(taux, x.nature),
        source: x.source,
        observation: o,
        message: repartition.length > 1 ? `Compte vendu à plusieurs taux : réparti au prorata des montants observés (${repartition.map((y) => `${pct(y.taux ?? 0)} : ${Math.round(y.part * 1000) / 10} %`).join(', ')}).` : message,
      });
    });
  }
  return lignes;
}

/** Parts par taux en centièmes de pour cent, arrondies pour totaliser exactement 10 000. */
function parts(montants: Map<number, number>): Record<number, number> {
  const total = [...montants.values()].reduce((a, b) => a + b, 0);
  const r: Record<number, number> = {};
  if (!total) return r;
  let reste = 10000;
  const liste = [...montants].filter(([, m]) => m !== 0).sort((a, b) => b[1] - a[1]);
  liste.forEach(([taux, m], k) => {
    const p = k === liste.length - 1 ? reste : Math.round((m / total) * 10000);
    r[taux] = p;
    reste -= p;
  });
  return r;
}

export function calculerG340(e: EntreeG340): G340 {
  const p = e.parametres;
  const avertissements: string[] = [];
  const lignes = lignesVentes(e.observations, p);
  for (const l of lignes) if (l.source === 'a-saisir') avertissements.push(`Compte ${l.compteNum} : taux à saisir.`);

  // Ventilation : CA TTC par taux (encours TTC) et CA HT par taux (PCA, pertes) ; taux 0 = non imposable.
  // Régime mixte : seuls les comptes au régime des encaissements entrent dans la ventilation.
  const encaissement = (l: LigneVente) => p.regime === 'encaissements' || (p.regime === 'mixte' && (p.comptes[l.compteNum]?.regime ?? 'encaissements') === 'encaissements');
  const caTtc = new Map<number, number>();
  const caHt = new Map<number, number>();
  for (const l of lignes.filter(encaissement)) {
    const t = l.nature === 'imposable' && l.taux ? l.taux : 0;
    caTtc.set(t, (caTtc.get(t) ?? 0) + l.imposable + tvaHt(l.imposable, t) + l.exonere);
    caHt.set(t, (caHt.get(t) ?? 0) + l.imposable + l.exonere);
  }
  const partsTtc = parts(caTtc);
  const partsHt = parts(caHt);
  // Régime mixte : part du CA TTC soumise aux encaissements.
  const totalTtc = lignes.reduce((s, l) => s + l.ca + l.tva, 0);
  const fraction = p.regime === 'mixte' && totalTtc ? [...caTtc.values()].reduce((a, b) => a + b, 0) / totalTtc : 1;
  if (p.regime === 'mixte') avertissements.push(`Régime mixte : régularisations calculées sur ${Math.round(fraction * 1000) / 10} % des encours (part du chiffre d'affaires au régime des encaissements).`);

  /** Répartition d'un solde par taux : saisie (montants) ou au prorata du CA ; somme toujours égale au solde. */
  const repartir = (solde: string, montant: number, ttc: boolean): Map<number, number> => {
    const r = new Map<number, number>();
    if (montant === 0) return r;
    const saisie = p.ventilation.methode === 'manuelle' ? p.ventilation.manuelle[solde] : undefined;
    if (saisie && Object.keys(saisie).length) {
      for (const [t, v] of Object.entries(saisie)) if (v) r.set(Number(t), v);
      const ecartSaisie = montant - [...r.values()].reduce((a, b) => a + b, 0);
      if (ecartSaisie) {
        const principal = [...r].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0]?.[0] ?? 0;
        r.set(principal, (r.get(principal) ?? 0) + ecartSaisie);
        avertissements.push(`Ventilation saisie de « ${solde} » : écart de ${(ecartSaisie / 100).toLocaleString('fr-FR')} € avec le solde, porté au taux principal.`);
      }
      return r;
    }
    const liste = Object.entries(ttc ? partsTtc : partsHt).map(([t, part]) => ({ taux: Number(t), part }));
    if (!liste.length) liste.push({ taux: 0, part: 10000 });
    let reste = montant;
    liste.forEach(({ taux, part }, k) => {
      const m = k === liste.length - 1 ? reste : Math.round((montant * part) / 10000);
      reste -= m;
      r.set(taux, (r.get(taux) ?? 0) + m);
    });
    return r;
  };

  const regularisations: Regularisation[] = [];
  if (p.regime !== 'debits') {
    for (const cle of CATEGORIES_ENCOURS) {
      const prefixes = p.prefixesEncours[cle];
      const saisi = p.soldesN1[cle];
      const n = Math.round(somme(e.comptes, prefixes, 'cloture') * fraction);
      const auto = e.comptesN1 ? somme(e.comptesN1, prefixes, 'cloture') : somme(e.comptes, prefixes, 'ouverture');
      const n1 = Math.round((saisi ? saisi.montant : auto) * fraction);
      const { ttc, libelle } = LIBELLES_ENCOURS[cle];
      const conversion = ttc ? tvaTtc : tvaHt;
      const rN1 = repartir(`${cle}:n1`, n1, ttc);
      const rN = repartir(`${cle}:n`, n, ttc);
      const parTaux: PartTaux[] = [...new Set([...rN1.keys(), ...rN.keys()])]
        .sort((a, b) => b - a)
        .map((taux) => ({ taux, n1: rN1.get(taux) ?? 0, n: rN.get(taux) ?? 0, tvaN1: conversion(rN1.get(taux) ?? 0, taux), tvaN: conversion(rN.get(taux) ?? 0, taux) }));
      const tva = parTaux.reduce((s, x) => s + x.tvaN1 - x.tvaN, 0);
      if (n1 === 0 && n === 0) continue;
      regularisations.push({ cle, libelle, comptes: prefixes, n1, n, sourceN1: saisi ? saisi.source : e.comptesN1 ? 'fec-n1' : 'an', parTaux, tva });
    }
    // Pertes sur créances irrécouvrables : la TVA de ces créances jamais encaissées n'est pas due.
    const pertes = somme(e.comptes, p.prefixesPertes, 'debit') - somme(e.comptes, p.prefixesPertes, 'credit');
    if (pertes) {
      const parTaux = [...repartir('pertes:n', pertes, false)].map(([taux, montant]) => ({ taux, n1: 0, n: montant, tvaN1: 0, tvaN: tvaHt(montant, taux) }));
      regularisations.push({ cle: 'pertes', libelle: 'Pertes sur créances irrécouvrables HT (TVA à régulariser)', comptes: p.prefixesPertes, n1: 0, n: pertes, sourceN1: null, parTaux, tva: -parTaux.reduce((s, x) => s + x.tvaN, 0) });
    }
  }
  const autoliquidation = somme(e.comptes, p.prefixesAutoliquidation, 'credit');
  if (autoliquidation) {
    regularisations.push({
      cle: 'autoliquidation',
      libelle: 'TVA autoliquidée sur achats (comprise dans la TVA collectée déclarée)',
      comptes: p.prefixesAutoliquidation,
      n1: 0,
      n: autoliquidation,
      sourceN1: null,
      parTaux: [{ taux: 2000, n1: 0, n: autoliquidation, tvaN1: 0, tvaN: autoliquidation }],
      tva: autoliquidation,
    });
  }

  // Synthèse par taux (imposables) et par nature (non imposables), rapprochée des cases de la CA3.
  const synthese = new Map<string, SyntheseTaux>();
  const cleSynthese = (taux: number | null, nature: Nature, caseCa3: string | null) => (nature === 'imposable' ? `t${taux}` : `n${caseCa3 ?? nature}`);
  for (const l of lignes) {
    const k = cleSynthese(l.taux, l.nature, l.caseCa3);
    let s = synthese.get(k);
    if (!s) synthese.set(k, (s = { taux: l.nature === 'imposable' ? l.taux : null, nature: l.nature, caseCa3: l.caseCa3, ventes: 0, tvaVentes: 0, regularisations: 0, aDeclarer: 0, baseTheorique: 0, baseDeclaree: null, taxeDeclaree: null }));
    s.ventes += l.nature === 'imposable' ? l.imposable : l.ca;
    s.tvaVentes += l.tva;
  }
  // Encours non imposables (taux 0) : la base encaissée = ventes + encours N-1 − encours N, portée sur la
  // principale ligne non imposable (E2 en général).
  let encoursNonImposables = 0;
  for (const r of regularisations) {
    for (const x of r.parTaux) {
      if (!x.taux) {
        if (r.cle !== 'pertes' && r.cle !== 'autoliquidation') encoursNonImposables += x.n1 - x.n;
        continue;
      }
      const k = `t${x.taux}`;
      let s = synthese.get(k);
      if (!s) synthese.set(k, (s = { taux: x.taux, nature: 'imposable', caseCa3: caseParDefaut(x.taux, 'imposable'), ventes: 0, tvaVentes: 0, regularisations: 0, aDeclarer: 0, baseTheorique: 0, baseDeclaree: null, taxeDeclaree: null }));
      s.regularisations += r.cle === 'pertes' ? -x.tvaN : r.cle === 'autoliquidation' ? x.tvaN : x.tvaN1 - x.tvaN;
    }
  }
  const principaleNonImposable = [...synthese.values()].filter((s) => s.nature !== 'imposable').sort((a, b) => Math.abs(b.ventes) - Math.abs(a.ventes))[0];
  for (const s of synthese.values()) {
    s.aDeclarer = s.tvaVentes + s.regularisations;
    s.baseTheorique = s.nature === 'imposable' && s.taux ? Math.round((s.aDeclarer * 10000) / s.taux) : s.ventes + (s === principaleNonImposable ? encoursNonImposables : 0);
    if (s.caseCa3 && e.declarations.length) {
      const def = CASES_PAR_CODE.get(s.caseCa3);
      s.baseDeclaree = e.declarations.reduce((t, v) => t + valeur(v, s.caseCa3!, def?.colonnes === 2 ? 'base' : 'montant'), 0);
      s.taxeDeclaree = def?.colonnes === 2 ? e.declarations.reduce((t, v) => t + valeur(v, s.caseCa3!, 'taxe'), 0) : null;
    }
  }
  const syntheseParTaux = [...synthese.values()].sort((a, b) => (b.taux ?? -1) - (a.taux ?? -1) || (a.caseCa3 ?? '').localeCompare(b.caseCa3 ?? ''));

  const tvaSurCa = lignes.reduce((s, l) => s + l.tva, 0);
  const totalRegularisations = regularisations.reduce((s, r) => s + r.tva, 0);
  const tvaTheorique = tvaSurCa + totalRegularisations;
  const tvaDeclaree = e.declarations.reduce((s, v) => s + tvaCollecteeDeclaree(v), 0);
  const ecart = tvaTheorique - tvaDeclaree;
  const justifie = p.justifications.reduce((s, j) => s + j.montant, 0);
  const residuel = ecart - justifie;
  const description =
    p.ventilation.methode === 'manuelle'
      ? 'Ventilation des encours saisie par le collaborateur.'
      : `Ventilation des encours au prorata du chiffre d'affaires TTC de chaque taux (${Object.entries(partsTtc).sort((x, y) => y[1] - x[1]).map(([t, v]) => `${Number(t) ? pct(Number(t)) : 'non imposable'} : ${(v / 100).toLocaleString('fr-FR')} %`).join(', ') || 'aucun CA'}).`;
  if (!e.declarations.length) avertissements.push('Aucune déclaration CA3 retenue pour l’exercice : TVA déclarée nulle.');
  return {
    lignes,
    regularisations,
    syntheseParTaux,
    ventilation: { methode: p.ventilation.methode, description, partsTtc, partsHt },
    caTotal: lignes.reduce((s, l) => s + l.ca, 0),
    caImposable: lignes.reduce((s, l) => s + l.imposable, 0),
    tvaSurCa,
    totalRegularisations,
    tvaTheorique,
    tvaDeclaree,
    ecart,
    justifie,
    residuel,
    avertissements,
  };
}
