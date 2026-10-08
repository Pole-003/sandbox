import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { beforeAll, describe, expect, it } from 'vitest';
import { classeurSuivi, STATUTS } from '../../../src/modules/circularisations/export-suivi.ts';
import { parametresParDefaut } from '../../../src/modules/circularisations/parametres.ts';
import { selectionner } from '../../../src/modules/circularisations/selection.ts';
import { octetsClasseur } from '../../../src/modules/fec/export/xlsx.ts';
import { construireDonneesFec, type DonneesFec } from '../../../src/modules/fec/interface-circularisations.ts';
import { reglagesInitiaux } from '../../../src/modules/fec/stockage/base-fec.ts';
import { ATTENDUS, importerFichier } from '../fec/aides.ts';

let donnees: DonneesFec;
let octets: Uint8Array;
const p = parametresParDefaut('2026-06-30', 2026);
p.sp = 5_000_000;
p.ss = 7_500_000;
p.sai = 250_000;

beforeAll(async () => {
  const r = await importerFichier(ATTENDUS.fichiers.find((f) => f.categorie === 'propre')!.fichier);
  if (r.statut !== 'termine') throw new Error();
  donnees = construireDonneesFec(
    r.fec.colonnes,
    { id: 'x', dossierId: 'd', role: 'N', importeLe: '', meta: r.fec.meta, constatsLecture: [], constatsEcritures: [], reglages: reglagesInitiaux(r.fec.meta) },
    { id: 'd', nom: 'Négoce fictif' },
  );
  const s = selectionner(donnees, p);
  octets = await octetsClasseur(classeurSuivi(ExcelJS, s, p, donnees.metadonnees, '0.9.0', new Date('2026-10-08T10:00:00Z')));
});

async function lire(o: Uint8Array): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(o.buffer.slice(o.byteOffset, o.byteOffset + o.byteLength) as ArrayBuffer);
  return wb;
}

describe('tableau de suivi des circularisations (.xlsx)', () => {
  it('onglets, références, banques soldées comprises', async () => {
    const wb = await lire(octets);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Synthèse', 'Banques', 'Clients', 'Fournisseurs', 'Décisions manuelles', 'Paramètres']);
    const bq = wb.getWorksheet('Banques')!;
    expect(bq.getCell('A4').value).toBe('Réf.');
    expect(bq.getCell('F4').value).toBe('Solde comptable au 30/06/2026');
    const etablissements = [5, 6, 7, 8].map((r) => [bq.getCell(`A${r}`).value ?? null, bq.getCell(`E${r}`).value ?? null]);
    expect(etablissements).toEqual([
      ['BQ-001', 'Banque Alpha'],
      ['BQ-002', 'Banque Bêta'],
      ['BQ-003', 'Banque Gamma'],
      [null, null],
    ]);
    expect(String(bq.getCell('C7').value)).toBe('512300 (soldé)');
    const fo = wb.getWorksheet('Fournisseurs')!;
    const lignes = fo.getSheetValues().filter((r) => Array.isArray(r) && r[4] === 'F0001') as unknown[][];
    expect(lignes).toHaveLength(1);
    expect(String(lignes[0]![10])).toContain('F2');
    expect(typeof fo.getCell('F5').value).toBe('number');
  });

  it('formules, listes déroulantes, mises en forme conditionnelles, SAI nommé', async () => {
    const wb = await lire(octets);
    const cl = wb.getWorksheet('Clients')!;
    expect((cl.getCell('U5').value as { formula: string }).formula).toBe('IF(S5="","",IF(T5="C",-S5,S5)-F5)');
    expect((cl.getCell('X5').value as { formula: string }).formula).toBe('IF(U5="","",U5-N(V5))');
    expect(cl.getCell('R5').dataValidation).toMatchObject({ type: 'list', formulae: [`"${STATUTS.join(',')}"`] });
    expect(cl.getCell('T5').dataValidation).toMatchObject({ type: 'list', formulae: ['"D,C"'] });
    expect((cl as unknown as { conditionalFormattings: unknown[] }).conditionalFormattings.length).toBe(2);
    expect(wb.definedNames.getRanges('SAI').ranges).toEqual(["'Paramètres'!$B$6"]);
    const param = wb.getWorksheet('Paramètres')!;
    expect(param.getCell('B6').value).toBe(2500);
    expect(param.getCell('B18').value).toBe(2026);
    expect(param.getCell('B21').value).toBe(donnees.metadonnees.empreinte);
  });

  // LibreOffice recalcule le classeur : on vérifie les résultats des formules, pas seulement leur texte.
  const soffice = (() => {
    try {
      execFileSync('soffice', ['--version'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();
  it.skipIf(!soffice)('saisir un solde confirmé fait apparaître l’écart et met à jour la synthèse (recalcul LibreOffice)', async () => {
    const wb = await lire(octets);
    const cl = wb.getWorksheet('Clients')!;
    const solde = cl.getCell('F5').value as number;
    cl.getCell('R5').value = 'Réponse reçue';
    cl.getCell('S5').value = Math.abs(solde) - 3000;
    cl.getCell('T5').value = solde < 0 ? 'C' : 'D';
    cl.getCell('V5').value = solde < 0 ? 1000 : -1000;
    const dossier = mkdtempSync(join(tmpdir(), 'pole003-suivi-'));
    try {
      writeFileSync(join(dossier, 'suivi.xlsx'), await octetsClasseur(wb));
      execFileSync('soffice', ['--headless', '--calc', '--convert-to', 'xlsx:Calc MS Excel 2007 XML', '--outdir', join(dossier, 'calc'), join(dossier, 'suivi.xlsx')], { stdio: 'ignore', timeout: 120_000 });
      const recalcule = await lire(readFileSync(join(dossier, 'calc', 'suivi.xlsx')));
      const c = recalcule.getWorksheet('Clients')!;
      const resultat = (ref: string) => {
        const v = c.getCell(ref).value as { result?: unknown } | number;
        return typeof v === 'object' && v !== null ? v.result : v;
      };
      const ecart = (solde < 0 ? 3000 : -3000) as number;
      expect(resultat('U5')).toBeCloseTo(ecart, 2);
      expect(resultat('X5')).toBeCloseTo(ecart - (solde < 0 ? 1000 : -1000), 2);
      const s = recalcule.getWorksheet('Synthèse')!;
      const r = (ref: string) => (s.getCell(ref).value as { result?: unknown }).result;
      expect(r('C6')).toBe(1);
      expect(r('F6')).toBeCloseTo(ecart, 2);
      expect(r('H6')).toBe('Inférieur ou égal au SAI');
      expect(r('B5')).toBe(3);
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  }, 180_000);
});
