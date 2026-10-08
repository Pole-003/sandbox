import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { beforeAll, describe, expect, it } from 'vitest';
import { octetsClasseur } from '../../../src/modules/fec/export/xlsx.ts';
import type { DonneesTvaFec } from '../../../src/modules/fec/interface-tva.ts';
import type { DeclarationCa3 } from '../../../src/modules/tva/ca3/declaration.ts';
import { assemblerCadrage, type Cadrage } from '../../../src/modules/tva/cadrage/cadrage.ts';
import { parametresParDefaut, type ParametresCadrage } from '../../../src/modules/tva/cadrage/parametres.ts';
import { classeurCadrageTva } from '../../../src/modules/tva/export/classeur-tva.ts';
import { ATTENDUS_TVA, donneesTva, ventilationExacte } from './aides-cadrage.ts';
import { ATTENDUS_CA3, lireFixture } from './aides.ts';

let fec: DonneesTvaFec;
let declarations: DeclarationCa3[];
let p: ParametresCadrage;
let cadrage: Cadrage;
let octets: Uint8Array;

beforeAll(async () => {
  fec = await donneesTva('conforme');
  declarations = [];
  for (const a of [...ATTENDUS_CA3.services].reverse()) {
    const l = await lireFixture('services', a.fichier);
    declarations.push({ id: a.fichier, source: 'pdf', nomFichier: a.fichier, empreinte: 'e'.repeat(64), identification: l.identification, lues: l.cases, corrections: [], messagesLecture: l.messages, casesInconnues: l.casesInconnues, importeLe: '' });
  }
  p = parametresParDefaut(100_000);
  p.collaborateur = 'C. Exemple';
  p.ventilation = { methode: 'manuelle', manuelle: ventilationExacte(ATTENDUS_TVA.conforme) };
  p.justifications = [{ id: 'j1', libelle: 'Écart de déclaration du mois de février', montant: 3_000, commentaire: 'Justification partielle (test)', piece: 'CA3 02/2026' }];
  cadrage = assemblerCadrage(fec, null, declarations, p);
  const wb = classeurCadrageTva(ExcelJS, {
    entreprise: 'CONSEIL FICTIF SERVICES SAS',
    siren: '000777128',
    exercice: cadrage.exercice,
    periodes: cadrage.periodes,
    g300: cadrage.g300,
    g340: cadrage.g340,
    mensuel: cadrage.mensuel,
    controles: cadrage.controles,
    anomalies: cadrage.anomalies,
    corrections: [],
    declarations: cadrage.retenues.map((d, i) => ({ periode: cadrage.periodes[i]!, source: d.source, fichier: d.nomFichier, empreinte: d.empreinte, millesime: d.identification.millesime })),
    parametres: p,
    fec: fec.metadonnees,
    version: '0.14.0',
    date: new Date('2026-10-08T10:00:00Z'),
  });
  octets = await octetsClasseur(wb);
});

describe('assemblage du cadrage', () => {
  it('CA3 retenues dans l’ordre des périodes, anomalies de série et de déclaration, écart de février', () => {
    expect(cadrage.periodes[0]).toBe('07/2025');
    expect(cadrage.periodes).toHaveLength(12);
    expect(cadrage.g340.ecart).toBe(5_000);
    expect(cadrage.g340.residuel).toBe(2_000);
    expect(cadrage.anomalies.map((a) => `${a.periode} ${a.message.code}`)).toEqual(expect.arrayContaining(['12/2025 DEPOT_TARDIF', '02/2026 L16', '02/2026 T9B']));
    expect(cadrage.anomalies.some((a) => a.message.code === 'EXERCICE_INCOMPLET')).toBe(false);
  });

  it('déclaration hors exercice non retenue et mois manquant signalé', () => {
    const autre = { ...declarations[0]!, id: 'x', identification: { ...declarations[0]!.identification, debut: '2026-07-01', fin: '2026-07-31' } };
    const c = assemblerCadrage(fec, null, [...declarations.filter((d) => !d.id.includes('202511')), autre], p);
    expect(c.horsExercice).toHaveLength(1);
    expect(c.anomalies[0]!.message.message).toBe('Mois de l’exercice sans déclaration : 11/2025.');
  });
});

