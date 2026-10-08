import { describe, expect, it } from 'vitest';
import { REGLES } from '../../../src/modules/fec/conformite/regles.ts';
import { tousLesConstats, type ResultatImport } from '../../../src/modules/fec/import/pipeline.ts';
import { ENTETE_BIC, importerTexte, ligneBic } from './aides.ts';

/** Écriture équilibrée de deux lignes. */
function ecriture(num: string, options: Partial<Record<string, string>> = {}, montant = '100,00'): string[] {
  return [
    ligneBic({ EcritureNum: num, CompteNum: '627000', Debit: montant, ...options }),
    ligneBic({ EcritureNum: num, CompteNum: '512000', CompteLib: 'Banque', Credit: montant, ...options }),
  ];
}

const AN = [
  ligneBic({ JournalCode: 'AN', JournalLib: 'A nouveaux', EcritureNum: '1', EcritureDate: '20250101', PieceDate: '20250101', EcritureLib: 'A nouveaux', CompteNum: '512000', CompteLib: 'Banque', Debit: '500,00' }),
  ligneBic({ JournalCode: 'AN', JournalLib: 'A nouveaux', EcritureNum: '1', EcritureDate: '20250101', PieceDate: '20250101', EcritureLib: 'A nouveaux', CompteNum: '101000', CompteLib: 'Capital', Credit: '500,00' }),
];

function fec(...lignes: string[]): string {
  return [ENTETE_BIC, ...lignes].join('\r\n') + '\r\n';
}

function codes(r: ResultatImport): Record<string, number[] | number> {
  if (r.statut !== 'termine') throw new Error(r.statut);
  return Object.fromEntries(tousLesConstats(r.fec).map((c) => [c.code, c.lignes.length ? c.lignes : c.occurrences]));
}

describe('catalogue des règles', () => {
  it('codes uniques, gravités et sources renseignées', () => {
    expect(new Set(REGLES.map((r) => r.code)).size).toBe(REGLES.length);
    for (const r of REGLES) {
      expect(r.libelle.length).toBeGreaterThan(5);
      expect(r.source.length).toBeGreaterThan(3);
    }
  });
});

describe('FEC minimal conforme', () => {
  it("n'a aucun constat", async () => {
    expect(codes(await importerTexte(fec(...AN, ...ecriture('2'), ...ecriture('3'))))).toEqual({});
  });
});

describe('règles de structure', () => {
  it('S03 : octets propres à Windows-1252 dans un fichier lu en ISO-8859-15', async () => {
    const texte = fec(...AN, ...ecriture('2', { EcritureLib: 'Frais 5 €' }));
    const octets = Uint8Array.from(texte, (c) => (c === '€' ? 0x80 : c === 'é' ? 0xe9 : c.charCodeAt(0)));
    const r = await importerTexte(octets);
    expect(codes(r)).toEqual({ S03: 1 });
    if (r.statut === 'termine') expect(r.fec.meta.encodage).toBe('windows-1252');
  });

  it('S06 et S08 : zone absente, nom reconnu par alias', async () => {
    const entete = ENTETE_BIC.replace('EcritureLib', 'Libellé écriture').replace('\tIdevise', '');
    const lignes = [...AN, ...ecriture('2')].map((l) => l.split('\t').slice(0, 17).join('\t'));
    expect(codes(await importerTexte([entete, ...lignes].join('\n')))).toEqual({ S06: 1, S08: 1 });
  });

  it('S13 et S11 : séparateur en fin de ligne et ligne trop courte', async () => {
    const lignes = [...AN, ...ecriture('2')].map((l) => `${l}\t`);
    lignes[2] = lignes[2]!.slice(0, -1);
    const r = await importerTexte([`${ENTETE_BIC}\t`, ...lignes].join('\n'));
    expect(codes(r)).toEqual({ S13: 1, S11: [4] });
  });

  it('S05 : sans en-tête, l’assistant de correspondance est requis', async () => {
    const r = await importerTexte([...AN, ...ecriture('2')].join('\n'));
    expect(r.statut).toBe('correspondance-requise');
    if (r.statut !== 'correspondance-requise') return;
    expect(r.sansEntete).toBe(true);
    expect(r.apercu).toHaveLength(4);
    const correspondance = Object.fromEntries(ENTETE_BIC.split('\t').map((z, i) => [i, z])) as never;
    const r2 = await importerTexte([...AN, ...ecriture('2')].join('\n'), { correspondance, sansEntete: true });
    expect(codes(r2)).toMatchObject({ S05: 1, S08: 18 });
  });

  it('S15 : fichier sans écriture', async () => {
    expect(codes(await importerTexte(`${ENTETE_BIC}\n`))).toEqual({ S15: 1 });
  });

  it('S16 : XML sans DateCloture ni deuxième ligne', async () => {
    const xml = `<?xml version="1.0"?><comptabilite xsi:noNamespaceSchemaLocation="formatA47A-I-VII-1.xsd"><exercice><journal><JournalCode>OD</JournalCode><JournalLib>OD</JournalLib><ecriture><EcritureNum>1</EcritureNum><EcritureDate>2025-01-15</EcritureDate><EcritureLib>x</EcritureLib><PieceRef>1</PieceRef><PieceDate>2025-01-15</PieceDate><ValidDate>2025-01-15</ValidDate><ligne><CompteNum>627000</CompteNum><CompteLib>Frais</CompteLib><Debit>0</Debit></ligne></ecriture></journal></exercice></comptabilite>`;
    const r = await importerTexte(xml, { nomFichier: '000987651FEC20251231.xml' });
    expect(codes(r)).toMatchObject({ S16: [1], E05: [1], E13: 1, D12: [1] });
  });
});

