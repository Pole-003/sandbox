/**
 * Marques « lu » et « important pour nos dossiers », mémorisées dans le navigateur (IndexedDB,
 * CLAUDE.md règle n° 5). Rien n'est envoyé : ces marques restent sur le poste.
 *
 * Base « <préfixe>veille », version 1 : magasin « marques » { id, lu, important, modifie_le }.
 * Toute évolution de structure passera par une nouvelle version avec conversion de l'ancien format.
 */
import { cleStockage } from '../../core/stockage.ts';
import type { Marque } from './logique.ts';

export interface MagasinMarques {
  toutes(): Promise<Map<string, Marque>>;
  enregistrer(id: string, marque: Marque): Promise<void>;
  /** Faux si IndexedDB est indisponible (navigation privée stricte, stratégie d'entreprise) : marques non conservées. */
  readonly persistant: boolean;
}

export const NOM_BASE = cleStockage('veille');
export const VERSION_BASE = 1;
const MAGASIN = 'marques';

interface Enregistrement extends Marque {
  id: string;
  modifie_le: string;
}

/** Migrations versionnées : l'indice i fait passer de la version i à i + 1. */
const MIGRATIONS: ((base: IDBDatabase) => void)[] = [
  (base) => {
    base.createObjectStore(MAGASIN, { keyPath: 'id' });
  },
];

function ouvrir(fabrique: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resoudre, rejeter) => {
    const requete = fabrique.open(NOM_BASE, VERSION_BASE);
    requete.onupgradeneeded = (e) => {
      for (let v = e.oldVersion; v < VERSION_BASE; v++) MIGRATIONS[v]?.(requete.result);
    };
    requete.onsuccess = () => resoudre(requete.result);
    requete.onerror = () => rejeter(requete.error);
    requete.onblocked = () => rejeter(new Error('base locale bloquée par un autre onglet'));
  });
}

function attendre<T>(requete: IDBRequest<T>): Promise<T> {
  return new Promise((resoudre, rejeter) => {
    requete.onsuccess = () => resoudre(requete.result);
    requete.onerror = () => rejeter(requete.error);
  });
}

export function magasinMemoire(): MagasinMarques {
  const marques = new Map<string, Marque>();
  return {
    persistant: false,
    toutes: async () => new Map(marques),
    enregistrer: async (id, marque) => void marques.set(id, marque),
  };
}

export async function ouvrirMagasin(fabrique: IDBFactory | undefined = globalThis.indexedDB): Promise<MagasinMarques> {
  if (!fabrique) return magasinMemoire();
  let base: IDBDatabase;
  try {
    base = await ouvrir(fabrique);
  } catch {
    return magasinMemoire();
  }
  return {
    persistant: true,
    async toutes() {
      const liste = await attendre(base.transaction(MAGASIN, 'readonly').objectStore(MAGASIN).getAll() as IDBRequest<Enregistrement[]>);
      return new Map(liste.map((e) => [e.id, { lu: e.lu, important: e.important }]));
    },
    async enregistrer(id, marque) {
      const magasin = base.transaction(MAGASIN, 'readwrite').objectStore(MAGASIN);
      // Une marque entièrement décochée est supprimée : la base ne garde que l'utile.
      if (!marque.lu && !marque.important) await attendre(magasin.delete(id));
      else await attendre(magasin.put({ id, ...marque, modifie_le: new Date().toISOString() } satisfies Enregistrement));
    },
  };
}
