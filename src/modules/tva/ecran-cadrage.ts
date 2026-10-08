/**
 * Écran du cadrage de TVA (parties 3 à 5) : synthèse de l'écart, contrôle de la TVA collectée (G340) avec
 * taux et soldes N-1 modifiables, cadrage par période et contrôles complémentaires, justification de
 * l'écart, paramètres du dossier, détail des écritures du FEC derrière chaque montant, export Excel.
 * Les données viennent du module FEC (interface-tva) et des CA3 du dossier ; tout reste sur le poste.
 */
import { h } from '../../app/dom.ts';
import { formaterMontant } from '../../core/format.ts';
import { ecrirePreference, lirePreference } from '../../core/stockage.ts';
import { bouton, dateFr, nombreFr, telecharger, TYPE_XLSX } from '../fec/ecran/commun.ts';
import { chargerExcelJS, octetsClasseur } from '../fec/export/xlsx.ts';
import { chargerDonneesTva, type DonneesTvaFec, type FiltreLignes } from '../fec/interface-tva.ts';
import type { Dossier } from '../fec/stockage/base-fec.ts';
import { libellePeriode } from './ca3/declaration.ts';
import { assemblerCadrage, type Cadrage } from './cadrage/cadrage.ts';
import type { LigneVente, Regularisation } from './cadrage/g340.ts';
import {
  CATEGORIES_ENCOURS,
  EXEMPLES_JUSTIFICATION,
  LIBELLES_ENCOURS,
  LIBELLES_NATURES,
  parametresParDefaut,
  type CategorieEncours,
  type Nature,
  type ParametresCadrage,
  type Regime,
} from './cadrage/parametres.ts';
import { classeurCadrageTva } from './export/classeur-tva.ts';
import type { DonneesTva } from './stockage.ts';

const PREF_COLLABORATEUR = 'tva-collaborateur';
type Onglet = 'g340' | 'mensuel' | 'justification' | 'parametres';
const ONGLETS: { id: Onglet; libelle: string }[] = [
  { id: 'g340', libelle: 'TVA collectée (G340)' },
  { id: 'mensuel', libelle: 'Cadrage par période' },
  { id: 'justification', libelle: 'Justification de l’écart' },
  { id: 'parametres', libelle: 'Paramètres' },
];

const signe = (c: number) => (c < 0 ? `−${formaterMontant(-c)}` : formaterMontant(c));
const taux = (bp: number | null) => (bp ? `${(bp / 100).toLocaleString('fr-FR')} %` : '—');
const versCentimes = (texte: string): number | null | undefined => {
  const t = texte.replace(/[\s  ]/g, '').replace('−', '-').replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) : undefined;
};
const prefixes = (texte: string) =>
  texte
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter((x) => /^\d+$/.test(x));

export interface EcranCadrage {
  /** Les déclarations ont changé (dépôt, correction, saisie) : recalcul. */
  maj(): void;
  detruire(): void;
}

