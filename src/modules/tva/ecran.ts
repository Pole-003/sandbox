/**
 * Écran du cadrage de TVA, partie 1 : dépôt en lot des CA3 (PDF, dans n'importe quel ordre), tri par
 * période, tableau de vérification « case par période » avec corrections tracées, saisie manuelle d'une
 * déclaration illisible, anomalies de lecture, de calcul et de série. Tout reste sur le poste.
 */
import { h } from '../../app/dom.ts';
import { formaterMontant } from '../../core/format.ts';
import { ecrirePreference, lirePreference } from '../../core/stockage.ts';
import { bouton, dateFr, nombreFr } from '../fec/ecran/commun.ts';
import { listerDossiers, type Dossier } from '../fec/stockage/base-fec.ts';
import { CASES_PAR_CODE } from './ca3-cases.ts';
import type { Gravite, IdentificationCa3, ValeurCase } from './ca3/analyse.ts';
import { controlerDeclaration, controlerSerie, periodicite, trierParPeriode, type MessageControle } from './ca3/controles.ts';
import { recapitulatifG300, TITRES_BLOCS } from './cadrage/g300.ts';
import { libellePeriode, valeursRetenues, type Colonne, type DeclarationCa3 } from './ca3/declaration.ts';
import { CASES_SAISIE, declarationSaisie, identificationVide, lireFichierCa3 } from './ca3/import-ca3.ts';
import { rendreCadrage, type EcranCadrage } from './ecran-cadrage.ts';
import { enregistrerTva, lireTva, type DonneesTva } from './stockage.ts';

const PREF_DOSSIER = 'tva-dossier';
const LIBELLES_GRAVITE: Record<Gravite, string> = { anomalie: 'Anomalie', avertissement: 'Avertissement', information: 'Information' };
const CLASSE_GRAVITE: Record<Gravite, string> = { anomalie: 'badge-gravite-non-conforme', avertissement: 'badge-gravite-anomalie', information: 'badge-gravite-information' };

/** Euros entiers au format français (les CA3 n'ont pas de centimes) : « 125 000 ». */
const euros = (c: number) => formaterMontant(c).replace(/,00$/, '');
const versCentimes = (texte: string): number | null | undefined => {
  const t = texte.replace(/[\s  ]/g, '').replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) : undefined;
};
const versIso = (jjmmaaaa: string) => (/^\d{4}-\d{2}-\d{2}$/.test(jjmmaaaa) ? jjmmaaaa : null);

function badge(g: Gravite): HTMLElement {
  return h('span', { class: `badge ${CLASSE_GRAVITE[g]}` }, LIBELLES_GRAVITE[g]);
}

