/**
 * Tableaux croisés dynamiques (TCD) dans les exports Excel. ExcelJS ne sait pas en créer : on écrit le
 * classeur avec ExcelJS (données sources et rendu du TCD), puis on ajoute au fichier .xlsx les parties
 * OOXML du TCD (définition du cache et tableau), avant le téléchargement.
 *
 *  - Les données sources sont dans un onglet dédié, en-tête en ligne 1 (plage propre pour le cache).
 *  - Le cache est marqué « actualiser à l'ouverture », sans enregistrements : Excel recalcule le TCD
 *    depuis l'onglet source quand le fichier est ouvert en modification.
 *  - Le résultat du TCD est aussi écrit dans les cellules (disposition compacte, sous-totaux en tête de
 *    groupe, total général), pour que le fichier soit lisible avant actualisation (mode protégé d'Excel).
 *
 * Aucune URL n'est écrite dans ce code : les espaces de noms et types de relation OOXML sont repris du
 * classeur produit par ExcelJS.
 */
import type { Workbook, Worksheet } from 'exceljs';
import type JSZip from 'jszip';

export interface ChampTcd {
  nom: string;
  /** Texte (champ de regroupement possible) ou montant en centimes (champ de valeur possible). */
  type: 'texte' | 'montant';
  largeur?: number;
}

export interface DefinitionTcd {
  /** Nom du TCD (unique dans le classeur). */
  nom: string;
  feuilleCible: string;
  feuilleSource: string;
  /** Lignes affichées au-dessus du TCD (la première en gras). */
  titre: string[];
  champs: ChampTcd[];
  /** Une ligne par enregistrement : texte, ou centimes pour un champ « montant ». */
  lignes: (string | number)[][];
  /** Champs en lignes, du plus englobant au plus fin. */
  axes: number[];
  /** Champs de valeur (somme). */
  valeurs: number[];
}

/** Ligne de départ du TCD dans l'onglet cible (titre au-dessus). */
const LIGNE_TCD = 4;
const FORMAT_MONTANT = '#,##0.00;[Red]-#,##0.00';
/** Format intégré n° 4 d'Excel : « #,##0.00 ». */
const NUM_FMT_MONTANT = 4;

const declares = new WeakMap<Workbook, DefinitionTcd[]>();

const comparer = (a: string, b: string) => a.localeCompare(b, 'fr', { numeric: true });

export function lettreColonne(n: number): string {
  let s = '';
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
  return s;
}

const xml = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const nomValeur = (def: DefinitionTcd, champ: number) => `Somme de ${def.champs[champ]!.nom}`;

interface Noeud {
  item: number;
  sommes: number[];
  enfants: Map<number, Noeud>;
}

interface Calcul {
  /** Éléments distincts (triés) de chaque champ texte ; vide pour un champ montant. */
  elements: string[][];
  racine: Noeud;
  /** Lignes du TCD dans l'ordre d'affichage : profondeur et nœud. */
  rendu: { profondeur: number; noeud: Noeud }[];
}

function calculer(def: DefinitionTcd): Calcul {
  const elements = def.champs.map((c, k) => (c.type === 'texte' ? [...new Set(def.lignes.map((l) => String(l[k])))].sort(comparer) : []));
  const index = elements.map((e) => new Map(e.map((v, i) => [v, i])));
  const nouveau = (item: number): Noeud => ({ item, sommes: def.valeurs.map(() => 0), enfants: new Map() });
  const racine = nouveau(-1);
  for (const l of def.lignes) {
    const ajouter = (n: Noeud) => def.valeurs.forEach((v, k) => (n.sommes[k]! += Number(l[v]) || 0));
    ajouter(racine);
    let n = racine;
    for (const a of def.axes) {
      const i = index[a]!.get(String(l[a]))!;
      let e = n.enfants.get(i);
      if (!e) n.enfants.set(i, (e = nouveau(i)));
      ajouter(e);
      n = e;
    }
  }
  const rendu: Calcul['rendu'] = [];
  const parcourir = (n: Noeud, profondeur: number) => {
    for (const e of [...n.enfants.values()].sort((a, b) => a.item - b.item)) {
      rendu.push({ profondeur, noeud: e });
      parcourir(e, profondeur + 1);
    }
  };
  parcourir(racine, 0);
  return { elements, racine, rendu };
}