export function rendreCadrage(zone: HTMLElement, dossier: Dossier, donnees: () => DonneesTva | null, sauver: () => Promise<void>, dire: (t: string) => void): EcranCadrage {
  let detruit = false;
  let fec: DonneesTvaFec | null = null;
  let fecN1: DonneesTvaFec | null = null;
  let cadrage: Cadrage | null = null;
  let actif: Onglet = 'g340';
  const synthese = h('div');
  const onglets = h('div', { class: 'onglets', role: 'tablist', 'aria-label': 'Cadrage de TVA' });
  const panneau = h('div', { role: 'tabpanel', id: 'panneau-cadrage' });
  const dialogue = h('dialog', { class: 'dialogue-ecriture dialogue-tva', 'aria-labelledby': 'titre-detail-tva' }) as HTMLDialogElement;

  const parametres = (): ParametresCadrage => donnees()!.parametres!;
  const enregistrer = () => {
    void sauver();
    recalculer();
  };

  function recalculer(): void {
    const d = donnees();
    if (!fec || !d) return;
    cadrage = assemblerCadrage(fec, fecN1, d.declarations, parametres());
    rendreSynthese();
    rendrePanneau();
  }

  // ---- Détail des écritures -------------------------------------------------------------------------
  function detail(titre: string, filtre: FiltreLignes, source: DonneesTvaFec | null = fec): void {
    if (!source) return;
    const { lignes, total } = source.lignes(filtre, 2000);
    const somme = lignes.reduce((s, l) => s + l.debit - l.credit, 0);
    dialogue.replaceChildren(
      h('h3', { id: 'titre-detail-tva' }, titre),
      h('p', { class: 'note texte-secondaire' }, `${nombreFr(total)} ligne(s) du FEC (comptes ${filtre.comptes.join(', ')}${filtre.mois ? `, ${filtre.mois.slice(5)}/${filtre.mois.slice(0, 4)}` : ''}${filtre.aNouveaux ? ', à-nouveaux compris' : ''}${filtre.sens ? `, ${filtre.sens === 'credit' ? 'au crédit' : 'au débit'}` : ''})${total > lignes.length ? ` : ${nombreFr(lignes.length)} premières affichées` : ''} ; solde des lignes affichées : ${signe(somme)} €.`),
      h(
        'div',
        { class: 'tableau-defilant tableau-hauteur', tabindex: '0', role: 'region', 'aria-label': 'Écritures' },
        h(
          'table',
          { class: 'tableau tableau-compact' },
          h('thead', {}, h('tr', {}, ...['Date', 'Journal', 'N°', 'Pièce', 'Libellé', 'Compte', 'Tiers', 'Débit', 'Crédit'].map((x, k) => h('th', { scope: 'col', class: k >= 7 ? 'nombre' : undefined }, x)))),
          h(
            'tbody',
            {},
            ...lignes.map((l) =>
              h(
                'tr',
                { title: `Ligne ${l.ligneOrigine} du fichier` },
                h('td', {}, l.aNouveau ? `${dateFr(l.date)} (AN)` : dateFr(l.date)),
                h('td', {}, l.journal),
                h('td', {}, l.ecritureNum),
                h('td', {}, l.pieceRef),
                h('td', {}, l.libelle),
                h('td', { class: 'mono' }, l.compteNum),
                h('td', { class: 'mono' }, l.compAuxNum),
                h('td', { class: 'nombre montant' }, l.debit ? formaterMontant(l.debit) : ''),
                h('td', { class: 'nombre montant' }, l.credit ? formaterMontant(l.credit) : ''),
              ),
            ),
          ),
        ),
      ),
      h('div', { class: 'actions' }, bouton('Fermer', () => dialogue.close(), { primaire: true })),
    );
    dialogue.showModal();
  }

  const lien = (montant: number, titre: string, filtre: FiltreLignes, source: DonneesTvaFec | null = fec) => {
    const b = h('button', { type: 'button', class: 'lien-montant', title: 'Voir les écritures du FEC' }, signe(montant));
    b.addEventListener('click', () => detail(titre, filtre, source));
    return b;
  };

  // ---- Synthèse ----------------------------------------------------------------------------------------
  function rendreSynthese(): void {
    if (!cadrage) return;
    const g = cadrage.g340;
    const tuile = (valeur: string, libelle: string, alerte = false) => h('div', { class: 'tuile' }, h('span', { class: `tuile-valeur${alerte ? ' ecart-non-nul' : ''}` }, valeur), h('span', { class: 'tuile-libelle' }, libelle));
    synthese.replaceChildren(
      h(
        'div',
        { class: 'tuiles tuiles-montants', role: 'group', 'aria-label': 'Synthèse du cadrage' },
        tuile(`${signe(g.tvaTheorique)} €`, 'TVA collectée théorique (FEC)'),
        tuile(`${signe(g.tvaDeclaree)} €`, `TVA collectée déclarée (${cadrage.retenues.length} CA3)`),
        tuile(`${signe(g.ecart)} €`, 'Écart (théorique − déclarée)'),
        tuile(`${signe(g.justifie)} €`, 'Justifié'),
        tuile(`${signe(g.residuel)} €`, 'Écart résiduel non justifié', g.residuel !== 0),
      ),
      h(
        'p',
        { class: `bandeau ${g.residuel !== 0 ? 'bandeau-alerte' : 'bandeau-succes'}`, role: 'status' },
        g.ecart === 0
          ? 'Aucun écart entre la TVA collectée théorique et la TVA collectée déclarée.'
          : g.residuel === 0
            ? `Écart de ${signe(g.ecart)} €, entièrement justifié.`
            : `Écart de ${signe(g.ecart)} €, dont ${signe(g.justifie)} € justifiés : écart résiduel non justifié de ${signe(g.residuel)} €.`,
      ),
      h(
        'div',
        { class: 'actions' },
        bouton('Exporter la feuille de travail (.xlsx)', () => void exporter(), { primaire: true }),
        h('span', { class: 'note texte-secondaire' }, `FEC ${fec!.metadonnees.nomFichier}, exercice du ${dateFr(cadrage.exercice.debut)} au ${dateFr(cadrage.exercice.fin)}${fecN1 ? ` · FEC N-1 : ${fecN1.metadonnees.nomFichier}` : ''}.`),
      ),
    );
  }

  // ---- G340 ----------------------------------------------------------------------------------------------
  function selectTaux(l: LigneVente): HTMLSelectElement {
    const p = parametres();
    const r = p.comptes[l.compteNum];
    const valeurActuelle = r?.taux !== undefined || r?.nature !== undefined ? (r.nature && r.nature !== 'imposable' ? `n:${r.nature}` : `t:${r.taux ?? 0}`) : 'auto';
    const options: [string, string][] = [
      ['auto', `Proposé (${l.source === 'observe' ? 'observé' : l.source === 'libelle' ? 'libellé' : 'à saisir'})`],
      ...[2000, 1000, 550, 210, 850, 1300].map((t): [string, string] => [`t:${t}`, `${(t / 100).toLocaleString('fr-FR')} %`]),
      ...(['autoliquidation', 'exportation', 'intracom-biens', 'exoneree'] as Nature[]).map((n): [string, string] => [`n:${n}`, LIBELLES_NATURES[n]]),
    ];
    const s = h('select', { 'aria-label': `Taux du compte ${l.compteNum}` }, ...options.map(([v, t]) => h('option', { value: v, selected: v === valeurActuelle }, t)));
    s.addEventListener('change', () => {
      const v = s.value;
      const autre = { ...p.comptes[l.compteNum] };
      delete autre.taux;
      delete autre.nature;
      if (v.startsWith('t:')) Object.assign(autre, { taux: Number(v.slice(2)), nature: 'imposable' });
      else if (v.startsWith('n:')) Object.assign(autre, { taux: null, nature: v.slice(2) as Nature });
      p.comptes[l.compteNum] = autre;
      enregistrer();
      dire(`Taux du compte ${l.compteNum} modifié.`);
    });
    return s;
  }

  function champSoldeN1(r: Regularisation): HTMLElement {
    const p = parametres();
    const cle = r.cle as CategorieEncours;
    const e = h('input', { type: 'text', inputmode: 'decimal', class: 'champ-montant', value: (r.n1 / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 }).replace(/ | /g, ' '), 'aria-label': `${r.libelle} N-1` }) as HTMLInputElement;
    e.addEventListener('change', () => {
      const v = versCentimes(e.value);
      if (v === undefined) {
        dire('Montant invalide.');
        return;
      }
      if (v === null) delete p.soldesN1[cle];
      else p.soldesN1[cle] = { montant: v, source: 'saisie' };
      enregistrer();
      dire(`Solde N-1 « ${r.libelle} » ${v === null ? 'rétabli depuis le FEC' : 'saisi'}.`);
    });
    return h('span', {}, e, h('span', { class: 'badge badge-source' }, r.sourceN1 === 'saisie' ? 'saisi' : r.sourceN1 === 'fec-n1' ? 'FEC N-1' : 'à-nouveaux'));
  }

  function vueG340(): HTMLElement {
    const g = cadrage!.g340;
    const p = parametres();
    const ventes = g.lignes.map((l) =>
      h(
        'tr',
        { title: l.message ?? undefined },
        h('th', { scope: 'row', class: 'mono' }, l.compteNum),
        h('td', {}, l.compteLib, l.message ? h('span', { class: 'note texte-secondaire' }, ` ${l.message}`) : ''),
        h('td', { class: 'nombre montant' }, lien(l.ca, `Chiffre d’affaires — ${l.compteNum}`, { comptes: [l.compteNum] })),
        h('td', { class: 'nombre montant' }, signe(l.exonere)),
        h('td', { class: 'nombre' }, l.pctSoumis === null ? '' : `${(l.pctSoumis * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`),
        h('td', { class: 'nombre montant' }, signe(l.imposable)),
        h('td', {}, selectTaux(l)),
        h('td', { class: 'nombre montant' }, signe(l.tva)),
        h('td', { class: 'mono' }, l.caseCa3 ?? '—'),
      ),
    );
    const regul = g.regularisations.flatMap((r) =>
      r.parTaux.map((x, k) =>
        h(
          'tr',
          {},
          k === 0 ? h('th', { scope: 'row', rowspan: String(r.parTaux.length) }, r.libelle, h('div', { class: 'note texte-secondaire mono' }, r.comptes.join(', '))) : null,
          h('td', {}, taux(x.taux) === '—' ? 'non imposable' : taux(x.taux)),
          h('td', { class: 'nombre montant' }, k === 0 && CATEGORIES_ENCOURS.includes(r.cle as CategorieEncours) ? champSoldeN1(r) : signe(x.n1), k === 0 && r.parTaux.length > 1 ? h('div', { class: 'note texte-secondaire' }, `dont ${signe(x.n1)}`) : ''),
          h('td', { class: 'nombre montant' }, k === 0 ? lien(r.n, `${r.libelle} — N`, { comptes: r.comptes, aNouveaux: r.cle !== 'pertes' && r.cle !== 'autoliquidation', sens: r.cle === 'autoliquidation' ? 'credit' : undefined }) : '', k === 0 && r.parTaux.length > 1 ? h('div', { class: 'note texte-secondaire' }, `dont ${signe(x.n)}`) : k > 0 ? signe(x.n) : ''),
          h('td', { class: 'nombre montant' }, signe(x.tvaN1)),
          h('td', { class: 'nombre montant' }, signe(x.tvaN)),
          h('td', { class: 'nombre montant' }, signe(r.cle === 'pertes' ? -x.tvaN : r.cle === 'autoliquidation' ? x.tvaN : x.tvaN1 - x.tvaN)),
        ),
      ),
    );
    const methode = h('select', { id: 'tva-ventilation' }, h('option', { value: 'prorata', selected: p.ventilation.methode === 'prorata' }, 'Au prorata du CA de chaque taux'), h('option', { value: 'manuelle', selected: p.ventilation.methode === 'manuelle' }, 'Saisie par taux'));
    methode.addEventListener('change', () => {
      p.ventilation.methode = methode.value as 'prorata' | 'manuelle';
      enregistrer();
    });
    return h(
      'div',
      {},
      h('h3', {}, 'Ventes'),
      h('p', { class: 'note texte-secondaire' }, 'Taux proposé dans l’ordre : taux observé dans les écritures de vente (HT du compte rapproché de la TVA des comptes ', p.prefixesTva.join(', '), ' de la même écriture), indice dans le libellé, saisie. Cliquez sur un montant pour voir les écritures.'),
      h(
        'div',
        { class: 'tableau-defilant', tabindex: '0', role: 'region', 'aria-label': 'Ventes' },
        h(
          'table',
          { class: 'tableau tableau-cadrage' },
          h('thead', {}, h('tr', {}, ...['N° de compte', 'Libellé', 'CA HT', 'CA exonéré', '% du CA soumis', 'CA imposable', 'Taux', 'Montant de TVA', 'Case CA3'].map((x, k) => h('th', { scope: 'col', class: [2, 3, 4, 5, 7].includes(k) ? 'nombre' : undefined }, x)))),
          h('tbody', {}, ...ventes),
          h('tfoot', {}, h('tr', { class: 'ligne-solde' }, h('th', { scope: 'row', colspan: '2' }, 'Total'), h('td', { class: 'nombre montant' }, signe(g.caTotal)), h('td'), h('td'), h('td', { class: 'nombre montant' }, signe(g.caImposable)), h('td'), h('td', { class: 'nombre montant' }, signe(g.tvaSurCa)), h('td'))),
        ),
      ),
      h('h3', {}, p.regime === 'debits' ? 'Régularisations (régime des débits)' : 'Régularisations (régime des encaissements)'),
      h('div', { class: 'ligne-champs' }, h('div', { class: 'champ' }, h('label', { for: methode.id }, 'Ventilation des encours par taux'), methode)),
      h('p', { class: 'note texte-secondaire' }, g.ventilation.description, ' TVA comprise = TTC / (1 + taux) × taux ; produits constatés d’avance : HT × taux. Les soldes N-1 sont pré-remplis depuis ', fecN1 ? 'le FEC N-1' : 'les à-nouveaux du FEC', ' et restent modifiables (vider le champ pour revenir à la valeur du FEC).'),
      h(
        'div',
        { class: 'tableau-defilant', tabindex: '0', role: 'region', 'aria-label': 'Régularisations' },
        h(
          'table',
          { class: 'tableau tableau-cadrage' },
          h('thead', {}, h('tr', {}, ...['Nature', 'Taux', 'Montant N-1', 'Montant N', 'TVA N-1', 'TVA N', 'Régularisation'].map((x, k) => h('th', { scope: 'col', class: k >= 2 ? 'nombre' : undefined }, x)))),
          h('tbody', {}, ...regul),
          h('tfoot', {}, h('tr', { class: 'ligne-solde' }, h('th', { scope: 'row', colspan: '6' }, 'Total des régularisations'), h('td', { class: 'nombre montant' }, signe(g.totalRegularisations)))),
        ),
      ),
      p.ventilation.methode === 'manuelle' ? saisieVentilation() : h('span'),
      h('h3', {}, 'Synthèse par taux et rapprochement de la CA3'),
      h(
        'div',
        { class: 'tableau-defilant', tabindex: '0', role: 'region', 'aria-label': 'Synthèse par taux' },
        h(
          'table',
          { class: 'tableau tableau-cadrage' },
          h('thead', {}, h('tr', {}, ...['Taux', 'Case CA3', 'Ventes', 'TVA', 'Régularisations', 'Montant à déclarer', 'Base théorique', 'Base déclarée', 'Taxe déclarée', 'Écart taxe'].map((x, k) => h('th', { scope: 'col', class: k >= 2 ? 'nombre' : undefined }, x)))),
          h(
            'tbody',
            {},
            ...g.syntheseParTaux.map((s) =>
              h(
                'tr',
                {},
                h('th', { scope: 'row' }, s.nature === 'imposable' ? taux(s.taux) : LIBELLES_NATURES[s.nature]),
                h('td', { class: 'mono' }, s.caseCa3 ?? '—'),
                h('td', { class: 'nombre montant' }, signe(s.ventes)),
                h('td', { class: 'nombre montant' }, signe(s.tvaVentes)),
                h('td', { class: 'nombre montant' }, signe(s.regularisations)),
                h('td', { class: 'nombre montant' }, signe(s.aDeclarer)),
                h('td', { class: 'nombre montant' }, signe(s.baseTheorique)),
                h('td', { class: 'nombre montant' }, s.baseDeclaree === null ? '—' : signe(s.baseDeclaree)),
                h('td', { class: 'nombre montant' }, s.taxeDeclaree === null ? '—' : signe(s.taxeDeclaree)),
                h('td', { class: 'nombre montant' }, s.taxeDeclaree === null ? '' : signe(s.aDeclarer - s.taxeDeclaree)),
              ),
            ),
          ),
          h(
            'tfoot',
            {},
            h('tr', { class: 'ligne-solde' }, h('th', { scope: 'row', colspan: '5' }, 'TOTAL TVA collectée théorique'), h('td', { class: 'nombre montant' }, signe(g.tvaTheorique)), h('td', { colspan: '4' })),
            h('tr', { class: 'ligne-solde' }, h('th', { scope: 'row', colspan: '5' }, 'TVA collectée déclarée (G300)'), h('td', { class: 'nombre montant' }, signe(g.tvaDeclaree)), h('td', { colspan: '4' })),
            h('tr', { class: 'ligne-solde' }, h('th', { scope: 'row', colspan: '5' }, 'ÉCART'), h('td', { class: `nombre montant${g.ecart !== 0 ? ' ecart-non-nul' : ''}` }, signe(g.ecart)), h('td', { colspan: '4' })),
          ),
        ),
      ),
    );
  }

  /** Saisie de la ventilation des encours en montants par taux (N-1 et N). */
  function saisieVentilation(): HTMLElement {
    const p = parametres();
    const g = cadrage!.g340;
    const tauxPossibles = [...new Set([...g.syntheseParTaux.map((s) => s.taux ?? 0), 0])].sort((a, b) => b - a);
    const lignes: HTMLElement[] = [];
    for (const r of g.regularisations.filter((x) => CATEGORIES_ENCOURS.includes(x.cle as CategorieEncours) || x.cle === 'pertes')) {
      for (const periode of r.cle === 'pertes' ? (['n'] as const) : (['n1', 'n'] as const)) {
        const cle = `${r.cle}:${periode}`;
        const solde = periode === 'n1' ? r.n1 : r.n;
        lignes.push(
          h(
            'tr',
            {},
            h('th', { scope: 'row' }, `${r.cle === 'pertes' ? 'Pertes' : LIBELLES_ENCOURS[r.cle as CategorieEncours].libelle} ${periode === 'n1' ? 'N-1' : 'N'}`, h('div', { class: 'note texte-secondaire' }, `solde ${signe(solde)} €`)),
            ...tauxPossibles.map((t) => {
              const actuelle = p.ventilation.manuelle[cle]?.[String(t)] ?? r.parTaux.find((x) => x.taux === t)?.[periode === 'n1' ? 'n1' : 'n'] ?? 0;
              const e = h('input', { type: 'text', inputmode: 'decimal', class: 'champ-montant', value: actuelle ? (actuelle / 100).toFixed(2).replace('.', ',') : '', 'aria-label': `${cle} ${t ? taux(t) : 'non imposable'}` }) as HTMLInputElement;
              e.addEventListener('change', () => {
                const v = versCentimes(e.value);
                if (v === undefined) return dire('Montant invalide.');
                const saisie = { ...Object.fromEntries(r.parTaux.map((x) => [String(x.taux), periode === 'n1' ? x.n1 : x.n])), ...(p.ventilation.manuelle[cle] ?? {}) };
                saisie[String(t)] = v ?? 0;
                p.ventilation.manuelle[cle] = saisie;
                enregistrer();
              });
              return h('td', {}, e);
            }),
          ),
        );
      }
    }
    return h(
      'div',
      {},
      h('h4', {}, 'Ventilation saisie (montants par taux)'),
      h('p', { class: 'note texte-secondaire' }, 'Répartissez chaque solde par taux (par exemple d’après la liste des factures ouvertes). Un écart avec le solde est porté au taux principal et signalé.'),
      h('div', { class: 'tableau-defilant', tabindex: '0', role: 'region', 'aria-label': 'Ventilation saisie' }, h('table', { class: 'tableau tableau-cadrage' }, h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Solde'), ...tauxPossibles.map((t) => h('th', { scope: 'col' }, t ? taux(t) : 'Non imposable')))), h('tbody', {}, ...lignes))),
    );
  }

  // ---- Cadrage par période ----------------------------------------------------------------------------
  function vueMensuelle(): HTMLElement {
    const c = cadrage!;
    const p = parametres();
    return h(
      'div',
      {},
      h('p', { class: 'note texte-secondaire' }, 'La CA3 d’une période, déposée le mois suivant, est rapprochée des écritures de la période elle-même. TVA comptabilisée : crédits des comptes 4457 (et 4452 pour la TVA autoliquidée sur achats, déclarée avec la TVA collectée).'),
      h(
        'div',
        { class: 'tableau-defilant', tabindex: '0', role: 'region', 'aria-label': 'Cadrage par période' },
        h(
          'table',
          { class: 'tableau tableau-cadrage' },
          h('thead', {}, h('tr', {}, ...['Période', 'Dépôt', 'TVA déclarée', 'TVA 4457', 'TVA autoliquidée 4452', 'Écart TVA', 'CA déclaré', 'CA comptabilisé', 'Écart CA'].map((x, k) => h('th', { scope: 'col', class: k >= 2 ? 'nombre' : undefined }, x)))),
          h(
            'tbody',
            {},
            ...c.mensuel.map((m) => {
              const mois = m.mois.length === 1 ? m.mois[0] : undefined;
              return h(
                'tr',
                { class: m.tvaDeclaree === null ? 'ligne-anormale' : undefined },
                h('th', { scope: 'row' }, m.periode),
                h('td', {}, dateFr(m.dateDepot)),
                h('td', { class: 'nombre montant' }, m.tvaDeclaree === null ? '—' : signe(m.tvaDeclaree)),
                h('td', { class: 'nombre montant' }, mois ? lien(m.tva4457, `TVA au crédit des 4457 — ${m.periode}`, { comptes: ['4457'], mois, sens: 'credit' }) : signe(m.tva4457)),
                h('td', { class: 'nombre montant' }, m.tvaAutoliquidee ? (mois ? lien(m.tvaAutoliquidee, `TVA autoliquidée — ${m.periode}`, { comptes: p.prefixesAutoliquidation, mois, sens: 'credit' }) : signe(m.tvaAutoliquidee)) : ''),
                h('td', { class: `nombre montant${m.ecartTva ? ' ecart-non-nul' : ''}` }, m.ecartTva === null ? '' : signe(m.ecartTva)),
                h('td', { class: 'nombre montant' }, m.caDeclare === null ? '—' : signe(m.caDeclare)),
                h('td', { class: 'nombre montant' }, mois ? lien(m.caComptabilise, `Chiffre d’affaires — ${m.periode}`, { comptes: p.prefixesProduits, mois }) : signe(m.caComptabilise)),
                h('td', { class: 'nombre montant' }, m.ecartCa === null ? '' : signe(m.ecartCa)),
              );
            }),
          ),
        ),
      ),
      h('h3', {}, 'Contrôles complémentaires'),
      h(
        'div',
        { class: 'tableau-defilant', tabindex: '0', role: 'region', 'aria-label': 'Contrôles complémentaires' },
        h(
          'table',
          { class: 'tableau tableau-cadrage' },
          h('thead', {}, h('tr', {}, ...['Contrôle', 'Comptabilité', 'Déclaration', 'Écart'].map((x, k) => h('th', { scope: 'col', class: k ? 'nombre' : undefined }, x)))),
          h(
            'tbody',
            {},
            ...c.controles.map((x) =>
              h(
                'tr',
                {},
                h('th', { scope: 'row' }, x.libelle, h('div', { class: 'note texte-secondaire' }, x.explication)),
                h('td', { class: 'nombre montant' }, lien(x.comptable, x.libelle, { comptes: x.comptes, aNouveaux: true })),
                h('td', { class: 'nombre montant' }, x.declare === null ? '—' : signe(x.declare)),
                h('td', { class: `nombre montant${x.ecart ? ' ecart-non-nul' : ''}` }, x.ecart === null ? '' : signe(x.ecart)),
              ),
            ),
          ),
        ),
      ),
    );
  }

  // ---- Justification ---------------------------------------------------------------------------------------
  function vueJustification(): HTMLElement {
    const p = parametres();
    const g = cadrage!.g340;
    const liste = h('datalist', { id: 'tva-exemples-justification' }, ...EXEMPLES_JUSTIFICATION.map((x) => h('option', { value: x })));
    const lignes = p.justifications.map((j, i) => {
      const champ = (cle: 'libelle' | 'commentaire' | 'piece', aria: string) => {
        const e = h('input', { type: 'text', value: j[cle], 'aria-label': `${aria} ${i + 1}`, list: cle === 'libelle' ? liste.id : undefined }) as HTMLInputElement;
        e.addEventListener('change', () => {
          j[cle] = e.value;
          void sauver();
        });
        return e;
      };
      const montant = h('input', { type: 'text', inputmode: 'decimal', class: 'champ-montant', value: (j.montant / 100).toFixed(2).replace('.', ','), 'aria-label': `Montant ${i + 1}` }) as HTMLInputElement;
      montant.addEventListener('change', () => {
        const v = versCentimes(montant.value);
        if (v === undefined) return dire('Montant invalide.');
        j.montant = v ?? 0;
        enregistrer();
      });
      return h(
        'tr',
        {},
        h('td', {}, champ('libelle', 'Libellé')),
        h('td', {}, montant),
        h('td', {}, champ('commentaire', 'Commentaire')),
        h('td', {}, champ('piece', 'Référence de pièce')),
        h(
          'td',
          {},
          bouton('Retirer', () => {
            p.justifications.splice(i, 1);
            enregistrer();
          }),
        ),
      );
    });
    return h(
      'div',
      {},
      liste,
      h('p', {}, `Écart à justifier : `, h('strong', {}, `${signe(g.ecart)} €`), ` (TVA théorique ${signe(g.tvaTheorique)} € − TVA déclarée ${signe(g.tvaDeclaree)} €).`),
      h(
        'div',
        { class: 'tableau-defilant', tabindex: '0', role: 'region', 'aria-label': 'Justification' },
        h(
          'table',
          { class: 'tableau tableau-cadrage' },
          h('thead', {}, h('tr', {}, ...['Libellé', 'Montant', 'Commentaire', 'Référence de pièce', ''].map((x) => h('th', { scope: 'col' }, x)))),
          h('tbody', {}, ...lignes),
          h(
            'tfoot',
            {},
            h('tr', { class: 'ligne-solde' }, h('th', { scope: 'row' }, 'Total justifié'), h('td', { class: 'nombre montant' }, signe(g.justifie)), h('td', { colspan: '3' })),
            h('tr', { class: 'ligne-solde' }, h('th', { scope: 'row' }, 'Écart résiduel non justifié'), h('td', { class: `nombre montant${g.residuel !== 0 ? ' ecart-non-nul' : ''}` }, signe(g.residuel)), h('td', { colspan: '3' }, g.residuel === 0 ? 'Écart entièrement justifié' : '')),
          ),
        ),
      ),
      h(
        'div',
        { class: 'actions' },
        bouton('Ajouter une ligne', () => {
          p.justifications.push({ id: crypto.randomUUID(), libelle: '', montant: 0, commentaire: '', piece: '' });
          enregistrer();
        }),
      ),
    );
  }

  // ---- Paramètres -------------------------------------------------------------------------------------------
  function vueParametres(): HTMLElement {
    const p = parametres();
    const texte = (id: string, libelle: string, valeur: string, maj: (v: string) => void, aide = '') => {
      const e = h('input', { id, type: 'text', value: valeur, autocomplete: 'off' }) as HTMLInputElement;
      e.addEventListener('change', () => {
        maj(e.value);
        enregistrer();
      });
      return h('div', { class: 'champ' }, h('label', { for: id }, libelle), e, aide ? h('span', { class: 'note texte-secondaire' }, aide) : '');
    };
    const regime = h(
      'select',
      { id: 'tva-regime' },
      ...(
        [
          ['encaissements', 'Encaissements (prestations de services)'],
          ['debits', 'Débits (livraisons de biens, option)'],
          ['mixte', 'Mixte (par compte)'],
        ] as [Regime, string][]
      ).map(([v, t]) => h('option', { value: v, selected: p.regime === v }, t)),
    );
    regime.addEventListener('change', () => {
      p.regime = regime.value as Regime;
      enregistrer();
    });
    const regimesComptes =
      p.regime === 'mixte'
        ? h(
            'div',
            {},
            h('h4', {}, 'Régime par compte'),
            ...cadrage!.g340.lignes
              .filter((l, i, t) => t.findIndex((x) => x.compteNum === l.compteNum) === i)
              .map((l) => {
                const s = h('select', { 'aria-label': `Régime du compte ${l.compteNum}` }, h('option', { value: 'encaissements', selected: (p.comptes[l.compteNum]?.regime ?? 'encaissements') === 'encaissements' }, 'Encaissements'), h('option', { value: 'debits', selected: p.comptes[l.compteNum]?.regime === 'debits' }, 'Débits'));
                s.addEventListener('change', () => {
                  p.comptes[l.compteNum] = { ...p.comptes[l.compteNum], regime: s.value as 'encaissements' | 'debits' };
                  enregistrer();
                });
                return h('div', { class: 'champ champ-case' }, h('span', { class: 'mono' }, `${l.compteNum} ${l.compteLib}`), s);
              }),
          )
        : h('span');
    const declarations = donnees()!.declarations;
    return h(
      'div',
      {},
      h(
        'div',
        { class: 'ligne-champs' },
        h('div', { class: 'champ' }, h('label', { for: regime.id }, 'Régime d’exigibilité'), regime),
        texte('tva-collaborateur', 'Collaborateur', p.collaborateur, (v) => {
          p.collaborateur = v.trim();
          ecrirePreference(PREF_COLLABORATEUR, p.collaborateur || null);
        }),
      ),
      regimesComptes,
      h(
        'div',
        { class: 'ligne-champs' },
        texte('tva-produits', 'Comptes de produits retenus (préfixes)', p.prefixesProduits.join(', '), (v) => (p.prefixesProduits = prefixes(v)), 'ex. 70, 75, 77 ou des comptes précis (7088)'),
        texte('tva-comptes-tva', 'Comptes de TVA collectée observés', p.prefixesTva.join(', '), (v) => (p.prefixesTva = prefixes(v)), '4457 et 44587 (TVA sur factures non encaissées)'),
        texte('tva-pertes', 'Pertes sur créances irrécouvrables', p.prefixesPertes.join(', '), (v) => (p.prefixesPertes = prefixes(v))),
        texte('tva-autoliq', 'TVA autoliquidée sur achats', p.prefixesAutoliquidation.join(', '), (v) => (p.prefixesAutoliquidation = prefixes(v))),
      ),
      h(
        'div',
        { class: 'ligne-champs' },
        ...CATEGORIES_ENCOURS.map((cle) => texte(`tva-encours-${cle}`, `${LIBELLES_ENCOURS[cle].libelle} (préfixes)`, p.prefixesEncours[cle].join(', '), (v) => (p.prefixesEncours[cle] = prefixes(v)))),
      ),
      h('h4', {}, 'Déclarations CA3 correspondant à l’exercice'),
      h('p', { class: 'note' }, `${cadrage!.retenues.length} déclaration(s) retenue(s) : ${cadrage!.periodes.join(', ') || 'aucune'}.`, cadrage!.horsExercice.length ? ` Hors exercice (non retenues) : ${cadrage!.horsExercice.map((d) => libellePeriode(d.identification.debut, d.identification.fin)).join(', ')}.` : '', declarations.length === 0 ? ' Déposez les CA3 ci-dessus.' : ''),
      h('div', { class: 'actions' }, bouton('Rétablir les paramètres par défaut', () => {
        if (!window.confirm('Rétablir les paramètres par défaut ? Les taux saisis, soldes N-1 saisis, ventilations et justifications seront perdus.')) return;
        donnees()!.parametres = { ...parametresParDefaut(), collaborateur: p.collaborateur };
        enregistrer();
      })),
    );
  }

  // ---- Onglets et export -----------------------------------------------------------------------------------
  function rendrePanneau(): void {
    if (!cadrage) return;
    panneau.setAttribute('aria-labelledby', `onglet-tva-${actif}`);
    const vue = { g340: vueG340, mensuel: vueMensuelle, justification: vueJustification, parametres: vueParametres }[actif];
    const focus = document.activeElement instanceof HTMLElement && panneau.contains(document.activeElement) ? document.activeElement.getAttribute('aria-label') : null;
    panneau.replaceChildren(vue());
    // Après un recalcul, le focus revient au champ modifié (même libellé accessible).
    if (focus) panneau.querySelector<HTMLElement>(`[aria-label="${CSS.escape(focus)}"]`)?.focus();
  }

  function rendreOnglets(): void {
    onglets.replaceChildren(
      ...ONGLETS.map((o) => {
        const b = h('button', { type: 'button', role: 'tab', class: 'onglet', id: `onglet-tva-${o.id}`, 'aria-selected': String(actif === o.id), 'aria-controls': 'panneau-cadrage' }, o.libelle);
        b.addEventListener('click', () => {
          actif = o.id;
          rendreOnglets();
          rendrePanneau();
        });
        return b;
      }),
    );
  }

  async function exporter(): Promise<void> {
    if (!cadrage || !fec) return;
    dire('Préparation de la feuille de travail…');
    try {
      const ExcelJS = await chargerExcelJS();
      const c = cadrage;
      const d = donnees()!;
      const id = c.retenues.find((x) => x.identification.denomination)?.identification;
      const wb = classeurCadrageTva(ExcelJS, {
        entreprise: id?.denomination ?? dossier.nom,
        siren: fec.metadonnees.siren ?? id?.siren ?? null,
        exercice: c.exercice,
        periodes: c.periodes,
        g300: c.g300,
        g340: c.g340,
        mensuel: c.mensuel,
        controles: c.controles,
        anomalies: c.anomalies,
        corrections: c.retenues.flatMap((x, i) => x.corrections.map((correction) => ({ periode: c.periodes[i]!, correction }))),
        declarations: c.retenues.map((x, i) => ({ periode: c.periodes[i]!, source: x.source === 'pdf' ? 'PDF' : 'Saisie manuelle', fichier: x.nomFichier, empreinte: x.empreinte, millesime: x.identification.millesime })),
        parametres: d.parametres!,
        fec: fec.metadonnees,
        version: __APP_VERSION__,
        date: new Date(),
      });
      const nom = `Cadrage_TVA_${(fec.metadonnees.siren ?? dossier.nom).replace(/[^\w-]+/g, '_')}_${c.exercice.fin.replaceAll('-', '')}.xlsx`;
      telecharger(await octetsClasseur(wb), nom, TYPE_XLSX);
      dire('Feuille de travail exportée.');
    } catch (e) {
      dire(`Export impossible : ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  zone.replaceChildren(h('section', { class: 'carte' }, h('h2', {}, 'Cadrage de la TVA collectée'), h('p', { class: 'texte-secondaire' }, 'Chargement du FEC du dossier…')));
  void (async () => {
    const [n, n1] = await Promise.all([chargerDonneesTva(dossier.id, 'N'), chargerDonneesTva(dossier.id, 'N-1')]);
    if (detruit) return;
    if (!n) {
      zone.replaceChildren(h('section', { class: 'carte' }, h('h2', {}, 'Cadrage de la TVA collectée'), h('p', {}, 'Le dossier n’a pas encore de FEC de l’exercice : ', h('a', { href: '#/fec' }, 'importez-le dans le module FEC'), ' pour reconstituer la TVA théorique.')));
      return;
    }
    fec = n;
    fecN1 = n1;
    const d = donnees();
    if (!d) return;
    if (!d.parametres) {
      d.parametres = { ...parametresParDefaut(), collaborateur: lirePreference(PREF_COLLABORATEUR) ?? '' };
      void sauver();
    }
    zone.replaceChildren(h('section', { class: 'carte', 'aria-labelledby': 'titre-cadrage-tva' }, h('h2', { id: 'titre-cadrage-tva' }, 'Cadrage de la TVA collectée'), synthese, onglets, panneau, dialogue));
    rendreOnglets();
    recalculer();
  })();

  return {
    maj: recalculer,
    detruire() {
      detruit = true;
      if (dialogue.open) dialogue.close();
    },
  };
}
