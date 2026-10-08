/**
 * Écran « Analyse de FEC » : dossiers, dépôt du FEC N (et N-1 facultatif), import dans un Web Worker
 * avec progression et annulation, assistant de correspondance, résumé, conformité et rapport.
 * Tout reste dans le navigateur : le fichier n'est lu que localement et stocké dans IndexedDB.
 */
import { h } from '../../../app/dom.ts';
import { lirePreference, ecrirePreference } from '../../../core/stockage.ts';
import { controlerColonnes } from '../conformite/controles.ts';
import { chargerExcelJS, octetsClasseur } from '../export/xlsx.ts';
import { classeurRapport } from '../export/rapport-conformite.ts';
import { lancerImport, type ImportEnCours } from '../import/client-import.ts';
import type { Encodage } from '../import/decodage.ts';
import { tousLesConstats, type CorrespondanceRequise, type OptionsImport } from '../import/pipeline.ts';
import {
  creerDossier,
  enregistrerProfil,
  lireColonnes,
  lireImport,
  listerDossiers,
  mettreAJourImport,
  modifierDossier,
  purgerDossier,
  toutPurger,
  trouverProfil,
  type Dossier,
  type ImportEnregistre,
  type Role,
} from '../stockage/base-fec.ts';
import { LIBELLES_REGIME, type Regime } from '../zones.ts';
import { rendreAssistant } from './assistant.ts';
import { bouton, dateFr, nombreFr, octetsFr, telecharger, TYPE_XLSX } from './commun.ts';
import { rendreRapport } from './rapport.ts';
import { rendreResume } from './resume.ts';

const PREF_DOSSIER = 'fec-dossier-actif';

type EtatEmplacement =
  | { type: 'vide'; erreur?: string }
  | { type: 'import'; fichier: File; en: ImportEnCours; octets: number; total: number; lignes: number; etape: 'lecture' | 'enregistrement' }
  | { type: 'assistant'; fichier: File; demande: CorrespondanceRequise; options: OptionsAvancees }
  | { type: 'importe'; imp: ImportEnregistre };

interface OptionsAvancees {
  encodage?: Encodage;
  regime?: Regime;
  reconstruireAuxiliaires: boolean;
}

const LIBELLES_ROLE: Record<Role, string> = {
  N: 'FEC de l’exercice (N)',
  'N-1': 'FEC de l’exercice précédent (N-1, facultatif)',
};

