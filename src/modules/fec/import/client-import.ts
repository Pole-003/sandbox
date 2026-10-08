/** Lancement d'un import dans le Web Worker (lecture, contrôles, enregistrement local), avec progression et annulation. */
import type { Role } from '../stockage/base-fec.ts';
import type { MessageDuWorker, MessageVersWorker, OptionsWorker, ResultatWorker } from './import.worker.ts';

export interface ImportEnCours {
  resultat: Promise<ResultatWorker>;
  annuler(): void;
}

export function lancerImport(
  fichier: File,
  destination: { dossierId: string; role: Role },
  options: OptionsWorker,
  surProgression: (octets: number, total: number, lignes: number, etape: 'lecture' | 'enregistrement') => void,
): ImportEnCours {
  const worker = new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module', name: 'import-fec' });
  const resultat = new Promise<ResultatWorker>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<MessageDuWorker>) => {
      const m = e.data;
      if (m.type === 'progression') surProgression(m.octets, m.total, m.lignes, m.etape);
      else {
        worker.terminate();
        if (m.type === 'resultat') resolve(m.resultat);
        else reject(new Error(m.message));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'Erreur du traitement en arrière-plan'));
    };
  });
  worker.postMessage({ type: 'importer', fichier, ...destination, options } satisfies MessageVersWorker);
  return {
    resultat,
    annuler() {
      worker.postMessage({ type: 'annuler' } satisfies MessageVersWorker);
    },
  };
}
