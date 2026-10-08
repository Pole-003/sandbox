/**
 * Écrans d'analyse du FEC : balance générale (N / N-1), balances auxiliaires et âgées, grand-livre
 * virtualisé, statistiques. Navigation balance → grand-livre → écriture complète.
 * Les calculs (purs, testés) sont dans ../analyses/ ; les données viennent du stockage local.
 */
import { h } from '../../../app/dom.ts';
import { formaterMontant } from '../../../core/format.ts';
import { calculerBalanceAuxiliaire, TRANCHES, type BalanceAuxiliaire, type Population } from '../analyses/auxiliaire.ts';
import { calculerBalance, comparerBalances, type Balance, type GroupeBalance, type LigneComparaison } from '../analyses/balance.ts';
import { calculerChiffresCles, type ChiffresCles } from '../analyses/chiffres-cles.ts';
import { calculerTft, presentationTft, type Tft } from '../analyses/tft.ts';
import { creerContexte, t, type ContexteAnalyse } from '../analyses/contexte.ts';
import { filtrerGrandLivre, lignesEcriture, type FiltresGrandLivre, type GrandLivre } from '../analyses/grand-livre.ts';
import { calculerStatistiques, ecrituresDuChiffre, type Statistiques } from '../analyses/statistiques.ts';
import {
  classeurBalanceGenerale,
  classeurBalancesAuxiliaires,
  classeurChiffresCles,
  classeurTft,
  classeurGrandLivre,
  classeurStatistiques,
} from '../export/analyses-xlsx.ts';
import { chargerExcelJS, octetsClasseur, type ExcelJSModule, type Parametres } from '../export/xlsx.ts';
import type { Workbook } from 'exceljs';
import { dateIso } from '../import/valeurs.ts';
import type { JournalAN } from '../metadonnees.ts';
import { lireColonnes, type Dossier, type ImportEnregistre } from '../stockage/base-fec.ts';
import { bouton, dateFr, nombreFr, telecharger, TYPE_XLSX } from './commun.ts';
import { creerListeVirtuelle } from './liste-virtuelle.ts';

const ONGLETS = [
  { id: 'chiffres', libelle: 'Chiffres clés' },
  { id: 'tft', libelle: 'Flux de trésorerie' },
  { id: 'balance', libelle: 'Balance générale' },
  { id: 'auxiliaire', libelle: 'Balances auxiliaires' },
  { id: 'grand-livre', libelle: 'Grand-livre' },
  { id: 'statistiques', libelle: 'Statistiques' },
] as const;
type Onglet = (typeof ONGLETS)[number]['id'];

/** Montant signé (perte, décaissement) : « −1 234,56 ». */
const signe = (x: number) => (x < 0 ? `−${formaterMontant(-x)}` : formaterMontant(x));
/** Variation en % de la valeur N-1 (en valeur absolue au dénominateur), ou « — ». */
const variationPct = (n: number, avant: number) => (avant ? `${(((n - avant) / Math.abs(avant)) * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1, signDisplay: 'always' })} %` : '—');
const montant = (c: number) => (c === 0 ? '' : formaterMontant(c));
const solde = (c: number) => (c === 0 ? '0,00' : `${formaterMontant(Math.abs(c))} ${c > 0 ? 'D' : 'C'}`);
const dateLigne = (d: number) => (d > 0 ? dateFr(dateIso(d)) : d === -1 ? 'invalide' : '—');

function journalAN(imp: ImportEnregistre): JournalAN | null {
  const code = imp.reglages.journalAN;
  const j = code ? imp.meta.journaux.find((x) => x.code === code) : undefined;
  if (!j) return null;
  return { code: j.code, libelle: j.libelle, methode: imp.meta.journalAN?.code === j.code ? imp.meta.journalAN.methode : 'code' };
}

function contexteDe(imp: ImportEnregistre, colonnes: Awaited<ReturnType<typeof lireColonnes>>): ContexteAnalyse {
  const debut = imp.reglages.debut ?? imp.meta.exercice?.debut ?? '1900-01-01';
  const fin = imp.reglages.fin ?? imp.meta.exercice?.fin ?? '2099-12-31';
  return creerContexte(colonnes!, { debut, fin }, journalAN(imp));
}

export interface SectionAnalyses {
  element: HTMLElement;
  detruire(): void;
}

