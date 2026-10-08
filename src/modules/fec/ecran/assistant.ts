/**
 * Assistant de correspondance des colonnes : ouvert quand une zone indispensable reste introuvable
 * (ou en l'absence d'en-tête). La correspondance validée peut être mémorisée comme « profil d'import »
 * réutilisé automatiquement pour les FEC suivants du même logiciel.
 */
import { h } from '../../../app/dom.ts';
import type { Correspondance } from '../import/colonnes-entete.ts';
import type { CorrespondanceRequise } from '../import/pipeline.ts';
import { LIBELLES_REGIME, TOUTES_ZONES, type Regime, type Zone } from '../zones.ts';
import { bouton } from './commun.ts';

export interface ChoixAssistant {
  correspondance: Correspondance;
  regime: Regime | undefined;
  sansEntete: boolean;
  profil: string | null;
}

const INDISPENSABLES_DC: Zone[] = ['EcritureNum', 'EcritureDate', 'CompteNum', 'Debit', 'Credit'];
const INDISPENSABLES_MS: Zone[] = ['EcritureNum', 'EcritureDate', 'CompteNum', 'Montant', 'Sens'];

/** Vérifie une correspondance : renvoie le message d'erreur, ou null si elle est utilisable. */
export function verifierCorrespondance(c: Correspondance): string | null {
  const zones = Object.values(c).filter((z): z is Zone => z !== null);
  const doublons = zones.filter((z, i) => zones.indexOf(z) !== i);
  if (doublons.length) return `Zone attribuée à plusieurs colonnes : ${[...new Set(doublons)].join(', ')}.`;
  const ok = (liste: Zone[]) => liste.every((z) => zones.includes(z));
  if (!ok(INDISPENSABLES_DC) && !ok(INDISPENSABLES_MS)) {
    const manquantes = INDISPENSABLES_DC.filter((z) => !zones.includes(z));
    return `Zones indispensables non attribuées : ${manquantes.join(', ')} (ou Montant et Sens à la place de Debit et Credit).`;
  }
  return null;
}

export function rendreAssistant(
  demande: CorrespondanceRequise,
  nomFichier: string,
  surValidation: (choix: ChoixAssistant) => void,
  surAnnulation: () => void,
): HTMLElement {
  if (demande.entetes.length === 0) {
    return h(
      'section',
      { class: 'carte assistant', 'aria-labelledby': 'titre-assistant' },
      h('h3', { id: 'titre-assistant' }, 'Structure non reconnue'),
      h('p', {}, `Aucun séparateur de zones (tabulation, « | », point-virgule, virgule) ne découpe « ${nomFichier} » en au moins 9 colonnes régulières. Vérifiez qu'il s'agit bien d'un FEC.`),
      h('pre', { class: 'apercu-brut' }, demande.apercu.map((l) => l[0]).join('\n')),
      bouton('Fermer', surAnnulation),
    );
  }
  const correspondance: Correspondance = { ...demande.proposition };
  const message = h('p', { class: 'message-erreur', role: 'alert' });
  const selects = demande.entetes.map((nom, rang) => {
    const id = `assistant-col-${rang}`;
    const select = h(
      'select',
      { id },
      h('option', { value: '' }, '— Ignorer —'),
      ...TOUTES_ZONES.map((z) => h('option', { value: z, selected: correspondance[rang] === z }, z)),
    );
    select.addEventListener('change', () => {
      correspondance[rang] = (select.value || null) as Zone | null;
      message.textContent = '';
    });
    return h('th', { scope: 'col' }, h('label', { for: id, class: 'entete-colonne' }, nom || `(colonne ${rang + 1})`), select);
  });
  const regime = h(
    'select',
    { id: 'assistant-regime' },
    h('option', { value: '' }, 'Détection automatique'),
    ...(Object.keys(LIBELLES_REGIME) as Regime[]).map((r) => h('option', { value: r }, LIBELLES_REGIME[r])),
  );
  const memoriser = h('input', { type: 'checkbox', id: 'assistant-memoriser', checked: true });
  const nomProfil = h('input', { type: 'text', id: 'assistant-profil', placeholder: 'ex. : export du logiciel X', autocomplete: 'off' });

  return h(
    'section',
    { class: 'carte assistant', 'aria-labelledby': 'titre-assistant' },
    h('h3', { id: 'titre-assistant' }, 'Correspondance des colonnes'),
    h(
      'p',
      {},
      demande.sansEntete
        ? 'La première ligne ne contient pas les noms des zones du FEC. Indiquez la zone de chaque colonne.'
        : `Zones indispensables introuvables : ${demande.manquantes.join(', ')}. Indiquez la zone de chaque colonne (aperçu des 20 premières lignes).`,
    ),
    h(
      'div',
      { class: 'tableau-defilant', tabindex: '0', role: 'region', 'aria-label': 'Aperçu du fichier' },
      h(
        'table',
        { class: 'tableau tableau-apercu' },
        h('thead', {}, h('tr', {}, ...selects)),
        h('tbody', {}, ...demande.apercu.map((l) => h('tr', {}, ...demande.entetes.map((_, i) => h('td', {}, l[i] ?? ''))))),
      ),
    ),
    h(
      'div',
      { class: 'ligne-champs' },
      h('div', { class: 'champ' }, h('label', { for: 'assistant-regime' }, 'Régime'), regime),
      h('div', { class: 'champ' }, h('label', { for: 'assistant-profil' }, 'Nom du profil d’import'), nomProfil),
      h('div', { class: 'champ champ-case' }, memoriser, h('label', { for: 'assistant-memoriser' }, 'Mémoriser pour les prochains FEC de ce logiciel (sur ce poste)')),
    ),
    message,
    h(
      'div',
      { class: 'actions' },
      bouton(
        'Valider et importer',
        () => {
          const erreur = verifierCorrespondance(correspondance);
          if (erreur) {
            message.textContent = erreur;
            return;
          }
          surValidation({
            correspondance,
            regime: (regime.value || undefined) as Regime | undefined,
            sansEntete: demande.sansEntete,
            profil: memoriser.checked ? nomProfil.value.trim() || 'Profil sans nom' : null,
          });
        },
        { primaire: true },
      ),
      bouton('Annuler', surAnnulation),
    ),
  );
}
