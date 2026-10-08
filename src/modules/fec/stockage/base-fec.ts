/**
 * Stockage local des dossiers FEC dans IndexedDB (CLAUDE.md, règle n° 5) : rien ne quitte le poste.
 *
 * Base « pole003-sandbox-fec » (« pole003-sandbox-beta-fec » en bêta), magasins :
 *  - dossiers : { id, nom, siren, creeLe, modifieLe, fec: { N?, 'N-1'? } } (identifiants d'import) ;
 *  - imports  : métadonnées, constats et réglages d'un FEC importé (index dossierId) ;
 *  - colonnes : FEC normalisé en colonnes typées (séparé pour ne pas le charger en listant les dossiers) ;
 *  - profils  : correspondances de colonnes mémorisées, par signature d'en-tête ;
 *  - circularisations : paramètres et décisions de sélection des circularisations, par dossier (v2) ;
 *  - courriers : en-tête, signataire et dates des lettres de circularisation, par dossier (v3) ;
 *  - modeles-courriers : modèles de lettres et coordonnées du cabinet, communs au poste (v3) ;
 *  - tva : déclarations CA3 (valeurs lues, corrections tracées, empreintes des PDF) et cadrage, par dossier (v4).
 *
 * Toute évolution de structure incrémente VERSION_BASE et ajoute une migration dans MIGRATIONS,
 * qui convertit l'ancien format (CLAUDE.md, conventions).
 */
import { cleStockage } from '../../../core/stockage.ts';
import type { Constat } from '../conformite/constats.ts';
import type { FecColonnes } from '../donnees/colonnes.ts';
import type { Correspondance } from '../import/colonnes-entete.ts';
import type { MetaImport } from '../import/pipeline.ts';
import type { Regime } from '../zones.ts';

export const NOM_BASE = cleStockage('fec');
export const VERSION_BASE = 4;

export type Role = 'N' | 'N-1';

export interface Dossier {
  id: string;
  nom: string;
  siren: string | null;
  creeLe: string;
  modifieLe: string;
  fec: Partial<Record<Role, string>>;
}

/** Réglages confirmés ou modifiés par l'utilisateur après l'import. */
export interface Reglages {
  siren: string | null;
  cloture: string | null;
  debut: string | null;
  fin: string | null;
  journalAN: string | null;
  journalANConfirme: boolean;
  /** L'utilisateur a pris connaissance des non-conformités et choisi de continuer. */
  nonConformitesAcceptees: boolean;
}

export interface ImportEnregistre {
  id: string;
  dossierId: string;
  role: Role;
  importeLe: string;
  meta: MetaImport;
  constatsLecture: Constat[];
  constatsEcritures: Constat[];
  reglages: Reglages;
}

export interface ProfilImport {
  signature: string;
  nom: string;
  correspondance: Correspondance;
  regime: Regime | null;
  sansEntete: boolean;
  creeLe: string;
  utiliseLe: string;
}

const MIGRATIONS: Record<number, (db: IDBDatabase) => void> = {
  1: (db) => {
    db.createObjectStore('dossiers', { keyPath: 'id' });
    db.createObjectStore('imports', { keyPath: 'id' }).createIndex('dossierId', 'dossierId');
    db.createObjectStore('colonnes', { keyPath: 'id' });
    db.createObjectStore('profils', { keyPath: 'signature' });
  },
  // Version 2 (étape 7) : paramètres et décisions de circularisation, un enregistrement par dossier.
  // Aucune donnée existante à convertir : les dossiers et FEC de la version 1 sont conservés tels quels.
  2: (db) => {
    db.createObjectStore('circularisations', { keyPath: 'dossierId' });
  },
  // Version 3 (étape 8) : courriers de circularisation. Modèles et coordonnées du cabinet communs au poste
  // (« modeles-courriers », un enregistrement « poste »), en-tête et signataire du client par dossier
  // (« courriers »). Aucune donnée existante à convertir.
  3: (db) => {
    db.createObjectStore('courriers', { keyPath: 'dossierId' });
    db.createObjectStore('modeles-courriers', { keyPath: 'id' });
  },
  // Version 4 (cadrage de TVA) : déclarations CA3 lues ou saisies et paramètres du cadrage, par dossier.
  // Aucune donnée existante à convertir.
  4: (db) => {
    db.createObjectStore('tva', { keyPath: 'dossierId' });
  },
};

function requete<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function fin(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction annulée'));
  });
}

let base: Promise<IDBDatabase> | null = null;

export function ouvrirBase(): Promise<IDBDatabase> {
  base ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(NOM_BASE, VERSION_BASE);
    r.onupgradeneeded = (e) => {
      for (let v = e.oldVersion + 1; v <= VERSION_BASE; v++) MIGRATIONS[v]!(r.result);
    };
    r.onsuccess = () => {
      r.result.onversionchange = () => {
        r.result.close();
        base = null;
      };
      resolve(r.result);
    };
    r.onerror = () => {
      base = null;
      reject(r.error ?? new Error('IndexedDB indisponible'));
    };
    r.onblocked = () => reject(new Error('Base de données bloquée par un autre onglet : fermez les autres onglets de la sandbox.'));
  });
  return base;
}