describe('règles de données', () => {
  it('D12, D15, D17, D18', async () => {
    const r = await importerTexte(
      fec(
        ...AN,
        ...ecriture('2'),
        ligneBic({ EcritureNum: '3', Debit: '0,00', Credit: '0,00' }),
        ligneBic({ EcritureNum: '3', Debit: '0,00', Credit: '0,00', EcritureLet: 'AA' }),
        ...ecriture('4', { Montantdevise: '0,00', DateLet: '00000000' }),
        ligneBic({ EcritureNum: '5', Debit: '10,00', Credit: '' }),
        ligneBic({ EcritureNum: '5', Credit: '10,00' }),
      ),
    );
    expect(codes(r)).toEqual({ D12: [6, 7], D15: [7], D17: [8, 9], D18: [10] });
  });

  it('D16 : tiers intégré au compte, auxiliaire reconstruit', async () => {
    const r = await importerTexte(fec(...AN, ...ecriture('2', {}), ligneBic({ EcritureNum: '3', CompteNum: '411DUPONT', CompteLib: 'Dupont SARL', Debit: '12,00' }), ligneBic({ EcritureNum: '3', CompteNum: '706000', CompteLib: 'Prestations', Credit: '12,00' })));
    expect(codes(r)).toEqual({ D16: [6] });
    if (r.statut !== 'termine') return;
    const f = r.fec.colonnes;
    const i = Array.from(f.ligneOrigine).indexOf(6);
    expect([f.textes[f.compteNum[i]!], f.textes[f.compteLib[i]!], f.textes[f.compAuxNum[i]!], f.textes[f.compAuxLib[i]!]]).toEqual([
      '411',
      'Clients',
      '411DUPONT',
      'Dupont SARL',
    ]);
  });

  it('D02 et D19 : trésorerie BNC avec zones à blanc', async () => {
    const entete = `${ENTETE_BIC}\tDateRglt\tModeRglt\tNatOp\tIdClient`;
    const l = (v: Partial<Record<string, string>>, rglt = '20250115\tVIR\tHonoraires\tCLI1') => `${ligneBic(v)}\t${rglt}`;
    const lignes = [
      ...AN.map((x) => `${x}\t20250101\tReport\t\t`),
      l({ EcritureNum: '2', CompteNum: '512000', CompteLib: 'Banque', Debit: '10,00' }),
      l({ EcritureNum: '2', CompteNum: '', Credit: '10,00' }),
      l({ EcritureNum: '3', CompteNum: '512000', CompteLib: 'Banque', Debit: '10,00' }, '\t\t\t'),
      l({ EcritureNum: '3', CompteNum: '706000', Credit: '10,00' }),
    ];
    const r = await importerTexte([entete, ...lignes].join('\n'));
    if (r.statut === 'termine') expect(r.fec.meta.regime).toBe('bnc-tresorerie');
    expect(codes(r)).toEqual({ D19: [5], D02: [6] });
  });
});

