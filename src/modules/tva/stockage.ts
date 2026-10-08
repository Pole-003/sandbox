/** Sauvegarde locale (IndexedDB) des déclarations CA3 d'un dossier : valeurs lues, corrections, empreintes. Les PDF ne sont pas conservés. */
import { ecrireEnregistrement, lireEnregistrement } from '../fec/stockage/base-fec.ts';
import type { DeclarationCa3 } from './ca3/declaration.ts';

export interface DonneesTva {
  version: 1;
  dossierId: string;
  declarations: DeclarationCa3[];
  modifieLe: string;
}

export async function lireTva(dossierId: string): Promise<DonneesTva> {
  return (await lireEnregistrement<DonneesTva>('tva', dossierId)) ?? { version: 1, dossierId, declarations: [], modifieLe: '' };
}

export async function enregistrerTva(d: DonneesTva): Promise<void> {
  await ecrireEnregistrement('tva', { ...d, modifieLe: new Date().toISOString() } satisfies DonneesTva);
}
