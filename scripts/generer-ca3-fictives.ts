/**
 * Génère les CA3 fictives (PDF) et leurs valeurs attendues dans tests/fixtures/ca3/ (npm run ca3:fictives).
 * Aucune donnée réelle : sociétés, SIREN (clé de Luhn valide) et montants inventés.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { millesimeInconnu, pdfScanne, serieServices, serieTrimestrielle, type Ca3Fictive } from './ca3-fictives/donnees.ts';
import { pdfCa3 } from './ca3-fictives/pdf.ts';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'ca3');

/** Valeurs attendues en centimes, comme les lit l'application. */
function attendu(d: Ca3Fictive) {
  const cases: Record<string, { base?: number; taxe?: number; montant?: number }> = {};
  for (const [code, v] of Object.entries(d.cases)) {
    cases[code] = Object.fromEntries(Object.entries(v).map(([k, n]) => [k, n * 100]));
  }
  for (const s of d.casesSupplementaires ?? []) cases[s.code] = { montant: s.montant * 100 };
  return {
    fichier: d.fichier,
    description: d.description,
    variante: d.variante,
    illisible: Boolean(d.scanne),
    identification: d.scanne
      ? null
      : { denomination: d.denomination, siren: d.siren, debut: d.debut, fin: d.fin, dateLimite: d.dateLimite, dateDepot: d.dateDepot, dateCreation: d.dateDepot, millesime: d.millesime },
    cases: d.scanne ? {} : cases,
    controlesAttendus: d.controlesAttendus,
  };
}

export async function genererCa3(): Promise<void> {
  const series = { services: serieServices(), trimestrielle: serieTrimestrielle(), autres: [millesimeInconnu(), pdfScanne()] };
  const attendus: Record<string, ReturnType<typeof attendu>[]> = {};
  for (const [nom, liste] of Object.entries(series)) {
    mkdirSync(join(RACINE, nom), { recursive: true });
    attendus[nom] = [];
    for (const d of liste) {
      writeFileSync(join(RACINE, nom, d.fichier), await pdfCa3(d));
      attendus[nom].push(attendu(d));
    }
  }
  writeFileSync(join(RACINE, 'attendus.json'), `${JSON.stringify({ $commentaire: 'Généré par scripts/generer-ca3-fictives.ts : montants en centimes, données fictives.', ...attendus }, null, 1)}\n`);
  console.log(`CA3 fictives : ${Object.values(series).flat().length} PDF dans ${RACINE}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await genererCa3();
