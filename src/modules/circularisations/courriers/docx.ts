/**
 * Rendu des lettres en .docx (librairie docx, chargée à la demande) et export en lot : une archive .zip
 * avec un fichier par tiers, ou un document unique (une section par lettre) pour l'impression.
 * Tout est produit sur le poste, sans appel réseau.
 */
import type { Paragraph as ParagraphDocx } from 'docx';
import type { Bloc, Lettre } from './lettres.ts';

export type DocxModule = typeof import('docx');

export const TYPE_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const TYPE_ZIP = 'application/zip';

export function chargerDocx(): Promise<DocxModule> {
  return import('docx');
}

const mm = (x: number) => Math.round((x * 1440) / 25.4);
const CASE = '☐';

function paragraphes(D: DocxModule, l: Lettre): ParagraphDocx[] {
  const { Paragraph, TextRun, AlignmentType } = D;
  const vide = () => new Paragraph({});
  const retrait = { left: mm(95) };
  const bloc = (b: Bloc, apres = 120, apresPuce = false): ParagraphDocx => {
    switch (b.type) {
      case 'puce':
        return new Paragraph({ text: b.texte, bullet: { level: 0 }, alignment: AlignmentType.JUSTIFIED, spacing: { after: 60 } });
      case 'case':
        return new Paragraph({ children: [new TextRun({ text: `${CASE}  ` }), new TextRun(b.texte)], spacing: { after: apres }, indent: { left: mm(7), hanging: mm(7) } });
      case 'saisie':
        return new Paragraph({
          children: [new TextRun(`${b.texte} `), new TextRun({ children: [new D.Tab()] })],
          tabStops: [{ type: D.TabStopType.RIGHT, position: mm(170), leader: D.LeaderType.UNDERSCORE }],
          spacing: { after: apres + 120 },
        });
      default:
        return new Paragraph({ text: b.texte, alignment: AlignmentType.JUSTIFIED, spacing: { before: apresPuce ? 120 : 0, after: apres } });
    }
  };

  const lettre: ParagraphDocx[] = [
    new Paragraph({ children: [new TextRun({ text: l.societe, bold: true, size: 24 })] }),
    ...l.enTete.map((t) => new Paragraph({ text: t })),
    vide(),
    vide(),
    // Bloc destinataire : nom du tiers, adresse laissée vide (à compléter dans Word).
    new Paragraph({ children: [new TextRun({ text: l.destinataire, bold: true })], indent: retrait }),
    ...Array.from({ length: 4 }, () => new Paragraph({ indent: retrait })),
    vide(),
    new Paragraph({ text: l.lieuDate, indent: retrait, spacing: { after: 240 } }),
    new Paragraph({ children: [new TextRun({ text: 'Réf. : ', bold: true }), new TextRun(`${l.ref}${l.codeTiers ? ` (code tiers ${l.codeTiers})` : ''}`)] }),
    new Paragraph({ children: [new TextRun({ text: 'Objet : ', bold: true }), new TextRun({ text: l.objet, bold: true })], spacing: { after: 360 } }),
    ...l.corps.map((b, i) => bloc(b, 120, l.corps[i - 1]?.type === 'puce')),
    vide(),
    ...l.signature.map((t, i) => new Paragraph({ text: t, indent: retrait, spacing: { after: i === l.signature.length - 1 ? 0 : 60 } })),
  ];
  if (l.coupon) {
    lettre.push(
      new Paragraph({ children: [new TextRun({ text: l.coupon.titre.toUpperCase(), bold: true, size: 26 })], alignment: AlignmentType.CENTER, pageBreakBefore: true, spacing: { after: 240 } }),
      new Paragraph({ children: [new TextRun({ text: l.coupon.consigne, italics: true })], alignment: AlignmentType.JUSTIFIED, spacing: { after: 360 } }),
      new Paragraph({ children: [new TextRun({ text: `Tiers : ${l.destinataire}${l.codeTiers ? ` (code ${l.codeTiers})` : ''}`, bold: true })], spacing: { after: 240 } }),
      ...l.coupon.blocs.map((b) => bloc(b, 160)),
    );
  }
  return lettre;
}

function section(D: DocxModule, l: Lettre) {
  return {
    properties: { page: { size: { width: mm(210), height: mm(297) }, margin: { top: mm(20), bottom: mm(20), left: mm(20), right: mm(20) } } },
    footers: {
      default: new D.Footer({ children: [new D.Paragraph({ children: [new D.TextRun({ text: `Réf. ${l.ref}`, size: 16, color: '666666' })], alignment: D.AlignmentType.RIGHT })] }),
    },
    children: paragraphes(D, l),
  };
}

/** Un document .docx : une lettre, ou plusieurs (une section par lettre, chacune sur une nouvelle page). */
export async function docxLettres(D: DocxModule, lettres: Lettre[], titre: string): Promise<Uint8Array> {
  const doc = new D.Document({
    creator: 'Sandbox Pôle 003',
    title: titre,
    styles: { default: { document: { run: { font: 'Arial', size: 21 }, paragraph: { spacing: { line: 264 } } } } },
    sections: lettres.map((l) => section(D, l)),
  });
  return new Uint8Array(await D.Packer.toArrayBuffer(doc));
}

/** Archive .zip : un .docx par lettre, nommé « CL-001 - Nom du tiers.docx » (noms rendus uniques). */
export async function archiveLettres(D: DocxModule, lettres: Lettre[]): Promise<Uint8Array> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const vus = new Set<string>();
  for (const l of lettres) {
    let nom = l.nomFichier;
    for (let k = 2; vus.has(nom.toLowerCase()); k++) nom = l.nomFichier.replace(/\.docx$/, ` (${k}).docx`);
    vus.add(nom.toLowerCase());
    // Un .docx est déjà compressé : stockage sans recompression ; date fixe pour une archive reproductible.
    zip.file(nom, await docxLettres(D, [l], `${l.ref} — ${l.destinataire}`), { compression: 'STORE', date: new Date(Date.UTC(2000, 0, 1)) });
  }
  return zip.generateAsync({ type: 'uint8array' });
}
