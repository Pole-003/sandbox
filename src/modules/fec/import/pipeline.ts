/**
 * Chaîne d'import d'un FEC, en flux : détection → identification des colonnes → lecture et normalisation
 * → métadonnées → contrôle de conformité. Indépendante du navigateur (testée sous Node) ; le Web Worker
 * n'en est qu'une enveloppe.
 */
import { Sha256 } from '../../../core/sha256.ts';
import { Constats, type Constat } from '../conformite/constats.ts';
import { controlerColonnes, modeNumerotation, type ModeNumerotation } from '../conformite/controles.ts';
import { ConstructeurColonnes, type FecColonnes } from '../donnees/colonnes.ts';
import { deduireExercice, detecterJournalAN, lireNomFichier, type Exercice, type JournalAN } from '../metadonnees.ts';
import { zonesObligatoires, type PresentationMontants, type Regime, type Zone } from '../zones.ts';
import {
  controlerEntete,
  estEntete,
  identifierColonnes,
  proposerCorrespondance,
  signatureEntete,
  type Colonne,
  type Correspondance,
} from './colonnes-entete.ts';
import { Decodeur, detecterEncodage, ErreurEncodage, type Encodage } from './decodage.ts';
import { DecoupeurLignes, decouper, detecterFinLigne, detecterStructure, type FinLigne, type Separateur } from './lecture-plate.ts';
import { normaliserLigne, type ContexteNormalisation } from './normalisation.ts';
import { lireDate } from './valeurs.ts';
import { AssembleurFecXml, LecteurXml } from './xml.ts';

/** Source d'octets relançable (nécessaire si l'encodage détecté se révèle faux en cours de lecture). */
export type Source = () => AsyncIterable<Uint8Array>;

export interface OptionsImport {
  nomFichier: string;
  taille: number;
  encodage?: Encodage;
  regime?: Regime;
  /** Correspondance des colonnes validée dans l'assistant (ou profil d'import mémorisé). */
  correspondance?: Correspondance;
  /** La première ligne est une ligne de données (pas d'en-tête). */
  sansEntete?: boolean;
  reconstruireAuxiliaires?: boolean;
  annulation?: { annule: boolean };
  progression?: (octetsLus: number, lignes: number) => void;
}

export interface MetaImport {
  nomFichier: string;
  taille: number;
  empreinte: string;
  format: 'plat' | 'xml';
  encodage: Encodage;
  bom: boolean;
  finLigne: FinLigne | null;
  separateur: Separateur | null;
  guillemets: boolean;
  regime: Regime;
  presentation: PresentationMontants;
  schemaXml: string | null;
  colonnes: Colonne[];
  signatureEntete: string | null;
  nbLignes: number;
  nbEcritures: number;
  siren: string | null;
  sirenValide: boolean;
  cloture: string | null;
  exercice: Exercice | null;
  journalAN: JournalAN | null;
  modeNumerotation: ModeNumerotation;
  periode: { premiere: string; derniere: string } | null;
  dureeMs: number;
}

export interface FecImporte {
  meta: MetaImport;
  colonnes: FecColonnes;
  /** Constats établis à la lecture (structure, données), indépendants de l'exercice. */
  constatsLecture: Constat[];
  /** Constats sur l'ensemble des écritures (à recalculer si l'exercice ou le journal d'AN change). */
  constatsEcritures: Constat[];
}

export interface CorrespondanceRequise {
  statut: 'correspondance-requise';
  entetes: string[];
  apercu: string[][];
  proposition: Correspondance;
  manquantes: Zone[];
  sansEntete: boolean;
  signatureEntete: string | null;
}

export type ResultatImport = { statut: 'termine'; fec: FecImporte } | CorrespondanceRequise | { statut: 'annule' };

const TAILLE_ECHANTILLON = 1 << 20;

/** Lit le début du fichier (≥ 1 Mo ou tout le fichier) puis rend le reste. */
async function* avecEchantillon(source: AsyncIterable<Uint8Array>, recevoir: (e: Uint8Array) => void) {
  const morceaux: Uint8Array[] = [];
  let taille = 0;
  const it = source[Symbol.asyncIterator]();
  let fini = false;
  while (taille < TAILLE_ECHANTILLON) {
    const r = await it.next();
    if (r.done) {
      fini = true;
      break;
    }
    morceaux.push(r.value);
    taille += r.value.length;
  }
  const echantillon = new Uint8Array(taille);
  let p = 0;
  for (const m of morceaux) {
    echantillon.set(m, p);
    p += m.length;
  }
  recevoir(echantillon);
  yield echantillon;
  if (fini) return;
  for (;;) {
    const r = await it.next();
    if (r.done) return;
    yield r.value;
  }
}

export async function importerFec(source: Source, options: OptionsImport): Promise<ResultatImport> {
  try {
    return await importer(source, options);
  } catch (e) {
    // Fichier détecté UTF-8 mais invalide plus loin : relecture en Windows-1252.
    if (e instanceof ErreurEncodage && !options.encodage) return importer(source, { ...options, encodage: 'windows-1252' });
    throw e;
  }
}