/** Onglet de données sources : en-tête en ligne 1, montants en euros. */
function feuilleSource(wb: Workbook, def: DefinitionTcd): Worksheet {
  const ws = wb.addWorksheet(def.feuilleSource);
  def.champs.forEach((c, k) => {
    const cell = ws.getCell(1, k + 1);
    cell.value = c.nom;
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7EEF8' } };
    const col = ws.getColumn(k + 1);
    col.width = c.largeur ?? (c.type === 'montant' ? 16 : 30);
    if (c.type === 'montant') col.numFmt = FORMAT_MONTANT;
  });
  def.lignes.forEach((l, r) => {
    const row = ws.getRow(r + 2);
    def.champs.forEach((c, k) => (row.getCell(k + 1).value = c.type === 'montant' ? Number(l[k]) / 100 : String(l[k])));
  });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, def.lignes.length + 1), column: def.champs.length } };
  return ws;
}

/** Rendu du TCD dans les cellules de l'onglet cible (identique à ce qu'Excel affiche après actualisation). */
function feuilleCible(ws: Worksheet, def: DefinitionTcd, c: Calcul): void {
  def.titre.forEach((t, i) => {
    ws.getCell(i + 1, 1).value = t;
    if (i === 0) ws.getCell(i + 1, 1).font = { bold: true, size: 13 };
  });
  const entete = ws.getRow(LIGNE_TCD);
  entete.getCell(1).value = 'Étiquettes de lignes';
  def.valeurs.forEach((v, k) => (entete.getCell(k + 2).value = nomValeur(def, v)));
  entete.font = { bold: true };
  c.rendu.forEach(({ profondeur, noeud }, r) => {
    const row = ws.getRow(LIGNE_TCD + 1 + r);
    const axe = def.axes[profondeur]!;
    row.getCell(1).value = c.elements[axe]![noeud.item]!;
    row.getCell(1).alignment = { indent: profondeur };
    noeud.sommes.forEach((s, k) => (row.getCell(k + 2).value = s / 100));
    if (profondeur < def.axes.length - 1) row.font = { bold: true };
  });
  const total = ws.getRow(LIGNE_TCD + 1 + c.rendu.length);
  total.getCell(1).value = 'Total général';
  c.racine.sommes.forEach((s, k) => (total.getCell(k + 2).value = s / 100));
  total.font = { bold: true };
  ws.getColumn(1).width = 52;
  def.valeurs.forEach((_, k) => {
    ws.getColumn(k + 2).width = 18;
    ws.getColumn(k + 2).numFmt = FORMAT_MONTANT;
  });
  ws.views = [{ state: 'frozen', ySplit: LIGNE_TCD }];
}

/**
 * Ajoute un TCD au classeur : crée l'onglet cible (à l'endroit de l'appel dans l'ordre des onglets) et
 * l'onglet source, et déclare le TCD pour l'écriture du fichier (octetsClasseur).
 */
export function ajouterTcd(wb: Workbook, def: DefinitionTcd): void {
  const cible = wb.addWorksheet(def.feuilleCible);
  if (def.lignes.length === 0) {
    cible.getCell('A1').value = def.titre[0] ?? def.nom;
    cible.getCell('A2').value = 'Aucune donnée : tableau croisé dynamique non créé.';
    return;
  }
  feuilleCible(cible, def, calculer(def));
  feuilleSource(wb, def);
  declares.set(wb, [...(declares.get(wb) ?? []), def]);
}

export function tcdDeclares(wb: Workbook): DefinitionTcd[] {
  return declares.get(wb) ?? [];
}

// ---- Parties OOXML ---------------------------------------------------------------------------------

