/**
 * Génère les FEC fictifs du cadrage de TVA (npm run tva:fictifs) dans tests/fixtures/tva/ : la société de
 * services des CA3 fictives, en variante conforme et en variante avec écart de cut-off, et les valeurs
 * attendues du cadrage. Aucune donnée réelle.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encoder, OPTIONS_STANDARD, texteFec } from './fec-fictifs/ecriture-fichier.ts';
import { attendusServices, ecrituresServices, SOCIETE, type Variante } from './tva-fictif/fec-services.ts';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'tva');

export function genererTva(): void {
  mkdirSync(RACINE, { recursive: true });
  const attendus: Record<string, unknown> = { $commentaire: 'Généré par scripts/generer-tva-fictif.ts : montants en centimes, données fictives.' };
  for (const v of ['conforme', 'cutoff'] as Variante[]) {
    const fichier = `${SOCIETE.siren}FEC${SOCIETE.cloture.replaceAll('-', '')}_${v}.txt`;
    writeFileSync(join(RACINE, fichier), encoder(texteFec(ecrituresServices(v), OPTIONS_STANDARD), 'utf-8'));
    attendus[v] = { fichier, ...attendusServices(v) };
  }
  writeFileSync(join(RACINE, 'attendus.json'), `${JSON.stringify(attendus, null, 1)}\n`);
  console.log(`FEC fictifs du cadrage de TVA dans ${RACINE}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) genererTva();
