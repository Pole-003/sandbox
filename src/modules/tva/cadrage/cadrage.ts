/**
 * Assemblage du cadrage de TVA d'un dossier (fonction pure) : CA3 retenues pour l'exercice du FEC,
 * récapitulatif G300, contrôle G340, cadrage par période, contrôles complémentaires, anomalies.
 * Utilisé par l'écran, l'export Excel et les tests.
 */
import type { DonneesTvaFec } from '../../fec/interface-tva.ts';
import type { MessageCa3, ValeurCase } from '../ca3/analyse.ts';
import { controlerDeclaration, controlerSerie, trierParPeriode } from '../ca3/controles.ts';
import { libellePeriode, valeursRetenues, type DeclarationCa3 } from '../ca3/declaration.ts';
import { recapitulatifG300, type LigneG300 } from './g300.ts';
import { calculerG340, type G340 } from './g340.ts';
import { cadrageMensuel, controlesComplementaires, type ControleComplementaire, type LigneMensuelle } from './mensuel.ts';
import type { ParametresCadrage } from './parametres.ts';

export interface Cadrage {
  exercice: { debut: string; fin: string };
  retenues: DeclarationCa3[];
  /** Déclarations du dossier hors de l'exercice (non retenues). */
  horsExercice: DeclarationCa3[];
  valeurs: Record<string, ValeurCase>[];
  periodes: string[];
  g300: LigneG300[];
  g340: G340;
  mensuel: LigneMensuelle[];
  controles: ControleComplementaire[];
  anomalies: { periode: string; message: MessageCa3 }[];
}

const dansExercice = (d: DeclarationCa3, e: { debut: string; fin: string }) => !!d.identification.debut && !!d.identification.fin && d.identification.debut >= e.debut && d.identification.fin <= e.fin;

export function assemblerCadrage(fec: DonneesTvaFec, fecN1: DonneesTvaFec | null, declarations: DeclarationCa3[], p: ParametresCadrage): Cadrage {
  const exercice = fec.metadonnees.exercice;
  const triees = trierParPeriode(declarations);
  const retenues = triees.filter((d) => dansExercice(d, exercice));
  const horsExercice = triees.filter((d) => !dansExercice(d, exercice));
  const valeurs = retenues.map((d) => valeursRetenues(d));
  const periodes = retenues.map((d) => libellePeriode(d.identification.debut, d.identification.fin));
  const g340 = calculerG340({
    observations: fec.observerVentes({ produits: p.prefixesProduits, tva: p.prefixesTva, clients: ['41'] }),
    comptes: fec.comptes(),
    comptesN1: fecN1 ? fecN1.comptes().map((c) => ({ ...c })) : null,
    declarations: valeurs,
    parametres: p,
  });
  const retenuesValeurs = retenues.map((d, i) => ({ identification: d.identification, valeurs: valeurs[i]! }));
  const mensuel = cadrageMensuel(exercice, retenuesValeurs, fec.mouvementsMensuels(['4457']), fec.mouvementsMensuels(p.prefixesProduits), fec.mouvementsMensuels(p.prefixesAutoliquidation));
  const controles = controlesComplementaires(fec.comptes(), retenuesValeurs, g340, p, exercice.fin);

  const anomalies: Cadrage['anomalies'] = [];
  for (const m of controlerSerie(retenues)) {
    const d = retenues.find((x) => x.id === m.declaration);
    anomalies.push({ periode: d ? libellePeriode(d.identification.debut, d.identification.fin) : 'Série', message: m });
  }
  retenues.forEach((d, i) => {
    for (const m of [...d.messagesLecture, ...controlerDeclaration(valeurs[i]!)]) anomalies.push({ periode: periodes[i]!, message: m });
  });
  const nonCouverts = mensuel.filter((m) => m.tvaDeclaree === null).map((m) => m.periode.replace(' (non déclaré)', ''));
  if (nonCouverts.length) anomalies.unshift({ periode: 'Série', message: { gravite: 'anomalie', code: 'EXERCICE_INCOMPLET', message: `Mois de l’exercice sans déclaration : ${nonCouverts.join(', ')}.` } });
  if (horsExercice.length) anomalies.push({ periode: 'Série', message: { gravite: 'information', code: 'HORS_EXERCICE', message: `Déclaration(s) hors de l’exercice du FEC, non retenue(s) : ${horsExercice.map((d) => libellePeriode(d.identification.debut, d.identification.fin)).join(', ')}.` } });
  for (const a of g340.avertissements) anomalies.push({ periode: 'G340', message: { gravite: 'avertissement', code: 'G340', message: a } });
  return { exercice, retenues, horsExercice, valeurs, periodes, g300: recapitulatifG300(valeurs), g340, mensuel, controles, anomalies };
}