async function importer(source: Source, options: OptionsImport): Promise<ResultatImport> {
  const t0 = performance.now();
  const constats = new Constats();
  const sha = new Sha256();
  let echantillon: Uint8Array = new Uint8Array();
  const flux = avecEchantillon(source(), (e) => (echantillon = e));
  const it = flux[Symbol.asyncIterator]();
  const premier = await it.next();
  const debutFichier = premier.done ? new Uint8Array() : premier.value;

  const detection = detecterEncodage(echantillon);
  const encodage = options.encodage ?? detection.encodage;
  const decodeur = new Decodeur(encodage);
  const nomFichier = lireNomFichier(options.nomFichier);

  // Détection du format sur le début du texte.
  const texteDebut = new Decodeur(encodage).decoder(echantillon, false).replace(/^\ufeff/, '');
  // Capacité initiale estimée d'après la longueur moyenne des lignes de l'échantillon (+10 %).
  const lignesEchantillon = Math.max(1, (texteDebut.match(/\n|\r(?!\n)/g) ?? []).length);
  const octetsParLigne = Math.max(40, echantillon.length / lignesEchantillon);
  const constructeur = new ConstructeurColonnes(Math.max(1024, Math.ceil((options.taille / octetsParLigne) * 1.1)));
  const xml = /^\s*<\?xml|^\s*<comptabilite[\s>]/.test(texteDebut);
  let octetsLus = 0;
  let lignesLues = 0;
  const annule = () => options.annulation?.annule === true;

  const morceaux = async function* (): AsyncGenerator<string> {
    let bloc: Uint8Array | undefined = debutFichier;
    while (bloc) {
      if (annule()) return;
      sha.ajouter(bloc);
      octetsLus += bloc.length;
      const texte = decodeur.decoder(bloc, false);
      yield texte;
      options.progression?.(octetsLus, lignesLues);
      const r = await it.next();
      bloc = r.done ? undefined : r.value;
    }
    yield decodeur.decoder(new Uint8Array(), true);
  };

  let regime: Regime = options.regime ?? 'bic';
  let presentation: PresentationMontants = 'debit-credit';
  let colonnes: Colonne[] = [];
  let signature: string | null = null;
  let separateur: Separateur | null = null;
  let guillemets = false;
  let finLigne: FinLigne | null = null;
  let schemaXml: string | null = null;
  let clotureXml: string | null = null;

  const normaliser = (ctx: ContexteNormalisation, valeurs: (z: Zone) => string | undefined, ligne: number) => {
    constructeur.ajouter(normaliserLigne(valeurs, ligne, ctx));
    lignesLues++;
  };

  if (xml) {
    let ctx: ContexteNormalisation | null = null;
    const emettre = (l: { rang: number; valeurs: Partial<Record<Zone, string>> }) => {
      if (!ctx) {
        regime = options.regime ?? reel.entete.regime ?? (l.valeurs.IdClient !== undefined ? 'bnc-tresorerie' : l.valeurs.DateRglt !== undefined ? 'ba-tresorerie' : 'bic');
        ctx = { regime, xml: true, obligatoires: zonesObligatoires(regime, 'debit-credit'), reconstruireAuxiliaires: options.reconstruireAuxiliaires ?? true, constats };
      }
      if (l.valeurs.Montant !== undefined) presentation = 'montant-sens';
      normaliser(ctx, (z) => l.valeurs[z], l.rang);
    };
    const reel = new AssembleurFecXml(emettre, constats);
    const lecteur = new LecteurXml(reel);
    for await (const texte of morceaux()) lecteur.pousser(texte);
    lecteur.pousser('', true);
    if (annule()) return { statut: 'annule' };
    if (reel.racineInconnue) constats.global('S16', `racine <${reel.racineInconnue}> au lieu de <comptabilite>`);
    schemaXml = reel.entete.schema;
    if (!schemaXml) constats.global('S16', 'schéma XSD non déclaré (xsi:noNamespaceSchemaLocation)');
    const dc = reel.entete.dateCloture ? lireDate(reel.entete.dateCloture, true).valeur : 0;
    if (dc > 0) clotureXml = `${String(dc).slice(0, 4)}-${String(dc).slice(4, 6)}-${String(dc).slice(6)}`;
  } else {
    const decoupeur = new DecoupeurLignes();
    finLigne = detecterFinLigne(texteDebut);
    const premieresLignes = texteDebut.split(/\r\n|\r|\n/).slice(0, 51);
    const structure = detecterStructure(premieresLignes);
    if (!structure) {
      // Aucun séparateur plausible : l'assistant affiche le texte brut.
      return {
        statut: 'correspondance-requise',
        entetes: [],
        apercu: premieresLignes.slice(0, 20).map((l) => [l]),
        proposition: {},
        manquantes: [],
        sansEntete: false,
        signatureEntete: null,
      };
    }
    separateur = structure.separateur;
    guillemets = structure.guillemets;
    const premiere = decouper(premieresLignes[0]!.replace(/^\ufeff/, ''), separateur, guillemets);
    const avecEntete = options.sansEntete ? false : estEntete(premiere);
    const entetes = avecEntete ? premiere : premiere.map((_, i) => `Colonne ${i + 1}`);
    signature = avecEntete ? signatureEntete(premiere) : null;
    const id = identifierColonnes(entetes, { regime: options.regime, correspondance: options.correspondance });
    if (!avecEntete || id.bloquantes.length > 0) {
      if (!options.correspondance || id.bloquantes.length > 0) {
        return {
          statut: 'correspondance-requise',
          entetes,
          apercu: premieresLignes
            .slice(avecEntete ? 1 : 0)
            .filter((l) => l.trim() !== '')
            .slice(0, 20)
            .map((l) => decouper(l, separateur!, guillemets)),
          proposition: proposerCorrespondance(id),
          manquantes: id.bloquantes,
          sansEntete: !avecEntete,
          signatureEntete: signature,
        };
      }
    }
    if (!avecEntete) constats.global('S05');
    regime = id.regime;
    presentation = id.presentation;
    colonnes = id.colonnes;
    controlerEntete(id, constats);
    if (separateur !== '\t' && separateur !== '|') constats.global('S02', `séparateur ${separateur === ';' ? 'point-virgule' : 'virgule'}`);
    if (guillemets) constats.global('S14');
    const ctx: ContexteNormalisation = {
      regime,
      xml: false,
      obligatoires: zonesObligatoires(regime, presentation).filter((z) => id.index[z] !== undefined),
      reconstruireAuxiliaires: options.reconstruireAuxiliaires ?? true,
      constats,
    };
    const index = id.index;
    const nbColonnes = entetes.length;
    let numero = 0;
    const traiter = (ligne: string) => {
      numero++;
      if (numero === 1 && avecEntete) return;
      if (ligne.trim() === '') {
        constats.ligne('S12', numero);
        return;
      }
      const champs = decouper(ligne, separateur!, guillemets);
      if (champs.length !== nbColonnes) constats.ligne('S11', numero);
      normaliser(ctx, (z) => {
        const i = index[z];
        return i === undefined ? undefined : (champs[i] ?? '');
      }, numero);
    };
    for await (const texte of morceaux()) for (const ligne of decoupeur.pousser(texte)) traiter(ligne);
    if (annule()) return { statut: 'annule' };
    for (const ligne of decoupeur.pousser('', true)) traiter(ligne);
  }

  if (detection.bom && encodage === 'utf-8') constats.global('S04');
  const encodageReel: Encodage = encodage !== 'utf-8' && decodeur.octetsC1 > 0 ? 'windows-1252' : encodage;
  if (encodageReel === 'windows-1252') constats.global('S03', 'Windows-1252');

  const fec = constructeur.terminer();
  if (fec.nbLignes === 0) constats.global('S15');
  if (!nomFichier.conforme) constats.global('S01', options.nomFichier);

  const journalAN = detecterJournalAN(fec);
  const cloture = nomFichier.cloture ?? clotureXml;
  const exercice = fec.nbLignes > 0 ? deduireExercice(fec, journalAN, cloture) : null;
  let premiere = Number.MAX_SAFE_INTEGER;
  let derniere = 0;
  for (let i = 0; i < fec.nbLignes; i++) {
    const d = fec.ecritureDate[i]!;
    if (d > 0) {
      if (d < premiere) premiere = d;
      if (d > derniere) derniere = d;
    }
  }
  const iso = (d: number) => `${String(d).slice(0, 4)}-${String(d).slice(4, 6)}-${String(d).slice(6)}`;
  const constatsEcritures = exercice ? controlerColonnes(fec, { debut: exercice.debut, fin: exercice.fin, journalAN, xml }) : [];

  return {
    statut: 'termine',
    fec: {
      colonnes: fec,
      constatsLecture: constats.resultat(),
      constatsEcritures,
      meta: {
        nomFichier: options.nomFichier,
        taille: options.taille,
        empreinte: sha.terminer(),
        format: xml ? 'xml' : 'plat',
        encodage: encodageReel,
        bom: detection.bom,
        finLigne,
        separateur,
        guillemets,
        regime,
        presentation,
        schemaXml,
        colonnes,
        signatureEntete: signature,
        nbLignes: fec.nbLignes,
        nbEcritures: fec.nbEcritures,
        siren: nomFichier.siren,
        sirenValide: nomFichier.sirenValide,
        cloture,
        exercice,
        journalAN,
        modeNumerotation: modeNumerotation(fec),
        periode: derniere > 0 ? { premiere: iso(premiere), derniere: iso(derniere) } : null,
        dureeMs: performance.now() - t0,
      },
    },
  };
}

/** Tous les constats, triés dans l'ordre du catalogue. */
export function tousLesConstats(fec: Pick<FecImporte, 'constatsLecture' | 'constatsEcritures'>): Constat[] {
  const k = new Constats();
  k.fusionner(fec.constatsLecture);
  k.fusionner(fec.constatsEcritures);
  return k.resultat();
}
