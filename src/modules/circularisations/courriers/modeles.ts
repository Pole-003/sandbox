/**
 * Modèles de lettres de demande de confirmation (SPEC 4.5), un par population.
 *
 * Décisions du 08/10/2026 : lettre sur papier à en-tête du client, signée par son dirigeant, réponse
 * adressée directement au cabinet ; solde non indiqué par défaut pour toutes les populations (le solde
 * indiqué reste une option des modèles clients et fournisseurs) ; bloc adresse du destinataire laissé
 * vide, à compléter dans Word.
 *
 * Le corps est un texte simple : paragraphes séparés par une ligne vide, ligne commençant par « - »
 * pour une puce, variables entre accolades (voir VARIABLES). Un paragraphe vide après remplacement
 * des variables est supprimé.
 */
import type { PopulationDemande } from '../demandes.ts';

export type Demande = 'solde' | 'releve' | 'solde-et-releve';

export interface ModeleCourrier {
  /** Lettre « à solde indiqué » (le solde comptable figure dans la lettre) ; toujours faux pour les banques. */
  soldeIndique: boolean;
  /** Ce qui est demandé au tiers : confirmation du solde, relevé de compte, ou les deux. */
  demande: Demande;
  /** Banques : rappeler les comptes enregistrés dans la comptabilité (numéro et libellé, sans solde). */
  listerComptes: boolean;
  /** Joindre un coupon-réponse (page séparée). */
  coupon: boolean;
  objet: string;
  corps: string;
}

export interface CoordonneesCabinet {
  nom: string;
  /** Adresse de réponse, une ligne par ligne d'adresse. */
  adresse: string;
  email: string;
}

/** Modèles et coordonnées du cabinet, communs à tous les dossiers du poste. */
export interface ModelesCourriers {
  version: 1;
  cabinet: CoordonneesCabinet;
  modeles: Record<PopulationDemande, ModeleCourrier>;
}

/** Réglages propres au dossier : en-tête et signataire du client, dates des lettres. */
export interface ReglagesCourriersDossier {
  version: 1;
  /** Raison sociale (variable {societe}). */
  societe: string;
  /** Lignes de l'en-tête du client sous la raison sociale (adresse, SIREN…). */
  enTete: string;
  lieu: string;
  signataireNom: string;
  signataireQualite: string;
  /** Date des lettres (ISO) ; vide = date du jour de l'export. */
  dateLettres: string;
  /** Date limite de réponse souhaitée (ISO) ; vide = « dans les meilleurs délais ». */
  dateLimite: string;
}

export const VARIABLES: { nom: string; description: string }[] = [
  { nom: 'societe', description: 'Raison sociale du client' },
  { nom: 'tiers', description: 'Nom du tiers ou de l’établissement' },
  { nom: 'code_tiers', description: 'Code du tiers (compte auxiliaire)' },
  { nom: 'reference', description: 'Référence de la demande (CL-001…)' },
  { nom: 'date_cloture', description: 'Date de clôture (JJ/MM/AAAA)' },
  { nom: 'cabinet', description: 'Nom du cabinet' },
  { nom: 'contact_reponse', description: 'Adresse de réponse du cabinet (et e-mail)' },
  { nom: 'delai_reponse', description: '« si possible avant le … » ou « dans les meilleurs délais »' },
  { nom: 'phrase_solde', description: 'Lettre à solde indiqué : phrase donnant le solde ; sinon vide' },
  { nom: 'phrase_demande', description: 'Demande de confirmation du solde et/ou de relevé, selon les options' },
  { nom: 'solde', description: 'Solde comptable en valeur absolue (1 234,56 €)' },
  { nom: 'sens_solde', description: '« en notre faveur » ou « en votre faveur »' },
  { nom: 'comptes_banque', description: 'Banques : rappel des comptes enregistrés (si l’option est cochée)' },
];

