/**
 * Carte de résumé d'un FEC importé : caractéristiques détectées, métadonnées modifiables
 * (SIREN, clôture, exercice, journal d'à-nouveaux), indicateur de conformité.
 */
import { h } from '../../../app/dom.ts';
import { compterParGravite } from '../conformite/constats.ts';
import { LIBELLES_ENCODAGE } from '../import/decodage.ts';
import { LIBELLES_SEPARATEUR } from '../import/lecture-plate.ts';
import { tousLesConstats } from '../import/pipeline.ts';
import type { ImportEnregistre, Reglages } from '../stockage/base-fec.ts';
import { LIBELLES_REGIME } from '../zones.ts';
import { bouton, dateFr, indicateurConformite, nombreFr, octetsFr } from './commun.ts';

export interface ActionsResume {
  enregistrerReglages(r: Reglages): Promise<void>;
  voirRapport(): void;
  exporterRapport(): void;
  remplacer(): void;
  accepterNonConformites(): void;
}

function ligne(terme: string, ...valeur: (Node | string)[]): HTMLElement[] {
  return [h('dt', {}, terme), h('dd', {}, ...valeur)];
}

const METHODES_AN: Record<string, string> = {
  code: 'reconnu par son code',
  'libelle-journal': 'reconnu par son libellé',
  'libelle-ecritures': 'reconnu par les libellés des écritures du premier jour',
};

export function rendreResume(imp: ImportEnregistre, actions: ActionsResume): HTMLElement {
  const m = imp.meta;
  const r = imp.reglages;
  const constats = tousLesConstats(imp);
  const nonConformes = compterParGravite(constats)['non-conforme'];
  const variante = `${LIBELLES_REGIME[m.regime]}, ${m.presentation === 'montant-sens' ? 'Montant / Sens' : 'Debit / Credit'}`;

  const champ = (id: string, libelle: string, controle: HTMLElement) =>
    h('div', { class: 'champ' }, h('label', { for: id }, libelle), controle);
  const siren = h('input', { id: `siren-${imp.id}`, type: 'text', inputmode: 'numeric', maxlength: '9', value: r.siren ?? '', autocomplete: 'off' });
  const cloture = h('input', { id: `cloture-${imp.id}`, type: 'date', value: r.cloture ?? '' });
  const debut = h('input', { id: `debut-${imp.id}`, type: 'date', value: r.debut ?? '' });
  const fin = h('input', { id: `fin-${imp.id}`, type: 'date', value: r.fin ?? '' });
  const journal = h(
    'select',
    { id: `an-${imp.id}` },
    h('option', { value: '' }, 'Aucun (pas d’à-nouveaux)'),
    ...m.journaux.map((j) => h('option', { value: j.code, selected: j.code === r.journalAN }, `${j.code} — ${j.libelle} (${nombreFr(j.lignes)} lignes)`)),
  );
  const etat = h('p', { class: 'note', role: 'status', 'aria-live': 'polite' });
  const enregistrer = async (confirmerAN: boolean) => {
    etat.textContent = 'Recalcul des contrôles…';
    try {
      await actions.enregistrerReglages({
        ...r,
        siren: siren.value.trim() || null,
        cloture: cloture.value || null,
        debut: debut.value || null,
        fin: fin.value || null,
        journalAN: journal.value || null,
        journalANConfirme: confirmerAN || (r.journalANConfirme && journal.value === (r.journalAN ?? '')),
      });
    } catch (e) {
      etat.textContent = e instanceof Error ? e.message : String(e);
    }
  };

  const anAConfirmer = !r.journalANConfirme;
  return h(
    'div',
    { class: 'resume' },
    h(
      'dl',
      { class: 'grille-resume' },
      ...ligne('Fichier', m.nomFichier, h('span', { class: 'texte-secondaire' }, ` · ${octetsFr(m.taille)}`)),
      ...ligne('Format', m.format === 'xml' ? `XML${m.schemaXml ? ` (${m.schemaXml})` : ''}` : 'Fichier à plat'),
      ...ligne('Encodage', `${LIBELLES_ENCODAGE[m.encodage]}${m.bom ? ' avec BOM' : ''}`),
      ...(m.format === 'plat'
        ? ligne('Séparateur', `${m.separateur ? LIBELLES_SEPARATEUR[m.separateur] : '—'}${m.guillemets ? ', zones entre guillemets' : ''}, fins de ligne ${m.finLigne}`)
        : []),
      ...ligne('Variante', variante),
      ...ligne('Lignes / écritures', `${nombreFr(m.nbLignes)} lignes, ${nombreFr(m.nbEcritures)} écritures (numérotation ${m.modeNumerotation === 'globale' ? 'globale' : 'par journal'})`),
      ...ligne('Période des écritures', m.periode ? `du ${dateFr(m.periode.premiere)} au ${dateFr(m.periode.derniere)}` : '—'),
      ...ligne('Empreinte SHA-256', h('code', { class: 'empreinte' }, m.empreinte)),
      ...ligne('Durée de l’import', `${(m.dureeMs / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s`),
    ),
    h(
      'fieldset',
      { class: 'reglages' },
      h('legend', {}, 'Dossier et exercice (modifiables)'),
      h(
        'div',
        { class: 'ligne-champs' },
        champ(siren.id, `SIREN${m.siren ? '' : ' (absent du nom de fichier)'}${m.siren && !m.sirenValide ? ' — clé de contrôle invalide' : ''}`, siren),
        champ(cloture.id, 'Date de clôture', cloture),
        champ(debut.id, 'Début d’exercice', debut),
        champ(fin.id, 'Fin d’exercice', fin),
      ),
      h(
        'div',
        { class: 'ligne-champs' },
        champ(journal.id, `Journal d’à-nouveaux${m.journalAN ? ` (${METHODES_AN[m.journalAN.methode]})` : ' (non détecté)'}`, journal),
        anAConfirmer ? h('span', { class: 'badge badge-gravite-anomalie' }, 'À confirmer') : h('span', { class: 'badge badge-etat-ok' }, 'Confirmé'),
      ),
      h(
        'div',
        { class: 'actions' },
        anAConfirmer ? bouton('Confirmer le journal d’à-nouveaux', () => void enregistrer(true), { primaire: true }) : null,
        bouton('Enregistrer les modifications', () => void enregistrer(false)),
      ),
      etat,
    ),
    h('h4', {}, 'Conformité'),
    indicateurConformite(constats),
    nonConformes > 0 && !r.nonConformitesAcceptees
      ? h(
          'div',
          { class: 'bandeau bandeau-alerte', role: 'alert' },
          h('p', {}, `Ce FEC présente ${nombreFr(nonConformes)} non-conformité(s) : l’outil officiel Test Compta Demat le déclarerait non conforme. L’analyse reste possible.`),
          bouton('J’ai compris, continuer l’analyse', actions.accepterNonConformites, { primaire: true }),
        )
      : null,
    h(
      'div',
      { class: 'actions' },
      bouton('Rapport détaillé', actions.voirRapport),
      bouton('Exporter le rapport (.xlsx)', actions.exporterRapport),
      bouton('Remplacer le fichier', actions.remplacer),
    ),
  );
}
