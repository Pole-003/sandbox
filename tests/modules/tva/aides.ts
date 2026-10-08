import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { analyserCa3, type LectureCa3 } from '../../../src/modules/tva/ca3/analyse.ts';
import { pagesDuPdf } from '../../../src/modules/tva/ca3/texte-pdf.ts';

export const DOSSIER_CA3 = join(import.meta.dirname, '..', '..', 'fixtures', 'ca3');

export interface AttenduCa3 {
  fichier: string;
  description: string;
  variante: number;
  illisible: boolean;
  identification: Record<string, string> | null;
  cases: Record<string, { base?: number; taxe?: number; montant?: number }>;
  controlesAttendus: string[];
}

export const ATTENDUS_CA3 = JSON.parse(readFileSync(join(DOSSIER_CA3, 'attendus.json'), 'utf8')) as Record<'services' | 'trimestrielle' | 'autres', AttenduCa3[]>;

export async function lireFixture(serie: 'services' | 'trimestrielle' | 'autres', fichier: string): Promise<LectureCa3> {
  const octets = new Uint8Array(readFileSync(join(DOSSIER_CA3, serie, fichier)));
  return analyserCa3(await pagesDuPdf(pdfjs as unknown as typeof import('pdfjs-dist'), octets));
}
