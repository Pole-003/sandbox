/**
 * Texte positionné d'un PDF avec pdfjs-dist (module injecté : version navigateur avec son worker local,
 * ou version « legacy » en test sous Node). Le PDF est fourni en mémoire : aucun chargement réseau,
 * ni police de référence, ni CMap, ni WebAssembly, ni script du document (CSP inchangée).
 */
import type { PageTexte } from './analyse.ts';

type Pdfjs = typeof import('pdfjs-dist');

export async function pagesDuPdf(pdfjs: Pdfjs, octets: Uint8Array): Promise<PageTexte[]> {
  const tache = pdfjs.getDocument({
    // pdfjs transfère le tampon à son worker : on lui passe une copie.
    data: octets.slice(),
    useWasm: false,
    useSystemFonts: false,
    disableFontFace: true,
    enableXfa: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  const doc = await tache.promise;
  try {
    const pages: PageTexte[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const vue = page.getViewport({ scale: 1 });
      const contenu = await page.getTextContent();
      const elements: PageTexte['elements'] = [];
      for (const item of contenu.items) {
        if (!('str' in item) || !item.str) continue;
        // Coordonnées dans la page affichée (rotation comprise), origine en haut à gauche.
        const t = pdfjs.Util.transform(vue.transform, item.transform);
        const hauteur = Math.hypot(t[2], t[3]) || item.height;
        elements.push({ texte: item.str, x: t[4], y: vue.height - t[5], largeur: item.width * vue.scale, hauteur });
      }
      pages.push({ largeur: vue.width, hauteur: vue.height, elements });
      page.cleanup();
    }
    return pages;
  } finally {
    await tache.destroy();
  }
}
