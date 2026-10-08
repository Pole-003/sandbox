/**
 * pdfjs-dist dans le navigateur, chargé à la demande. L'analyse du PDF se fait dans le worker de pdfjs,
 * servi depuis la même origine (fichier intégré au build, CSP worker-src 'self').
 */
import urlWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

type Pdfjs = typeof import('pdfjs-dist');

let module: Promise<Pdfjs> | null = null;

export function chargerPdfjs(): Promise<Pdfjs> {
  module ??= import('pdfjs-dist').then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerPort ??= new Worker(urlWorker, { type: 'module', name: 'pdfjs' });
    return pdfjs;
  });
  return module;
}
