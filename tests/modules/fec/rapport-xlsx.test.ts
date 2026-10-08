import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { classeurRapport } from '../../../src/modules/fec/export/rapport-conformite.ts';
import { octetsClasseur } from '../../../src/modules/fec/export/xlsx.ts';
import { tousLesConstats } from '../../../src/modules/fec/import/pipeline.ts';
import { importerFichier } from './aides.ts';

describe('export du rapport de conformité', () => {
  it('synthèse, un onglet par contrôle en anomalie, paramètres ; montants numériques', async () => {
    const r = await importerFichier('pieges/000987651FEC20251231_piege-desequilibre.txt');
    if (r.statut !== 'termine') throw new Error();
    const constats = tousLesConstats(r.fec);
    const wb = classeurRapport(ExcelJS, constats, r.fec.colonnes, {
      dossier: 'Petit Comptoir',
      siren: '000987651',
      exercice: '01/01/2025 – 31/12/2025',
      fichier: r.fec.meta.nomFichier,
      empreinte: r.fec.meta.empreinte,
      version: '0.0.0',
    });
    const relu = new ExcelJS.Workbook();
    await relu.xlsx.load((await octetsClasseur(wb)).buffer as ArrayBuffer);
    expect(relu.worksheets.map((w) => w.name)).toEqual([
      'Synthèse',
      'E01 Écriture déséquilibrée',
      'E02 Déséquilibre global',
      "E03 Déséquilibre d'un journal",
      "E04 Déséquilibre d'un mois",
      'Paramètres',
    ]);
    const synthese = relu.getWorksheet('Synthèse')!;
    expect(String(synthese.getCell('A2').value)).toContain('Seul l’outil officiel Test Compta Demat');
    const e01 = relu.getWorksheet('E01 Écriture déséquilibrée')!;
    expect(e01.getRow(4).getCell(1).value).toBe('Ligne du fichier');
    expect(e01.getRow(5).getCell(1).value).toBe(196);
    expect(typeof e01.getRow(5).getCell(10).value).toBe('number');
    expect(e01.getRow(5).getCell(4).value).toBeInstanceOf(Date);
    expect(e01.views[0]).toMatchObject({ state: 'frozen', ySplit: 4 });
    expect(relu.getWorksheet('Paramètres')!.getCell('B5').value).toBe(r.fec.meta.empreinte);
  });
});
