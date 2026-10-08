/**
 * Lecture en flux d'un FEC XML (schémas formatA47A-I-VII-1, VIII-3, VIII-5, VIII-7).
 *
 * DOMParser n'existe pas dans un Web Worker et chargerait tout le document en mémoire : ce lecteur
 * minimal (éléments, texte, entités, CDATA, commentaires) suffit à la structure simple des schémas
 * officiels et traite un fichier de plusieurs centaines de Mo morceau par morceau.
 */
import type { Constats } from '../conformite/constats.ts';
import type { Regime, Zone } from '../zones.ts';

const ENTITES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decoderEntites(texte: string): string {
  if (!texte.includes('&')) return texte;
  return texte.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (tout, nom: string) => {
    if (nom[0] === '#') {
      const code = nom[1] === 'x' || nom[1] === 'X' ? parseInt(nom.slice(2), 16) : parseInt(nom.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : tout;
    }
    return ENTITES[nom] ?? tout;
  });
}

interface Evenements {
  ouverture(nom: string, attributs: string): void;
  texte(texte: string): void;
  fermeture(nom: string): void;
}

/** Analyseur lexical en flux : appelle les événements au fil des morceaux de texte. */
export class LecteurXml {
  private tampon = '';
  private readonly ev: Evenements;

  constructor(evenements: Evenements) {
    this.ev = evenements;
  }

  pousser(morceau: string, final = false): void {
    const t = this.tampon + morceau;
    this.tampon = '';
    let i = 0;
    for (;;) {
      const lt = t.indexOf('<', i);
      if (lt < 0) {
        if (final) this.ev.texte(t.slice(i));
        else this.tampon = t.slice(i);
        return;
      }
      if (lt > i) this.ev.texte(t.slice(i, lt));
      const [ouvrant, fermant] = t.startsWith('<!--', lt)
        ? ['<!--', '-->']
        : t.startsWith('<![CDATA[', lt)
          ? ['<![CDATA[', ']]>']
          : ['<', '>'];
      const fin = t.indexOf(fermant, lt + ouvrant.length);
      if (fin < 0) {
        // Construction incomplète : on attend le morceau suivant.
        this.tampon = t.slice(lt);
        return;
      }
      i = fin + fermant.length;
      if (ouvrant === '<!--') continue;
      if (ouvrant === '<![CDATA[') {
        // Protégé pour traverser le décodage des entités à la fermeture de l'élément.
        this.ev.texte(t.slice(lt + 9, fin).replaceAll('&', '&amp;').replaceAll('<', '&lt;'));
        continue;
      }
      const balise = t.slice(lt + 1, fin);
      if (balise[0] === '?' || balise[0] === '!') continue;
      if (balise[0] === '/') {
        this.ev.fermeture(balise.slice(1).trim());
        continue;
      }
      const autoFermante = balise.endsWith('/');
      const corps = autoFermante ? balise.slice(0, -1) : balise;
      const espace = corps.search(/\s/);
      const nom = espace < 0 ? corps : corps.slice(0, espace);
      this.ev.ouverture(nom, espace < 0 ? '' : corps.slice(espace));
      if (autoFermante) this.ev.fermeture(nom);
    }
  }
}

const CHAMPS_ECRITURE = new Set([
  'EcritureNum',
  'EcritureDate',
  'EcritureLib',
  'PieceRef',
  'PieceDate',
  'EcritureLet',
  'DateLet',
  'ValidDate',
  'DateRglt',
  'ModeRglt',
  'NatOp',
  'IdClient',
]);
const CHAMPS_LIGNE: Record<string, Zone> = {
  CompteNum: 'CompteNum',
  CompteLib: 'CompteLib',
  CompAuxNum: 'CompAuxNum',
  CompteAuxNum: 'CompAuxNum',
  CompAuxLib: 'CompAuxLib',
  CompteAuxLib: 'CompAuxLib',
  Montantdevise: 'Montantdevise',
  Idevise: 'Idevise',
  Debit: 'Debit',
  Credit: 'Credit',
  Montant: 'Montant',
  Sens: 'Sens',
};

export const SCHEMAS: Record<string, Regime> = {
  'formatA47A-I-VII-1': 'bic',
  'formatA47A-I-VIII-3': 'bnc-ba-commercial',
  'formatA47A-I-VIII-5': 'ba-tresorerie',
  'formatA47A-I-VIII-7': 'bnc-tresorerie',
};

export interface LigneXml {
  /** Rang de l'élément <ligne> dans le fichier (à partir de 1). */
  rang: number;
  valeurs: Partial<Record<Zone, string>>;
}

export interface EnteteXml {
  schema: string | null;
  regime: Regime | null;
  dateCloture: string | null;
}

/**
 * Assemble les lignes d'écriture : chaque <ligne> reçoit les zones de son journal et de son écriture.
 * Les écarts au schéma relèvent de S16 (Non conforme), avec le rang de la ligne concernée.
 */