export function creerSectionAnalyses(impN: ImportEnregistre, impN1: ImportEnregistre | null, dossier: Dossier, dire: (t: string) => void): SectionAnalyses {
  const etat = h('p', { class: 'texte-secondaire', role: 'status' }, 'Chargement des données du FEC…');
  const onglets = h('div', { class: 'onglets', role: 'tablist', 'aria-label': 'Analyses' });
  const panneau = h('div', { class: 'panneau-analyse', role: 'tabpanel', tabindex: '-1' });
  const dialogue = h('dialog', { class: 'dialogue-ecriture', 'aria-labelledby': 'titre-ecriture' }) as HTMLDialogElement;
  const element = h(
    'section',
    { class: 'carte analyses', 'aria-labelledby': 'titre-analyses' },
    h('h2', { id: 'titre-analyses' }, 'Analyses'),
    etat,
    onglets,
    panneau,
    dialogue,
  );
  let detruit = false;
  let ctx: ContexteAnalyse;
  let ctxN1: ContexteAnalyse | null = null;
  let actif: Onglet = 'chiffres';
  let filtresGL: FiltresGrandLivre = {};
  const cache: { tft?: Tft; tftN1?: Tft | null; chiffres?: ChiffresCles; chiffresN1?: ChiffresCles | null; balance?: Balance; balanceN1?: Balance | null; comparaison?: LigneComparaison[] | null; aux?: Partial<Record<Population, BalanceAuxiliaire>>; stats?: Statistiques } = {};

  const r = impN.reglages;
  const parametres = (): Parametres => ({
    dossier: dossier.nom,
    siren: r.siren,
    exercice: `du ${dateFr(ctx.debut)} au ${dateFr(ctx.fin)}`,
    fichier: impN.meta.nomFichier,
    empreinte: impN.meta.empreinte,
    version: __APP_VERSION__,
  });

  async function exporter(nom: string, fabrique: (ExcelJS: ExcelJSModule) => Workbook): Promise<void> {
    dire('Préparation de l’export Excel…');
    try {
      const ExcelJS = await chargerExcelJS();
      telecharger(await octetsClasseur(fabrique(ExcelJS)), `${nom}_${(r.siren ?? dossier.nom).replace(/[^\w-]+/g, '_')}.xlsx`, TYPE_XLSX);
      dire('Export Excel prêt.');
    } catch (e) {
      dire(`Export impossible : ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ---- Écriture complète -------------------------------------------------------------------------
  function ouvrirEcriture(e: number): void {
    const { f } = ctx;
    const lignes = Array.from(lignesEcriture(ctx, e));
    const p = lignes[0]!;
    const debit = lignes.reduce((s, i) => s + f.debit[i]!, 0);
    const credit = lignes.reduce((s, i) => s + f.credit[i]!, 0);
    dialogue.replaceChildren(
      h('h3', { id: 'titre-ecriture' }, `Écriture ${t(f, 'journalCode', p)} n° ${t(f, 'ecritureNum', p)} du ${dateLigne(f.ecritureDate[p]!)}`),
      h(
        'p',
        { class: 'note texte-secondaire' },
        `${t(f, 'journalLib', p)} · pièce ${t(f, 'pieceRef', p) || '—'} du ${dateLigne(f.pieceDate[p]!)} · validée le ${dateLigne(f.validDate[p]!)}${ctx.an[p] ? ' · à-nouveaux' : ''}`,
      ),
      h(
        'div',
        { class: 'tableau-defilant' },
        h(
          'table',
          { class: 'tableau' },
          h(
            'thead',
            {},
            h('tr', {}, ...['Ligne', 'Compte', 'Libellé du compte', 'Auxiliaire', 'Libellé', 'Débit', 'Crédit', 'Lettrage'].map((x, k) => h('th', { scope: 'col', class: k >= 5 && k <= 6 ? 'nombre' : undefined }, x))),
          ),
          h(
            'tbody',
            {},
            ...lignes.map((i) =>
              h(
                'tr',
                {},
                h('td', { class: 'nombre' }, String(f.ligneOrigine[i])),
                h('td', { class: 'mono' }, t(f, 'compteNum', i)),
                h('td', {}, t(f, 'compteLib', i)),
                h('td', {}, [t(f, 'compAuxNum', i), t(f, 'compAuxLib', i)].filter(Boolean).join(' — ')),
                h('td', {}, t(f, 'ecritureLib', i)),
                h('td', { class: 'nombre montant' }, montant(f.debit[i]!)),
                h('td', { class: 'nombre montant' }, montant(f.credit[i]!)),
                h('td', {}, t(f, 'ecritureLet', i) ? `${t(f, 'ecritureLet', i)} (${dateLigne(f.dateLet[i]!)})` : ''),
              ),
            ),
          ),
          h('tfoot', {}, h('tr', {}, h('th', { scope: 'row', colspan: '5' }, debit === credit ? 'Total — écriture équilibrée' : `Total — déséquilibre de ${formaterMontant(debit - credit)}`), h('td', { class: 'nombre montant' }, formaterMontant(debit)), h('td', { class: 'nombre montant' }, formaterMontant(credit)), h('td'))),
        ),
      ),
      h('div', { class: 'actions' }, bouton('Fermer', () => dialogue.close(), { primaire: true })),
    );
    dialogue.showModal();
  }

  /** Liste d'écritures (indicateurs, Benford) : date, journal, n°, pièce, libellé, montant. */
  function listeEcritures(ecritures: number[], libelle: string): HTMLElement {
    const { f } = ctx;
    const premieres = ecritures.map((e) => lignesEcriture(ctx, e)[0]!);
    const totaux = ecritures.map((e) => Array.from(lignesEcriture(ctx, e)).reduce((s, i) => s + f.debit[i]!, 0));
    const entete = h('div', { class: 'ligne-ecr entete-liste', role: 'row' }, ...['Date', 'Journal', 'N°', 'Pièce', 'Libellé', 'Montant'].map((x) => h('span', { role: 'columnheader', class: x === 'Montant' ? 'montant' : undefined }, x)));
    const liste = creerListeVirtuelle({ hauteurLigne: 32, entete, libelle });
    liste.definir(ecritures.length, (k) => {
      const i = premieres[k]!;
      const l = h(
        'div',
        { class: 'ligne-ecr ligne-cliquable', role: 'row', tabindex: '0', title: 'Ouvrir l’écriture complète' },
        h('span', { role: 'cell' }, dateLigne(f.ecritureDate[i]!)),
        h('span', { role: 'cell' }, t(f, 'journalCode', i)),
        h('span', { role: 'cell', class: 'mono' }, t(f, 'ecritureNum', i)),
        h('span', { role: 'cell' }, t(f, 'pieceRef', i)),
        h('span', { role: 'cell', class: 'tronque' }, t(f, 'ecritureLib', i) || '(vide)'),
        h('span', { role: 'cell', class: 'montant' }, formaterMontant(totaux[k]!)),
      );
      const ouvrir = () => ouvrirEcriture(ecritures[k]!);
      l.addEventListener('click', ouvrir);
      l.addEventListener('keydown', (ev) => ev.key === 'Enter' && ouvrir());
      return l;
    });
    return liste.element;
  }

  function versGrandLivre(filtres: FiltresGrandLivre): void {
    filtresGL = filtres;
    choisir('grand-livre');
  }

  // ---- Balance générale --------------------------------------------------------------------------
  function vueChiffres(): HTMLElement {
    const b = (cache.balance ??= calculerBalance(ctx));
    if (cache.balanceN1 === undefined) cache.balanceN1 = ctxN1 ? calculerBalance(ctxN1) : null;
    const c = (cache.chiffres ??= calculerChiffresCles(b));
    if (cache.chiffresN1 === undefined) cache.chiffresN1 = cache.balanceN1 ? calculerChiffresCles(cache.balanceN1) : null;
    const n1 = cache.chiffresN1;
    const variation = (n: number, avant: number | undefined) => {
      if (avant === undefined) return '';
      const pct = avant ? ((n - avant) / Math.abs(avant)) * 100 : null;
      return `${n - avant >= 0 ? '+' : '−'}${formaterMontant(Math.abs(n - avant))}${pct === null ? '' : ` (${pct.toLocaleString('fr-FR', { maximumFractionDigits: 1, signDisplay: 'always' })} %)`}`;
    };
    const tuile = (valeur: number, libelle: string, avant: number | undefined) =>
      h(
        'div',
        { class: 'tuile' },
        h('span', { class: `tuile-valeur${valeur < 0 ? ' valeur-negative' : ''}` }, `${signe(valeur)} €`),
        h('span', { class: 'tuile-libelle' }, libelle),
        avant === undefined ? null : h('span', { class: 'tuile-libelle' }, `N-1 : ${signe(avant)} € · ${variation(valeur, avant)}`),
      );
    const ebe = (x: ChiffresCles) => x.sig.find((l) => l.code === 'EBE')!.montant;
    const parCodeN1 = new Map((n1?.sig ?? []).map((l) => [l.code, l.montant]));
    const verif: HTMLElement[] = [];
    if (c.gestionSoldee) {
      verif.push(h('p', { class: 'bandeau bandeau-alerte' }, `Les comptes de charges et de produits sont soldés dans ce FEC (écriture de détermination du résultat) : le résultat est lu au compte 12, soit ${signe(c.resultat)} €. Les soldes intermédiaires ci-dessous sont nuls.`));
    } else if (c.resultatCompte12 !== null) {
      verif.push(h('p', { class: 'note texte-secondaire' }, `Le compte 12 présente un solde de ${signe(c.resultatCompte12)} € à la clôture (résultat de l’exercice précédent non encore affecté, ou résultat déjà comptabilisé) : à rapprocher du résultat ci-dessus.`));
    }
    return h(
      'div',
      {},
      h(
        'div',
        { class: 'tuiles tuiles-montants', role: 'group', 'aria-label': 'Chiffres clés' },
        tuile(c.chiffreAffaires, 'Chiffre d’affaires (comptes 70)', n1?.chiffreAffaires),
        tuile(c.resultat, c.resultat >= 0 ? 'Résultat de l’exercice (bénéfice)' : 'Résultat de l’exercice (perte)', n1?.resultat),
        tuile(ebe(c), 'Excédent brut d’exploitation', n1 ? ebe(n1) : undefined),
        tuile(c.totalProduits, 'Total des produits (classe 7)', n1?.totalProduits),
        tuile(c.totalCharges, 'Total des charges (classe 6)', n1?.totalCharges),
      ),
      ...verif,
      h(
        'div',
        { class: 'actions' },
        bouton('Exporter (.xlsx)', () => void exporter('Chiffres_cles', (X) => classeurChiffresCles(X, c, n1, parametres(), { n: b, n1: cache.balanceN1 ?? null }))),
        h('span', { class: 'texte-secondaire note' }, n1 ? `Comparaison avec ${impN1!.meta.nomFichier}` : 'Chargez le FEC N-1 pour la comparaison.'),
      ),
      h('h3', {}, 'Soldes intermédiaires de gestion'),
      h(
        'div',
        { class: 'tableau-defilant', tabindex: '0', role: 'region', 'aria-label': 'Soldes intermédiaires de gestion' },
        h(
          'table',
          { class: 'tableau tableau-sig' },
          h('thead', {}, h('tr', {}, ...['Rubrique', 'Comptes', 'Exercice N', ...(n1 ? ['Exercice N-1', 'Variation', 'Var. %'] : [])].map((x, k) => h('th', { scope: 'col', class: k >= 2 ? 'nombre' : undefined }, x)))),
          h(
            'tbody',
            {},
            ...c.sig.map((l) => {
              const avant = parCodeN1.get(l.code);
              return h(
                'tr',
                { class: l.nature === 'solde' ? 'ligne-solde' : undefined },
                h(l.nature === 'solde' ? 'th' : 'td', l.nature === 'solde' ? { scope: 'row' } : {}, l.nature === 'produit' ? `+ ${l.libelle}` : l.nature === 'charge' ? `− ${l.libelle}` : `= ${l.libelle}`),
                h('td', { class: 'mono note' }, l.comptes),
                h('td', { class: 'nombre montant' }, signe(l.montant)),
                ...(n1 ? [h('td', { class: 'nombre montant' }, avant === undefined ? '—' : signe(avant)), h('td', { class: 'nombre montant' }, avant === undefined ? '' : signe(l.montant - avant)), h('td', { class: 'nombre' }, avant === undefined ? '' : variationPct(l.montant, avant))] : []),
              );
            }),
          ),
        ),
      ),
    );
  }

  function vueTft(): HTMLElement {
    const b = (cache.balance ??= calculerBalance(ctx));
    if (cache.balanceN1 === undefined) cache.balanceN1 = ctxN1 ? calculerBalance(ctxN1) : null;
    const t = (cache.tft ??= calculerTft(b));
    if (cache.tftN1 === undefined) cache.tftN1 = cache.balanceN1 ? calculerTft(cache.balanceN1) : null;
    const n1 = cache.tftN1;
    const tuile = (valeur: number, libelle: string, avant: number | undefined) =>
      h(
        'div',
        { class: 'tuile' },
        h('span', { class: `tuile-valeur${valeur < 0 ? ' valeur-negative' : ''}` }, `${signe(valeur)} €`),
        h('span', { class: 'tuile-libelle' }, libelle),
        avant === undefined ? null : h('span', { class: 'tuile-libelle' }, `N-1 : ${signe(avant)} €`),
      );
    const controles: HTMLElement[] = [
      t.ecart === 0
        ? h('p', { class: 'bandeau bandeau-succes', role: 'status' }, `Contrôle : la somme des flux (${signe(t.variationTresorerie)} €) est égale à la variation de la trésorerie entre l’ouverture (${signe(t.tresorerieOuverture)} €) et la clôture (${signe(t.tresorerieCloture)} €).`)
        : h('p', { class: 'bandeau bandeau-alerte', role: 'status' }, `Écart de ${signe(t.ecart)} € entre la somme des flux et la variation de trésorerie : la balance du FEC n’est pas équilibrée (voir la balance générale).`),
    ];
    if (t.gestionSoldee) controles.push(h('p', { class: 'note texte-secondaire' }, 'Comptes de gestion soldés dans le FEC : le résultat net est repris du compte 12.'));
    if (n1 && n1.tresorerieCloture !== t.tresorerieOuverture) {
      controles.push(h('p', { class: 'bandeau bandeau-alerte' }, `La trésorerie de clôture du FEC N-1 (${signe(n1.tresorerieCloture)} €) diffère de la trésorerie d’ouverture de l’exercice (${signe(t.tresorerieOuverture)} €) : vérifiez les à-nouveaux.`));
    }
    if (!r.journalANConfirme) controles.push(h('p', { class: 'note texte-secondaire' }, 'La trésorerie d’ouverture repose sur le journal d’à-nouveaux, à confirmer dans le résumé du FEC.'));
    return h(
      'div',
      {},
      h(
        'div',
        { class: 'tuiles tuiles-montants', role: 'group', 'aria-label': 'Flux de trésorerie' },
        tuile(t.flux.operationnel, 'Flux opérationnels', n1?.flux.operationnel),
        tuile(t.flux.investissement, 'Flux d’investissement', n1?.flux.investissement),
        tuile(t.flux.financement, 'Flux de financement', n1?.flux.financement),
        tuile(t.variationTresorerie, 'Variation de trésorerie', n1?.variationTresorerie),
        tuile(t.tresorerieCloture, 'Trésorerie à la clôture', n1?.tresorerieCloture),
      ),
      ...controles,
      h(
        'div',
        { class: 'actions' },
        bouton('Exporter (.xlsx)', () => void exporter('Flux_de_tresorerie', (X) => classeurTft(X, t, n1, parametres()))),
        h('span', { class: 'texte-secondaire note' }, n1 ? `Comparaison avec ${impN1!.meta.nomFichier}` : 'Chargez le FEC N-1 pour la comparaison.'),
      ),
      h('h3', {}, 'Tableau des flux de trésorerie (méthode indirecte, IAS 7)'),
      h(
        'div',
        { class: 'tableau-defilant', tabindex: '0', role: 'region', 'aria-label': 'Tableau des flux de trésorerie' },
        h(
          'table',
          { class: 'tableau tableau-sig' },
          h('thead', {}, h('tr', {}, ...['Rubrique', 'Comptes', 'Exercice N', ...(n1 ? ['Exercice N-1', 'Variation'] : [])].map((x, k) => h('th', { scope: 'col', class: k >= 2 ? 'nombre' : undefined }, x)))),
          h(
            'tbody',
            {},
            ...presentationTft()
              .filter((l) => l.nature !== 'ecart' || t.ecart !== 0 || (n1?.ecart ?? 0) !== 0)
              .map((l) => {
                const v = l.montant(t);
                const avant = n1 ? l.montant(n1) : null;
                if (l.nature === 'section') return h('tr', { class: 'ligne-section' }, h('th', { scope: 'rowgroup', colspan: String(n1 ? 5 : 3) }, l.libelle));
                const fort = l.nature !== 'detail';
                return h(
                  'tr',
                  { class: fort ? 'ligne-solde' : undefined },
                  h(fort ? 'th' : 'td', fort ? { scope: 'row' } : {}, l.libelle),
                  h('td', { class: 'mono note' }, l.comptes),
                  h('td', { class: 'nombre montant' }, signe(v ?? 0)),
                  ...(n1 ? [h('td', { class: 'nombre montant' }, signe(avant ?? 0)), h('td', { class: 'nombre montant' }, signe((v ?? 0) - (avant ?? 0)))] : []),
                );
              }),
          ),
        ),
      ),
    );
  }

  function vueBalance(): HTMLElement {
    const b = (cache.balance ??= calculerBalance(ctx));
    if (cache.balanceN1 === undefined) cache.balanceN1 = ctxN1 ? calculerBalance(ctxN1) : null;
    if (cache.comparaison === undefined) cache.comparaison = cache.balanceN1 ? comparerBalances(b, cache.balanceN1) : null;
    const comparaison = new Map((cache.comparaison ?? []).map((c) => [c.compteNum, c]));
    const avecN1 = comparaison.size > 0;
    // Balance repliée à l'ouverture : seules les classes sont affichées.
    const replies = new Set<string>(b.classes.map((c) => c.code));
    const corps = h('tbody', {});
    const cellulesN1 = (compteNum: string | null, soldeN: number, soldeN1: number | null) => {
      if (!avecN1) return [];
      const n1 = compteNum ? (comparaison.get(compteNum)?.clotureN1 ?? null) : soldeN1;
      const variation = soldeN - (n1 ?? 0);
      const pct = n1 ? (variation / Math.abs(n1)) * 100 : null;
      return [
        h('td', { class: 'nombre montant' }, n1 === null ? '—' : solde(n1)),
        h('td', { class: 'nombre montant' }, formaterMontant(variation)),
        h('td', { class: 'nombre' }, pct === null ? '—' : `${pct.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`),
      ];
    };
    const sommeN1 = (g: GroupeBalance): number =>
      g.comptes.reduce((x, c) => x + (comparaison.get(c.compteNum)?.clotureN1 ?? 0), 0) + g.sousGroupes.reduce((x, sg) => x + sommeN1(sg), 0);
    const ligneGroupe = (g: GroupeBalance, niveau: number) => {
      const replie = replies.has(g.code);
      const bascule = h('button', { type: 'button', class: 'bouton-repli', 'aria-expanded': String(!replie), 'aria-label': `${replie ? 'Déplier' : 'Replier'} ${g.code}` }, replie ? '▸' : '▾');
      bascule.addEventListener('click', () => {
        if (replies.has(g.code)) replies.delete(g.code);
        else replies.add(g.code);
        remplir();
      });
      return h(
        'tr',
        { class: `groupe-balance niveau-${niveau}` },
        h('th', { scope: 'row', colspan: '2' }, bascule, ` ${g.code} — ${g.libelle}`),
        h('td', { class: 'nombre montant' }, solde(g.ouverture)),
        h('td', { class: 'nombre montant' }, montant(g.debit)),
        h('td', { class: 'nombre montant' }, montant(g.credit)),
        h('td', { class: 'nombre montant' }, solde(g.cloture)),
        ...cellulesN1(null, g.cloture, sommeN1(g)),
      );
    };
    const remplir = () => {
      const lignes: HTMLElement[] = [];
      for (const c of b.classes) {
        lignes.push(ligneGroupe(c, 1));
        if (replies.has(c.code)) continue;
        for (const s of c.sousGroupes) {
          lignes.push(ligneGroupe(s, 2));
          if (replies.has(s.code)) continue;
          for (const l of s.comptes) {
            const lien = h('button', { type: 'button', class: 'lien-bouton mono', title: 'Voir le compte dans le grand-livre' }, l.compteNum);
            lien.addEventListener('click', () => versGrandLivre({ compte: l.compteNum }));
            lignes.push(
              h(
                'tr',
                {},
                h('td', {}, lien),
                h('td', {}, l.compteLib),
                h('td', { class: 'nombre montant' }, solde(l.ouverture)),
                h('td', { class: 'nombre montant' }, montant(l.debit)),
                h('td', { class: 'nombre montant' }, montant(l.credit)),
                h('td', { class: 'nombre montant' }, solde(l.cloture)),
                ...cellulesN1(l.compteNum, l.cloture, null),
              ),
            );
          }
        }
      }
      corps.replaceChildren(...lignes);
    };
    remplir();
    const eq = b.equilibre;
    return h(
      'div',
      {},
      h(
        'p',
        { class: `bandeau ${eq.ouverture && eq.mouvements && eq.cloture ? 'bandeau-succes' : 'bandeau-alerte'}`, role: 'status' },
        eq.ouverture && eq.mouvements && eq.cloture
          ? `Balance équilibrée : à-nouveaux, mouvements et soldes (${nombreFr(b.comptes.length)} comptes).`
          : `Balance déséquilibrée — à-nouveaux : ${eq.ouverture ? 'équilibrés' : 'déséquilibrés'}, mouvements : ${eq.mouvements ? 'équilibrés' : 'déséquilibrés'}, solde global : ${solde(b.total.cloture)}.`,
      ),
      h(
        'div',
        { class: 'actions' },
        bouton('Tout replier', () => {
          for (const c of b.classes) replies.add(c.code);
          remplir();
        }),
        bouton('Tout déplier', () => {
          replies.clear();
          remplir();
        }),
        bouton('Exporter (.xlsx)', () => void exporter('Balance_generale', (X) => classeurBalanceGenerale(X, b, cache.comparaison ?? null, parametres()))),
        avecN1 ? h('span', { class: 'texte-secondaire note' }, `Comparaison avec ${impN1!.meta.nomFichier}`) : h('span', { class: 'texte-secondaire note' }, 'Chargez le FEC N-1 pour la comparaison.'),
      ),
      h(
        'div',
        { class: 'tableau-defilant tableau-hauteur', tabindex: '0', role: 'region', 'aria-label': 'Balance générale' },
        h(
          'table',
          { class: 'tableau tableau-balance' },
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              ...['Compte', 'Libellé', 'Solde d’ouverture', 'Débit', 'Crédit', 'Solde de clôture', ...(avecN1 ? ['Solde N-1', 'Variation', 'Var. %'] : [])].map((x, k) =>
                h('th', { scope: 'col', class: k >= 2 ? 'nombre' : undefined }, x),
              ),
            ),
          ),
          corps,
          h(
            'tfoot',
            {},
            h(
              'tr',
              {},
              h('th', { scope: 'row', colspan: '2' }, 'Total'),
              h('td', { class: 'nombre montant' }, solde(b.total.ouverture)),
              h('td', { class: 'nombre montant' }, formaterMontant(b.total.debit)),
              h('td', { class: 'nombre montant' }, formaterMontant(b.total.credit)),
              h('td', { class: 'nombre montant' }, solde(b.total.cloture)),
              ...(avecN1 ? [h('td'), h('td'), h('td')] : []),
            ),
          ),
        ),
      ),
    );
  }

  // ---- Balances auxiliaires ----------------------------------------------------------------------
  function vueAuxiliaire(): HTMLElement {
    let population: Population = 'clients';
    let recherche = '';
    let anormaux = false;
    const zone = h('div');
    const balance = (p: Population) => ((cache.aux ??= {})[p] ??= calculerBalanceAuxiliaire(ctx, p));
    const remplir = () => {
      const b = balance(population);
      const anormal = (c: number) => (population === 'clients' ? c < 0 : c > 0);
      const n = recherche.toLowerCase();
      const tiers = b.tiers.filter((x) => (!anormaux || anormal(x.cloture)) && (!n || x.cle.toLowerCase().includes(n) || x.libelle.toLowerCase().includes(n)));
      zone.replaceChildren(
        h(
          'p',
          { class: 'note texte-secondaire' },
          `${nombreFr(tiers.length)} tiers sur ${nombreFr(b.tiers.length)} · ${nombreFr(b.tiers.filter((x) => anormal(x.cloture)).length)} solde(s) anormal(aux) (${population === 'clients' ? 'clients créditeurs' : 'fournisseurs débiteurs'}). Balance âgée : montants non lettrés à la clôture, ancienneté depuis la date de pièce.`,
        ),
        h(
          'div',
          { class: 'tableau-defilant tableau-hauteur', tabindex: '0', role: 'region', 'aria-label': `Balance auxiliaire ${population}` },
          h(
            'table',
            { class: 'tableau tableau-balance' },
            h(
              'thead',
              {},
              h('tr', {}, ...['Code', 'Tiers', 'Ouverture', 'Débit', 'Crédit', 'Clôture', 'Non lettré', ...TRANCHES.map((x) => x.libelle)].map((x, k) => h('th', { scope: 'col', class: k >= 2 ? 'nombre' : undefined }, x))),
            ),
            h(
              'tbody',
              {},
              ...tiers.map((x) => {
                const lien = h('button', { type: 'button', class: 'lien-bouton mono', title: 'Voir le tiers dans le grand-livre' }, x.cle);
                lien.addEventListener('click', () => versGrandLivre(x.compAuxNum ? { auxiliaire: x.compAuxNum } : { compte: x.cle }));
                return h(
                  'tr',
                  { class: anormal(x.cloture) ? 'ligne-anormale' : undefined },
                  h('td', {}, lien),
                  h('td', {}, x.libelle, anormal(x.cloture) ? h('span', { class: 'badge badge-gravite-anomalie' }, 'solde anormal') : null),
                  h('td', { class: 'nombre montant' }, solde(x.ouverture)),
                  h('td', { class: 'nombre montant' }, montant(x.debit)),
                  h('td', { class: 'nombre montant' }, montant(x.credit)),
                  h('td', { class: 'nombre montant' }, solde(x.cloture)),
                  h('td', { class: 'nombre montant' }, montant(x.nonLettre)),
                  ...x.agee.map((v) => h('td', { class: 'nombre montant' }, montant(v))),
                );
              }),
            ),
            h(
              'tfoot',
              {},
              h(
                'tr',
                {},
                h('th', { scope: 'row', colspan: '2' }, 'Total de la population'),
                h('td', { class: 'nombre montant' }, solde(b.total.ouverture)),
                h('td', { class: 'nombre montant' }, formaterMontant(b.total.debit)),
                h('td', { class: 'nombre montant' }, formaterMontant(b.total.credit)),
                h('td', { class: 'nombre montant' }, solde(b.total.cloture)),
                h('td', { class: 'nombre montant' }, formaterMontant(b.total.nonLettre)),
                ...b.total.agee.map((v) => h('td', { class: 'nombre montant' }, formaterMontant(v))),
              ),
            ),
          ),
        ),
      );
    };
    const choixPopulation = h(
      'select',
      { id: 'aux-population' },
      h('option', { value: 'clients' }, 'Clients (comptes 41)'),
      h('option', { value: 'fournisseurs' }, 'Fournisseurs (comptes 40)'),
    );
    choixPopulation.addEventListener('change', () => {
      population = choixPopulation.value as Population;
      remplir();
    });
    const champRecherche = h('input', { id: 'aux-recherche', type: 'search', placeholder: 'Code ou nom', autocomplete: 'off' });
    champRecherche.addEventListener('input', () => {
      recherche = champRecherche.value.trim();
      remplir();
    });
    const caseAnormaux = h('input', { type: 'checkbox', id: 'aux-anormaux' });
    caseAnormaux.addEventListener('change', () => {
      anormaux = caseAnormaux.checked;
      remplir();
    });
    remplir();
    return h(
      'div',
      {},
      h(
        'div',
        { class: 'ligne-champs' },
        h('div', { class: 'champ' }, h('label', { for: 'aux-population' }, 'Population'), choixPopulation),
        h('div', { class: 'champ' }, h('label', { for: 'aux-recherche' }, 'Rechercher'), champRecherche),
        h('div', { class: 'champ champ-case' }, caseAnormaux, h('label', { for: 'aux-anormaux' }, 'Soldes anormaux seulement')),
        bouton('Exporter clients et fournisseurs (.xlsx)', () => void exporter('Balances_auxiliaires', (X) => classeurBalancesAuxiliaires(X, [balance('clients'), balance('fournisseurs')], parametres()))),
      ),
      zone,
    );
  }

  // ---- Grand-livre -------------------------------------------------------------------------------
  function vueGrandLivre(): HTMLElement {
    const { f } = ctx;
    const champ = (id: string, libelle: string, controle: HTMLElement) => h('div', { class: 'champ' }, h('label', { for: id }, libelle), controle);
    const entree = (id: string, type: string, valeur: string | number | undefined, attributs: Record<string, string> = {}) =>
      h('input', { id, type, value: valeur === undefined ? '' : String(valeur), autocomplete: 'off', ...attributs });
    const compte = entree('gl-compte', 'text', filtresGL.compte, { placeholder: 'ex. 411' });
    const aux = entree('gl-aux', 'text', filtresGL.auxiliaire, { placeholder: 'CompAuxNum' });
    const journal = h('select', { id: 'gl-journal' }, h('option', { value: '' }, 'Tous'), ...impN.meta.journaux.map((j) => h('option', { value: j.code, selected: j.code === filtresGL.journal }, `${j.code} — ${j.libelle}`)));
    const du = entree('gl-du', 'date', filtresGL.du);
    const au = entree('gl-au', 'date', filtresGL.au);
    const min = entree('gl-min', 'number', filtresGL.montantMin === undefined ? undefined : filtresGL.montantMin / 100, { step: '0.01', min: '0', inputmode: 'decimal' });
    const max = entree('gl-max', 'number', filtresGL.montantMax === undefined ? undefined : filtresGL.montantMax / 100, { step: '0.01', min: '0', inputmode: 'decimal' });
    const libelle = entree('gl-libelle', 'search', filtresGL.libelle, { placeholder: 'Libellé, pièce, tiers' });
    const lettrage = h(
      'select',
      { id: 'gl-lettrage' },
      ...(['tous', 'lettre', 'non-lettre'] as const).map((v) => h('option', { value: v, selected: (filtresGL.lettrage ?? 'tous') === v }, { tous: 'Toutes les lignes', lettre: 'Lettrées', 'non-lettre': 'Non lettrées' }[v])),
    );
    const resume = h('p', { class: 'note', role: 'status', 'aria-live': 'polite' });
    const entete = h(
      'div',
      { class: 'ligne-gl entete-liste', role: 'row' },
      ...['Compte', 'Date', 'Jnl', 'N°', 'Pièce', 'Auxiliaire', 'Libellé', 'Débit', 'Crédit', 'Solde', 'Let.'].map((x) =>
        h('span', { role: 'columnheader', class: ['Débit', 'Crédit', 'Solde'].includes(x) ? 'montant' : undefined }, x),
      ),
    );
    const liste = creerListeVirtuelle({ hauteurLigne: 32, entete, libelle: 'Grand-livre' });
    let gl: GrandLivre;
    const euros = (v: string) => (v.trim() === '' ? undefined : Math.round(Number(v.replace(',', '.')) * 100));
    const appliquer = () => {
      filtresGL = {
        compte: compte.value.trim() || undefined,
        auxiliaire: aux.value.trim() || undefined,
        journal: journal.value || undefined,
        du: du.value || undefined,
        au: au.value || undefined,
        montantMin: euros(min.value),
        montantMax: euros(max.value),
        libelle: libelle.value.trim() || undefined,
        lettrage: lettrage.value as FiltresGrandLivre['lettrage'],
      };
      gl = filtrerGrandLivre(ctx, filtresGL);
      resume.textContent = `${nombreFr(gl.lignes.length)} ligne(s) · total débit ${formaterMontant(gl.totalDebit)} · total crédit ${formaterMontant(gl.totalCredit)}`;
      liste.definir(gl.lignes.length, (k) => {
        const i = gl.lignes[k]!;
        const l = h(
          'div',
          { class: `ligne-gl ligne-cliquable${ctx.an[i] ? ' ligne-an' : ''}`, role: 'row', tabindex: '0', title: 'Ouvrir l’écriture complète' },
          h('span', { role: 'cell', class: 'mono' }, t(f, 'compteNum', i)),
          h('span', { role: 'cell' }, dateLigne(f.ecritureDate[i]!)),
          h('span', { role: 'cell' }, t(f, 'journalCode', i)),
          h('span', { role: 'cell', class: 'mono' }, t(f, 'ecritureNum', i)),
          h('span', { role: 'cell', class: 'tronque' }, t(f, 'pieceRef', i)),
          h('span', { role: 'cell', class: 'tronque' }, t(f, 'compAuxNum', i)),
          h('span', { role: 'cell', class: 'tronque', title: t(f, 'ecritureLib', i) }, t(f, 'ecritureLib', i)),
          h('span', { role: 'cell', class: 'montant' }, montant(f.debit[i]!)),
          h('span', { role: 'cell', class: 'montant' }, montant(f.credit[i]!)),
          h('span', { role: 'cell', class: 'montant' }, solde(gl.soldes[k]!)),
          h('span', { role: 'cell' }, t(f, 'ecritureLet', i)),
        );
        const ouvrir = () => ouvrirEcriture(f.ecriture[i]!);
        l.addEventListener('click', ouvrir);
        l.addEventListener('keydown', (ev) => ev.key === 'Enter' && ouvrir());
        return l;
      });
    };
    const formulaire = h(
      'div',
      { class: 'filtres-gl', role: 'search', 'aria-label': 'Filtres du grand-livre' },
      h(
        'div',
        { class: 'ligne-champs' },
        champ(compte.id, 'Compte (début)', compte),
        champ(aux.id, 'Auxiliaire', aux),
        champ(journal.id, 'Journal', journal),
        champ(du.id, 'Du', du),
        champ(au.id, 'Au', au),
        champ(min.id, 'Montant min. (€)', min),
        champ(max.id, 'Montant max. (€)', max),
        champ(libelle.id, 'Texte', libelle),
        champ(lettrage.id, 'Lettrage', lettrage),
      ),
      h(
        'div',
        { class: 'actions' },
        bouton('Filtrer', appliquer, { primaire: true }),
        bouton('Effacer les filtres', () => {
          for (const x of [compte, aux, du, au, min, max, libelle]) x.value = '';
          journal.value = '';
          lettrage.value = 'tous';
          appliquer();
        }),
        bouton('Exporter (.xlsx)', () => {
          const description = Object.entries(filtresGL)
            .filter(([, v]) => v !== undefined && v !== 'tous')
            .map(([k, v]) => `${k} = ${typeof v === 'number' ? formaterMontant(v) : v}`)
            .join(' ; ');
          void exporter('Grand_livre', (X) => classeurGrandLivre(X, ctx, gl, description, parametres()));
        }),
      ),
    );
    formulaire.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') appliquer();
    });
    queueMicrotask(appliquer);
    return h('div', {}, formulaire, resume, liste.element, h('p', { class: 'note texte-secondaire' }, 'Cliquez sur une ligne (ou Entrée) pour afficher l’écriture complète. Les à-nouveaux apparaissent en tête de chaque compte.'));
  }

  // ---- Statistiques ------------------------------------------------------------------------------
  function graphiqueBenford(s: Statistiques): SVGSVGElement {
    const ns = 'http://www.w3.org/2000/svg';
    const el = <K extends keyof SVGElementTagNameMap>(nom: K, attributs: Record<string, string | number>, ...enfants: (SVGElement | string)[]) => {
      const e = document.createElementNS(ns, nom);
      for (const [k, v] of Object.entries(attributs)) e.setAttribute(k, String(v));
      e.append(...enfants);
      return e;
    };
    const L = 520;
    const H = 220;
    const m = { g: 44, d: 12, h: 12, b: 34 };
    const largeur = (L - m.g - m.d) / 9;
    const total = s.benford.total || 1;
    const maxP = Math.max(0.32, ...s.benford.observes.map((n) => n / total));
    const y = (p: number) => m.h + (H - m.h - m.b) * (1 - p / maxP);
    const svg = el('svg', { viewBox: `0 0 ${L} ${H}`, class: 'graphique-benford', role: 'img', 'aria-label': 'Premier chiffre des montants : observé (barres) et attendu selon la loi de Benford (traits)' });
    for (const p of [0, 0.1, 0.2, 0.3]) {
      svg.append(el('line', { x1: m.g, x2: L - m.d, y1: y(p), y2: y(p), class: 'grille' }), el('text', { x: m.g - 6, y: y(p) + 4, 'text-anchor': 'end', class: 'axe' }, `${p * 100} %`));
    }
    s.benford.observes.forEach((n, d) => {
      const obs = n / total;
      const att = s.benford.attendues[d]!;
      const x = m.g + d * largeur;
      const titre = el('title', {}, `Chiffre ${d + 1} : observé ${(obs * 100).toFixed(1)} % (${nombreFr(n)}), attendu ${(att * 100).toFixed(1)} %`);
      const barre = el('rect', { x: x + largeur * 0.2, y: y(obs), width: largeur * 0.6, height: Math.max(0, y(0) - y(obs)), rx: 3, class: 'barre-observee' }, titre);
      const zone = el('rect', { x, y: m.h, width: largeur, height: H - m.h - m.b, class: 'zone-survol' }, el('title', {}, titre.textContent ?? ''));
      svg.append(barre, el('line', { x1: x + largeur * 0.12, x2: x + largeur * 0.88, y1: y(att), y2: y(att), class: 'trait-attendu' }), zone, el('text', { x: x + largeur / 2, y: H - m.b + 16, 'text-anchor': 'middle', class: 'axe' }, String(d + 1)));
    });
    return svg;
  }

  function vueStatistiques(): HTMLElement {
    const s = (cache.stats ??= calculerStatistiques(ctx));
    const detail = h('div', { class: 'detail-indicateur' });
    const montrer = (titre: string, ecritures: number[]) => {
      detail.replaceChildren(h('h4', {}, `${titre} — ${nombreFr(ecritures.length)} écriture(s)`), ecritures.length ? listeEcritures(ecritures, titre) : h('p', { class: 'texte-secondaire' }, 'Aucune écriture.'));
      detail.scrollIntoView({ block: 'nearest' });
    };
    const moisCourts = s.mois.map((m) => `${m.slice(5)}/${m.slice(2, 4)}`);
    const tableJM = h(
      'div',
      { class: 'tableau-defilant', tabindex: '0', role: 'region', 'aria-label': 'Écritures par journal et par mois' },
      h(
        'table',
        { class: 'tableau tableau-compact' },
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Journal'), ...moisCourts.map((m) => h('th', { scope: 'col', class: 'nombre' }, m)), h('th', { scope: 'col', class: 'nombre' }, 'Total'))),
        h(
          'tbody',
          {},
          ...s.journaux.map((j, r) =>
            h('tr', {}, h('th', { scope: 'row' }, j), ...s.ecrituresParJournalMois[r]!.map((n) => h('td', { class: 'nombre' }, n ? nombreFr(n) : '')), h('td', { class: 'nombre' }, nombreFr(s.ecrituresParJournalMois[r]!.reduce((a, b) => a + b, 0)))),
          ),
        ),
      ),
    );
    const indicateurs = h(
      'ul',
      { class: 'liste-indicateurs' },
      ...s.indicateurs.map((ind) => {
        const b = bouton(`Voir (${nombreFr(ind.ecritures.length)})`, () => montrer(ind.libelle, ind.ecritures));
        if (!ind.ecritures.length) b.disabled = true;
        return h('li', { class: 'indicateur' }, h('div', {}, h('strong', {}, ind.libelle), h('p', { class: 'note texte-secondaire' }, ind.description)), h('span', { class: 'compte-indicateur' }, nombreFr(ind.ecritures.length)), b);
      }),
    );
    const tableBenford = h(
      'table',
      { class: 'tableau tableau-compact' },
      h('thead', {}, h('tr', {}, ...['Chiffre', 'Observé', 'Observé %', 'Attendu %', ''].map((x, k) => h('th', { scope: 'col', class: k > 0 && k < 4 ? 'nombre' : undefined }, x)))),
      h(
        'tbody',
        {},
        ...s.benford.observes.map((n, d) =>
          h(
            'tr',
            {},
            h('th', { scope: 'row' }, String(d + 1)),
            h('td', { class: 'nombre' }, nombreFr(n)),
            h('td', { class: 'nombre' }, `${((n / (s.benford.total || 1)) * 100).toFixed(1)} %`),
            h('td', { class: 'nombre' }, `${(s.benford.attendues[d]! * 100).toFixed(1)} %`),
            h('td', {}, bouton('Écritures', () => montrer(`Montants commençant par ${d + 1}`, ecrituresDuChiffre(ctx, d + 1)))),
          ),
        ),
      ),
    );
    return h(
      'div',
      {},
      h('p', { class: 'avertissement-officiel' }, 'Ces indicateurs sont des pistes pour les tests sur les écritures de journal, pas des conclusions.'),
      h('div', { class: 'actions' }, bouton('Exporter les statistiques (.xlsx)', () => void exporter('Statistiques', (X) => classeurStatistiques(X, ctx, s, parametres())))),
      h('h3', {}, 'Écritures par journal et par mois'),
      tableJM,
      h('h3', {}, 'Tests d’écritures'),
      indicateurs,
      h('h3', {}, 'Premier chiffre des montants (loi de Benford)'),
      h(
        'p',
        { class: 'note texte-secondaire' },
        `${nombreFr(s.benford.total)} lignes d’au moins 10 € hors à-nouveaux · écart absolu moyen ${s.benford.mad.toFixed(4)} · conformité : ${s.benford.conformite} (seuils de Nigrini).`,
      ),
      h(
        'div',
        { class: 'benford' },
        h('figure', {}, graphiqueBenford(s), h('figcaption', { class: 'legende' }, h('span', { class: 'puce-observe', 'aria-hidden': 'true' }), 'Observé ', h('span', { class: 'puce-attendu', 'aria-hidden': 'true' }), 'Attendu (Benford)')),
        tableBenford,
      ),
      detail,
    );
  }

  // ---- Onglets -----------------------------------------------------------------------------------
  const boutonsOnglets = ONGLETS.map((o) => {
    const b = h('button', { type: 'button', role: 'tab', class: 'onglet', id: `onglet-${o.id}`, 'aria-selected': String(o.id === actif), 'aria-controls': 'panneau-analyse' }, o.libelle);
    b.addEventListener('click', () => choisir(o.id));
    return b;
  });
  onglets.addEventListener('keydown', (e) => {
    const i = ONGLETS.findIndex((o) => o.id === actif);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const j = (i + (e.key === 'ArrowRight' ? 1 : ONGLETS.length - 1)) % ONGLETS.length;
      choisir(ONGLETS[j]!.id);
      boutonsOnglets[j]!.focus();
    }
  });
  panneau.id = 'panneau-analyse';

  function choisir(o: Onglet): void {
    actif = o;
    boutonsOnglets.forEach((b, k) => {
      b.setAttribute('aria-selected', String(ONGLETS[k]!.id === o));
      b.tabIndex = ONGLETS[k]!.id === o ? 0 : -1;
    });
    panneau.setAttribute('aria-labelledby', `onglet-${o}`);
    panneau.replaceChildren(h('p', { class: 'texte-secondaire' }, 'Calcul en cours…'));
    // Laisse le navigateur afficher « Calcul en cours… » avant un calcul éventuellement long.
    setTimeout(() => {
      if (detruit) return;
      const vue = { chiffres: vueChiffres, tft: vueTft, balance: vueBalance, auxiliaire: vueAuxiliaire, 'grand-livre': vueGrandLivre, statistiques: vueStatistiques }[o];
      panneau.replaceChildren(vue());
    }, 20);
  }

  void (async () => {
    try {
      const [colonnes, colonnesN1] = await Promise.all([lireColonnes(impN.id), impN1 ? lireColonnes(impN1.id) : Promise.resolve(null)]);
      if (detruit) return;
      if (!colonnes) {
        etat.textContent = 'Données du FEC introuvables dans le stockage local : réimportez le fichier.';
        return;
      }
      ctx = contexteDe(impN, colonnes);
      ctxN1 = impN1 && colonnesN1 ? contexteDe(impN1, colonnesN1) : null;
      etat.textContent = `Exercice du ${dateFr(ctx.debut)} au ${dateFr(ctx.fin)} · journal d’à-nouveaux : ${r.journalAN ?? 'aucun'}${r.journalANConfirme ? '' : ' (à confirmer)'}${ctxN1 ? ` · comparaison avec l’exercice précédent (${impN1!.meta.nomFichier})` : ''}.`;
      onglets.replaceChildren(...boutonsOnglets);
      choisir(actif);
    } catch (e) {
      etat.textContent = `Analyses indisponibles : ${e instanceof Error ? e.message : String(e)}`;
    }
  })();

  return {
    element,
    detruire() {
      detruit = true;
      if (dialogue.open) dialogue.close();
    },
  };
}
