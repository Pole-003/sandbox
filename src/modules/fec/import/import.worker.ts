/**
 * Web Worker d'import : lit le fichier en flux (File.stream()), exécute la chaîne d'import puis enregistre
 * le FEC normalisé dans IndexedDB, sans repasser par le fil principal : l'interface ne fige ni pendant la
 * lecture ni pendant l'enregistrement. Aucun accès réseau : le Worker ne reçoit que le fichier choisi.
 */
import { enregistrerImport, type ImportEnregistre, type Role } from '../stockage/base-fec.ts';
import { importerFec, type CorrespondanceRequise, type OptionsImport } from './pipeline.ts';

export type OptionsWorker = Omit<OptionsImport, 'annulation' | 'progression' | 'nomFichier' | 'taille'>;

export type MessageVersWorker =
  | { type: 'importer'; fichier: File; dossierId: string; role: Role; options: OptionsWorker }
  | { type: 'annuler' };

export type ResultatWorker = { statut: 'termine'; imp: ImportEnregistre } | CorrespondanceRequise | { statut: 'annule' };

export type MessageDuWorker =
  | { type: 'progression'; octets: number; total: number; lignes: number; etape: 'lecture' | 'enregistrement' }
  | { type: 'resultat'; resultat: ResultatWorker }
  | { type: 'erreur'; message: string };

const portee = self as unknown as {
  postMessage(message: MessageDuWorker): void;
  onmessage: ((e: MessageEvent<MessageVersWorker>) => void) | null;
};

const annulation = { annule: false };

async function* lire(fichier: Blob): AsyncGenerator<Uint8Array> {
  const lecteur = fichier.stream().getReader();
  try {
    for (;;) {
      const { done, value } = await lecteur.read();
      if (done) return;
      yield value;
    }
  } finally {
    lecteur.releaseLock();
  }
}

portee.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'annuler') {
    annulation.annule = true;
    return;
  }
  annulation.annule = false;
  let dernier = 0;
  try {
    const resultat = await importerFec(() => lire(m.fichier), {
      ...m.options,
      nomFichier: m.fichier.name,
      taille: m.fichier.size,
      annulation,
      progression: (octets, lignes) => {
        const t = performance.now();
        if (t - dernier < 100) return;
        dernier = t;
        portee.postMessage({ type: 'progression', octets, total: m.fichier.size, lignes, etape: 'lecture' });
      },
    });
    if (resultat.statut !== 'termine') {
      portee.postMessage({ type: 'resultat', resultat });
      return;
    }
    portee.postMessage({ type: 'progression', octets: m.fichier.size, total: m.fichier.size, lignes: resultat.fec.meta.nbLignes, etape: 'enregistrement' });
    const imp = await enregistrerImport(m.dossierId, m.role, resultat.fec);
    portee.postMessage({ type: 'resultat', resultat: { statut: 'termine', imp } });
  } catch (erreur) {
    portee.postMessage({ type: 'erreur', message: erreur instanceof Error ? erreur.message : String(erreur) });
  }
};
