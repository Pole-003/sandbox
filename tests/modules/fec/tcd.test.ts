import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { ajouterTcd, lettreColonne, type DefinitionTcd } from '../../../src/modules/fec/export/tcd.ts';
import { octetsClasseur } from '../../../src/modules/fec/export/xlsx.ts';

const definition = (): DefinitionTcd => ({
  nom: 'TCD_Essai',
  feuilleCible: 'TCD Essai',
  feuilleSource: 'Données & sources',
  titre: ['Essai', 'Sous-titre'],
  champs: [
    { nom: 'Classe', type: 'texte' },
    { nom: 'Compte', type: 'texte' },
    { nom: 'Débit', type: 'montant' },
    { nom: 'Crédit', type: 'montant' },
  ],
  lignes: [
    ['6 – Charges', '607 – Achats', 10_050, 0],
    ['4 – Tiers', '411 – Clients <A&B>', 20_000, 5_025],
    ['6 – Charges', '601 – Matières', 1_000, 0],
    ['4 – Tiers', '401 – Fournisseurs', 0, 30_000],
    ['6 – Charges', '607 – Achats', 1, 0],
  ],
  axes: [0, 1],
  valeurs: [2, 3],
});

async function classeur(def: DefinitionTcd) {
  const wb = new ExcelJS.Workbook();
  ajouterTcd(wb, def);
  wb.addWorksheet('Autre');
  const octets = await octetsClasseur(wb);
  return { octets, zip: await JSZip.loadAsync(octets) };
}

describe('tableaux croisés dynamiques', () => {
  it('lettres de colonnes', () => {
    expect([1, 26, 27, 52, 703].map(lettreColonne)).toEqual(['A', 'Z', 'AA', 'AZ', 'AAA']);
  });

  it('rendu dans les cellules : groupes triés, sous-totaux en tête, total général', async () => {
    const { octets } = await classeur(definition());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength) as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['TCD Essai', 'Données & sources', 'Autre']);
    const ws = wb.getWorksheet('TCD Essai')!;
    const lignes = [4, 5, 6, 7, 8, 9, 10, 11].map((r) => [ws.getCell(r, 1).value, ws.getCell(r, 2).value, ws.getCell(r, 3).value]);
    expect(lignes).toEqual([
      ['Étiquettes de lignes', 'Somme de Débit', 'Somme de Crédit'],
      ['4 – Tiers', 200, 350.25],
      ['401 – Fournisseurs', 0, 300],
      ['411 – Clients <A&B>', 200, 50.25],
      ['6 – Charges', 110.51, 0],
      ['601 – Matières', 10, 0],
      ['607 – Achats', 100.51, 0],
      ['Total général', 310.51, 350.25],
    ]);
    expect(ws.getCell('A6').alignment?.indent).toBe(1);
    const source = wb.getWorksheet('Données & sources')!;
    expect(source.getRow(1).values).toEqual([undefined, 'Classe', 'Compte', 'Débit', 'Crédit']);
    expect(source.getCell('C2').value).toBe(100.5);
  });

  it('parties OOXML : cache actualisé à l’ouverture, tableau, relations et types', async () => {
    const { zip } = await classeur(definition());
    const lire = (f: string) => zip.file(f)!.async('string');
    const classeurXml = await lire('xl/workbook.xml');
    expect(classeurXml).toMatch(/<calcPr[^>]*\/><pivotCaches><pivotCache cacheId="1" r:id="rIdCacheTcd1"\/><\/pivotCaches><\/workbook>/);
    expect(await lire('xl/_rels/workbook.xml.rels')).toMatch(/Id="rIdCacheTcd1" Type="[^"]*\/relationships\/pivotCacheDefinition" Target="pivotCache\/pivotCacheDefinition1.xml"/);
    const cache = await lire('xl/pivotCache/pivotCacheDefinition1.xml');
    expect(cache).toContain('saveData="0" refreshOnLoad="1"');
    expect(cache).toContain('<worksheetSource ref="A1:D6" sheet="Données &amp; sources"/>');
    expect(cache).toContain('<cacheField name="Compte" numFmtId="0"><sharedItems count="4"><s v="401 – Fournisseurs"/><s v="411 – Clients &lt;A&amp;B&gt;"/><s v="601 – Matières"/><s v="607 – Achats"/></sharedItems></cacheField>');
    expect(cache).toContain('<cacheField name="Débit" numFmtId="0"><sharedItems containsSemiMixedTypes="0" containsString="0" containsNumber="1" minValue="0" maxValue="200"/>');
    const tcd = await lire('xl/pivotTables/pivotTable1.xml');
    expect(tcd).toContain('name="TCD_Essai" cacheId="1"');
    expect(tcd).toContain('<location ref="A4:C11" firstHeaderRow="0" firstDataRow="1" firstDataCol="1"/>');
    expect(tcd).toContain('<rowFields count="2"><field x="0"/><field x="1"/></rowFields>');
    expect(tcd).toContain('<rowItems count="7"><i><x/></i><i r="1"><x/></i><i r="1"><x v="1"/></i><i><x v="1"/></i><i r="1"><x v="2"/></i><i r="1"><x v="3"/></i><i t="grand"><x/></i></rowItems>');
    expect(tcd).toContain('<colFields count="1"><field x="-2"/></colFields><colItems count="2"><i><x/></i><i i="1"><x v="1"/></i></colItems>');
    expect(tcd).toContain('<dataField name="Somme de Débit" fld="2" baseField="0" baseItem="0" numFmtId="4"/>');
    expect(await lire('xl/pivotTables/_rels/pivotTable1.xml.rels')).toContain('Target="../pivotCache/pivotCacheDefinition1.xml"');
    const feuille = Object.keys(zip.files).find((f) => /^xl\/worksheets\/_rels\/sheet\d+\.xml\.rels$/.test(f))!;
    expect(await lire(feuille)).toContain('Target="../pivotTables/pivotTable1.xml"');
    const types = await lire('[Content_Types].xml');
    expect(types).toContain('PartName="/xl/pivotTables/pivotTable1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml"');
    expect(types).toContain('PartName="/xl/pivotCache/pivotCacheDefinition1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml"');
  });

  it('un seul champ de valeur : en-tête en ligne 1 du TCD', async () => {
    const { zip } = await classeur({ ...definition(), valeurs: [2] });
    const tcd = await zip.file('xl/pivotTables/pivotTable1.xml')!.async('string');
    expect(tcd).toContain('<location ref="A4:B11" firstHeaderRow="1" firstDataRow="1" firstDataCol="1"/>');
    expect(tcd).toContain('<colItems count="1"><i/></colItems>');
    expect(tcd).not.toContain('<colFields');
  });

  it('aucune donnée : onglet explicatif, pas de TCD', async () => {
    const { zip } = await classeur({ ...definition(), lignes: [] });
    expect(Object.keys(zip.files).some((f) => f.includes('pivot'))).toBe(false);
  });
});

