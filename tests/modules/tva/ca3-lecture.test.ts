import { describe, expect, it } from 'vitest';
import { controlerDeclaration } from '../../../src/modules/tva/ca3/controles.ts';
import { ATTENDUS_CA3, lireFixture } from './aides.ts';

describe('lecture des CA3 fictives (PDF → cases)', () => {
  for (const serie of ['services', 'trimestrielle', 'autres'] as const) {
    for (const a of ATTENDUS_CA3[serie]) {
      it(`${a.fichier} — ${a.description}`, async () => {
        const l = await lireFixture(serie, a.fichier);
        expect(l.illisible).toBe(a.illisible);
        if (a.illisible) return;
        expect(l.identification).toEqual(a.identification);
        expect(l.cases).toEqual(a.cases);
        const controles = controlerDeclaration(l.cases).map((m) => m.code).sort();
        expect(controles).toEqual([...a.controlesAttendus.filter((c) => c !== 'DEPOT_TARDIF')].sort());
      });
    }
  }
});
