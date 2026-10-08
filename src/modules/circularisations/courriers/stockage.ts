/** Sauvegarde locale (IndexedDB) des modèles de lettres (communs au poste) et des réglages de courriers par dossier. */
import { ecrireEnregistrement, lireEnregistrement } from '../../fec/stockage/base-fec.ts';
import { modelesParDefaut, type ModelesCourriers, type ReglagesCourriersDossier } from './modeles.ts';

const CLE_POSTE = 'poste';

/** Modèles enregistrés, complétés par les valeurs par défaut pour toute clé absente. */
export async function lireModeles(): Promise<ModelesCourriers> {
  const defaut = modelesParDefaut();
  const e = await lireEnregistrement<{ id: string; modeles: ModelesCourriers }>('modeles-courriers', CLE_POSTE);
  if (!e) return defaut;
  return {
    version: 1,
    cabinet: { ...defaut.cabinet, ...e.modeles.cabinet },
    modeles: {
      banques: { ...defaut.modeles.banques, ...e.modeles.modeles?.banques },
      clients: { ...defaut.modeles.clients, ...e.modeles.modeles?.clients },
      fournisseurs: { ...defaut.modeles.fournisseurs, ...e.modeles.modeles?.fournisseurs },
    },
  };
}

export async function enregistrerModeles(modeles: ModelesCourriers): Promise<void> {
  await ecrireEnregistrement('modeles-courriers', { id: CLE_POSTE, modeles, modifieLe: new Date().toISOString() });
}

export async function lireReglagesCourriers(dossierId: string): Promise<ReglagesCourriersDossier | null> {
  return (await lireEnregistrement<{ dossierId: string; reglages: ReglagesCourriersDossier }>('courriers', dossierId))?.reglages ?? null;
}

export async function enregistrerReglagesCourriers(dossierId: string, reglages: ReglagesCourriersDossier): Promise<void> {
  await ecrireEnregistrement('courriers', { dossierId, reglages, modifieLe: new Date().toISOString() });
}