export function rendreEcranFec(conteneur: HTMLElement): () => void {
  let dossiers: Dossier[] = [];
  let actif: Dossier | null = null;
  const emplacements: Record<Role, EtatEmplacement> = { N: { type: 'vide' }, 'N-1': { type: 'vide' } };
  let rapport: Role | null = null;
  let detruit = false;
  const annonce = h('p', { class: 'visuellement-masque', role: 'status', 'aria-live': 'polite' });
  const principal = h('div', { class: 'fec-principal' });

  conteneur.replaceChildren(
    h(
      'div',
      { class: 'ecran ecran-fec' },
      h('h1', {}, 'Analyse de FEC'),
      h('p', { class: 'texte-secondaire' }, 'Le fichier est lu et analysé dans votre navigateur. Il n’est jamais envoyé : les données restent sur ce poste.'),
      annonce,
      principal,
    ),
  );

  const dire = (texte: string) => (annonce.textContent = texte);

  async function chargerDossier(d: Dossier | null): Promise<void> {
    actif = d;
    rapport = null;
    ecrirePreference(PREF_DOSSIER, d?.id ?? null);
    for (const role of ['N', 'N-1'] as Role[]) {
      const id = d?.fec[role];
      const imp = id ? await lireImport(id) : null;
      emplacements[role] = imp ? { type: 'importe', imp } : { type: 'vide' };
    }
    rendre();
  }

  async function initialiser(): Promise<void> {
    try {
      dossiers = await listerDossiers();
    } catch (e) {
      principal.replaceChildren(h('p', { class: 'carte message-erreur' }, `Stockage local indisponible : ${e instanceof Error ? e.message : String(e)}. La navigation privée ou une stratégie d’entreprise peut bloquer IndexedDB.`));
      return;
    }
    const prefere = lirePreference(PREF_DOSSIER);
    await chargerDossier(dossiers.find((d) => d.id === prefere) ?? dossiers[0] ?? null);
  }

  // ---- Dossiers ----------------------------------------------------------------------------------
  function barreDossiers(): HTMLElement {
    const select = h(
      'select',
      { id: 'fec-dossier' },
      ...dossiers.map((d) => h('option', { value: d.id, selected: d.id === actif?.id }, `${d.nom}${d.siren ? ` (${d.siren})` : ''}`)),
    );
    select.addEventListener('change', () => void chargerDossier(dossiers.find((d) => d.id === select.value) ?? null));
    const nom = h('input', { id: 'fec-nouveau-dossier', type: 'text', placeholder: 'Nom du client ou du dossier', autocomplete: 'off' });
    const creer = async () => {
      const valeur = nom.value.trim();
      if (!valeur) {
        nom.focus();
        return;
      }
      const d = await creerDossier(valeur);
      dossiers = await listerDossiers();
      dire(`Dossier « ${valeur} » créé.`);
      await chargerDossier(d);
    };
    nom.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void creer();
    });
    return h(
      'section',
      { class: 'carte barre-dossiers', 'aria-label': 'Dossiers' },
      dossiers.length
        ? h('div', { class: 'champ' }, h('label', { for: 'fec-dossier' }, 'Dossier'), select)
        : h('p', {}, 'Créez un dossier pour commencer. Il regroupe le FEC de l’exercice et, si besoin, celui de l’exercice précédent.'),
      h('div', { class: 'champ' }, h('label', { for: 'fec-nouveau-dossier' }, 'Nouveau dossier'), h('div', { class: 'groupe' }, nom, bouton('Créer', () => void creer(), { primaire: !dossiers.length }))),
      h(
        'div',
        { class: 'actions actions-purge' },
        actif
          ? bouton(
              'Purger ce dossier',
              () => {
                if (!actif || !confirm(`Supprimer définitivement le dossier « ${actif.nom} » et ses FEC de ce navigateur ?`)) return;
                void purgerDossier(actif.id).then(async () => {
                  dossiers = await listerDossiers();
                  dire('Dossier purgé.');
                  await chargerDossier(dossiers[0] ?? null);
                });
              },
              { danger: true },
            )
          : null,
        dossiers.length
          ? bouton(
              'Tout purger',
              () => {
                if (!confirm('Supprimer définitivement TOUS les dossiers, FEC et profils d’import de ce navigateur ?')) return;
                void toutPurger().then(async () => {
                  dossiers = [];
                  dire('Toutes les données locales du module FEC ont été supprimées.');
                  await chargerDossier(null);
                });
              },
              { danger: true },
            )
          : null,
      ),
    );
  }

  // ---- Import ------------------------------------------------------------------------------------
  async function importer(role: Role, fichier: File, options: OptionsAvancees, complement: Partial<OptionsImport> = {}): Promise<void> {
    if (!actif) return;
    const dossier = actif;
    const en = lancerImport(
      fichier,
      { dossierId: dossier.id, role },
      { encodage: options.encodage, regime: options.regime, reconstruireAuxiliaires: options.reconstruireAuxiliaires, ...complement },
      (octets, total, lignes, etape) => {
        const e = emplacements[role];
        if (e.type !== 'import') return;
        Object.assign(e, { octets, total, lignes, etape });
        majProgression(role);
      },
    );
    emplacements[role] = { type: 'import', fichier, en, octets: 0, total: fichier.size, lignes: 0, etape: 'lecture' };
    rendre();
    dire(`Import de ${fichier.name} en cours.`);
    try {
      const r = await en.resultat;
      if (detruit) return;
      if (r.statut === 'annule') {
        emplacements[role] = { type: 'vide' };
        dire('Import annulé.');
      } else if (r.statut === 'correspondance-requise') {
        const signature = r.signatureEntete ?? `#sans-entete#${r.entetes.length}`;
        const profil = complement.correspondance ? null : await trouverProfil(signature);
        if (profil) {
          dire(`Profil d’import « ${profil.nom} » appliqué.`);
          await importer(role, fichier, { ...options, regime: options.regime ?? profil.regime ?? undefined }, { correspondance: profil.correspondance, sansEntete: profil.sansEntete });
          return;
        }
        emplacements[role] = { type: 'assistant', fichier, demande: r, options };
        dire('Correspondance des colonnes requise.');
      } else {
        dossiers = await listerDossiers();
        actif = dossiers.find((d) => d.id === dossier.id) ?? actif;
        emplacements[role] = { type: 'importe', imp: r.imp };
        dire(`Import terminé : ${nombreFr(r.imp.meta.nbLignes)} lignes.`);
      }
    } catch (e) {
      emplacements[role] = { type: 'vide', erreur: `Import impossible : ${e instanceof Error ? e.message : String(e)}` };
    }
    rendre();
  }

  function majProgression(role: Role): void {
    const e = emplacements[role];
    if (e.type !== 'import') return;
    const barre = principal.querySelector<HTMLProgressElement>(`#progression-${role}`);
    const texte = principal.querySelector<HTMLElement>(`#progression-texte-${role}`);
    if (barre) barre.value = e.total ? e.octets / e.total : 0;
    if (texte) {
      texte.textContent =
        e.etape === 'enregistrement'
          ? `${nombreFr(e.lignes)} lignes lues · enregistrement local du dossier…`
          : `${octetsFr(e.octets)} sur ${octetsFr(e.total)} · ${nombreFr(e.lignes)} lignes lues`;
    }
  }

  function zoneDepot(role: Role, erreur?: string): HTMLElement {
    const id = `fichier-${role}`;
    const entree = h('input', { id, type: 'file', class: 'visuellement-masque', accept: '.txt,.csv,.xml,.tsv,.dat,text/plain,application/xml,text/xml' });
    const encodage = h(
      'select',
      { id: `encodage-${role}` },
      h('option', { value: '' }, 'Détection automatique'),
      h('option', { value: 'utf-8' }, 'UTF-8'),
      h('option', { value: 'iso-8859-15' }, 'ISO-8859-15'),
      h('option', { value: 'windows-1252' }, 'Windows-1252'),
    );
    const regime = h(
      'select',
      { id: `regime-${role}` },
      h('option', { value: '' }, 'Détection automatique (BIC/IS par défaut)'),
      ...(Object.keys(LIBELLES_REGIME) as Regime[]).map((r) => h('option', { value: r }, LIBELLES_REGIME[r])),
    );
    const reconstruire = h('input', { type: 'checkbox', id: `reconstruire-${role}`, checked: true });
    const options = (): OptionsAvancees => ({
      encodage: (encodage.value || undefined) as Encodage | undefined,
      regime: (regime.value || undefined) as Regime | undefined,
      reconstruireAuxiliaires: reconstruire.checked,
    });
    const lancer = (f: File | undefined) => {
      if (f) void importer(role, f, options());
    };
    entree.addEventListener('change', () => lancer(entree.files?.[0]));
    const zone = h(
      'label',
      { for: id, class: 'zone-depot' },
      h('span', { class: 'zone-depot-titre' }, 'Déposez le FEC ici'),
      h('span', { class: 'texte-secondaire' }, 'ou cliquez pour choisir le fichier (texte ou XML, tout logiciel comptable)'),
    );
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('survol');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('survol'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('survol');
      lancer(e.dataTransfer?.files[0]);
    });
    return h(
      'div',
      {},
      erreur ? h('p', { class: 'message-erreur', role: 'alert' }, erreur) : null,
      entree,
      zone,
      h(
        'details',
        { class: 'options-avancees' },
        h('summary', {}, 'Options de lecture'),
        h(
          'div',
          { class: 'ligne-champs' },
          h('div', { class: 'champ' }, h('label', { for: encodage.id }, 'Encodage'), encodage),
          h('div', { class: 'champ' }, h('label', { for: regime.id }, 'Régime'), regime),
          h('div', { class: 'champ champ-case' }, reconstruire, h('label', { for: reconstruire.id }, 'Reconstruire les auxiliaires intégrés au numéro de compte (411DUPONT)')),
        ),
      ),
    );
  }

  // ---- Conformité --------------------------------------------------------------------------------
  async function exporterRapport(imp: ImportEnregistre): Promise<void> {
    dire('Préparation du rapport Excel…');
    const [ExcelJS, colonnes] = await Promise.all([chargerExcelJS(), lireColonnes(imp.id)]);
    if (!colonnes) throw new Error('Données du FEC introuvables');
    const r = imp.reglages;
    const classeur = classeurRapport(ExcelJS, tousLesConstats(imp), colonnes, {
      dossier: actif?.nom ?? '',
      siren: r.siren,
      exercice: `du ${dateFr(r.debut)} au ${dateFr(r.fin)}`,
      fichier: imp.meta.nomFichier,
      empreinte: imp.meta.empreinte,
      version: __APP_VERSION__,
    });
    const nom = `Conformite_${imp.meta.nomFichier.replace(/\.[^.]+$/, '')}.xlsx`;
    telecharger(await octetsClasseur(classeur), nom, TYPE_XLSX);
    dire('Rapport exporté.');
  }

  async function enregistrerReglages(role: Role, imp: ImportEnregistre, reglages: ImportEnregistre['reglages']): Promise<void> {
    let constatsEcritures = imp.constatsEcritures;
    const changeControle = reglages.debut !== imp.reglages.debut || reglages.fin !== imp.reglages.fin || reglages.journalAN !== imp.reglages.journalAN;
    if (changeControle && reglages.debut && reglages.fin) {
      const colonnes = await lireColonnes(imp.id);
      if (colonnes) {
        const j = imp.meta.journaux.find((x) => x.code === reglages.journalAN);
        constatsEcritures = controlerColonnes(colonnes, {
          debut: reglages.debut,
          fin: reglages.fin,
          journalAN: j ? { code: j.code, libelle: j.libelle, methode: imp.meta.journalAN?.code === j.code ? imp.meta.journalAN.methode : 'code' } : null,
          xml: imp.meta.format === 'xml',
        });
      }
    }
    const maj = await mettreAJourImport(imp.id, { reglages, constatsEcritures });
    if (actif && reglages.siren !== actif.siren && role === 'N') actif = await modifierDossier(actif.id, { siren: reglages.siren });
    dossiers = await listerDossiers();
    emplacements[role] = { type: 'importe', imp: maj };
    dire('Modifications enregistrées.');
    rendre();
  }

  // ---- Rendu -------------------------------------------------------------------------------------
  function emplacement(role: Role): HTMLElement {
    const e = emplacements[role];
    let contenu: HTMLElement;
    if (e.type === 'vide') contenu = zoneDepot(role, e.erreur);
    else if (e.type === 'import') {
      contenu = h(
        'div',
        { class: 'progression' },
        h('p', {}, `Lecture de ${e.fichier.name}…`),
        h('progress', { id: `progression-${role}`, max: '1', value: String(e.total ? e.octets / e.total : 0), 'aria-label': 'Progression de l’import' }),
        h('p', { id: `progression-texte-${role}`, class: 'note texte-secondaire' }, 'Démarrage…'),
        bouton('Annuler', () => e.en.annuler()),
      );
    } else if (e.type === 'assistant') {
      contenu = rendreAssistant(
        e.demande,
        e.fichier.name,
        (choix) => {
          const signature = e.demande.signatureEntete ?? `#sans-entete#${e.demande.entetes.length}`;
          const suite = () =>
            void importer(role, e.fichier, { ...e.options, regime: choix.regime ?? e.options.regime }, { correspondance: choix.correspondance, sansEntete: choix.sansEntete });
          if (choix.profil) {
            void enregistrerProfil({ signature, nom: choix.profil, correspondance: choix.correspondance, regime: choix.regime ?? null, sansEntete: choix.sansEntete }).then(suite);
          } else suite();
        },
        () => {
          emplacements[role] = { type: 'vide' };
          rendre();
        },
      );
    } else {
      const imp = e.imp;
      contenu = rendreResume(imp, {
        enregistrerReglages: (r) => enregistrerReglages(role, imp, r),
        voirRapport: () => {
          rapport = role;
          rendre();
        },
        exporterRapport: () => void exporterRapport(imp).catch((err) => dire(String(err))),
        remplacer: () => {
          emplacements[role] = { type: 'vide' };
          rendre();
        },
        accepterNonConformites: () => void enregistrerReglages(role, imp, { ...imp.reglages, nonConformitesAcceptees: true }),
      });
    }
    return h('section', { class: 'carte emplacement', 'aria-labelledby': `titre-${role}` }, h('h2', { id: `titre-${role}` }, LIBELLES_ROLE[role]), contenu);
  }

  function rendre(): void {
    if (detruit) return;
    if (rapport) {
      const e = emplacements[rapport];
      if (e.type === 'importe') {
        principal.replaceChildren(
          rendreRapport(tousLesConstats(e.imp), e.imp.meta.nomFichier, {
            exporter: () => void exporterRapport(e.imp).catch((err) => dire(String(err))),
            retour: () => {
              rapport = null;
              rendre();
            },
          }),
        );
        return;
      }
      rapport = null;
    }
    const enfants: HTMLElement[] = [barreDossiers()];
    if (actif) {
      enfants.push(emplacement('N'), emplacement('N-1'));
      const n = emplacements.N;
      if (n.type === 'importe') {
        enfants.push(
          h(
            'section',
            { class: 'carte' },
            h('h2', {}, 'Analyses'),
            h('p', { class: 'texte-secondaire' }, 'Balances, grand-livre et statistiques d’écritures : étape 6.'),
          ),
        );
      }
    }
    principal.replaceChildren(...enfants);
    for (const role of ['N', 'N-1'] as Role[]) majProgression(role);
  }

  void initialiser();
  return () => {
    detruit = true;
    for (const e of Object.values(emplacements)) if (e.type === 'import') e.en.annuler();
  };
}
