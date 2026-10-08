/**
 * Métadonnées d'un dossier FEC communes aux interfaces des modules consommateurs (Circularisations,
 * Cadrage de TVA) : identification, exercice retenu, journal d'à-nouveaux, empreinte du fichier.
 * Fichier neutre : les modules consommateurs restent indépendants les uns des autres.
 */
import type { JournalAN } from './metadonnees.ts';
import type { Dossier, ImportEnregistre } from './stockage/base-fec.ts';

export interface MetadonneesDossierFec {
  dossierId: string;
  nomDossier: string;
  siren: string | null;
  exercice: { debut: string; fin: string };
  dateCloture: string;
  journalAN: { code: string; confirme: boolean } | null;
  /** Empreinte SHA-256 du fichier FEC (prouve quel fichier a servi, sans le contenu). */
  empreinte: string;
  nomFichier: string;
  nbLignes: number;
  nbEcritures: number;
  importeLe: string;
}

/** Métadonnées du dossier et journal d'à-nouveaux retenu (réglages de l'utilisateur, sinon détection). */
export function lireDossierFec(imp: ImportEnregistre, dossier: Pick<Dossier, 'id' | 'nom'>): { metadonnees: MetadonneesDossierFec; journalAN: JournalAN | null } {
  const r = imp.reglages;
  const debut = r.debut ?? imp.meta.exercice?.debut ?? '';
  const fin = r.fin ?? imp.meta.exercice?.fin ?? '';
  const journal = r.journalAN ? imp.meta.journaux.find((j) => j.code === r.journalAN) : undefined;
  const journalAN: JournalAN | null = journal
    ? { code: journal.code, libelle: journal.libelle, methode: imp.meta.journalAN?.code === journal.code ? imp.meta.journalAN.methode : 'code' }
    : null;
  return {
    metadonnees: {
      dossierId: dossier.id,
      nomDossier: dossier.nom,
      siren: r.siren,
      exercice: { debut, fin },
      dateCloture: r.cloture ?? fin,
      journalAN: r.journalAN ? { code: r.journalAN, confirme: r.journalANConfirme } : null,
      empreinte: imp.meta.empreinte,
      nomFichier: imp.meta.nomFichier,
      nbLignes: imp.meta.nbLignes,
      nbEcritures: imp.meta.nbEcritures,
      importeLe: imp.importeLe,
    },
    journalAN,
  };
}
