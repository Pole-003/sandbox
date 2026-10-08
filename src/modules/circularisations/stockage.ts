/** Sauvegarde locale (IndexedDB) des paramètres et décisions de circularisation d'un dossier. */
import { ecrireEnregistrement, lireEnregistrement } from '../fec/stockage/base-fec.ts';
import { migrerParametres, type ParametresCircularisation } from './parametres.ts';

interface Enregistrement {
  dossierId: string;
  parametres: ParametresCircularisation;
  modifieLe: string;
}

export async function lireParametres(dossierId: string): Promise<ParametresCircularisation | null> {
  const p = (await lireEnregistrement<{ parametres: Parameters<typeof migrerParametres>[0] }>('circularisations', dossierId))?.parametres;
  return p ? migrerParametres(p) : null;
}

export async function enregistrerParametres(dossierId: string, parametres: ParametresCircularisation): Promise<void> {
  await ecrireEnregistrement('circularisations', { dossierId, parametres, modifieLe: new Date().toISOString() } satisfies Enregistrement);
}