function definitionCache(def: DefinitionTcd, c: Calcul, ns: { main: string; r: string }): string {
  const champs = def.champs
    .map((ch, k) => {
      if (ch.type === 'texte') {
        const e = c.elements[k]!;
        return `<cacheField name="${xml(ch.nom)}" numFmtId="0"><sharedItems count="${e.length}">${e.map((v) => `<s v="${xml(v)}"/>`).join('')}</sharedItems></cacheField>`;
      }
      const valeurs = def.lignes.map((l) => Number(l[k]) / 100);
      const entiers = valeurs.every((v) => Number.isInteger(v));
      return `<cacheField name="${xml(ch.nom)}" numFmtId="0"><sharedItems containsSemiMixedTypes="0" containsString="0" containsNumber="1"${entiers ? ' containsInteger="1"' : ''} minValue="${Math.min(...valeurs)}" maxValue="${Math.max(...valeurs)}"/></cacheField>`;
    })
    .join('');
  const ref = `A1:${lettreColonne(def.champs.length)}${def.lignes.length + 1}`;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<pivotCacheDefinition xmlns="${ns.main}" xmlns:r="${ns.r}" saveData="0" refreshOnLoad="1" createdVersion="6" refreshedVersion="6" minRefreshableVersion="3" recordCount="${def.lignes.length}">` +
    `<cacheSource type="worksheet"><worksheetSource ref="${ref}" sheet="${xml(def.feuilleSource)}"/></cacheSource>` +
    `<cacheFields count="${def.champs.length}">${champs}</cacheFields></pivotCacheDefinition>`
  );
}

function tableau(def: DefinitionTcd, c: Calcul, cacheId: number, ns: { main: string }): string {
  const nbValeurs = def.valeurs.length;
  const champs = def.champs
    .map((_, k) => {
      if (def.axes.includes(k)) {
        const e = c.elements[k]!;
        return `<pivotField axis="axisRow" showAll="0"><items count="${e.length + 1}">${e.map((_, i) => `<item x="${i}"/>`).join('')}<item t="default"/></items></pivotField>`;
      }
      return def.valeurs.includes(k) ? '<pivotField dataField="1" showAll="0"/>' : '<pivotField showAll="0"/>';
    })
    .join('');
  const x = (v: number) => (v === 0 ? '<x/>' : `<x v="${v}"/>`);
  const lignes = c.rendu.map(({ profondeur, noeud }) => `<i${profondeur ? ` r="${profondeur}"` : ''}>${x(noeud.item)}</i>`);
  lignes.push('<i t="grand"><x/></i>');
  const colonnes =
    nbValeurs > 1
      ? `<colFields count="1"><field x="-2"/></colFields><colItems count="${nbValeurs}">${def.valeurs.map((_, k) => (k === 0 ? '<i><x/></i>' : `<i i="${k}">${x(k)}</i>`)).join('')}</colItems>`
      : '<colItems count="1"><i/></colItems>';
  const ref = `A${LIGNE_TCD}:${lettreColonne(1 + nbValeurs)}${LIGNE_TCD + c.rendu.length + 1}`;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<pivotTableDefinition xmlns="${ns.main}" name="${xml(def.nom)}" cacheId="${cacheId}" applyNumberFormats="0" applyBorderFormats="0" applyFontFormats="0" applyPatternFormats="0" applyAlignmentFormats="0" applyWidthHeightFormats="1" dataCaption="Valeurs" updatedVersion="6" minRefreshableVersion="3" useAutoFormatting="1" itemPrintTitles="1" createdVersion="6" indent="0" outline="1" outlineData="1" multipleFieldFilters="0" rowHeaderCaption="Étiquettes de lignes">` +
    `<location ref="${ref}" firstHeaderRow="${nbValeurs > 1 ? 0 : 1}" firstDataRow="1" firstDataCol="1"/>` +
    `<pivotFields count="${def.champs.length}">${champs}</pivotFields>` +
    `<rowFields count="${def.axes.length}">${def.axes.map((a) => `<field x="${a}"/>`).join('')}</rowFields>` +
    `<rowItems count="${lignes.length}">${lignes.join('')}</rowItems>` +
    colonnes +
    `<dataFields count="${nbValeurs}">${def.valeurs.map((v) => `<dataField name="${xml(nomValeur(def, v))}" fld="${v}" baseField="0" baseItem="0" numFmtId="${NUM_FMT_MONTANT}"/>`).join('')}</dataFields>` +
    `<pivotTableStyleInfo name="PivotStyleLight16" showRowHeaders="1" showColHeaders="1" showRowStripes="0" showColStripes="0" showLastColumn="1"/>` +
    `</pivotTableDefinition>`
  );
}

