/** Lecture d'une CA3 déposée (PDF) dans le navigateur, et création d'une déclaration saisie à la main. */
import { sha256 } from '../../../core/sha256.ts';
import { analyserCa3, type IdentificationCa3 } from './analyse.ts';
import type { DeclarationCa3 } from './declaration.ts';
import { chargerPdfjs } from './pdfjs-navigateur.ts';
import { pagesDuPdf } from './texte-pdf.ts';

/** Cases proposées dans la grille de saisie manuelle (PDF illisible). */
export const CASES_SAISIE: readonly string[] = ['A1', 'A2', 'A3', 'B2', 'B4', 'E1', 'E2', 'F2', '08', '09', '9B', '15', '5B', '16', '17', '19', '20', '21', '22', '2C', '23', '25', 'TD', '26', '27', '28', '29', '32'];

const identifiant = () => crypto.randomUUID();

export async function lireFichierCa3(fichier: File): Promise<DeclarationCa3> {
  const octets = new Uint8Array(await fichier.arrayBuffer());
  const empreinte = sha256(octets);
  let lecture;
  try {
    lecture = analyserCa3(await pagesDuPdf(await chargerPdfjs(), octets));
  } catch (e) {
    lecture = {
      identification: identificationVide(),
      cases: {},
      casesInconnues: [],
      messages: [{ gravite: 'anomalie' as const, code: 'LECTURE', message: `PDF illisible (${e instanceof Error ? e.message : String(e)}) : saisissez la déclaration manuellement.` }],
      illisible: true,
    };
  }
  return {
    id: identifiant(),
    source: 'pdf',
    nomFichier: fichier.name,
    empreinte,
    identification: lecture.identification,
    lues: lecture.cases,
    corrections: [],
    messagesLecture: lecture.messages,
    casesInconnues: lecture.casesInconnues,
    importeLe: new Date().toISOString(),
  };
}

export function identificationVide(): IdentificationCa3 {
  return { denomination: null, siren: null, debut: null, fin: null, dateLimite: null, dateDepot: null, dateCreation: null, millesime: null };
}

export function declarationSaisie(identification: IdentificationCa3): DeclarationCa3 {
  return {
    id: identifiant(),
    source: 'saisie',
    nomFichier: null,
    empreinte: null,
    identification,
    lues: {},
    corrections: [],
    messagesLecture: [],
    casesInconnues: [],
    importeLe: new Date().toISOString(),
  };
}
