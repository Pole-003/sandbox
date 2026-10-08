import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as D from 'docx';
import JSZip from 'jszip';
import { beforeAll, describe, expect, it } from 'vitest';
import { formaterMontant } from '../../../src/core/format.ts';
import { archiveLettres, docxLettres } from '../../../src/modules/circularisations/courriers/docx.ts';
import { blocsDuCorps, composerLettre, nomFichier, remplacer, type ContexteLettres, type Lettre } from '../../../src/modules/circularisations/courriers/lettres.ts';
import { modelesParDefaut, reglagesDossierParDefaut, VARIABLES } from '../../../src/modules/circularisations/courriers/modeles.ts';
import { demandes, type Demande } from '../../../src/modules/circularisations/demandes.ts';
import { parametresParDefaut } from '../../../src/modules/circularisations/parametres.ts';
import { selectionner, type Selection } from '../../../src/modules/circularisations/selection.ts';
import { construireDonneesFec } from '../../../src/modules/fec/interface-circularisations.ts';
import { reglagesInitiaux } from '../../../src/modules/fec/stockage/base-fec.ts';
import { ATTENDUS, importerFichier } from '../fec/aides.ts';

const NBSP = '\u00a0';
let selection: Selection;
let liste: Record<'banques' | 'clients' | 'fournisseurs', Demande[]>;

const contexte = (): ContexteLettres => {
  const modeles = modelesParDefaut();
  modeles.cabinet = { nom: 'Cabinet Fictif Audit', adresse: '10 rue de l’Exemple\n75000 Paris', email: 'circularisations@exemple.invalid' };
  const dossier = reglagesDossierParDefaut('Négoce fictif SAS', '000123455');
  dossier.enTete = '1 avenue Imaginaire\n69000 Lyon\nSIREN 000 123 455';
  dossier.lieu = 'Lyon';
  dossier.signataireNom = 'Camille Exemple';
  dossier.signataireQualite = 'La Présidente';
  dossier.dateLimite = '2026-07-31';
  return { modeles, dossier, dateCloture: '2026-06-30', aujourdhui: '2026-07-10' };
};

const texte = (l: Lettre) => [l.objet, ...l.corps.map((b) => b.texte), ...(l.coupon ? [l.coupon.consigne, ...l.coupon.blocs.map((b) => b.texte)] : [])].join('\n');

