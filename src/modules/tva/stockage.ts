/** Sauvegarde locale (IndexedDB) des déclarations CA3 d'un dossier : valeurs lues, corrections, empreintes. Les PDF ne sont pas conservés. */
import { ecrireEnregistrement, lireEnregistrement } from '../fec/stockage/base-fec.ts';
import type { DeclarationCa3 } from './ca3/declaration.ts';
import { migrerParametres, type ParametresCadrage } from './cadrage/parametres.ts';

export interface DonneesTva {
  version: 1;
  dossierId: string;
  declarations: DeclarationCa3[];
  /** Paramètres du cadrage (absent tant que le cadrage n'a pas été ouvert). */
  parametres?: ParametresCadrage;
  modifieLe: string;
}

export async function lireTva(dossierId: string): Promise<DonneesTva> {
  const d = await lireEnregistrement<DonneesTva>('tva', dossierId);
  if (!d) return { version: 1, dossierId, declarations: [], modifieLe: '' };
  return d.parametres ? { ...d, parametres: migrerParametres(d.parametres as Parameters<typeof migrerParametres>[0]) } : d;
}

export async function enregistrerTva(d: DonneesTva): Promise<void> {
  await ecrireEnregistrement('tva', { ...d, modifieLe: new Date().toISOString() } satisfies DonneesTva);
}
