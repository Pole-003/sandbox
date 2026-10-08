/**
 * Composition des lettres (fonction pure) : à partir des demandes numérotées, des modèles et des réglages
 * du dossier, produit une description neutre de chaque lettre, rendue ensuite en aperçu HTML ou en .docx.
 */
import { formaterDate, formaterMontant } from '../../../core/format.ts';
import type { Demande } from '../demandes.ts';
import type { ModeleCourrier, ModelesCourriers, ReglagesCourriersDossier } from './modeles.ts';

export type Bloc =
  | { type: 'paragraphe'; texte: string }
  | { type: 'puce'; texte: string }
  /** Case à cocher suivie d'un texte. */
  | { type: 'case'; texte: string }
  /** Texte suivi d'une ligne à compléter à la main. */
  | { type: 'saisie'; texte: string };

export interface Lettre {
  ref: string;
  population: Demande['population'];
  /** Nom du tiers ou de l'établissement (le reste du bloc adresse est laissé vide). */
  destinataire: string;
  codeTiers: string | null;
  /** Nom du fichier .docx dans l'archive. */
  nomFichier: string;
  societe: string;
  enTete: string[];
  lieuDate: string;
  objet: string;
  corps: Bloc[];
  signature: string[];
  /** Coupon-réponse (page séparée), ou null. */
  coupon: { titre: string; consigne: string; blocs: Bloc[] } | null;
}

const NBSP = '\u00a0';
const euros = (centimes: number) => `${formaterMontant(Math.abs(centimes))}${NBSP}€`;
const LIGNE_A_COMPLETER = '______________';

/** Remplace les variables connues ; une variable inconnue reste visible telle quelle. */
export function remplacer(texte: string, variables: Record<string, string>): string {
  return texte.replace(/\{([a-z_]+)\}/g, (tout, nom: string) => variables[nom] ?? tout);
}

/** Découpe un corps en blocs : paragraphes séparés par une ligne vide, puces « - ». */
export function blocsDuCorps(texte: string): Bloc[] {
  const blocs: Bloc[] = [];
  for (const paragraphe of texte.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    let courant: string[] = [];
    const vider = () => {
      const t = courant.join(' ').replace(/[ \t]+/g, ' ').trim();
      if (t) blocs.push({ type: 'paragraphe', texte: t });
      courant = [];
    };
    for (const ligne of paragraphe.split('\n')) {
      const puce = /^\s*[-•]\s+(.*)$/.exec(ligne);
      if (puce) {
        vider();
        const t = puce[1]!.trim();
        if (t) blocs.push({ type: 'puce', texte: t });
      } else courant.push(ligne);
    }
    vider();
  }
  return blocs;
}

