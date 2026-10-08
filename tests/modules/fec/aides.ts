import { createReadStream, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Attendus } from '../../../scripts/generer-fec-fictifs.ts';
import { importerFec, type OptionsImport, type ResultatImport } from '../../../src/modules/fec/import/pipeline.ts';

export const DOSSIER_FEC = join(import.meta.dirname, '../../fixtures/fec');

export const ATTENDUS = JSON.parse(readFileSync(join(DOSSIER_FEC, 'attendus.json'), 'utf8')) as Attendus;

/** Importe un fichier du dépôt en flux, par morceaux de 64 Ko (comme File.stream() du navigateur). */
export function importerFichier(chemin: string, options: Partial<OptionsImport> = {}): Promise<ResultatImport> {
  const complet = chemin.startsWith('/') ? chemin : join(DOSSIER_FEC, chemin);
  return importerFec(() => createReadStream(complet, { highWaterMark: 65_536 }) as AsyncIterable<Uint8Array>, {
    nomFichier: basename(complet),
    taille: statSync(complet).size,
    ...options,
  });
}

export const ENTETE_BIC =
  'JournalCode\tJournalLib\tEcritureNum\tEcritureDate\tCompteNum\tCompteLib\tCompAuxNum\tCompAuxLib\tPieceRef\tPieceDate\tEcritureLib\tDebit\tCredit\tEcritureLet\tDateLet\tValidDate\tMontantdevise\tIdevise';

/** Ligne BIC/IS à partir de valeurs partielles (les autres zones prennent une valeur conforme). */
export function ligneBic(v: Partial<Record<string, string>>): string {
  const defaut: Record<string, string> = {
    JournalCode: 'OD',
    JournalLib: 'Opérations diverses',
    EcritureNum: '1',
    EcritureDate: '20250115',
    CompteNum: '627000',
    CompteLib: 'Services bancaires',
    CompAuxNum: '',
    CompAuxLib: '',
    PieceRef: 'P1',
    PieceDate: '20250115',
    EcritureLib: 'Frais',
    Debit: '0,00',
    Credit: '0,00',
    EcritureLet: '',
    DateLet: '',
    ValidDate: '20250131',
    Montantdevise: '',
    Idevise: '',
  };
  return ENTETE_BIC.split('\t')
    .map((z) => v[z] ?? defaut[z]!)
    .join('\t');
}

/** Importe un FEC donné sous forme de texte (ou d'octets), découpé en petits morceaux. */
export function importerTexte(
  contenu: string | Uint8Array,
  options: Partial<OptionsImport> = {},
): Promise<ResultatImport> {
  const octets = typeof contenu === 'string' ? new TextEncoder().encode(contenu) : contenu;
  return importerFec(
    async function* () {
      for (let i = 0; i < octets.length; i += 7) yield octets.subarray(i, i + 7);
    },
    { nomFichier: '000987651FEC20251231.txt', taille: octets.length, ...options },
  );
}