describe('règles de libellés et d’écritures', () => {
  it('L02, L03, L04', async () => {
    const r = await importerTexte(
      fec(
        ...AN,
        ...ecriture('2'),
        ...ecriture('3'),
        ...ecriture('4', { JournalLib: 'Diverses' }),
        ligneBic({ EcritureNum: '5', CompteNum: '411000', CompteLib: 'Clients', CompAuxNum: 'X1', CompAuxLib: 'Martin', Debit: '5,00' }),
        ligneBic({ EcritureNum: '5', CompteNum: '401000', CompteLib: 'Fournisseurs', CompAuxNum: 'X1', CompAuxLib: 'Martin', Credit: '5,00' }),
        ligneBic({ EcritureNum: '6', CompteNum: '411000', CompteLib: 'Clients', CompAuxNum: 'X1', CompAuxLib: 'Martin SA', Debit: '5,00' }),
        ligneBic({ EcritureNum: '6', CompteNum: '627000', Credit: '5,00' }),
      ),
    );
    expect(codes(r)).toEqual({ L02: [8, 9], L03: [12], L04: 1 });
  });

  it('E05, E06, E15, E16, E17', async () => {
    const r = await importerTexte(
      fec(
        ...AN,
        ligneBic({ JournalCode: 'AN', JournalLib: 'A nouveaux', EcritureNum: '1', EcritureDate: '20250101', PieceDate: '20250101', EcritureLib: 'A nouveaux', CompteNum: '607000', CompteLib: 'Achats', Debit: '1,00' }),
        ligneBic({ JournalCode: 'AN', JournalLib: 'A nouveaux', EcritureNum: '1', EcritureDate: '20250101', PieceDate: '20250101', EcritureLib: 'A nouveaux', CompteNum: '101000', CompteLib: 'Capital', Credit: '1,00' }),
        ...ecriture('2', { EcritureDate: '20250301', PieceDate: '20250301', ValidDate: '20250331' }),
        ...ecriture('3', { EcritureDate: '20250201', PieceDate: '20250201', ValidDate: '20250331' }),
        ligneBic({ EcritureNum: '4', EcritureDate: '20250316', ValidDate: '20250331', Debit: '3,00' }),
        ligneBic({ EcritureNum: '4', EcritureDate: '20250317', ValidDate: '20250331', CompteNum: '512000', CompteLib: 'Banque', Credit: '3,00' }),
        ligneBic({ EcritureNum: '5', EcritureDate: '20250320', ValidDate: '20250331', CompteNum: '512000', CompteLib: 'Banque', Debit: '0,00' }),
        ligneBic({ EcritureNum: '6', EcritureDate: '20251231', PieceDate: '20251231', ValidDate: '20251231', CompteNum: '707000', CompteLib: 'Ventes', Debit: '50,00' }),
        ligneBic({ EcritureNum: '6', EcritureDate: '20251231', PieceDate: '20251231', ValidDate: '20251231', CompteNum: '607000', CompteLib: 'Achats', Credit: '20,00' }),
        ligneBic({ EcritureNum: '6', EcritureDate: '20251231', PieceDate: '20251231', ValidDate: '20251231', CompteNum: '120000', CompteLib: 'Résultat', Credit: '30,00' }),
      ),
    );
    expect(codes(r)).toEqual({ D12: [12], E05: [12], E06: [10, 11], E15: [4], E16: [13, 14, 15], E17: [8] });
  });

  it('E14 : à-nouveaux après d’autres écritures (numérotation globale)', async () => {
    const an = AN.map((l) => l.replace('\t1\t20250101', '\t3\t20250101'));
    const r = await importerTexte(fec(...ecriture('1'), ...ecriture('2'), ...an));
    expect(codes(r)).toMatchObject({ E14: 1 });
  });

  it('numérotation par journal : un même numéro dans deux journaux n’est pas un doublon (BOFiP § 100)', async () => {
    const lignes = [...AN];
    for (let k = 1; k <= 3; k++) {
      lignes.push(...ecriture(String(k), { JournalCode: 'BQ', JournalLib: 'Banque' }));
      lignes.push(...ecriture(String(k), { JournalCode: 'VT', JournalLib: 'Ventes' }));
    }
    const r = await importerTexte(fec(...lignes));
    expect(codes(r)).toEqual({});
    if (r.statut === 'termine') expect(r.fec.meta.modeNumerotation).toBe('par-journal');
  });
});