const maintenant = () => new Date().toISOString();
const identifiant = () => crypto.randomUUID();

export async function listerDossiers(): Promise<Dossier[]> {
  const db = await ouvrirBase();
  const dossiers = await requete(db.transaction('dossiers').objectStore('dossiers').getAll() as IDBRequest<Dossier[]>);
  return dossiers.sort((a, b) => b.modifieLe.localeCompare(a.modifieLe));
}

export async function creerDossier(nom: string, siren: string | null = null): Promise<Dossier> {
  const db = await ouvrirBase();
  const d: Dossier = { id: identifiant(), nom, siren, creeLe: maintenant(), modifieLe: maintenant(), fec: {} };
  const tx = db.transaction('dossiers', 'readwrite');
  tx.objectStore('dossiers').put(d);
  await fin(tx);
  return d;
}

export async function modifierDossier(id: string, changements: Partial<Pick<Dossier, 'nom' | 'siren'>>): Promise<Dossier> {
  const db = await ouvrirBase();
  const tx = db.transaction('dossiers', 'readwrite');
  const magasin = tx.objectStore('dossiers');
  const d = (await requete(magasin.get(id) as IDBRequest<Dossier | undefined>)) ?? null;
  if (!d) throw new Error('Dossier introuvable');
  const nouveau = { ...d, ...changements, modifieLe: maintenant() };
  magasin.put(nouveau);
  await fin(tx);
  return nouveau;
}

export async function lireDossier(id: string): Promise<Dossier | null> {
  const db = await ouvrirBase();
  return (await requete(db.transaction('dossiers').objectStore('dossiers').get(id) as IDBRequest<Dossier | undefined>)) ?? null;
}

export function reglagesInitiaux(meta: MetaImport): Reglages {
  return {
    siren: meta.siren,
    cloture: meta.cloture,
    debut: meta.exercice?.debut ?? null,
    fin: meta.exercice?.fin ?? null,
    journalAN: meta.journalAN?.code ?? null,
    journalANConfirme: false,
    nonConformitesAcceptees: false,
  };
}

/** Enregistre un FEC importé dans un dossier (remplace le FEC précédent du même rôle). */
export async function enregistrerImport(
  dossierId: string,
  role: Role,
  donnees: { meta: MetaImport; colonnes: FecColonnes; constatsLecture: Constat[]; constatsEcritures: Constat[] },
): Promise<ImportEnregistre> {
  const db = await ouvrirBase();
  const tx = db.transaction(['dossiers', 'imports', 'colonnes'], 'readwrite');
  const dossiers = tx.objectStore('dossiers');
  const d = await requete(dossiers.get(dossierId) as IDBRequest<Dossier | undefined>);
  if (!d) throw new Error('Dossier introuvable');
  const ancien = d.fec[role];
  if (ancien) {
    tx.objectStore('imports').delete(ancien);
    tx.objectStore('colonnes').delete(ancien);
  }
  const imp: ImportEnregistre = {
    id: identifiant(),
    dossierId,
    role,
    importeLe: maintenant(),
    meta: donnees.meta,
    constatsLecture: donnees.constatsLecture,
    constatsEcritures: donnees.constatsEcritures,
    reglages: reglagesInitiaux(donnees.meta),
  };
  tx.objectStore('imports').put(imp);
  tx.objectStore('colonnes').put({ id: imp.id, ...serialiserColonnes(donnees.colonnes) });
  dossiers.put({ ...d, siren: d.siren ?? donnees.meta.siren, fec: { ...d.fec, [role]: imp.id }, modifieLe: maintenant() });
  await fin(tx);
  return imp;
}

export async function lireImport(id: string): Promise<ImportEnregistre | null> {
  const db = await ouvrirBase();
  return (await requete(db.transaction('imports').objectStore('imports').get(id) as IDBRequest<ImportEnregistre | undefined>)) ?? null;
}

/**
 * Format stocké : les textes du dictionnaire sont concaténés en une seule chaîne avec leurs bornes
 * (Uint32Array). Sérialiser une chaîne et un tableau typé est bien plus rapide que des millions de
 * petites chaînes (le navigateur ne fige pas à l'enregistrement d'un FEC de plusieurs millions de lignes).
 */
type ColonnesStockees = Omit<FecColonnes, 'textes'> & { textesConcatenes: string; bornesTextes: Uint32Array };