export class AssembleurFecXml implements Evenements {
  readonly entete: EnteteXml = { schema: null, regime: null, dateCloture: null };
  racineInconnue: string | null = null;
  private pile: string[] = [];
  private texteCourant = '';
  private journal: Partial<Record<Zone, string>> = {};
  private ecriture: Partial<Record<Zone, string>> = {};
  private lignes: LigneXml[] = [];
  private ligne: Partial<Record<Zone, string>> | null = null;
  private rang = 0;
  private champsLigne = new Set<string>();
  private readonly emettre: (l: LigneXml) => void;
  private readonly constats: Constats;

  constructor(emettre: (l: LigneXml) => void, constats: Constats) {
    this.emettre = emettre;
    this.constats = constats;
  }

  private ecart(detail: string, rang?: number): void {
    if (rang === undefined) this.constats.global('S16', detail);
    else {
      this.constats.ligne('S16', rang);
      this.constats.detail('S16', `ligne ${rang} : ${detail}`);
    }
  }

  ouverture(nom: string, attributs: string): void {
    if (this.pile.length === 0) {
      if (nom !== 'comptabilite') this.racineInconnue = nom;
      const schema = /noNamespaceSchemaLocation\s*=\s*["'](?:file:)?([^"']*?)(?:\.xsd)?["']/i.exec(attributs)?.[1] ?? null;
      this.entete.schema = schema;
      this.entete.regime = schema ? (SCHEMAS[schema.split('/').pop()!] ?? null) : null;
    }
    this.pile.push(nom);
    this.texteCourant = '';
    if (nom === 'journal') this.journal = {};
    else if (nom === 'ecriture') {
      this.ecriture = {};
      this.lignes = [];
    } else if (nom === 'ligne') {
      this.ligne = {};
      this.champsLigne = new Set();
      this.rang++;
    }
  }

  texte(texte: string): void {
    this.texteCourant += texte;
  }

  fermeture(nom: string): void {
    this.pile.pop();
    const parent = this.pile[this.pile.length - 1];
    const valeur = decoderEntites(this.texteCourant).trim();
    this.texteCourant = '';
    if (parent === 'ligne' && this.ligne) {
      const zone = CHAMPS_LIGNE[nom];
      if (zone) {
        this.ligne[zone] = valeur;
        this.champsLigne.add(nom);
      }
      return;
    }
    if (parent === 'ecriture' && CHAMPS_ECRITURE.has(nom)) {
      this.ecriture[nom as Zone] = valeur;
      return;
    }
    if (parent === 'journal' && (nom === 'JournalCode' || nom === 'JournalLib')) {
      this.journal[nom] = valeur;
      return;
    }
    if (parent === 'exercice' && nom === 'DateCloture') {
      this.entete.dateCloture = valeur;
      return;
    }
    if (nom === 'ligne' && this.ligne) {
      const c = this.champsLigne;
      if (this.entete.regime === 'bic' && !c.has('CompteNum')) this.ecart('CompteNum absent', this.rang);
      if (!c.has('CompteLib')) this.ecart('CompteLib absent', this.rang);
      const montants = Number(c.has('Debit')) + Number(c.has('Credit')) + Number(c.has('Montant') || c.has('Sens'));
      if (montants !== 1 || (c.has('Montant') !== c.has('Sens'))) {
        this.ecart('une seule zone Debit, Credit ou le couple Montant/Sens est attendue', this.rang);
      }
      this.lignes.push({ rang: this.rang, valeurs: this.ligne });
      this.ligne = null;
      return;
    }
    if (nom === 'ecriture') {
      const premier = this.lignes[0]?.rang;
      const obligatoires = ['EcritureNum', 'EcritureDate', 'EcritureLib', 'PieceRef', 'PieceDate', 'ValidDate'];
      if (this.entete.regime === 'ba-tresorerie' || this.entete.regime === 'bnc-tresorerie') obligatoires.push('DateRglt', 'ModeRglt');
      const manquants = obligatoires.filter((z) => this.ecriture[z as Zone] === undefined);
      if (manquants.length) this.ecart(`${manquants.join(', ')} absent(s) de l'écriture`, premier);
      if (this.lignes.length < 2) this.ecart("moins de deux lignes dans l'écriture", premier);
      for (const l of this.lignes) {
        this.emettre({ rang: l.rang, valeurs: { ...this.journal, ...this.ecriture, ...l.valeurs } });
      }
      this.lignes = [];
      return;
    }
    if (nom === 'journal' && this.entete.regime === 'bic' && (this.journal.JournalCode === undefined || this.journal.JournalLib === undefined)) {
      this.ecart('JournalCode ou JournalLib absent du journal');
    }
    if (nom === 'exercice' && this.entete.dateCloture === null) this.ecart('DateCloture absente');
  }
}