export function rendreEcranTva(conteneur: HTMLElement): () => void {
  let detruit = false;
  let dossiers: Dossier[] = [];
  let dossier: Dossier | null = null;
  let donnees: DonneesTva | null = null;
  let cadrage: EcranCadrage | null = null;

  const annonce = h('p', { class: 'visuellement-masque', role: 'status', 'aria-live': 'polite' });
  const entete = h('div');
  const zoneDepot = h('div');
  const zoneSerie = h('div');
  const zoneTableau = h('div');
  const zoneCadrage = h('div');
  const zoneDeclarations = h('div');
  const zoneAnomalies = h('div');
  const dialogue = h('dialog', { class: 'dialogue-ecriture dialogue-tva', 'aria-labelledby': 'titre-dialogue-tva' }) as HTMLDialogElement;
  conteneur.replaceChildren(
    h(
      'div',
      { class: 'ecran ecran-fec ecran-tva' },
      h('h1', {}, 'Cadrage de TVA'),
      h('p', { class: 'texte-secondaire' }, 'Lecture des déclarations CA3 de l’exercice, récapitulatif des montants déclarés (G300), reconstitution de la TVA collectée à partir du FEC (G340), cadrage par période et justification de l’écart. Les PDF sont lus dans votre navigateur ; ils ne sont ni envoyés ni conservés (seules les valeurs lues et l’empreinte de chaque fichier sont enregistrées sur ce poste).'),
      annonce,
      entete,
      zoneDepot,
      zoneSerie,
      zoneTableau,
      zoneCadrage,
      zoneAnomalies,
      zoneDeclarations,
      dialogue,
    ),
  );
  const dire = (t: string) => (annonce.textContent = t);

  async function sauver(): Promise<void> {
    if (donnees) await enregistrerTva(donnees);
  }

  function declarations(): DeclarationCa3[] {
    return donnees ? trierParPeriode(donnees.declarations) : [];
  }

  function rendreTout(): void {
    rendreDepot();
    rendreSerie();
    rendreTableau();
    rendreAnomalies();
    rendreDeclarations();
    cadrage?.maj();
  }

  // ---- Dossier -----------------------------------------------------------------------------------
  async function choisirDossier(id: string | null): Promise<void> {
    dossier = dossiers.find((d) => d.id === id) ?? null;
    ecrirePreference(PREF_DOSSIER, dossier?.id ?? null);
    donnees = null;
    cadrage?.detruire();
    cadrage = null;
    rendreEntete();
    for (const z of [zoneDepot, zoneSerie, zoneTableau, zoneCadrage, zoneAnomalies, zoneDeclarations]) z.replaceChildren();
    if (!dossier) return;
    const d = dossier;
    const lu = await lireTva(d.id);
    if (detruit || dossier !== d) return;
    donnees = lu;
    cadrage = rendreCadrage(zoneCadrage, d, () => donnees, sauver, dire);
    rendreTout();
  }

  function rendreEntete(): void {
    if (dossiers.length === 0) {
      entete.replaceChildren(h('p', { class: 'carte' }, 'Aucun dossier. ', h('a', { href: '#/fec' }, 'Créez le dossier et importez son FEC dans le module FEC'), '.'));
      return;
    }
    const select = h(
      'select',
      { id: 'tva-dossier' },
      h('option', { value: '' }, '— Choisir un dossier —'),
      ...dossiers.map((d) => h('option', { value: d.id, selected: d.id === dossier?.id }, `${d.nom}${d.siren ? ` (${d.siren})` : ''}`)),
    );
    select.addEventListener('change', () => void choisirDossier(select.value || null));
    entete.replaceChildren(h('section', { class: 'carte barre-dossiers' }, h('div', { class: 'champ' }, h('label', { for: 'tva-dossier' }, 'Dossier'), select)));
  }

  // ---- Dépôt -------------------------------------------------------------------------------------
  async function deposer(fichiers: File[]): Promise<void> {
    if (!donnees) return;
    const pdf = fichiers.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    if (pdf.length < fichiers.length) dire(`${fichiers.length - pdf.length} fichier(s) ignoré(s) : seuls les PDF sont acceptés.`);
    const ignores: string[] = [];
    for (const [k, f] of pdf.entries()) {
      dire(`Lecture de ${f.name} (${k + 1}/${pdf.length})…`);
      etatDepot.textContent = `Lecture de ${f.name} (${k + 1}/${pdf.length})…`;
      const d = await lireFichierCa3(f);
      if (detruit || !donnees) return;
      if (donnees.declarations.some((x) => x.empreinte === d.empreinte)) {
        ignores.push(f.name);
        continue;
      }
      donnees.declarations.push(d);
    }
    await sauver();
    etatDepot.textContent = `${pdf.length - ignores.length} déclaration(s) lue(s)${ignores.length ? ` ; déjà déposée(s), ignorée(s) : ${ignores.join(', ')}` : ''}.`;
    dire(etatDepot.textContent);
    rendreTout();
  }

  const etatDepot = h('p', { class: 'note', role: 'status' });
  function rendreDepot(): void {
    const entree = h('input', { type: 'file', id: 'tva-fichiers', accept: 'application/pdf,.pdf', multiple: true, class: 'visuellement-masque' }) as HTMLInputElement;
    entree.addEventListener('change', () => {
      void deposer([...(entree.files ?? [])]);
      entree.value = '';
    });
    const zone = h(
      'label',
      { for: 'tva-fichiers', class: 'zone-depot' },
      h('strong', {}, 'Déposez les CA3 de l’exercice (PDF)'),
      h('span', { class: 'texte-secondaire' }, 'Les 12 déclarations en une fois, dans n’importe quel ordre, ou cliquez pour choisir les fichiers.'),
    );
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('survol');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('survol'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('survol');
      void deposer([...(e.dataTransfer?.files ?? [])]);
    });
    zoneDepot.replaceChildren(
      h(
        'section',
        { class: 'carte', 'aria-labelledby': 'titre-depot-tva' },
        h('h2', { id: 'titre-depot-tva' }, 'Déclarations CA3'),
        entree,
        zone,
        etatDepot,
        h('div', { class: 'actions' }, bouton('Saisir une déclaration à la main', () => ouvrirSaisie(null))),
      ),
    );
  }

  // ---- Série -------------------------------------------------------------------------------------
  function messagesSerie(): MessageControle[] {
    return controlerSerie(declarations());
  }

  function messagesDeclaration(d: DeclarationCa3): MessageControle[] {
    return [...d.messagesLecture, ...controlerDeclaration(valeursRetenues(d))].map((m) => ({ ...m, declaration: d.id }));
  }

  function rendreSerie(): void {
    const liste = declarations();
    if (liste.length === 0) {
      zoneSerie.replaceChildren();
      return;
    }
    const ids = liste.map((d) => d.identification);
    const denomination = ids.find((i) => i.denomination)?.denomination ?? '—';
    const sirens = [...new Set(ids.map((i) => i.siren).filter(Boolean))];
    const debut = ids.find((i) => i.debut)?.debut;
    const fin = [...ids].reverse().find((i) => i.fin)?.fin;
    const tous = [...liste.flatMap(messagesDeclaration), ...messagesSerie()];
    const nb = (g: Gravite) => tous.filter((m) => m.gravite === g).length;
    const per = periodicite(liste);
    zoneSerie.replaceChildren(
      h(
        'section',
        { class: `bandeau ${nb('anomalie') ? 'bandeau-alerte' : 'bandeau-succes'}`, 'aria-label': 'Synthèse de la série' },
        h(
          'p',
          {},
          h('strong', {}, denomination),
          ` · SIREN ${sirens.join(', ') || '—'} · ${nombreFr(liste.length)} déclaration(s) ${per === 'inconnue' ? '' : per === 'mixte' ? '(périodicité mixte)' : per + 's'} · du ${dateFr(debut)} au ${dateFr(fin)}`,
        ),
        h('p', {}, `${nb('anomalie')} anomalie(s), ${nb('avertissement')} avertissement(s), ${nb('information')} information(s).`),
      ),
    );
  }

  // ---- Tableau case par période -------------------------------------------------------------------
  function rendreTableau(): void {
    const liste = declarations();
    if (liste.length === 0) {
      zoneTableau.replaceChildren();
      return;
    }
    const retenues = liste.map((d) => valeursRetenues(d));
    const corps = h('tbody');
    const cellule = (d: DeclarationCa3, v: Record<string, ValeurCase>, code: string, colonne: Colonne) => {
      const x = v[code]?.[colonne];
      const corrections = d.corrections.filter((c) => c.code === code && c.colonne === colonne);
      const b = h(
        'button',
        {
          type: 'button',
          class: `cellule-ca3${corrections.length ? ' cellule-corrigee' : ''}`,
          'aria-label': `${code} ${colonne === 'montant' ? '' : colonne === 'base' ? 'base' : 'taxe'} ${libellePeriode(d.identification.debut, d.identification.fin)} : ${x === undefined ? 'vide' : euros(x)}${corrections.length ? ', corrigé' : ''}. Corriger`,
          title: corrections.length ? corrections.map((c) => `${c.avant === null ? 'vide' : euros(c.avant)} → ${c.apres === null ? 'vide' : euros(c.apres)} le ${new Date(c.le).toLocaleString('fr-FR')} : ${c.motif}`).join('\n') : 'Cliquer pour corriger',
        },
        x === undefined ? '' : CASES_PAR_CODE.get(code)?.pourcentage ? `${(x / 100).toLocaleString('fr-FR')} %` : euros(x),
      );
      b.addEventListener('click', () => ouvrirCorrection(d, code, colonne));
      return h('td', { class: 'nombre montant' }, b);
    };
    // Disposition du récapitulatif G300 : opérations, taux (base puis taxe), TVA collectée déclarée, 15 et 5B à part, 16, déductible, solde.
    let bloc = '';
    for (const l of recapitulatifG300(retenues)) {
      if (l.bloc !== bloc && l.bloc !== 'collectee') {
        bloc = l.bloc;
        corps.append(h('tr', { class: 'ligne-section' }, h('th', { scope: 'rowgroup', colspan: String(liste.length + 3) }, TITRES_BLOCS[l.bloc])));
      }
      if (l.code === 'COLLECTEE') {
        corps.append(
          h(
            'tr',
            { class: 'ligne-solde' },
            h('th', { scope: 'row', colspan: '2' }, l.libelle),
            ...l.valeurs.map((c) => h('td', { class: 'nombre montant' }, euros(c ?? 0))),
            h('td', { class: 'nombre montant total' }, euros(l.total ?? 0)),
          ),
        );
        continue;
      }
      corps.append(
        h(
          'tr',
          { class: l.colonne === 'taxe' ? undefined : 'debut-case' },
          h('th', { scope: 'row', class: 'mono' }, l.colonne === 'taxe' ? '' : l.code),
          h('td', { class: 'libelle-case' }, l.colonne === 'taxe' ? h('span', { class: 'note texte-secondaire' }, 'taxe due') : l.libelle.replace(' — base hors taxe', ''), l.colonne === 'base' ? h('span', { class: 'note texte-secondaire' }, ' — base HT') : ''),
          ...liste.map((d, i) => cellule(d, retenues[i]!, l.code, l.colonne ?? 'montant')),
          h('td', { class: 'nombre montant total' }, l.total === null ? '' : euros(l.total)),
        ),
      );
    }
    zoneTableau.replaceChildren(
      h(
        'section',
        { class: 'carte', 'aria-labelledby': 'titre-tableau-tva' },
        h('h2', { id: 'titre-tableau-tva' }, 'Récapitulatif des déclarations (G300) et vérification case par période'),
        h('p', { class: 'note texte-secondaire' }, 'Seules les cases servies au moins une fois sont affichées. Cliquez sur une valeur pour la corriger : la correction est tracée (valeur lue, nouvelle valeur, date, motif) et signalée en couleur.'),
        h(
          'div',
          { class: 'tableau-defilant', tabindex: '0', role: 'region', 'aria-label': 'Cases par période' },
          h(
            'table',
            { class: 'tableau tableau-ca3' },
            h(
              'thead',
              {},
              h(
                'tr',
                {},
                h('th', { scope: 'col' }, 'Case'),
                h('th', { scope: 'col' }, 'Libellé'),
                ...liste.map((d) => h('th', { scope: 'col', class: 'nombre' }, libellePeriode(d.identification.debut, d.identification.fin))),
                h('th', { scope: 'col', class: 'nombre' }, 'Total'),
              ),
            ),
            corps,
          ),
        ),
      ),
    );
  }

  // ---- Correction d'une valeur ------------------------------------------------------------------------
  function ouvrirCorrection(d: DeclarationCa3, code: string, colonne: Colonne): void {
    const actuelle = valeursRetenues(d)[code]?.[colonne];
    const lue = d.lues[code]?.[colonne];
    const valeur = h('input', { id: 'correction-valeur', type: 'text', inputmode: 'decimal', autocomplete: 'off', value: actuelle === undefined ? '' : String(actuelle / 100) });
    const motif = h('textarea', { id: 'correction-motif', rows: '2' });
    const erreur = h('p', { class: 'message-erreur', role: 'alert' });
    const valider = async () => {
      const apres = versCentimes(valeur.value);
      if (apres === undefined) {
        erreur.textContent = 'Montant invalide.';
        return;
      }
      if (!motif.value.trim()) {
        erreur.textContent = 'Le motif de la correction est obligatoire.';
        motif.focus();
        return;
      }
      d.corrections.push({ code, colonne, avant: actuelle ?? null, apres, le: new Date().toISOString(), motif: motif.value.trim() });
      dialogue.close();
      await sauver();
      rendreTout();
      dire(`Case ${code} corrigée.`);
    };
    const historique = d.corrections.filter((c) => c.code === code && c.colonne === colonne);
    dialogue.replaceChildren(
      h('h3', { id: 'titre-dialogue-tva' }, `Corriger la case ${code}${colonne === 'montant' ? '' : colonne === 'base' ? ' (base hors taxe)' : ' (taxe due)'} — ${libellePeriode(d.identification.debut, d.identification.fin)}`),
      h('p', { class: 'note texte-secondaire' }, `${d.source === 'pdf' ? 'Valeur lue dans le PDF' : 'Valeur saisie'} : ${lue === undefined ? 'case vide' : `${euros(lue)} €`}.`),
      historique.length ? h('ul', { class: 'note' }, ...historique.map((c) => h('li', {}, `${new Date(c.le).toLocaleString('fr-FR')} : ${c.avant === null ? 'vide' : euros(c.avant)} → ${c.apres === null ? 'vide' : euros(c.apres)} (${c.motif})`))) : h('span'),
      h('div', { class: 'champ' }, h('label', { for: valeur.id }, 'Nouvelle valeur en euros (vide = case non servie)'), valeur),
      h('div', { class: 'champ' }, h('label', { for: motif.id }, 'Motif (obligatoire)'), motif),
      erreur,
      h(
        'div',
        { class: 'actions' },
        bouton('Valider', () => void valider(), { primaire: true }),
        historique.length
          ? bouton('Annuler les corrections', () => {
              d.corrections = d.corrections.filter((c) => !(c.code === code && c.colonne === colonne));
              dialogue.close();
              void sauver().then(() => {
                rendreTout();
                dire(`Corrections de la case ${code} annulées.`);
              });
            })
          : null,
        bouton('Fermer', () => dialogue.close()),
      ),
    );
    dialogue.showModal();
    valeur.focus();
  }

  // ---- Saisie manuelle ------------------------------------------------------------------------------------
  function ouvrirSaisie(existante: DeclarationCa3 | null): void {
    const id: IdentificationCa3 = existante ? { ...existante.identification } : { ...identificationVide(), siren: dossier?.siren ?? null };
    const v = existante ? valeursRetenues(existante) : {};
    const champDate = (cle: 'debut' | 'fin' | 'dateLimite' | 'dateDepot', libelle: string) => {
      const e = h('input', { id: `saisie-${cle}`, type: 'date', value: id[cle] ?? '' });
      return { e, champ: h('div', { class: 'champ' }, h('label', { for: e.id }, libelle), e) };
    };
    const debut = champDate('debut', 'Début de période');
    const fin = champDate('fin', 'Fin de période');
    const limite = champDate('dateLimite', 'Date limite de dépôt');
    const depot = champDate('dateDepot', 'Date de dépôt');
    const siren = h('input', { id: 'saisie-siren', type: 'text', inputmode: 'numeric', value: id.siren ?? '', autocomplete: 'off' });
    const entrees: { code: string; colonne: Colonne; e: HTMLInputElement }[] = [];
    const lignes = CASES_SAISIE.map((code) => {
      const def = CASES_PAR_CODE.get(code)!;
      const colonnes: Colonne[] = def.colonnes === 2 ? ['base', 'taxe'] : ['montant'];
      return h(
        'tr',
        {},
        h('th', { scope: 'row', class: 'mono' }, code),
        h('td', {}, def.libelle),
        ...(['base', 'taxe'] as const).map((c) => {
          const col: Colonne = def.colonnes === 2 ? c : 'montant';
          if (def.colonnes === 1 && c === 'base') return h('td');
          const x = v[code]?.[col];
          const e = h('input', { type: 'text', inputmode: 'decimal', class: 'champ-montant', autocomplete: 'off', value: x === undefined ? '' : String(x / 100), 'aria-label': `${code} ${colonnes.length === 2 ? (c === 'base' ? 'base hors taxe' : 'taxe due') : 'montant'}` }) as HTMLInputElement;
          entrees.push({ code, colonne: col, e });
          return h('td', {}, e);
        }),
      );
    });
    const erreur = h('p', { class: 'message-erreur', role: 'alert' });
    const valider = async () => {
      if (!donnees) return;
      if (!versIso(debut.e.value) || !versIso(fin.e.value) || fin.e.value < debut.e.value) {
        erreur.textContent = 'La période (début et fin) est obligatoire.';
        return;
      }
      const cases: Record<string, ValeurCase> = {};
      for (const { code, colonne, e } of entrees) {
        const c = versCentimes(e.value);
        if (c === undefined) {
          erreur.textContent = `Montant invalide en case ${code}.`;
          e.focus();
          return;
        }
        if (c !== null) (cases[code] ??= {})[colonne] = c;
      }
      const identification: IdentificationCa3 = {
        ...id,
        siren: siren.value.replace(/\s/g, '') || null,
        debut: debut.e.value,
        fin: fin.e.value,
        dateLimite: versIso(limite.e.value),
        dateDepot: versIso(depot.e.value),
      };
      const cible = existante ?? declarationSaisie(identification);
      cible.identification = identification;
      cible.source = 'saisie';
      cible.lues = cases;
      cible.corrections = [];
      cible.messagesLecture = existante?.nomFichier ? [{ gravite: 'information', code: 'SAISIE', message: `Saisie manuelle (PDF ${existante.nomFichier} illisible).` }] : [];
      if (!existante) donnees.declarations.push(cible);
      dialogue.close();
      await sauver();
      rendreTout();
      dire('Déclaration saisie enregistrée.');
    };
    dialogue.replaceChildren(
      h('h3', { id: 'titre-dialogue-tva' }, existante?.nomFichier ? `Saisie manuelle — ${existante.nomFichier}` : 'Saisie manuelle d’une déclaration CA3'),
      h('p', { class: 'note texte-secondaire' }, 'Montants en euros, tels qu’ils figurent sur la déclaration. Laissez vides les cases non servies.'),
      h('div', { class: 'ligne-champs' }, h('div', { class: 'champ' }, h('label', { for: siren.id }, 'SIREN'), siren), debut.champ, fin.champ, limite.champ, depot.champ),
      h(
        'div',
        { class: 'tableau-defilant tableau-hauteur', tabindex: '0', role: 'region', 'aria-label': 'Cases de la déclaration' },
        h('table', { class: 'tableau tableau-compact' }, h('thead', {}, h('tr', {}, ...['Case', 'Libellé', 'Base hors taxe', 'Taxe due / montant'].map((x) => h('th', { scope: 'col' }, x)))), h('tbody', {}, ...lignes)),
      ),
      erreur,
      h('div', { class: 'actions' }, bouton('Enregistrer', () => void valider(), { primaire: true }), bouton('Annuler', () => dialogue.close())),
    );
    dialogue.showModal();
    debut.e.focus();
  }

  // ---- Anomalies ---------------------------------------------------------------------------------------
  function rendreAnomalies(): void {
    const liste = declarations();
    if (liste.length === 0) {
      zoneAnomalies.replaceChildren();
      return;
    }
    const parId = new Map(liste.map((d) => [d.id, d]));
    const tous = [...messagesSerie().map((m) => ({ ...m, serie: true })), ...liste.flatMap(messagesDeclaration).map((m) => ({ ...m, serie: false }))];
    const ordre: Record<Gravite, number> = { anomalie: 0, avertissement: 1, information: 2 };
    tous.sort((a, b) => ordre[a.gravite] - ordre[b.gravite]);
    zoneAnomalies.replaceChildren(
      h(
        'section',
        { class: 'carte', 'aria-labelledby': 'titre-anomalies-tva' },
        h('h2', { id: 'titre-anomalies-tva' }, `Contrôles (${nombreFr(tous.length)})`),
        tous.length === 0
          ? h('p', { class: 'bandeau bandeau-succes' }, 'Aucune anomalie : calculs de chaque déclaration et continuité de la série vérifiés.')
          : h(
              'ul',
              { class: 'liste-anomalies' },
              ...tous.map((m) => {
                const d = m.declaration ? parId.get(m.declaration) : undefined;
                return h('li', {}, badge(m.gravite), ' ', h('strong', {}, m.serie ? 'Série' : d ? libellePeriode(d.identification.debut, d.identification.fin) : ''), ' — ', m.message);
              }),
            ),
      ),
    );
  }

  // ---- Liste des déclarations --------------------------------------------------------------------------------
  function rendreDeclarations(): void {
    const liste = declarations();
    if (liste.length === 0) {
      zoneDeclarations.replaceChildren();
      return;
    }
    zoneDeclarations.replaceChildren(
      h(
        'section',
        { class: 'carte', 'aria-labelledby': 'titre-liste-tva' },
        h('h2', { id: 'titre-liste-tva' }, 'Fichiers et saisies'),
        h(
          'div',
          { class: 'tableau-defilant', tabindex: '0', role: 'region', 'aria-label': 'Déclarations' },
          h(
            'table',
            { class: 'tableau tableau-compact' },
            h('thead', {}, h('tr', {}, ...['Période', 'Source', 'Millésime', 'Dépôt', 'Empreinte SHA-256', 'Corrections', ''].map((x) => h('th', { scope: 'col' }, x)))),
            h(
              'tbody',
              {},
              ...liste.map((d) => {
                const illisible = d.source === 'pdf' && d.messagesLecture.some((m) => m.code === 'LECTURE');
                return h(
                  'tr',
                  {},
                  h('th', { scope: 'row' }, libellePeriode(d.identification.debut, d.identification.fin)),
                  h('td', {}, d.source === 'pdf' ? `PDF ${d.nomFichier}` : d.nomFichier ? `Saisie (PDF ${d.nomFichier} illisible)` : 'Saisie manuelle'),
                  h('td', {}, d.identification.millesime ?? '—'),
                  h('td', {}, `${dateFr(d.identification.dateDepot)}${d.identification.dateLimite ? ` (limite ${dateFr(d.identification.dateLimite)})` : ''}`),
                  h('td', { class: 'mono note', title: d.empreinte ?? '' }, d.empreinte ? `${d.empreinte.slice(0, 12)}…` : '—'),
                  h('td', { class: 'nombre' }, nombreFr(d.corrections.length)),
                  h(
                    'td',
                    {},
                    illisible || d.source === 'saisie' ? bouton(illisible ? 'Saisir les valeurs' : 'Modifier la saisie', () => ouvrirSaisie(d), { primaire: illisible }) : null,
                    bouton(
                      'Retirer',
                      () => {
                        if (!donnees || !window.confirm(`Retirer la déclaration ${libellePeriode(d.identification.debut, d.identification.fin)} et ses corrections ?`)) return;
                        donnees.declarations = donnees.declarations.filter((x) => x !== d);
                        void sauver().then(() => {
                          rendreTout();
                          dire('Déclaration retirée.');
                        });
                      },
                      { danger: true },
                    ),
                  ),
                );
              }),
            ),
          ),
        ),
      ),
    );
  }

  void (async () => {
    try {
      dossiers = await listerDossiers();
    } catch (e) {
      entete.replaceChildren(h('p', { class: 'carte message-erreur' }, `Stockage local indisponible : ${e instanceof Error ? e.message : String(e)}`));
      return;
    }
    const prefere = lirePreference(PREF_DOSSIER);
    await choisirDossier(dossiers.find((d) => d.id === prefere)?.id ?? dossiers[0]?.id ?? null);
  })();

  return () => {
    detruit = true;
    cadrage?.detruire();
    if (dialogue.open) dialogue.close();
  };
}