export function serialiserColonnes(f: FecColonnes): ColonnesStockees {
  const bornes = new Uint32Array(f.textes.length);
  let position = 0;
  f.textes.forEach((t, i) => {
    position += t.length;
    bornes[i] = position;
  });
  const { textes, ...reste } = f;
  return { ...reste, textesConcatenes: textes.join(''), bornesTextes: bornes };
}

export function deserialiserColonnes(s: ColonnesStockees): FecColonnes {
  const { textesConcatenes, bornesTextes, ...reste } = s;
  const textes = new Array<string>(bornesTextes.length);
  let debut = 0;
  for (let i = 0; i < bornesTextes.length; i++) {
    textes[i] = textesConcatenes.slice(debut, bornesTextes[i]);
    debut = bornesTextes[i]!;
  }
  return { ...reste, textes } as FecColonnes;
}

export async function lireColonnes(id: string): Promise<FecColonnes | null> {
  const db = await ouvrirBase();
  const r = await requete(db.transaction('colonnes').objectStore('colonnes').get(id) as IDBRequest<(ColonnesStockees & { id: string }) | undefined>);
  if (!r) return null;
  const { id: _id, ...stockees } = r;
  void _id;
  return deserialiserColonnes(stockees);
}

export async function mettreAJourImport(id: string, changements: { reglages?: Reglages; constatsEcritures?: Constat[] }): Promise<ImportEnregistre> {
  const db = await ouvrirBase();
  const tx = db.transaction('imports', 'readwrite');
  const magasin = tx.objectStore('imports');
  const imp = await requete(magasin.get(id) as IDBRequest<ImportEnregistre | undefined>);
  if (!imp) throw new Error('Import introuvable');
  const nouveau = { ...imp, ...changements };
  magasin.put(nouveau);
  await fin(tx);
  return nouveau;
}

/** « Purger ce dossier » : supprime le dossier, ses FEC et leurs données. */
export async function purgerDossier(id: string): Promise<void> {
  const db = await ouvrirBase();
  const tx = db.transaction(['dossiers', 'imports', 'colonnes', 'circularisations', 'courriers', 'tva'], 'readwrite');
  tx.objectStore('circularisations').delete(id);
  tx.objectStore('courriers').delete(id);
  tx.objectStore('tva').delete(id);
  const imports = await requete(tx.objectStore('imports').index('dossierId').getAllKeys(id));
  for (const cle of imports) {
    tx.objectStore('imports').delete(cle);
    tx.objectStore('colonnes').delete(cle);
  }
  tx.objectStore('dossiers').delete(id);
  await fin(tx);
}

/** « Tout purger » : supprime la base entière (dossiers, FEC, profils). */
export async function toutPurger(): Promise<void> {
  if (base) (await base).close();
  base = null;
  await new Promise<void>((resolve, reject) => {
    const r = indexedDB.deleteDatabase(NOM_BASE);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('Suppression bloquée par un autre onglet de la sandbox.'));
  });
}

/** Lecture et écriture d'un enregistrement d'un magasin secondaire (utilisé par le module Circularisations). */
export type MagasinSecondaire = 'circularisations' | 'courriers' | 'modeles-courriers' | 'tva';

export async function lireEnregistrement<T>(magasin: MagasinSecondaire, cle: string): Promise<T | null> {
  const db = await ouvrirBase();
  return ((await requete(db.transaction(magasin).objectStore(magasin).get(cle))) as T | undefined) ?? null;
}

export async function ecrireEnregistrement(magasin: MagasinSecondaire, valeur: unknown): Promise<void> {
  const db = await ouvrirBase();
  const tx = db.transaction(magasin, 'readwrite');
  tx.objectStore(magasin).put(valeur);
  await fin(tx);
}

export async function enregistrerProfil(p: Omit<ProfilImport, 'creeLe' | 'utiliseLe'>): Promise<void> {
  const db = await ouvrirBase();
  const tx = db.transaction('profils', 'readwrite');
  tx.objectStore('profils').put({ ...p, creeLe: maintenant(), utiliseLe: maintenant() });
  await fin(tx);
}

export async function trouverProfil(signature: string): Promise<ProfilImport | null> {
  const db = await ouvrirBase();
  return (await requete(db.transaction('profils').objectStore('profils').get(signature) as IDBRequest<ProfilImport | undefined>)) ?? null;
}

export async function listerProfils(): Promise<ProfilImport[]> {
  const db = await ouvrirBase();
  return requete(db.transaction('profils').objectStore('profils').getAll() as IDBRequest<ProfilImport[]>);
}

export async function supprimerProfil(signature: string): Promise<void> {
  const db = await ouvrirBase();
  const tx = db.transaction('profils', 'readwrite');
  tx.objectStore('profils').delete(signature);
  await fin(tx);
}

/** Usage du stockage du navigateur (pour informer l'utilisateur). */
export async function espaceUtilise(): Promise<{ utilise: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const e = await navigator.storage.estimate();
  return { utilise: e.usage ?? 0, quota: e.quota ?? 0 };
}