export const LIBELLES_POPULATIONS: Record<PopulationDemande, string> = { banques: 'Banques', clients: 'Clients', fournisseurs: 'Fournisseurs' };

export const LIBELLES_DEMANDES: Record<Demande, string> = {
  solde: 'Confirmation du solde',
  releve: 'Relevé de compte',
  'solde-et-releve': 'Solde et relevé de compte',
};

const POLITESSE = 'Nous vous remercions par avance de votre collaboration et vous prions d’agréer, Madame, Monsieur, l’expression de nos salutations distinguées.';
const REPONSE = 'Votre réponse est à adresser directement à {cabinet}, {contact_reponse}, en rappelant la référence {reference}, {delai_reponse}.';

const CORPS_BANQUES = [
  'Madame, Monsieur,',
  'Dans le cadre de l’examen de nos comptes de l’exercice clos le {date_cloture}, nous vous prions de bien vouloir communiquer directement à {cabinet} les informations suivantes, arrêtées à cette date, concernant l’ensemble des relations entre votre établissement et notre société :',
  [
    '- les soldes de tous nos comptes (comptes courants, comptes à terme, comptes en devises, comptes titres), y compris ceux clôturés au cours de l’exercice ;',
    '- les emprunts et concours de toute nature : capital restant dû, échéances, taux et garanties ;',
    '- les engagements hors bilan : cautions et garanties données ou reçues, crédits documentaires, instruments financiers de couverture ;',
    '- les effets escomptés non échus et les créances cédées non échues (bordereaux Dailly) ;',
    '- les titres et valeurs détenus en dépôt pour notre compte ;',
    '- les personnes habilitées à faire fonctionner nos comptes et l’étendue de leurs pouvoirs.',
  ].join('\n'),
  '{comptes_banque}',
  REPONSE,
  'Nous vous autorisons expressément à communiquer ces informations à {cabinet}.',
  POLITESSE,
].join('\n\n');

const corpsTiers = (clients: boolean) =>
  [
    'Madame, Monsieur,',
    'Dans le cadre de l’examen de nos comptes de l’exercice clos le {date_cloture}, nous vous prions de bien vouloir communiquer directement à {cabinet} les informations demandées ci-après.',
    '{phrase_solde}',
    '{phrase_demande}',
    REPONSE,
    clients
      ? 'Cette demande a pour seul objet le contrôle de nos comptes : elle ne constitue ni une demande de paiement ni un avis de règlement.'
      : 'Cette demande a pour seul objet le contrôle de nos comptes : elle ne constitue pas un avis de règlement.',
    POLITESSE,
  ].join('\n\n');

export function modelesParDefaut(): ModelesCourriers {
  const tiers = (clients: boolean): ModeleCourrier => ({
    soldeIndique: false,
    demande: 'solde-et-releve',
    listerComptes: false,
    coupon: true,
    objet: 'Demande de confirmation de solde au {date_cloture}',
    corps: corpsTiers(clients),
  });
  return {
    version: 1,
    cabinet: { nom: '', adresse: '', email: '' },
    modeles: {
      banques: {
        soldeIndique: false,
        demande: 'solde-et-releve',
        listerComptes: true,
        coupon: false,
        objet: 'Demande de confirmation des soldes et engagements au {date_cloture}',
        corps: CORPS_BANQUES,
      },
      clients: tiers(true),
      fournisseurs: tiers(false),
    },
  };
}

/** Texte par défaut d'un modèle (bouton « Rétablir le texte par défaut »). */
export function modeleParDefaut(population: PopulationDemande): ModeleCourrier {
  return modelesParDefaut().modeles[population];
}

export function reglagesDossierParDefaut(nomDossier: string, siren: string | null): ReglagesCourriersDossier {
  return {
    version: 1,
    societe: nomDossier,
    enTete: siren ? `SIREN ${siren.replace(/^(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3')}` : '',
    lieu: '',
    signataireNom: '',
    signataireQualite: '',
    dateLettres: '',
    dateLimite: '',
  };
}
