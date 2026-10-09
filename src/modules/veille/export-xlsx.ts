/**
 * Export .xlsx de la sélection d'articles de la veille (ExcelJS, chargé à la demande).
 * Le classeur est produit dans le navigateur : rien n'est envoyé.
 */
import type { Workbook } from 'exceljs';
import { chargerExcelJS, dateExcel, feuilleTableau, type ColonneXlsx } from '../fec/export/xlsx.ts';
import { LIBELLES_TYPE, type Article } from './modele.ts';

export const COLONNES_ARTICLES: ColonneXlsx<Article>[] = [
  { titre: 'Date', type: 'date', valeur: (a) => dateExcel(a.date) },
  { titre: 'Importance (1 à 5)', type: 'entier', largeur: 11, valeur: (a) => a.importance },
  { titre: 'Thème', largeur: 22, valeur: (a) => a.theme },
  { titre: 'Titre', largeur: 70, valeur: (a) => a.titre },
  { titre: 'Source', largeur: 30, valeur: (a) => a.source },
  { titre: 'Type', largeur: 15, valeur: (a) => (a.type ? LIBELLES_TYPE[a.type] : null) },
  { titre: 'Lien', largeur: 40, valeur: (a) => a.url },
  { titre: 'Extrait publié par la source', largeur: 70, valeur: (a) => a.resume },
  { titre: 'Public', largeur: 30, valeur: (a) => a.public.join(', ') },
  { titre: 'Score', type: 'entier', largeur: 8, valeur: (a) => a.pourquoi?.score ?? null },
  { titre: 'Mots-clés détectés', largeur: 40, valeur: (a) => a.pourquoi?.mots.map((m) => `${m.mot} (+${m.poids})`).join(', ') || null },
  { titre: 'Autres sources', largeur: 40, valeur: (a) => a.autres_sources?.map((x) => `${x.source} : ${x.url}`).join('\n') || null },
  { titre: 'Première collecte', type: 'date', valeur: (a) => dateExcel(a.collecte_le) },
];

/** Construit le classeur (séparé de l'écriture pour les tests). */
export function remplirClasseur(classeur: Workbook, articles: readonly Article[], criteres: [string, string][], version: string): void {
  const ws = feuilleTableau(classeur, 'Sélection', COLONNES_ARTICLES, articles, {
    titre: [`Veille du Pôle 003 — ${articles.length} article${articles.length > 1 ? 's' : ''} sélectionné${articles.length > 1 ? 's' : ''}`],
  });
  // La colonne « Lien » devient un lien cliquable (ligne d'en-tête : 3, données à partir de 4).
  const colonneLien = COLONNES_ARTICLES.findIndex((c) => c.titre === 'Lien') + 1;
  articles.forEach((a, i) => {
    const cellule = ws.getCell(4 + i, colonneLien);
    cellule.value = { text: a.url, hyperlink: a.url };
    cellule.font = { color: { argb: 'FF1F4E8C' }, underline: true };
  });
  ws.getColumn(COLONNES_ARTICLES.findIndex((c) => c.titre === 'Extrait publié par la source') + 1).alignment = { wrapText: true, vertical: 'top' };

  const p = classeur.addWorksheet('Paramètres');
  const lignes: [string, string | Date][] = [
    ['Export', 'Sélection du fil de veille'],
    ['Date d’export', new Date()],
    ['Outil', `Sandbox Pôle 003, version ${version}`],
    ...criteres,
    ['Mention', 'Extraits publiés par chaque source, tronqués à 300 caractères ; seul le texte officiel fait foi.'],
  ];
  lignes.forEach(([k, v], i) => {
    p.getCell(i + 1, 1).value = k;
    p.getCell(i + 1, 1).font = { bold: true };
    p.getCell(i + 1, 2).value = v;
    if (v instanceof Date) p.getCell(i + 1, 2).numFmt = 'dd/mm/yyyy hh:mm';
  });
  p.getColumn(1).width = 26;
  p.getColumn(2).width = 80;
}

export async function exporterArticles(articles: readonly Article[], criteres: [string, string][], version: string): Promise<Uint8Array> {
  const ExcelJS = await chargerExcelJS();
  const classeur = new ExcelJS.Workbook();
  classeur.creator = 'Sandbox Pôle 003';
  remplirClasseur(classeur, articles, criteres, version);
  return new Uint8Array(await classeur.xlsx.writeBuffer());
}
