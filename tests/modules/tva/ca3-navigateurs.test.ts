import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { analyserCa3 } from '../../../src/modules/tva/ca3/analyse.ts';
import { controlerDeclaration } from '../../../src/modules/tva/ca3/controles.ts';
import { pagesDuPdf } from '../../../src/modules/tva/ca3/texte-pdf.ts';
import { DOSSIER_CA3 } from './aides.ts';

interface Attendu {
  fichier: string;
  producteur: string;
  disposition: string;
  description: string;
  identification: Record<string, string>;
  cases: Record<string, { base?: number; taxe?: number; montant?: number }>;
  controlesAttendus: string[];
}
const DOSSIER = join(DOSSIER_CA3, 'navigateurs');
const ATTENDUS = JSON.parse(readFileSync(join(DOSSIER, 'attendus.json'), 'utf8')) as Attendu[];

describe('CA3 imprimées par de vrais moteurs de rendu (Chromium, LibreOffice)', () => {
  for (const a of ATTENDUS) {
    it(`${a.producteur} / ${a.disposition} — ${a.description}`, async () => {
      const l = analyserCa3(await pagesDuPdf(pdfjs as unknown as typeof import('pdfjs-dist'), new Uint8Array(readFileSync(join(DOSSIER, a.fichier)))));
      expect(l.illisible).toBe(false);
      expect(l.identification).toEqual(a.identification);
      expect(l.cases).toEqual(a.cases);
      expect(controlerDeclaration(l.cases).map((m) => m.code).sort()).toEqual([...a.controlesAttendus].sort());
      expect(l.messages.filter((m) => m.gravite !== 'information')).toEqual([]);
    });
  }
});
