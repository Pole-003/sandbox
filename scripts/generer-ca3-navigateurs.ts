/**
 * CA3 fictives imprimées en PDF par de vrais moteurs de rendu (npm run ca3:navigateurs) : Chromium
 * (« Imprimer en PDF » d'une page HTML, avec les en-têtes et pieds de page du navigateur,
 * scripts/ca3-fictives/html.ts) et LibreOffice (export PDF d'un document Word à tableaux,
 * scripts/ca3-fictives/docx.ts). Les PDF produits sont versionnés dans
 * tests/fixtures/ca3/navigateurs/ ; il n'est pas nécessaire de les régénérer pour lancer les tests.
 *
 * Prérequis : Chromium (variable CHROMIUM, sinon /opt/pw-browsers/chromium-*) et LibreOffice (soffice).
 * Aucune ressource réseau : la page est un fichier local sans dépendance externe.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serieServices, type Ca3Fictive } from './ca3-fictives/donnees.ts';
import { docxCa3 } from './ca3-fictives/docx.ts';
import { htmlCa3, type Disposition } from './ca3-fictives/html.ts';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'ca3', 'navigateurs');

function chromium(): string {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const base = '/opt/pw-browsers';
  const dossier = existsSync(base) ? readdirSync(base).find((n) => n.startsWith('chromium-')) : undefined;
  if (!dossier) throw new Error('Chromium introuvable : définissez la variable CHROMIUM.');
  return join(base, dossier, 'chrome-linux', 'chrome');
}

const centimes = (d: Ca3Fictive) => Object.fromEntries(Object.entries(d.cases).map(([c, v]) => [c, Object.fromEntries(Object.entries(v).map(([k, n]) => [k, n * 100]))]));

const serie = serieServices();
// Septembre (crédit), novembre (ligne « dont » sans code), février (incohérences), juin (montants à six chiffres).
const choix = ['202509', '202511', '202602', '202606'].map((m) => serie.find((d) => d.fichier.includes(m))!);
const travail = mkdtempSync(join(tmpdir(), 'ca3-nav-'));
mkdirSync(RACINE, { recursive: true });
const attendus: unknown[] = [];
try {
  for (const [k, d] of choix.entries()) {
    for (const [producteur, disposition] of [
      ['chromium', k % 2 === 0 ? 'tableau' : 'blocs'],
      ['libreoffice', 'tableau'],
    ] as [string, Disposition][]) {
      const nom = `${d.fichier.replace('.pdf', '')}_${producteur}_${disposition}`;
      const html = join(travail, `${nom}.html`);
      if (producteur === 'chromium') {
        writeFileSync(html, htmlCa3(d, disposition));
        execFileSync(chromium(), ['--headless', '--no-sandbox', '--disable-gpu', '--no-first-run', `--user-data-dir=${join(travail, 'profil-chromium')}`, `--print-to-pdf=${join(RACINE, `${nom}.pdf`)}`, `file://${html}`], { stdio: 'ignore', timeout: 60_000 });
      } else {
        const docx = join(travail, `${nom}.docx`);
        writeFileSync(docx, await docxCa3(d));
        execFileSync('soffice', ['--headless', `-env:UserInstallation=file://${join(travail, 'profil-lo')}`, '--convert-to', 'pdf:writer_pdf_Export', '--outdir', travail, docx], { stdio: 'ignore', timeout: 120_000 });
        renameSync(join(travail, `${nom}.pdf`), join(RACINE, `${nom}.pdf`));
      }
      attendus.push({
        fichier: `${nom}.pdf`,
        producteur,
        disposition,
        description: d.description,
        identification: { denomination: d.denomination, siren: d.siren, debut: d.debut, fin: d.fin, dateLimite: d.dateLimite, dateDepot: d.dateDepot, dateCreation: d.dateDepot, millesime: d.millesime },
        cases: centimes(d),
        controlesAttendus: d.controlesAttendus.filter((c) => c !== 'DEPOT_TARDIF'),
      });
    }
  }
  writeFileSync(join(RACINE, 'attendus.json'), `${JSON.stringify(attendus, null, 1)}\n`);
  console.log(`CA3 imprimées par navigateur : ${attendus.length} PDF dans ${RACINE}`);
} finally {
  rmSync(travail, { recursive: true, force: true });
}