/** Nom de fichier sûr pour Windows et les archives : « CL-001 - Nom du tiers.docx ». */
export function nomFichier(ref: string, destinataire: string): string {
  const nom = destinataire
    .normalize('NFC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 60)
    .trim();
  return `${ref}${nom ? ` - ${nom}` : ''}.docx`;
}

function phraseDemande(m: ModeleCourrier, date: string): string {
  const confirmer = m.soldeIndique
    ? 'confirmer ce solde ou, à défaut, nous indiquer le solde figurant dans vos livres à cette date'
    : `nous indiquer le solde de notre compte dans vos livres au ${date}`;
  const releve = `${m.demande === 'releve' ? `nous adresser un relevé de notre compte dans vos livres au ${date}` : 'y joindre un relevé de notre compte'}, faisant apparaître le détail des factures, avoirs et règlements non soldés à cette date, ainsi que les effets et litiges éventuels`;
  const coupon = m.coupon ? ', au moyen du coupon-réponse ci-joint' : '';
  if (m.demande === 'solde') return `Nous vous remercions de bien vouloir ${confirmer}${coupon}.`;
  if (m.demande === 'releve') return `Nous vous remercions de bien vouloir ${releve}.`;
  return `Nous vous remercions de bien vouloir ${confirmer}${coupon}, et ${releve}.`;
}

function coupon(m: ModeleCourrier, v: { societe: string; tiers: string; date: string; solde: number; cabinet: string; contact: string; ref: string }): Lettre['coupon'] {
  if (!m.coupon) return null;
  const faveur = (s: number) => (s > 0 ? `en faveur de ${v.societe}` : `en faveur de ${v.tiers}`);
  const blocs: Bloc[] = [];
  const demandeSolde = m.demande !== 'releve';
  if (demandeSolde && m.soldeIndique) {
    blocs.push({
      type: 'case',
      texte: v.solde === 0 ? `Nous confirmons que le compte de ${v.societe} dans nos livres est soldé au ${v.date}.` : `Nous confirmons qu’au ${v.date} le compte de ${v.societe} présente dans nos livres un solde de ${euros(v.solde)} ${faveur(v.solde)}.`,
    });
    blocs.push({ type: 'case', texte: 'Nous ne sommes pas d’accord avec ce solde : le détail de l’écart est joint.' });
    blocs.push({ type: 'saisie', texte: `Solde selon nos livres au ${v.date} : ${LIGNE_A_COMPLETER} € en faveur de` });
  } else if (demandeSolde) {
    blocs.push({ type: 'saisie', texte: `Au ${v.date}, le compte de ${v.societe} présente dans nos livres un solde de ${LIGNE_A_COMPLETER} € en faveur de` });
  }
  if (m.demande !== 'solde') blocs.push({ type: 'case', texte: `Relevé de compte au ${v.date} joint.` });
  blocs.push({ type: 'saisie', texte: 'Observations :' });
  blocs.push({ type: 'saisie', texte: 'Date :' });
  blocs.push({ type: 'saisie', texte: 'Nom et qualité du signataire :' });
  blocs.push({ type: 'paragraphe', texte: 'Cachet et signature :' });
  return {
    titre: 'Coupon-réponse',
    consigne: `À retourner directement à ${v.cabinet}, ${v.contact}. Référence ${v.ref} — ${v.societe} — situation au ${v.date}.`,
    blocs,
  };
}

export interface ContexteLettres {
  modeles: ModelesCourriers;
  dossier: ReglagesCourriersDossier;
  dateCloture: string;
  /** Date des lettres retenue si le dossier n'en fixe pas (date du jour de l'export), ISO. */
  aujourdhui: string;
}

export function composerLettre(d: Demande, c: ContexteLettres): Lettre {
  const m = c.modeles.modeles[d.population];
  const r = c.dossier;
  const date = formaterDate(c.dateCloture);
  const banque = d.population === 'banques';
  const destinataire = banque ? d.etablissement.etablissement : d.tiers.libelle;
  const codeTiers = banque ? null : d.tiers.compAuxNum;
  // Lettre à solde indiqué : jamais pour les banques (demande ouverte sur l'ensemble des relations).
  const soldeIndique = !banque && m.soldeIndique && m.demande !== 'releve';
  const solde = banque ? d.etablissement.solde : d.tiers.solde;
  const societe = r.societe.trim() || '[raison sociale du client]';
  const cabinet = c.modeles.cabinet.nom.trim() || '[nom du cabinet]';
  const adresse = c.modeles.cabinet.adresse
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join(', ');
  const email = c.modeles.cabinet.email.trim();
  const contact = `${adresse || '[adresse de réponse du cabinet]'}${email ? `, ou par courriel à ${email}` : ''}`;
  const sens = solde > 0 ? 'en notre faveur' : solde < 0 ? 'en votre faveur' : '';
  const comptesBanque =
    banque && m.listerComptes
      ? `Pour mémoire, notre comptabilité enregistre les comptes suivants auprès de votre établissement : ${d.etablissement.comptes
          .map((k) => `${k.compteNum} ${k.compteLib}${k.cloture === 0 && k.mouvemente ? ' (soldé à la clôture)' : ''}`)
          .join(' ; ')}.`
      : '';
  const variables: Record<string, string> = {
    societe,
    tiers: destinataire,
    code_tiers: codeTiers ?? '',
    reference: d.ref,
    date_cloture: date,
    cabinet,
    contact_reponse: contact,
    delai_reponse: r.dateLimite ? `si possible avant le ${formaterDate(r.dateLimite)}` : 'dans les meilleurs délais',
    solde: euros(solde),
    sens_solde: sens,
    phrase_solde: soldeIndique
      ? solde === 0
        ? `Selon notre comptabilité, votre compte${codeTiers ? ` (code ${codeTiers})` : ''} était soldé au ${date}.`
        : `Selon notre comptabilité, votre compte${codeTiers ? ` (code ${codeTiers})` : ''} présentait au ${date} un solde de ${euros(solde)} ${sens}.`
      : '',
    phrase_demande: banque ? '' : phraseDemande({ ...m, soldeIndique }, date),
    comptes_banque: comptesBanque,
  };
  const dateLettre = formaterDate(r.dateLettres || c.aujourdhui);
  return {
    ref: d.ref,
    population: d.population,
    destinataire,
    codeTiers,
    nomFichier: nomFichier(d.ref, destinataire),
    societe,
    enTete: r.enTete
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean),
    lieuDate: r.lieu.trim() ? `${r.lieu.trim()}, le ${dateLettre}` : `Le ${dateLettre}`,
    objet: remplacer(m.objet, variables).trim(),
    corps: blocsDuCorps(remplacer(m.corps, variables)),
    signature: [r.signataireQualite.trim(), r.signataireNom.trim()].filter(Boolean),
    coupon: coupon({ ...m, soldeIndique }, { societe, tiers: destinataire, date, solde, cabinet, contact, ref: d.ref }),
  };
}