async function texteDocx(octets: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(octets);
  const xml = await zip.file('word/document.xml')!.async('string');
  return xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

beforeAll(async () => {
  const r = await importerFichier(ATTENDUS.fichiers.find((f) => f.categorie === 'propre')!.fichier);
  if (r.statut !== 'termine') throw new Error();
  const donnees = construireDonneesFec(
    r.fec.colonnes,
    { id: 'x', dossierId: 'd', role: 'N', importeLe: '', meta: r.fec.meta, constatsLecture: [], constatsEcritures: [], reglages: reglagesInitiaux(r.fec.meta) },
    { id: 'd', nom: 'Négoce fictif' },
  );
  const p = parametresParDefaut('2026-06-30', 2026);
  p.sp = 5_000_000;
  selection = selectionner(donnees, p);
  liste = demandes(selection);
});

describe('outils de composition', () => {
  it('remplace les variables connues et laisse visibles les inconnues', () => {
    expect(remplacer('{societe} / {inconnue} / {reference}', { societe: 'A', reference: 'CL-001' })).toBe('A / {inconnue} / CL-001');
  });

  it('découpe le corps en paragraphes et puces, supprime les paragraphes vides', () => {
    expect(blocsDuCorps('Madame,\n\nLigne 1\nsuite\n\n\n\n- a ;\n- b.\n\n   \n\nFin')).toEqual([
      { type: 'paragraphe', texte: 'Madame,' },
      { type: 'paragraphe', texte: 'Ligne 1 suite' },
      { type: 'puce', texte: 'a ;' },
      { type: 'puce', texte: 'b.' },
      { type: 'paragraphe', texte: 'Fin' },
    ]);
  });

  it('nom de fichier sûr', () => {
    expect(nomFichier('CL-001', 'Dupont & Fils / SARL : "Lyon"')).toBe('CL-001 - Dupont & Fils SARL Lyon.docx');
    expect(nomFichier('FO-002', '  ')).toBe('FO-002.docx');
  });

  it('chaque variable documentée est utilisée par la composition', () => {
    const l = composerLettre(liste.clients[0]!, contexte());
    expect(l).toBeTruthy();
    for (const v of VARIABLES) {
      const c = contexte();
      c.modeles.modeles.clients.corps = `[{${v.nom}}]`;
      c.modeles.modeles.clients.soldeIndique = true;
      const t = composerLettre(liste.clients[0]!, c).corps.map((b) => b.texte).join('');
      expect(t, v.nom).not.toContain(`{${v.nom}}`);
    }
  });
});

describe('lettres par population (FEC fictif propre)', () => {
  it('références identiques au tableau de suivi', () => {
    expect(liste.banques.map((d) => d.ref)).toEqual(['BQ-001', 'BQ-002', 'BQ-003']);
    expect(liste.clients).toHaveLength(selection.clients.indicateurs.nbSelectionnes);
    expect(liste.fournisseurs.at(-1)!.ref).toBe(`FO-${String(selection.fournisseurs.indicateurs.nbSelectionnes).padStart(3, '0')}`);
  });

  it('banque : solde non indiqué, comptes rappelés y compris soldés, pas de coupon', () => {
    const gamma = liste.banques.find((d) => d.population === 'banques' && d.etablissement.etablissement === 'Banque Gamma')!;
    const l = composerLettre(gamma, contexte());
    expect(l.destinataire).toBe('Banque Gamma');
    expect(l.objet).toBe('Demande de confirmation des soldes et engagements au 30/06/2026');
    expect(l.coupon).toBeNull();
    const t = texte(l);
    expect(t).toContain('512300');
    expect(t).toContain('(soldé à la clôture)');
    expect(t).toContain('y compris ceux clôturés au cours de l’exercice');
    expect(t).toContain('Nous vous autorisons expressément à communiquer ces informations à Cabinet Fictif Audit.');
    expect(t).toContain('Votre réponse est à adresser directement à Cabinet Fictif Audit, 10 rue de l’Exemple, 75000 Paris, ou par courriel à circularisations@exemple.invalid, en rappelant la référence BQ-003, si possible avant le 31/07/2026.');
    expect(t).not.toMatch(/€/);
    expect(l.corps.filter((b) => b.type === 'puce')).toHaveLength(6);
    expect(l.lieuDate).toBe('Lyon, le 10/07/2026');
    expect(l.signature).toEqual(['La Présidente', 'Camille Exemple']);
  });

  it('banque : le solde n’est jamais indiqué, même si l’option est cochée', () => {
    const c = contexte();
    c.modeles.modeles.banques.soldeIndique = true;
    c.modeles.modeles.banques.corps = '{phrase_solde}';
    expect(composerLettre(liste.banques[1]!, c).corps).toEqual([]);
  });

  it('client, par défaut : solde non indiqué, solde et relevé demandés, coupon sans montant', () => {
    const d = liste.clients[0]!;
    const l = composerLettre(d, contexte());
    const t = texte(l);
    expect(t).not.toMatch(/\d\u00a0€/);
    expect(t).toContain('Nous vous remercions de bien vouloir nous indiquer le solde de notre compte dans vos livres au 30/06/2026, au moyen du coupon-réponse ci-joint, et y joindre un relevé de notre compte');
    expect(t).toContain('ne constitue ni une demande de paiement ni un avis de règlement');
    expect(l.coupon!.blocs.map((b) => b.type)).toEqual(['saisie', 'case', 'saisie', 'saisie', 'saisie', 'paragraphe']);
    expect(l.coupon!.consigne).toContain(`Référence ${d.ref} — Négoce fictif SAS — situation au 30/06/2026`);
  });

  it('client à solde indiqué : montant et sens, coupon d’accord / désaccord', () => {
    const c = contexte();
    c.modeles.modeles.clients.soldeIndique = true;
    const d = liste.clients.find((x) => x.population === 'clients' && x.tiers.solde > 0)!;
    if (d.population !== 'clients') throw new Error();
    const l = composerLettre(d, c);
    const montant = `${formaterMontant(d.tiers.solde)}${NBSP}€`;
    expect(texte(l)).toContain(`présentait au 30/06/2026 un solde de ${montant} en notre faveur.`);
    expect(l.coupon!.blocs[0]).toEqual({ type: 'case', texte: `Nous confirmons qu’au 30/06/2026 le compte de Négoce fictif SAS présente dans nos livres un solde de ${montant} en faveur de Négoce fictif SAS.` });
    expect(l.coupon!.blocs[1]!.type).toBe('case');
  });

  it('client créditeur (C3) à solde indiqué : « en votre faveur »', () => {
    const c = contexte();
    c.modeles.modeles.clients.soldeIndique = true;
    const d = liste.clients.find((x) => x.population === 'clients' && x.tiers.motifs.includes('C3'))!;
    if (d.population !== 'clients') throw new Error();
    const l = composerLettre(d, c);
    expect(texte(l)).toContain('en votre faveur.');
    expect(l.coupon!.blocs[0]!.texte).toContain(`en faveur de ${d.tiers.libelle}.`);
  });

  it('fournisseur, relevé seul : pas de phrase de solde ni de saisie du solde', () => {
    const c = contexte();
    c.modeles.modeles.fournisseurs.demande = 'releve';
    c.modeles.modeles.fournisseurs.soldeIndique = true; // sans effet sur une demande de relevé seul
    const l = composerLettre(liste.fournisseurs[0]!, c);
    const t = texte(l);
    expect(t).toContain('Nous vous remercions de bien vouloir nous adresser un relevé de notre compte dans vos livres au 30/06/2026');
    expect(t).not.toContain('Selon notre comptabilité');
    expect(t).toContain('ne constitue pas un avis de règlement');
    expect(l.coupon!.blocs[0]).toEqual({ type: 'case', texte: 'Relevé de compte au 30/06/2026 joint.' });
  });

  it('réglages vides : repères visibles et délai par défaut', () => {
    const c = contexte();
    c.modeles.cabinet = { nom: '', adresse: '', email: '' };
    c.dossier.societe = '';
    c.dossier.lieu = '';
    c.dossier.dateLimite = '';
    const t = texte(composerLettre(liste.clients[0]!, c));
    expect(t).toContain('[nom du cabinet], [adresse de réponse du cabinet], en rappelant la référence CL-001, dans les meilleurs délais.');
    expect(composerLettre(liste.clients[0]!, c).lieuDate).toBe('Le 10/07/2026');
  });
});

describe('export .docx', () => {
  it('document unique : une section par lettre, textes et coupon présents', async () => {
    const c = contexte();
    const lettres = [liste.banques[0]!, liste.clients[0]!, liste.fournisseurs[0]!].map((d) => composerLettre(d, c));
    const octets = await docxLettres(D, lettres, 'Lettres');
    const zip = await JSZip.loadAsync(octets);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml.match(/<w:sectPr/g)).toHaveLength(3);
    expect(xml.match(/<w:pageBreakBefore/g)).toHaveLength(2);
    const t = await texteDocx(octets);
    expect(t).toContain('Négoce fictif SAS');
    expect(t).toContain('Réf. : CL-001');
    expect(t).toContain('COUPON-RÉPONSE');
    expect(t).toContain('☐');
    expect(t).not.toMatch(/\{[a-z_]+\}/);
    // Aucune ressource externe dans le paquet (relations).
    for (const f of Object.keys(zip.files).filter((n) => n.endsWith('.rels'))) {
      expect(await zip.file(f)!.async('string'), f).not.toMatch(/TargetMode="External"/);
    }
  });

  it('archive : un fichier par lettre, noms uniques et triés par référence', async () => {
    const c = contexte();
    const lettres = liste.clients.slice(0, 3).map((d) => composerLettre(d, c));
    lettres.push({ ...lettres[0]!, ref: lettres[0]!.ref }); // doublon de nom
    const zip = await JSZip.loadAsync(await archiveLettres(D, lettres));
    const noms = Object.keys(zip.files);
    expect(noms).toHaveLength(4);
    expect(noms[0]).toBe(lettres[0]!.nomFichier);
    expect(noms[3]).toBe(lettres[0]!.nomFichier.replace('.docx', ' (2).docx'));
    const t = await texteDocx(await zip.file(noms[1]!)!.async('uint8array'));
    expect(t).toContain(lettres[1]!.destinataire);
  });
});

let soffice = false;
try {
  execFileSync('soffice', ['--version'], { stdio: 'ignore' });
  soffice = true;
} catch {
  /* LibreOffice absent : test de conversion ignoré */
}

describe.skipIf(!soffice)('ouverture par un traitement de texte (LibreOffice)', () => {
  it('le document unique se convertit en PDF', { timeout: 180_000 }, async () => {
    const c = contexte();
    c.modeles.modeles.clients.soldeIndique = true;
    const lettres = [...liste.banques.slice(0, 1), ...liste.clients.slice(0, 2), ...liste.fournisseurs.slice(0, 1)].map((d) => composerLettre(d, c));
    const dossier = mkdtempSync(join(tmpdir(), 'courriers-'));
    try {
      writeFileSync(join(dossier, 'lettres.docx'), await docxLettres(D, lettres, 'Lettres'));
      execFileSync('soffice', ['--headless', `-env:UserInstallation=file://${dossier}/profil`, '--convert-to', 'pdf', '--outdir', dossier, join(dossier, 'lettres.docx')], { stdio: 'ignore', timeout: 170_000 });
      expect(readdirSync(dossier)).toContain('lettres.pdf');
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });
});
