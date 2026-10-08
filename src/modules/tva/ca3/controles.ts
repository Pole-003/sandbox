/**
 * Contrôles automatiques des CA3 : arithmétique de chaque déclaration et cohérence de la série.
 * Un écart est signalé ; la déclaration reste utilisable. Montants en centimes (déclarations en euros
 * entiers : les égalités sont exactes, sauf base × taux ≈ taxe, avec une tolérance d'arrondi de 1 €).
 */
import { CASES_CA3 } from '../ca3-cases.ts';
import type { MessageCa3, ValeurCase } from './analyse.ts';
import { libellePeriode, valeur, valeursRetenues, type DeclarationCa3 } from './declaration.ts';

const TOLERANCE_TAUX = 100;
const LIGNES_TAUX = CASES_CA3.filter((c) => c.collectee);
const OPERATIONS_TAXEES = ['A1', 'A2', 'A3', 'A4', 'A5', 'B1', 'B2', 'B3', 'B4', 'B5'];

const euros = (c: number) => `${(c / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} €`;

export interface MessageControle extends MessageCa3 {
  /** Identifiant de la déclaration concernée (contrôles de série : la plus récente des deux). */
  declaration?: string;
}

/** TVA collectée déclarée : somme des taxes des lignes de taux (08 à 13, T1 à TC, P1, P2, I1 à I6). */
export function tvaCollecteeDeclaree(v: Record<string, ValeurCase>): number {
  return LIGNES_TAUX.reduce((s, c) => s + valeur(v, c.code, 'taxe'), 0);
}

export function controlerDeclaration(v: Record<string, ValeurCase>): MessageCa3[] {
  const m: MessageCa3[] = [];
  const sert = (code: string) => v[code] !== undefined;
  const egal = (code: string, attendu: number, formule: string, composants: string[]) => {
    if (!sert(code) && !composants.some(sert)) return;
    const lu = valeur(v, code);
    if (lu !== attendu) m.push({ gravite: 'anomalie', code: `L${code}`, message: `Ligne ${code} = ${euros(lu)} ; ${formule} = ${euros(attendu)} (écart ${euros(lu - attendu)}).` });
  };

  const brute = tvaCollecteeDeclaree(v) + valeur(v, '15') + valeur(v, '5B');
  egal('16', brute, 'somme des taxes des lignes 08 à 5B', [...LIGNES_TAUX.map((c) => c.code), '15', '5B']);
  const deductible = ['19', '20', '21', '22', '2C'].reduce((s, c) => s + valeur(v, c), 0);
  egal('23', deductible, 'somme des lignes 19 à 2C', ['19', '20', '21', '22', '2C']);

  const l16 = valeur(v, '16');
  const l23 = valeur(v, '23');
  if (sert('16') || sert('23') || sert('TD') || sert('25')) {
    if (l16 >= l23) {
      if (valeur(v, 'TD') !== l16 - l23) m.push({ gravite: 'anomalie', code: 'LTD', message: `Ligne TD = ${euros(valeur(v, 'TD'))} ; ligne 16 − ligne 23 = ${euros(l16 - l23)}.` });
      if (valeur(v, '25') !== 0) m.push({ gravite: 'anomalie', code: 'L25', message: `Crédit déclaré ligne 25 (${euros(valeur(v, '25'))}) alors que la TVA brute excède la TVA déductible.` });
    } else {
      if (valeur(v, '25') !== l23 - l16) m.push({ gravite: 'anomalie', code: 'L25', message: `Ligne 25 = ${euros(valeur(v, '25'))} ; ligne 23 − ligne 16 = ${euros(l23 - l16)}.` });
      if (valeur(v, 'TD') !== 0) m.push({ gravite: 'anomalie', code: 'LTD', message: `TVA due déclarée ligne TD (${euros(valeur(v, 'TD'))}) alors que la TVA déductible excède la TVA brute.` });
    }
  }
  if (sert('25') || sert('27')) {
    const attendu = valeur(v, '25') - valeur(v, '26');
    if (valeur(v, '27') !== attendu) {
      m.push({ gravite: 'anomalie', code: 'L27', message: `Ligne 27 = ${euros(valeur(v, '27'))} ; ligne 25 − ligne 26 = ${euros(attendu)}${sert('AA') ? ` (crédit transféré ligne AA : ${euros(valeur(v, 'AA'))})` : ''}.` });
    }
  }
  egal('28', valeur(v, 'TD') - valeur(v, 'X5'), 'ligne TD − ligne X5', ['TD', 'X5']);
  egal('32', valeur(v, '28') + valeur(v, '29') + valeur(v, 'Z5') - valeur(v, 'AB'), 'lignes 28 + 29 + Z5 − AB', ['28', '29', 'Z5', 'AB']);

  for (const c of LIGNES_TAUX) {
    const x = v[c.code];
    if (!x || c.taux === undefined) continue;
    const base = x.base ?? 0;
    const taxe = x.taxe ?? 0;
    const theorique = Math.round((base * c.taux) / 10000);
    if (Math.abs(theorique - taxe) > TOLERANCE_TAUX) {
      m.push({ gravite: 'anomalie', code: `T${c.code}`, message: `Ligne ${c.code} (${c.libelle}) : base ${euros(base)} × ${(c.taux / 100).toLocaleString('fr-FR')} % = ${euros(theorique)}, taxe déclarée ${euros(taxe)}.` });
    }
  }

  const operations = OPERATIONS_TAXEES.reduce((s, c) => s + valeur(v, c), 0);
  const bases = LIGNES_TAUX.reduce((s, c) => s + valeur(v, c.code, 'base'), 0);
  if ((operations || bases) && Math.abs(operations - bases) > TOLERANCE_TAUX) {
    m.push({
      gravite: 'avertissement',
      code: 'BASES',
      message: `Opérations taxées (A1 à B5) : ${euros(operations)} ; somme des bases imposables des lignes de taux : ${euros(bases)} (écart ${euros(operations - bases)}). À vérifier (A1 + A2 et achats autoliquidés).`,
    });
  }
  return m;
}

