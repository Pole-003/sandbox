/**
 * Écran de sélection des circularisations (SPEC 4.3) : paramètres et seuils avec recalcul instantané,
 * indicateurs par population, listes avec motifs, ajouts et exclusions justifiés, export du tableau de suivi.
 * Les données viennent du module FEC (interface-circularisations) ; tout reste sur le poste.
 */
import { h } from '../../app/dom.ts';
import { formaterMontant } from '../../core/format.ts';
import { ecrirePreference, lirePreference } from '../../core/stockage.ts';
import { bouton, dateFr, nombreFr, telecharger, TYPE_XLSX } from '../fec/ecran/commun.ts';
import { chargerExcelJS, octetsClasseur } from '../fec/export/xlsx.ts';
import { chargerDonneesFec, type DonneesFec } from '../fec/interface-circularisations.ts';
import { listerDossiers, type Dossier } from '../fec/stockage/base-fec.ts';
import { nouvelleGraine } from './alea.ts';
import { classeurSuivi } from './export-suivi.ts';
import { parametresParDefaut, proposerEtablissement, seuilEffectif, type Critere, type ParametresCircularisation, type Population } from './parametres.ts';
import { LIBELLES_MOTIFS, selectionner, type ResultatPopulation, type Selection, type TiersCandidat } from './selection.ts';
import { enregistrerParametres, lireParametres } from './stockage.ts';

const PREF_DOSSIER = 'circularisations-dossier';

const solde = (c: number) => (c === 0 ? '0,00' : `${formaterMontant(Math.abs(c))} ${c > 0 ? 'D' : 'C'}`);
const pourcentage = (x: number | null) => (x === null ? '—' : `${(x * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`);
const enEuros = (centimes: number | null) => (centimes === null ? '' : String(centimes / 100).replace('.', ','));
const versCentimes = (texte: string): number | null => {
  const t = texte.replace(/\s| | /g, '').replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};
const listePrefixes = (texte: string) =>
  texte
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter((x) => /^\d+$/.test(x));