describe('export Excel du cadrage', () => {
  const lire = async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength) as ArrayBuffer);
    return wb;
  };

  it('onglets, en-tête G340, TVA déclarée liée à la feuille G300', async () => {
    const wb = await lire();
    expect(wb.worksheets.map((w) => w.name)).toEqual(['G300 Récap TVA', 'G340 Contrôle TVA collectée', 'Cadrage mensuel', 'Anomalies CA3', 'Paramètres']);
    const g = wb.getWorksheet('G340 Contrôle TVA collectée')!;
    expect([1, 2, 4, 5].map((r) => [g.getCell(r, 1).value, g.getCell(r, 2).value])).toEqual([
      ['Entreprise', 'CONSEIL FICTIF SERVICES SAS'],
      ['Exercice', 'du 01/07/2025 au 30/06/2026'],
      ['Collaborateur', 'C. Exemple'],
      ['Chap.', 'G 340'],
    ]);
    let declaree: ExcelJS.Cell | null = null;
    g.eachRow((row) => {
      if (row.getCell(6).value === 'TVA collectée déclarée (G300)') declaree = row.getCell(8);
    });
    expect((declaree!.value as { formula: string }).formula).toMatch(/^'G300 Récap TVA'!O\d+$/);
    const params = wb.getWorksheet('Paramètres')!;
    expect(params.getColumn(2).values).toContain(fec.metadonnees.empreinte);
  });

  let soffice = false;
  try {
    execFileSync('soffice', ['--version'], { stdio: 'ignore' });
    soffice = true;
  } catch {
    /* LibreOffice absent */
  }

  it.skipIf(!soffice)('formules vivantes : recalcul par LibreOffice identique aux montants calculés', { timeout: 180_000 }, async () => {
    const dossier = mkdtempSync(join(tmpdir(), 'tva-xlsx-'));
    try {
      // Saisies du collaborateur dans Excel : justification complétée (20 €) et taxe 9B de février corrigée
      // (500 → 550) : les formules doivent en tenir compte (résultats en cache volontairement périmés).
      const modifie = await lire();
      const g340 = modifie.getWorksheet('G340 Contrôle TVA collectée')!;
      g340.eachRow((row) => {
        if (row.getCell(1).value === 'Écart de déclaration du mois de février') row.getCell(3).value = 50;
      });
      const g300 = modifie.getWorksheet('G300 Récap TVA')!;
      g300.eachRow((row) => {
        if (row.getCell(1).value === '9B' && String(row.getCell(2).value).endsWith('taxe due')) row.getCell(10).value = 550;
      });
      // Résultats en cache retirés : LibreOffice doit recalculer chaque formule.
      for (const ws of modifie.worksheets) {
        ws.eachRow((row) => row.eachCell((c) => {
          const v = c.value as { formula?: string } | null;
          if (v && typeof v === 'object' && 'formula' in v && v.formula) c.value = { formula: v.formula } as ExcelJS.CellFormulaValue;
        }));
      }
      writeFileSync(join(dossier, 'entree.xlsx'), new Uint8Array(await modifie.xlsx.writeBuffer()));
      execFileSync('soffice', ['--headless', `-env:UserInstallation=file://${dossier}/profil`, '--convert-to', 'xlsx:Calc MS Excel 2007 XML', '--outdir', join(dossier, 'sortie'), join(dossier, 'entree.xlsx')], { stdio: 'ignore', timeout: 170_000 });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(readFileSync(join(dossier, 'sortie', 'entree.xlsx')).buffer as ArrayBuffer);
      const valeur = (feuille: string, libelle: string, colLibelle: number, colValeur: number) => {
        let v: unknown = null;
        wb.getWorksheet(feuille)!.eachRow((row) => {
          if (row.getCell(colLibelle).value === libelle) {
            const c = row.getCell(colValeur).value as { formula?: string; result?: unknown } | number;
            // ExcelJS ignore un résultat de formule nul (« <v>0</v> » dans le fichier recalculé) : absent = 0.
            v = typeof c === 'object' && c !== null ? (c.result ?? (c.formula ? 0 : undefined)) : c;
          }
        });
        return v as number;
      };
      const g = cadrage.g340;
      expect(valeur('G340 Contrôle TVA collectée', 'TOTAL TVA collectée théorique', 6, 8)).toBeCloseTo(g.tvaTheorique / 100, 2);
      // Février corrigé dans G300 : TVA déclarée + 50 €, écart nul ; justification de 50 € : résiduel −50 €.
      expect(valeur('G340 Contrôle TVA collectée', 'TVA collectée déclarée (G300)', 6, 8)).toBeCloseTo(g.tvaDeclaree / 100 + 50, 2);
      expect(valeur('G340 Contrôle TVA collectée', 'ÉCART (théorique − déclarée)', 6, 8)).toBeCloseTo(0, 2);
      expect(valeur('G340 Contrôle TVA collectée', 'Écart résiduel non justifié', 1, 3)).toBeCloseTo(-50, 2);
      expect(valeur('G340 Contrôle TVA collectée', 'Total', 1, 8)).toBeCloseTo(g.tvaSurCa / 100, 2);
      expect(valeur('G340 Contrôle TVA collectée', 'Total des régularisations', 1, 9)).toBeCloseTo(g.totalRegularisations / 100, 2);
      expect(valeur('G300 Récap TVA', 'TVA collectée déclarée (taxes des lignes 08 à 13, T1 à TC, P1, P2, I1 à I6)', 2, 15)).toBeCloseTo(ATTENDUS_TVA.conforme.tvaTheorique / 100, 2);
      expect(valeur('Cadrage mensuel', 'Total', 1, 6)).toBeCloseTo(-50, 2);
      expect(valeur('Cadrage mensuel', '02/2026', 1, 6)).toBeCloseTo(-50, 2);
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });
});
