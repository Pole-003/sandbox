/**
 * Export du rapport de conformité en .xlsx : onglet « Synthèse », un onglet par contrôle en anomalie
 * (lignes concernées, avec leurs zones principales), onglet « Paramètres ».
 */
import type { Workbook } from 'exceljs';
import type { Constat } from '../conformite/constats.ts';
import { LIBELLES_GRAVITE, LIEN_TEST_COMPTA_DEMAT, MENTION_RAPPORT, regle } from '../conformite/regles.ts';
import { texteDe, type FecColonnes } from '../donnees/colonnes.ts';
import { dateExcel, euros, feuilleParametres, feuilleTableau, nomOnglet, type ExcelJSModule, type Parametres } from './xlsx.ts';

export function classeurRapport(
  ExcelJS: ExcelJSModule,
  constats: Constat[],
  colonnes: FecColonnes,
  parametres: Parametres,
): Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sandbox Pôle 003';
  wb.created = new Date();
  const noms = new Set<string>(['synthèse', 'paramètres']);

  const synthese = feuilleTableau(
    wb,
    'Synthèse',
    [
      { titre: 'Code', largeur: 8, valeur: (c: Constat) => c.code },
      { titre: 'Contrôle', largeur: 60, valeur: (c) => regle(c.code).libelle },
      { titre: 'Gravité', largeur: 14, valeur: (c) => LIBELLES_GRAVITE[regle(c.code).gravite] },
      { titre: 'Source', largeur: 34, valeur: (c) => regle(c.code).source },
      { titre: 'Occurrences', type: 'entier', largeur: 12, valeur: (c) => c.occurrences },
      { titre: 'Précisions', largeur: 60, valeur: (c) => c.details.slice(0, 20).join(' ; ') },
    ],
    constats,
    {
      titre: [
        `Rapport de conformité FEC — ${parametres.fichier}`,
        MENTION_RAPPORT,
        `Outil officiel : ${LIEN_TEST_COMPTA_DEMAT}`,
        constats.length === 0 ? 'Aucune anomalie détectée.' : `${constats.length} contrôle(s) en anomalie.`,
      ],
    },
  );
  synthese.getCell(3, 1).value = { text: `Outil officiel : ${LIEN_TEST_COMPTA_DEMAT}`, hyperlink: LIEN_TEST_COMPTA_DEMAT };

  // Ligne d'origine → indice de ligne normalisée.
  const indice = new Map<number, number>();
  for (let i = 0; i < colonnes.nbLignes; i++) indice.set(colonnes.ligneOrigine[i]!, i);

  for (const c of constats) {
    const r = regle(c.code);
    const nom = nomOnglet(`${c.code} ${r.libelle}`, noms);
    if (c.lignes.length === 0) {
      feuilleTableau(wb, nom, [{ titre: 'Précision', largeur: 100, valeur: (d: string) => d }], c.details.length ? c.details : ['Constat global, sans ligne.'], {
        titre: [`${c.code} — ${r.libelle}`, `${LIBELLES_GRAVITE[r.gravite]} · ${r.source} · ${c.occurrences} occurrence(s)`],
      });
      continue;
    }
    const t = (col: Parameters<typeof texteDe>[1]) => (l: number) => {
      const i = indice.get(l);
      return i === undefined ? '' : texteDe(colonnes, col, i);
    };
    const n = (f: (i: number) => number | Date | null) => (l: number) => {
      const i = indice.get(l);
      return i === undefined ? null : f(i);
    };
    feuilleTableau(
      wb,
      nom,
      [
        { titre: 'Ligne du fichier', type: 'entier', largeur: 10, valeur: (l: number) => l },
        { titre: 'JournalCode', largeur: 10, valeur: t('journalCode') },
        { titre: 'EcritureNum', largeur: 12, valeur: t('ecritureNum') },
        { titre: 'EcritureDate', type: 'date', valeur: n((i) => dateExcel(colonnes.ecritureDate[i]!)) },
        { titre: 'CompteNum', largeur: 12, valeur: t('compteNum') },
        { titre: 'CompteLib', largeur: 28, valeur: t('compteLib') },
        { titre: 'CompAuxNum', largeur: 12, valeur: t('compAuxNum') },
        { titre: 'PieceRef', largeur: 14, valeur: t('pieceRef') },
        { titre: 'EcritureLib', largeur: 36, valeur: t('ecritureLib') },
        { titre: 'Débit', type: 'montant', valeur: n((i) => euros(colonnes.debit[i]!)) },
        { titre: 'Crédit', type: 'montant', valeur: n((i) => euros(colonnes.credit[i]!)) },
        { titre: 'ValidDate', type: 'date', valeur: n((i) => dateExcel(colonnes.validDate[i]!)) },
      ],
      c.lignes,
      {
        titre: [
          `${c.code} — ${r.libelle}`,
          `${LIBELLES_GRAVITE[r.gravite]} · ${r.source} · ${c.occurrences} occurrence(s)${c.lignes.length < c.occurrences ? ` (${c.lignes.length} premières listées)` : ''}`,
        ],
      },
    );
  }
  feuilleParametres(wb, parametres);
  return wb;
}