export function rendreEcranCircularisations(conteneur: HTMLElement): () => void {
  let detruit = false;
  let dossiers: Dossier[] = [];
  let dossier: Dossier | null = null;
  let donnees: DonneesFec | null = null;
  let p: ParametresCircularisation | null = null;
  let selection: Selection | null = null;
  let vue: 'banques' | Population = 'clients';
  const filtres: Record<Population, { texte: string; retenusSeulement: boolean; tri: 'cle' | 'solde' | 'mouvements' }> = {
    clients: { texte: '', retenusSeulement: false, tri: 'cle' },
    fournisseurs: { texte: '', retenusSeulement: false, tri: 'cle' },
  };
  let minuterieSauvegarde: number | undefined;
  let sauvegardeEnAttente = false;
  /** Enregistre sans attendre les modifications en attente (fermeture ou rechargement de la page). */
  const vider = () => {
    if (!sauvegardeEnAttente || !dossier || !p) return;
    window.clearTimeout(minuterieSauvegarde);
    sauvegardeEnAttente = false;
    void enregistrerParametres(dossier.id, structuredClone(p));
  };
  window.addEventListener('pagehide', vider);

  const annonce = h('p', { class: 'visuellement-masque', role: 'status', 'aria-live': 'polite' });
  const entete = h('div');
  const bandeau = h('div');
  const zoneParametres = h('div');
  const zoneResultats = h('div');
  const dialogue = h('dialog', { class: 'dialogue-ecriture', 'aria-labelledby': 'titre-justification' }) as HTMLDialogElement;
  conteneur.replaceChildren(
    h(
      'div',
      { class: 'ecran ecran-fec ecran-circularisations' },
      h('h1', {}, 'Circularisations'),
      h('p', { class: 'texte-secondaire' }, 'Sélection des banques, clients et fournisseurs à circulariser à partir du FEC du dossier, et tableau de suivi. Tout est calculé sur ce poste.'),
      annonce,
      entete,
      bandeau,
      zoneParametres,
      zoneResultats,
      dialogue,
    ),
  );
  const dire = (t: string) => (annonce.textContent = t);

  function sauvegarder(): void {
    if (!dossier || !p) return;
    window.clearTimeout(minuterieSauvegarde);
    const id = dossier.id;
    sauvegardeEnAttente = true;
    minuterieSauvegarde = window.setTimeout(() => {
      sauvegardeEnAttente = false;
      if (p && dossier?.id === id) void enregistrerParametres(id, structuredClone(p));
    }, 400);
  }

  /** Recalcul instantané après toute modification ; la sélection n'est plus « arrêtée ». */
  function recalculer(modification = true): void {
    if (!donnees || !p) return;
    if (modification && p.selectionArreteeLe) p.selectionArreteeLe = null;
    selection = selectionner(donnees, p);
    rendreBandeau();
    rendreResultats();
    if (modification) sauvegarder();
  }

  // ---- Chargement --------------------------------------------------------------------------------
  async function choisirDossier(id: string | null): Promise<void> {
    vider();
    dossier = dossiers.find((d) => d.id === id) ?? null;
    ecrirePreference(PREF_DOSSIER, dossier?.id ?? null);
    donnees = null;
    p = null;
    selection = null;
    bandeau.replaceChildren();
    zoneParametres.replaceChildren();
    zoneResultats.replaceChildren(dossier ? h('p', { class: 'texte-secondaire' }, 'Chargement des données du FEC…') : h('div'));
    rendreEntete();
    if (!dossier) return;
    const d = dossier;
    const [fec, parametres] = await Promise.all([chargerDonneesFec(d.id), lireParametres(d.id)]);
    if (detruit || dossier !== d) return;
    if (!fec) {
      zoneResultats.replaceChildren(h('p', { class: 'carte' }, 'Ce dossier n’a pas encore de FEC de l’exercice : importez-le dans le module FEC.'));
      return;
    }
    donnees = fec;
    p = parametres ?? parametresParDefaut(fec.metadonnees.dateCloture);
    if (!parametres) {
      // Établissements proposés d'après les libellés, modifiables ensuite.
      for (const c of fec.comptesBancaires([...p.banques.prefixes, '50'])) p.banques.etablissements[c.compteNum] = proposerEtablissement(c.compteLib);
      sauvegarder();
    }
    rendreParametres();
    recalculer(false);
  }

  function rendreEntete(): void {
    const avecFec = dossiers.filter((d) => d.fec.N);
    if (avecFec.length === 0) {
      entete.replaceChildren(
        h('p', { class: 'carte' }, 'Aucun dossier avec un FEC importé. ', h('a', { href: '#/fec' }, 'Importer un FEC dans le module FEC'), '.'),
      );
      return;
    }
    const select = h(
      'select',
      { id: 'circ-dossier' },
      h('option', { value: '' }, '— Choisir un dossier —'),
      ...avecFec.map((d) => h('option', { value: d.id, selected: d.id === dossier?.id }, `${d.nom}${d.siren ? ` (${d.siren})` : ''}`)),
    );
    select.addEventListener('change', () => void choisirDossier(select.value || null));
    entete.replaceChildren(h('section', { class: 'carte barre-dossiers' }, h('div', { class: 'champ' }, h('label', { for: 'circ-dossier' }, 'Dossier'), select)));
  }

  // ---- Bandeau graine / date ---------------------------------------------------------------------
  function rendreBandeau(): void {
    if (!p || !donnees) return;
    const m = donnees.metadonnees;
    const arretee = p.selectionArreteeLe;
    bandeau.replaceChildren(
      h(
        'section',
        { class: 'bandeau bandeau-graine', 'aria-label': 'Graine et date de sélection' },
        h(
          'p',
          {},
          h('strong', {}, `Graine : ${p.graine}`),
          ` · ${arretee ? `sélection arrêtée le ${new Date(arretee).toLocaleString('fr-FR')}` : 'sélection en cours (non arrêtée)'} · FEC ${m.nomFichier}, clôture ${dateFr(p.dateCloture)}`,
          m.journalAN && !m.journalAN.confirme ? ' · journal d’à-nouveaux non confirmé dans le module FEC' : '',
        ),
        h(
          'div',
          { class: 'actions' },
          bouton('Nouvelle graine', () => {
            if (!p) return;
            p.graine = nouvelleGraine();
            rendreParametres();
            recalculer();
            dire(`Nouvelle graine : ${p.graine}.`);
          }),
          bouton(
            'Arrêter la sélection',
            () => {
              if (!p || !dossier) return;
              p.selectionArreteeLe = new Date().toISOString();
              window.clearTimeout(minuterieSauvegarde);
              void enregistrerParametres(dossier.id, structuredClone(p)).then(() => dire('Sélection arrêtée et enregistrée.'));
              rendreBandeau();
            },
            { primaire: !arretee },
          ),
          bouton('Exporter le tableau de suivi (.xlsx)', () => void exporter(), { primaire: Boolean(arretee) }),
        ),
      ),
    );
  }

  async function exporter(): Promise<void> {
    if (!p || !donnees || !selection) return;
    dire('Préparation du tableau de suivi…');
    try {
      const ExcelJS = await chargerExcelJS();
      const le = p.selectionArreteeLe ? new Date(p.selectionArreteeLe) : new Date();
      const wb = classeurSuivi(ExcelJS, selection, p, donnees.metadonnees, __APP_VERSION__, le);
      const nom = `Circularisations_${(donnees.metadonnees.siren ?? donnees.metadonnees.nomDossier).replace(/[^\w-]+/g, '_')}_${p.dateCloture.replaceAll('-', '')}.xlsx`;
      telecharger(await octetsClasseur(wb), nom, TYPE_XLSX);
      dire('Tableau de suivi exporté.');
    } catch (e) {
      dire(`Export impossible : ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ---- Paramètres --------------------------------------------------------------------------------
  function champMontant(id: string, libelle: string, valeur: number | null, maj: (v: number | null) => void): HTMLElement {
    const entree = h('input', { id, type: 'text', inputmode: 'decimal', value: enEuros(valeur), autocomplete: 'off', class: 'champ-montant' });
    entree.addEventListener('input', () => {
      maj(versCentimes(entree.value));
      recalculer();
    });
    return h('div', { class: 'champ' }, h('label', { for: id }, libelle), entree);
  }

  function ligneCritere(id: string, code: string, libelle: string, c: Critere): HTMLElement {
    const actif = h('input', { type: 'checkbox', id: `${id}-actif`, checked: c.actif });
    const valeur = h('input', { id: `${id}-valeur`, type: 'text', inputmode: 'decimal', autocomplete: 'off', class: 'champ-court', value: c.mode === 'euros' ? enEuros(c.valeur) : String(c.valeur) });
    const mode = h('select', { id: `${id}-mode`, 'aria-label': `Unité du seuil ${code}` }, h('option', { value: 'pct-sp', selected: c.mode === 'pct-sp' }, '% du SP'), h('option', { value: 'euros', selected: c.mode === 'euros' }, '€'));
    const effectif = h('span', { class: 'note texte-secondaire' });
    const majEffectif = () => {
      const s = c.actif ? seuilEffectif(c, p!.sp) : null;
      effectif.textContent = !c.actif ? 'désactivé' : s === null ? 'saisir le SP' : `= ${formaterMontant(s)} €`;
    };
    const lire = () => {
      c.actif = actif.checked;
      c.mode = mode.value as Critere['mode'];
      const v = versCentimes(valeur.value) ?? 0;
      c.valeur = c.mode === 'euros' ? v : v / 100;
      majEffectif();
      recalculer();
    };
    for (const e of [actif, valeur, mode]) e.addEventListener(e === valeur ? 'input' : 'change', lire);
    majEffectif();
    effectifs.push(majEffectif);
    return h('div', { class: 'ligne-critere' }, actif, h('label', { for: actif.id }, h('span', { class: 'badge badge-motif' }, code), ` ${libelle} ≥`), valeur, mode, effectif);
  }

  let effectifs: (() => void)[] = [];

  function blocPopulation(pop: Population): HTMLElement {
    const q = p![pop];
    const c = pop === 'clients';
    const prefixe = (id: string, libelle: string, valeurs: string[], maj: (v: string[]) => void) => {
      const e = h('input', { id, type: 'text', value: valeurs.join(', '), autocomplete: 'off' });
      e.addEventListener('change', () => {
        maj(listePrefixes(e.value));
        e.value = listePrefixes(e.value).join(', ');
        recalculer();
      });
      return h('div', { class: 'champ' }, h('label', { for: id }, libelle), e);
    };
    const anormal = h('input', { type: 'checkbox', id: `${pop}-anormal`, checked: q.anormal.actif });
    anormal.addEventListener('change', () => {
      q.anormal.actif = anormal.checked;
      recalculer();
    });
    const alea = h('input', { type: 'checkbox', id: `${pop}-alea`, checked: q.aleatoire.actif });
    const nombre = h('input', { id: `${pop}-alea-nombre`, type: 'number', min: '0', max: '999', value: String(q.aleatoire.nombre), class: 'champ-court', 'aria-label': 'Nombre de tirages' });
    const lireAlea = () => {
      q.aleatoire.actif = alea.checked;
      q.aleatoire.nombre = Math.max(0, Math.floor(Number(nombre.value) || 0));
      recalculer();
    };
    alea.addEventListener('change', lireAlea);
    nombre.addEventListener('input', lireAlea);
    const k = c ? 'C' : 'F';
    return h(
      'fieldset',
      { class: 'reglages' },
      h('legend', {}, c ? 'Clients' : 'Fournisseurs'),
      ligneCritere(`${pop}-solde`, `${k}1`, c ? 'Solde débiteur' : 'Solde créditeur', q.solde),
      ligneCritere(`${pop}-mvt`, `${k}2`, c ? 'Facturation de l’exercice' : 'Achats de l’exercice', q.mouvements),
      h('div', { class: 'ligne-critere' }, anormal, h('label', { for: anormal.id }, h('span', { class: 'badge badge-motif' }, `${k}3`), ` Solde anormal (${c ? 'créditeur' : 'débiteur'}, hors ${q.avances.join(', ')})`)),
      h('div', { class: 'ligne-critere' }, alea, h('label', { for: alea.id }, h('span', { class: 'badge badge-motif' }, `${k}4`), ' Tirage aléatoire uniforme : '), nombre, h('span', { class: 'note texte-secondaire' }, 'tiers parmi les non retenus à solde non nul')),
      h(
        'details',
        {},
        h('summary', {}, 'Comptes de la population'),
        h(
          'div',
          { class: 'ligne-champs' },
          prefixe(`${pop}-prefixes`, 'Préfixes inclus', q.prefixes, (v) => (q.prefixes = v)),
          prefixe(`${pop}-exclus`, 'Préfixes exclus', q.exclus, (v) => (q.exclus = v)),
          prefixe(`${pop}-avances`, 'Comptes d’avances', q.avances, (v) => (q.avances = v)),
        ),
      ),
    );
  }

  function rendreParametres(): void {
    if (!p) return;
    effectifs = [];
    const majSeuils = () => effectifs.forEach((f) => f());
    const cloture = h('input', { id: 'circ-cloture', type: 'date', value: p.dateCloture });
    cloture.addEventListener('change', () => {
      if (cloture.value) p!.dateCloture = cloture.value;
      recalculer();
    });
    const vmp = h('input', { type: 'checkbox', id: 'circ-vmp', checked: p.banques.inclureVmp });
    vmp.addEventListener('change', () => {
      p!.banques.inclureVmp = vmp.checked;
      recalculer();
    });
    zoneParametres.replaceChildren(
      h(
        'section',
        { class: 'carte', 'aria-labelledby': 'titre-parametres' },
        h('h2', { id: 'titre-parametres' }, 'Paramètres du dossier'),
        h(
          'div',
          { class: 'ligne-champs' },
          h('div', { class: 'champ' }, h('label', { for: 'circ-cloture' }, 'Date de clôture'), cloture),
          champMontant('circ-ss', 'Seuil de signification (SS, €)', p.ss, (v) => (p!.ss = v)),
          champMontant('circ-sp', 'Seuil de planification (SP, €)', p.sp, (v) => {
            p!.sp = v;
            majSeuils();
          }),
          champMontant('circ-sai', 'Seuil des anomalies insignifiantes (SAI, €)', p.sai, (v) => (p!.sai = v)),
        ),
        h('div', { class: 'grille-populations' }, blocPopulation('clients'), blocPopulation('fournisseurs')),
        h(
          'div',
          { class: 'ligne-champs' },
          h('div', { class: 'champ champ-case' }, vmp, h('label', { for: vmp.id }, 'Inclure les valeurs mobilières de placement (comptes 50) dans les banques')),
        ),
      ),
    );
  }

  // ---- Résultats ---------------------------------------------------------------------------------
  function tuile(valeur: string, libelle: string): HTMLElement {
    return h('div', { class: 'tuile' }, h('span', { class: 'tuile-valeur' }, valeur), h('span', { class: 'tuile-libelle' }, libelle));
  }

  function indicateurs(r: ResultatPopulation): HTMLElement {
    const i = r.indicateurs;
    return h(
      'div',
      { class: 'tuiles', role: 'group', 'aria-label': 'Indicateurs' },
      tuile(`${nombreFr(i.nbSelectionnes)} / ${nombreFr(i.nbTotal)}`, 'tiers sélectionnés'),
      tuile(pourcentage(i.couvertureSoldes), 'couverture des soldes (valeur absolue)'),
      tuile(pourcentage(i.couvertureMouvements), `couverture des ${r.population === 'clients' ? 'ventes (débits)' : 'achats (crédits)'}`),
      tuile(nombreFr(i.nbAnormaux), 'soldes anormaux'),
    );
  }

  /** Demande la justification d'un ajout ou d'une exclusion manuelle (obligatoire). */
  function demanderJustification(t: TiersCandidat, pop: Population, action: 'ajout' | 'exclusion'): void {
    const zone = h('textarea', { id: 'justification', rows: '3', required: true });
    const erreur = h('p', { class: 'message-erreur', role: 'alert' });
    const valider = () => {
      const texte = zone.value.trim();
      if (!texte) {
        erreur.textContent = 'La justification est obligatoire.';
        zone.focus();
        return;
      }
      p!.manuels = p!.manuels.filter((d) => !(d.population === pop && d.cle === t.cle));
      p!.manuels.push({ population: pop, cle: t.cle, action, justification: texte, le: new Date().toISOString() });
      dialogue.close();
      recalculer();
      dire(`${action === 'ajout' ? 'Ajout' : 'Exclusion'} de ${t.cle} enregistré.`);
    };
    dialogue.replaceChildren(
      h('h3', { id: 'titre-justification' }, `${action === 'ajout' ? 'Ajouter' : 'Exclure'} ${t.cle} — ${t.libelle}`),
      h('div', { class: 'champ' }, h('label', { for: 'justification' }, 'Justification (obligatoire, reprise dans le tableau de suivi)'), zone),
      erreur,
      h('div', { class: 'actions' }, bouton('Valider', valider, { primaire: true }), bouton('Annuler', () => dialogue.close())),
    );
    dialogue.showModal();
    zone.focus();
  }

  function tablePopulation(r: ResultatPopulation): HTMLElement {
    const pop = r.population;
    const f = filtres[pop];
    const recherche = h('input', { id: `${pop}-recherche`, type: 'search', value: f.texte, placeholder: 'Code ou nom', autocomplete: 'off' });
    const retenus = h('input', { type: 'checkbox', id: `${pop}-retenus`, checked: f.retenusSeulement });
    const tri = h(
      'select',
      { id: `${pop}-tri` },
      ...(
        [
          ['cle', 'Code tiers'],
          ['solde', 'Solde (valeur absolue)'],
          ['mouvements', pop === 'clients' ? 'Facturation' : 'Achats'],
        ] as const
      ).map(([v, l]) => h('option', { value: v, selected: f.tri === v }, l)),
    );
    const corps = h('tbody');
    const compteur = h('p', { class: 'note texte-secondaire', role: 'status' });
    const remplir = () => {
      const n = f.texte.toLowerCase();
      const mvt = (t: TiersCandidat) => (pop === 'clients' ? t.debit : t.credit);
      const tiers = r.tiers
        .filter((t) => (!f.retenusSeulement || t.retenu || t.exclusion) && (!n || t.cle.toLowerCase().includes(n) || t.libelle.toLowerCase().includes(n)))
        .sort((a, b) => (f.tri === 'solde' ? Math.abs(b.solde) - Math.abs(a.solde) : f.tri === 'mouvements' ? mvt(b) - mvt(a) : 0) || (a.cle < b.cle ? -1 : 1));
      compteur.textContent = `${nombreFr(tiers.length)} tiers affiché(s)`;
      corps.replaceChildren(
        ...tiers.map((t) => {
          const caseRetenu = h('input', { type: 'checkbox', checked: t.retenu, 'aria-label': `${t.retenu ? 'Exclure' : 'Ajouter'} ${t.cle}` });
          caseRetenu.addEventListener('change', () => {
            caseRetenu.checked = t.retenu;
            demanderJustification(t, pop, t.retenu ? 'exclusion' : 'ajout');
          });
          const decision = p!.manuels.find((d) => d.population === pop && d.cle === t.cle);
          const annuler = decision
            ? bouton('Annuler la décision', () => {
                p!.manuels = p!.manuels.filter((d) => d !== decision);
                recalculer();
              })
            : null;
          return h(
            'tr',
            { class: t.exclusion ? 'ligne-exclue' : t.anormal ? 'ligne-anormale' : undefined },
            h('td', {}, caseRetenu),
            h('td', { class: 'mono' }, t.cle),
            h('td', {}, t.libelle, h('span', { class: 'note texte-secondaire' }, ` ${t.comptes.join(', ')}`)),
            h('td', { class: 'nombre montant' }, solde(t.solde)),
            h('td', { class: 'nombre montant' }, formaterMontant(mvt(t))),
            h(
              'td',
              {},
              ...t.motifs.map((m) => h('span', { class: 'badge badge-motif', title: LIBELLES_MOTIFS[m] }, m)),
              t.rangTirage ? h('span', { class: 'note texte-secondaire' }, ` n° ${t.rangTirage}`) : null,
              t.exclusion ? h('span', { class: 'note' }, ` Exclu : ${t.exclusion}`) : null,
              t.justificationAjout ? h('span', { class: 'note' }, ` Ajout : ${t.justificationAjout}`) : null,
            ),
            h('td', {}, t.methode ?? '—', annuler),
          );
        }),
      );
    };
    recherche.addEventListener('input', () => {
      f.texte = recherche.value.trim();
      remplir();
    });
    retenus.addEventListener('change', () => {
      f.retenusSeulement = retenus.checked;
      remplir();
    });
    tri.addEventListener('change', () => {
      f.tri = tri.value as typeof f.tri;
      remplir();
    });
    remplir();
    return h(
      'div',
      {},
      indicateurs(r),
      h(
        'p',
        { class: 'note texte-secondaire' },
        `Seuils : ${r.seuils.solde === null ? 'solde — ' : `solde ${formaterMontant(r.seuils.solde)} € · `}${r.seuils.mouvements === null ? 'mouvements —' : `mouvements ${formaterMontant(r.seuils.mouvements)} €`}. Cochez ou décochez un tiers pour l’ajouter ou l’exclure (justification obligatoire).`,
      ),
      h(
        'div',
        { class: 'ligne-champs' },
        h('div', { class: 'champ' }, h('label', { for: recherche.id }, 'Rechercher'), recherche),
        h('div', { class: 'champ' }, h('label', { for: tri.id }, 'Trier par'), tri),
        h('div', { class: 'champ champ-case' }, retenus, h('label', { for: retenus.id }, 'Tiers retenus ou exclus seulement')),
      ),
      compteur,
      h(
        'div',
        { class: 'tableau-defilant tableau-hauteur', tabindex: '0', role: 'region', 'aria-label': `Sélection ${pop}` },
        h(
          'table',
          { class: 'tableau' },
          h(
            'thead',
            {},
            h('tr', {}, ...['Retenu', 'Code', 'Tiers', 'Solde', pop === 'clients' ? 'Facturation' : 'Achats', 'Motifs', 'Méthode'].map((x, k) => h('th', { scope: 'col', class: k === 3 || k === 4 ? 'nombre' : undefined }, x))),
          ),
          corps,
        ),
      ),
    );
  }

  function tableBanques(s: Selection): HTMLElement {
    const lignes = s.banques.comptes.map((c) => {
      const entree = h('input', { type: 'text', value: p!.banques.etablissements[c.compteNum] ?? proposerEtablissement(c.compteLib), 'aria-label': `Établissement du compte ${c.compteNum}`, autocomplete: 'off' });
      entree.addEventListener('change', () => {
        p!.banques.etablissements[c.compteNum] = entree.value.trim() || 'À préciser';
        recalculer();
      });
      return h(
        'tr',
        {},
        h('td', { class: 'mono' }, c.compteNum),
        h('td', {}, c.compteLib),
        h('td', {}, entree),
        h('td', { class: 'nombre montant' }, solde(c.cloture)),
        h('td', { class: 'nombre montant' }, formaterMontant(c.debit)),
        h('td', { class: 'nombre montant' }, formaterMontant(c.credit)),
        h('td', {}, c.cloture === 0 && c.mouvemente ? h('span', { class: 'badge badge-gravite-anomalie' }, 'soldé en cours d’exercice') : ''),
      );
    });
    return h(
      'div',
      {},
      h(
        'div',
        { class: 'tuiles' },
        tuile(nombreFr(s.banques.etablissements.length), 'établissements (une demande chacun)'),
        tuile(nombreFr(s.banques.comptes.length), 'comptes, sélection exhaustive'),
        tuile(nombreFr(s.banques.comptes.filter((c) => c.cloture === 0).length), 'comptes soldés à la clôture'),
      ),
      h('p', { class: 'note texte-secondaire' }, 'Tous les comptes bancaires présents dans le FEC sont retenus, même soldés. Regroupez-les par établissement : une ligne de suivi par établissement.'),
      h(
        'div',
        { class: 'tableau-defilant', tabindex: '0', role: 'region', 'aria-label': 'Comptes bancaires' },
        h(
          'table',
          { class: 'tableau' },
          h('thead', {}, h('tr', {}, ...['Compte', 'Libellé', 'Établissement', 'Solde', 'Débit', 'Crédit', ''].map((x, k) => h('th', { scope: 'col', class: k >= 3 && k <= 5 ? 'nombre' : undefined }, x)))),
          h('tbody', {}, ...lignes),
        ),
      ),
    );
  }

  function rendreResultats(): void {
    if (!selection) return;
    const s = selection;
    const onglets = (['banques', 'clients', 'fournisseurs'] as const).map((o) => {
      const r = o === 'banques' ? null : s[o];
      const b = h(
        'button',
        { type: 'button', role: 'tab', class: 'onglet', 'aria-selected': String(vue === o) },
        `${o === 'banques' ? 'Banques' : o === 'clients' ? 'Clients' : 'Fournisseurs'} (${nombreFr(r ? r.indicateurs.nbSelectionnes : s.banques.etablissements.length)})`,
      );
      b.addEventListener('click', () => {
        vue = o;
        rendreResultats();
      });
      return b;
    });
    zoneResultats.replaceChildren(
      h(
        'section',
        { class: 'carte', 'aria-labelledby': 'titre-selection' },
        h('h2', { id: 'titre-selection' }, 'Sélection'),
        h('div', { class: 'onglets', role: 'tablist', 'aria-label': 'Populations' }, ...onglets),
        h('div', { role: 'tabpanel' }, vue === 'banques' ? tableBanques(s) : tablePopulation(s[vue])),
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
    const avecFec = dossiers.filter((d) => d.fec.N);
    await choisirDossier(avecFec.find((d) => d.id === prefere)?.id ?? avecFec[0]?.id ?? null);
  })();

  return () => {
    detruit = true;
    if (dialogue.open) dialogue.close();
    vider();
    window.removeEventListener('pagehide', vider);
  };
}