let soffice = false;
try {
  execFileSync('soffice', ['--version'], { stdio: 'ignore' });
  soffice = true;
} catch {
  /* LibreOffice absent : test ignoré */
}

describe.skipIf(!soffice)('TCD relu et recalculé par un tableur (LibreOffice)', () => {
  it('le TCD est reconnu et recalculé à l’identique depuis les données sources', { timeout: 180_000 }, async () => {
    const { octets } = await classeur(definition());
    const dossier = mkdtempSync(join(tmpdir(), 'tcd-'));
    try {
      writeFileSync(join(dossier, 'tcd.xlsx'), octets);
      const profil = `-env:UserInstallation=file://${dossier}/profil`;
      execFileSync('soffice', ['--headless', profil, '--convert-to', 'ods', '--outdir', dossier, join(dossier, 'tcd.xlsx')], { stdio: 'ignore', timeout: 170_000 });
      const contenu = await (await JSZip.loadAsync(readFileSync(join(dossier, 'tcd.ods')))).file('content.xml')!.async('string');
      expect(contenu).toContain('table:name="TCD_Essai"');
      expect(contenu).toMatch(/table:source-field-name="Débit"[^>]*table:function="sum"/);
      execFileSync('soffice', ['--headless', profil, '--convert-to', 'csv:Text - txt - csv (StarCalc):59,34,76,1,,0,false,true,false,false,false,1', '--outdir', dossier, join(dossier, 'tcd.ods')], { stdio: 'ignore', timeout: 170_000 });
      const csv = readFileSync(join(dossier, 'tcd-TCD Essai.csv'), 'utf8');
      expect(csv).toContain('4 – Tiers;200;350.25');
      expect(csv).toContain('607 – Achats;100.51;0');
      expect(csv).toMatch(/;310\.51;350\.25/);
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });
});