const attribut = (balise: string, nom: string) => new RegExp(`\\s${nom}="([^"]*)"`).exec(balise)?.[1];
const dexml = (v: string) => v.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Ajoute les TCD déclarés au fichier .xlsx produit par ExcelJS. */
export async function integrerTcd(zip: JSZip, definitions: DefinitionTcd[]): Promise<void> {
  if (definitions.length === 0) return;
  const lire = async (chemin: string) => {
    const f = zip.file(chemin);
    if (!f) throw new Error(`Partie absente du classeur : ${chemin}`);
    return f.async('string');
  };
  let classeur = await lire('xl/workbook.xml');
  let relsClasseur = await lire('xl/_rels/workbook.xml.rels');
  let types = await lire('[Content_Types].xml');
  const racine = /<workbook\b[^>]*>/.exec(classeur)![0];
  const ns = { main: attribut(racine, 'xmlns')!, r: attribut(racine, 'xmlns:r')! };
  const relsRacine = /<Relationships\b[^>]*>/.exec(relsClasseur)![0];
  const nsRelations = attribut(relsRacine, 'xmlns')!;
  const typeFeuille = /Type="([^"]*\/worksheet)"/.exec(relsClasseur)![1]!;
  const typeRelation = (nom: string) => typeFeuille.replace(/worksheet$/, nom);

  const feuilles = new Map<string, string>();
  for (const m of classeur.matchAll(/<sheet\b[^>]*\/>/g)) feuilles.set(dexml(attribut(m[0], 'name')!), attribut(m[0], 'r:id')!);
  const cibles = new Map<string, string>();
  for (const m of relsClasseur.matchAll(/<Relationship\b[^>]*\/>/g)) cibles.set(attribut(m[0], 'Id')!, attribut(m[0], 'Target')!);

  const caches: string[] = [];
  for (const [k, def] of definitions.entries()) {
    const n = k + 1;
    const cacheId = n;
    const c = calculer(def);
    const idFeuille = feuilles.get(def.feuilleCible);
    if (!idFeuille) throw new Error(`Onglet du TCD introuvable : ${def.feuilleCible}`);
    const cheminFeuille = `xl/${cibles.get(idFeuille)!.replace(/^\/?xl\//, '')}`;
    const nomFichierFeuille = cheminFeuille.split('/').pop()!;

    zip.file(`xl/pivotCache/pivotCacheDefinition${n}.xml`, definitionCache(def, c, ns));
    zip.file(`xl/pivotTables/pivotTable${n}.xml`, tableau(def, c, cacheId, ns));
    zip.file(
      `xl/pivotTables/_rels/pivotTable${n}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${nsRelations}"><Relationship Id="rId1" Type="${typeRelation('pivotCacheDefinition')}" Target="../pivotCache/pivotCacheDefinition${n}.xml"/></Relationships>`,
    );
    const cheminRelsFeuille = cheminFeuille.replace(nomFichierFeuille, `_rels/${nomFichierFeuille}.rels`);
    const relation = `<Relationship Id="rIdTcd${n}" Type="${typeRelation('pivotTable')}" Target="../pivotTables/pivotTable${n}.xml"/>`;
    const existant = zip.file(cheminRelsFeuille);
    zip.file(
      cheminRelsFeuille,
      existant
        ? (await existant.async('string')).replace('</Relationships>', `${relation}</Relationships>`)
        : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${nsRelations}">${relation}</Relationships>`,
    );
    relsClasseur = relsClasseur.replace('</Relationships>', `<Relationship Id="rIdCacheTcd${n}" Type="${typeRelation('pivotCacheDefinition')}" Target="pivotCache/pivotCacheDefinition${n}.xml"/></Relationships>`);
    caches.push(`<pivotCache cacheId="${cacheId}" r:id="rIdCacheTcd${n}"/>`);
    types = types.replace(
      '</Types>',
      `<Override PartName="/xl/pivotTables/pivotTable${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml"/>` +
        `<Override PartName="/xl/pivotCache/pivotCacheDefinition${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml"/></Types>`,
    );
  }
  // Ordre du schéma : … definedNames, calcPr, oleSize, customWorkbookViews, pivotCaches, … extLst.
  const bloc = `<pivotCaches>${caches.join('')}</pivotCaches>`;
  const apres = /<(?:smartTagPr|smartTagTypes|webPublishing|fileRecoveryPr|webPublishObjects|extLst)\b/.exec(classeur);
  classeur = apres ? classeur.slice(0, apres.index) + bloc + classeur.slice(apres.index) : classeur.replace('</workbook>', `${bloc}</workbook>`);
  zip.file('xl/workbook.xml', classeur);
  zip.file('xl/_rels/workbook.xml.rels', relsClasseur);
  zip.file('[Content_Types].xml', types);
}