export type Periodicite = 'mensuelle' | 'trimestrielle' | 'mixte' | 'inconnue';

const plusUnJour = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
const moisCouverts = (debut: string, fin: string) => (Number(fin.slice(0, 4)) - Number(debut.slice(0, 4))) * 12 + Number(fin.slice(5, 7)) - Number(debut.slice(5, 7)) + 1;

/** Déclarations triées par période (les déclarations sans période en dernier). */
export function trierParPeriode<T extends Pick<DeclarationCa3, 'identification'>>(liste: T[]): T[] {
  return [...liste].sort((a, b) => (a.identification.debut ?? '9999').localeCompare(b.identification.debut ?? '9999'));
}

export function periodicite(liste: Pick<DeclarationCa3, 'identification'>[]): Periodicite {
  const durees = new Set(liste.filter((d) => d.identification.debut && d.identification.fin).map((d) => moisCouverts(d.identification.debut!, d.identification.fin!)));
  if (durees.size === 0) return 'inconnue';
  if (durees.size > 1) return 'mixte';
  return durees.has(1) ? 'mensuelle' : durees.has(3) ? 'trimestrielle' : 'inconnue';
}

export function controlerSerie(liste: DeclarationCa3[]): MessageControle[] {
  const m: MessageControle[] = [];
  const triees = trierParPeriode(liste);
  const sirens = new Set(triees.map((d) => d.identification.siren).filter(Boolean));
  if (sirens.size > 1) m.push({ gravite: 'anomalie', code: 'SERIE_SIREN', message: `Plusieurs SIREN dans la série : ${[...sirens].join(', ')}.` });

  const per = periodicite(triees);
  if (per === 'mixte') m.push({ gravite: 'information', code: 'SERIE_PERIODICITE', message: 'Périodicité mixte (déclarations mensuelles et trimestrielles) : vérifiez le changement de régime.' });

  for (let i = 0; i < triees.length; i++) {
    const d = triees[i]!;
    const id = d.identification;
    const periode = libellePeriode(id.debut, id.fin);
    if (id.dateLimite && id.dateDepot && id.dateDepot > id.dateLimite) {
      m.push({ gravite: 'avertissement', code: 'DEPOT_TARDIF', declaration: d.id, message: `${periode} : déposée le ${id.dateDepot.split('-').reverse().join('/')}, après la date limite du ${id.dateLimite.split('-').reverse().join('/')}.` });
    }
    const p = triees[i - 1];
    if (!p || !p.identification.fin || !id.debut) continue;
    const precedente = libellePeriode(p.identification.debut, p.identification.fin);
    const attendu = plusUnJour(p.identification.fin);
    if (id.debut === p.identification.debut) m.push({ gravite: 'anomalie', code: 'SERIE_DOUBLON', declaration: d.id, message: `Deux déclarations pour la période ${periode}.` });
    else if (id.debut < attendu) m.push({ gravite: 'anomalie', code: 'SERIE_CHEVAUCHEMENT', declaration: d.id, message: `La période ${periode} chevauche la période ${precedente}.` });
    else if (id.debut > attendu) {
      const fin = new Date(`${id.debut}T00:00:00Z`);
      fin.setUTCDate(fin.getUTCDate() - 1);
      m.push({ gravite: 'anomalie', code: 'SERIE_TROU', declaration: d.id, message: `Période non déclarée entre ${precedente} et ${periode} : du ${attendu.split('-').reverse().join('/')} au ${fin.toISOString().slice(0, 10).split('-').reverse().join('/')}.` });
    }
    // Report du crédit : ligne 22 = ligne 27 de la déclaration précédente.
    if (id.debut === attendu) {
      const report = valeur(valeursRetenues(d), '22');
      const credit = valeur(valeursRetenues(p), '27');
      if (report !== credit) {
        m.push({ gravite: 'anomalie', code: 'SERIE_REPORT', declaration: d.id, message: `${periode} : report de crédit ligne 22 = ${euros(report)} ; crédit à reporter ligne 27 de ${precedente} = ${euros(credit)}.` });
      }
    }
  }
  return m;
}
