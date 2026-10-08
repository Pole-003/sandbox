/**
 * Écran des courriers de circularisation (SPEC 4.5) : coordonnées du cabinet, en-tête et signataire du
 * client, modèles de lettres par population (texte modifiable avec variables), aperçu d'une lettre et
 * export en lot (.zip d'un .docx par tiers, ou document unique pour impression). Tout reste sur le poste.
 */
import { h } from '../../../app/dom.ts';
import { bouton, nombreFr, telecharger } from '../../fec/ecran/commun.ts';
import type { MetadonneesDossierFec } from '../../fec/interface-circularisations.ts';
import { demandes, type Demande, type PopulationDemande } from '../demandes.ts';
import type { Selection } from '../selection.ts';
import { archiveLettres, chargerDocx, docxLettres, TYPE_DOCX, TYPE_ZIP } from './docx.ts';
import { composerLettre, type Bloc, type ContexteLettres, type Lettre } from './lettres.ts';
import {
  LIBELLES_DEMANDES,
  LIBELLES_POPULATIONS,
  modeleParDefaut,
  reglagesDossierParDefaut,
  VARIABLES,
  type Demande as TypeDemande,
  type ModelesCourriers,
  type ReglagesCourriersDossier,
} from './modeles.ts';
import { enregistrerModeles, enregistrerReglagesCourriers, lireModeles, lireReglagesCourriers } from './stockage.ts';

const POPULATIONS: PopulationDemande[] = ['banques', 'clients', 'fournisseurs'];
const aujourdhui = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export interface EcranCourriers {
  /** Nouvelle sélection (recalcul) : met à jour la liste des lettres et l'aperçu. */
  maj(selection: Selection, dateCloture: string, arretee: boolean): void;
  /** Enregistre sans attendre les modifications en attente (fermeture ou rechargement de la page). */
  vider(): void;
  /** Quitte l'écran ou change de dossier. */
  detruire(): void;
}

/** Enregistrement différé (400 ms), vidable à la fermeture de la page. */
function differe(action: () => Promise<void>): { planifier(): void; vider(): void } {
  let minuterie: number | undefined;
  let enAttente = false;
  return {
    planifier() {
      window.clearTimeout(minuterie);
      enAttente = true;
      minuterie = window.setTimeout(() => {
        enAttente = false;
        void action();
      }, 400);
    },
    vider() {
      if (!enAttente) return;
      window.clearTimeout(minuterie);
      enAttente = false;
      void action();
    },
  };
}

export function rendreBlocs(blocs: Bloc[]): HTMLElement[] {
  const sortie: HTMLElement[] = [];
  let liste: HTMLUListElement | null = null;
  for (const b of blocs) {
    if (b.type === 'puce') {
      if (!liste) sortie.push((liste = h('ul')));
      liste.append(h('li', {}, b.texte));
      continue;
    }
    liste = null;
    if (b.type === 'case') sortie.push(h('p', { class: 'lettre-case' }, '☐ ', b.texte));
    else if (b.type === 'saisie') sortie.push(h('p', { class: 'lettre-saisie' }, b.texte, ' ', h('span', { class: 'lettre-ligne', 'aria-hidden': 'true' })));
    else sortie.push(h('p', {}, b.texte));
  }
  return sortie;
}

/** Aperçu HTML d'une lettre, fidèle à la structure du .docx. */
export function apercuLettre(l: Lettre): HTMLElement {
  return h(
    'article',
    { class: 'apercu-lettre', 'aria-label': `Aperçu de la lettre ${l.ref}` },
    h('div', { class: 'lettre-entete' }, h('strong', {}, l.societe), ...l.enTete.map((t) => h('div', {}, t))),
    h('div', { class: 'lettre-destinataire' }, h('strong', {}, l.destinataire), h('div', { class: 'lettre-adresse-vide' }, 'Adresse à compléter dans Word')),
    h('p', { class: 'lettre-droite' }, l.lieuDate),
    h('p', { class: 'lettre-ref' }, h('strong', {}, 'Réf. : '), `${l.ref}${l.codeTiers ? ` (code tiers ${l.codeTiers})` : ''}`, h('br'), h('strong', {}, `Objet : ${l.objet}`)),
    ...rendreBlocs(l.corps),
    h('div', { class: 'lettre-signature' }, ...l.signature.map((t) => h('div', {}, t))),
    l.coupon
      ? h(
          'section',
          { class: 'lettre-coupon', 'aria-label': 'Coupon-réponse' },
          h('h4', {}, l.coupon.titre.toUpperCase()),
          h('p', { class: 'lettre-consigne' }, l.coupon.consigne),
          h('p', {}, h('strong', {}, `Tiers : ${l.destinataire}${l.codeTiers ? ` (code ${l.codeTiers})` : ''}`)),
          ...rendreBlocs(l.coupon.blocs),
        )
      : null,
  );
}

export function rendreCourriers(
  zone: HTMLElement,
  dossier: { id: string; nom: string },
  fec: MetadonneesDossierFec,
  dire: (texte: string) => void,
): EcranCourriers {
  let detruit = false;
  let modeles: ModelesCourriers | null = null;
  let reglages: ReglagesCourriersDossier | null = null;
  let selection: Selection | null = null;
  let dateCloture = fec.dateCloture;
  let arretee = false;
  let liste: Record<PopulationDemande, Demande[]> = { banques: [], clients: [], fournisseurs: [] };
  let vue: PopulationDemande = 'clients';
  let refApercu: string | null = null;
  let format: 'zip' | 'unique' = 'zip';
  /** Références décochées dans la liste d'export (non enregistré). */
  const decochees = new Set<string>();

  const sauverModeles = differe(async () => {
    if (modeles) await enregistrerModeles(structuredClone(modeles));
  });
  const sauverReglages = differe(async () => {
    if (reglages) await enregistrerReglagesCourriers(dossier.id, structuredClone(reglages));
  });

  const zoneAvertissement = h('div');
  const zoneModele = h('div');
  const zoneApercu = h('div');
  const zoneExport = h('div');

  const contexte = (): ContexteLettres => ({ modeles: modeles!, dossier: reglages!, dateCloture, aujourdhui: aujourdhui() });

  // ---- Champs ------------------------------------------------------------------------------------
  function champ(id: string, libelle: string, valeur: string, maj: (v: string) => void, options: { type?: string; lignes?: number; aide?: string; exemple?: string } = {}): HTMLElement {
    const e = options.lignes ? h('textarea', { id, rows: String(options.lignes), placeholder: options.exemple }, valeur) : h('input', { id, type: options.type ?? 'text', value: valeur, autocomplete: 'off', placeholder: options.exemple });
    e.addEventListener('input', () => {
      maj(e.value);
      majApercu();
    });
    return h('div', { class: 'champ' }, h('label', { for: id }, libelle), e, options.aide ? h('span', { class: 'note texte-secondaire' }, options.aide) : null);
  }

  function blocCabinet(): HTMLElement {
    const m = modeles!;
    const maj = (f: (v: string) => void) => (v: string) => {
      f(v);
      sauverModeles.planifier();
    };
    return h(
      'fieldset',
      { class: 'reglages' },
      h('legend', {}, 'Cabinet (commun à tous les dossiers de ce poste)'),
      h(
        'div',
        { class: 'ligne-champs' },
        champ('cour-cabinet', 'Nom du cabinet', m.cabinet.nom, maj((v) => (m.cabinet.nom = v))),
        champ('cour-email', 'E-mail de réponse (facultatif)', m.cabinet.email, maj((v) => (m.cabinet.email = v)), { type: 'email' }),
      ),
      champ('cour-adresse', 'Adresse de réponse', m.cabinet.adresse, maj((v) => (m.cabinet.adresse = v)), { lignes: 3 }),
    );
  }

  function blocDossier(): HTMLElement {
    const r = reglages!;
    const maj = (f: (v: string) => void) => (v: string) => {
      f(v);
      sauverReglages.planifier();
    };
    return h(
      'fieldset',
      { class: 'reglages' },
      h('legend', {}, 'Client et signataire (ce dossier)'),
      h(
        'div',
        { class: 'ligne-champs' },
        champ('cour-societe', 'Raison sociale', r.societe, maj((v) => (r.societe = v))),
        champ('cour-lieu', 'Lieu', r.lieu, maj((v) => (r.lieu = v)), { exemple: 'ex. Lyon' }),
        champ('cour-qualite', 'Qualité du signataire', r.signataireQualite, maj((v) => (r.signataireQualite = v)), { exemple: 'ex. La Présidente, Le Gérant' }),
        champ('cour-signataire', 'Nom du signataire', r.signataireNom, maj((v) => (r.signataireNom = v))),
      ),
      champ('cour-entete', 'En-tête sous la raison sociale (adresse, SIREN…)', r.enTete, maj((v) => (r.enTete = v)), { lignes: 3 }),
      h(
        'div',
        { class: 'ligne-champs' },
        champ('cour-date', 'Date des lettres', r.dateLettres, maj((v) => (r.dateLettres = v)), { type: 'date', aide: 'vide = date du jour de l’export' }),
        champ('cour-limite', 'Réponse souhaitée avant le', r.dateLimite, maj((v) => (r.dateLimite = v)), { type: 'date', aide: 'vide = « dans les meilleurs délais »' }),
      ),
    );
  }

  // ---- Modèle de la population affichée -----------------------------------------------------------
  function rendreModele(): void {
    const m = modeles!.modeles[vue];
    const banque = vue === 'banques';
    const modif = () => {
      sauverModeles.planifier();
      majApercu();
    };
    const id = (x: string) => `cour-${vue}-${x}`;

    const options: HTMLElement[] = [];
    if (!banque) {
      const radio = (valeur: boolean, libelle: string) => {
        const r = h('input', { type: 'radio', name: id('type'), id: id(`type-${valeur}`), checked: m.soldeIndique === valeur, disabled: m.demande === 'releve' });
        r.addEventListener('change', () => {
          m.soldeIndique = valeur;
          modif();
        });
        return h('span', { class: 'champ-case' }, r, h('label', { for: r.id }, libelle));
      };
      const demande = h(
        'select',
        { id: id('demande') },
        ...(Object.keys(LIBELLES_DEMANDES) as TypeDemande[]).map((d) => h('option', { value: d, selected: m.demande === d }, LIBELLES_DEMANDES[d])),
      );
      demande.addEventListener('change', () => {
        m.demande = demande.value as TypeDemande;
        modif();
        rendreModele();
      });
      options.push(
        h('div', { class: 'champ', role: 'radiogroup', 'aria-label': 'Type de lettre' }, h('span', { class: 'libelle-champ' }, 'Type de lettre'), radio(false, 'Solde non indiqué'), radio(true, 'Solde indiqué')),
        h('div', { class: 'champ' }, h('label', { for: demande.id }, 'Demande'), demande),
      );
    } else {
      const lister = h('input', { type: 'checkbox', id: id('comptes'), checked: m.listerComptes });
      lister.addEventListener('change', () => {
        m.listerComptes = lister.checked;
        modif();
      });
      options.push(h('div', { class: 'champ champ-case' }, lister, h('label', { for: lister.id }, 'Rappeler les comptes enregistrés (numéro et libellé, sans solde)')));
    }
    const coupon = h('input', { type: 'checkbox', id: id('coupon'), checked: m.coupon });
    coupon.addEventListener('change', () => {
      m.coupon = coupon.checked;
      modif();
    });
    options.push(h('div', { class: 'champ champ-case' }, coupon, h('label', { for: coupon.id }, 'Joindre un coupon-réponse (page séparée)')));

    const objet = h('input', { id: id('objet'), type: 'text', value: m.objet, autocomplete: 'off' });
    objet.addEventListener('input', () => {
      m.objet = objet.value;
      modif();
    });
    const corps = h('textarea', { id: id('corps'), rows: '18', spellcheck: 'true', class: 'corps-modele' }, m.corps);
    corps.addEventListener('input', () => {
      m.corps = corps.value;
      modif();
    });
    let dernierChamp: HTMLInputElement | HTMLTextAreaElement = corps;
    objet.addEventListener('focus', () => (dernierChamp = objet));
    corps.addEventListener('focus', () => (dernierChamp = corps));
    const variables = VARIABLES.filter((v) => (banque ? !['phrase_solde', 'phrase_demande', 'solde', 'sens_solde', 'code_tiers'].includes(v.nom) : v.nom !== 'comptes_banque')).map((v) => {
      const b = h('button', { type: 'button', class: 'bouton bouton-variable', title: v.description }, `{${v.nom}}`);
      b.addEventListener('click', () => {
        const c = dernierChamp;
        c.focus();
        c.setRangeText(`{${v.nom}}`, c.selectionStart ?? c.value.length, c.selectionEnd ?? c.value.length, 'end');
        c.dispatchEvent(new Event('input'));
      });
      return b;
    });

    zoneModele.replaceChildren(
      h('div', { class: 'ligne-champs' }, ...options),
      h('div', { class: 'champ' }, h('label', { for: objet.id }, 'Objet'), objet),
      h(
        'div',
        { class: 'champ' },
        h('label', { for: corps.id }, 'Corps de la lettre'),
        h('span', { class: 'note texte-secondaire', id: id('aide') }, 'Paragraphes séparés par une ligne vide ; « - » en début de ligne pour une puce. Un paragraphe vide après remplacement des variables est supprimé.'),
        corps,
      ),
      h('div', { class: 'variables', role: 'group', 'aria-label': 'Insérer une variable' }, h('span', { class: 'note texte-secondaire' }, 'Insérer : '), ...variables),
      h(
        'div',
        { class: 'actions' },
        bouton('Rétablir le texte par défaut', () => {
          if (!window.confirm(`Rétablir le modèle ${LIBELLES_POPULATIONS[vue]} par défaut ? Le texte modifié sera perdu.`)) return;
          modeles!.modeles[vue] = modeleParDefaut(vue);
          modif();
          rendreModele();
          dire(`Modèle ${LIBELLES_POPULATIONS[vue]} rétabli.`);
        }),
      ),
    );
    corps.setAttribute('aria-describedby', id('aide'));
  }

  // ---- Aperçu ------------------------------------------------------------------------------------
  function majApercu(): void {
    if (!modeles || !reglages) return;
    const d = liste[vue];
    if (d.length === 0) {
      zoneApercu.replaceChildren(h('p', { class: 'texte-secondaire' }, `Aucune demande ${LIBELLES_POPULATIONS[vue].toLowerCase()} dans la sélection.`));
      return;
    }
    const courante = d.find((x) => x.ref === refApercu) ?? d[0]!;
    refApercu = courante.ref;
    const choix = h(
      'select',
      { id: 'cour-apercu' },
      ...d.map((x) => h('option', { value: x.ref, selected: x.ref === courante.ref }, `${x.ref} — ${x.population === 'banques' ? x.etablissement.etablissement : x.tiers.libelle}`)),
    );
    choix.addEventListener('change', () => {
      refApercu = choix.value;
      majApercu();
      document.getElementById('cour-apercu')?.focus();
    });
    let contenu: HTMLElement;
    try {
      contenu = apercuLettre(composerLettre(courante, contexte()));
    } catch (e) {
      contenu = h('p', { class: 'message-erreur' }, `Aperçu impossible : ${e instanceof Error ? e.message : String(e)}`);
    }
    zoneApercu.replaceChildren(h('div', { class: 'champ' }, h('label', { for: choix.id }, 'Aperçu pour'), choix), contenu);
  }

  // ---- Export ------------------------------------------------------------------------------------
  function retenues(): Demande[] {
    return POPULATIONS.flatMap((p) => liste[p]).filter((d) => !decochees.has(d.ref));
  }

  function rendreExport(): void {
    const compteur = h('p', { class: 'note', role: 'status' });
    const majCompteur = () => (compteur.textContent = `${nombreFr(retenues().length)} lettre(s) à générer.`);
    const groupes = POPULATIONS.map((p) => {
      const d = liste[p];
      const cases = d.map((x) => {
        const c = h('input', { type: 'checkbox', id: `cour-l-${x.ref}`, checked: !decochees.has(x.ref) });
        c.addEventListener('change', () => {
          if (c.checked) decochees.delete(x.ref);
          else decochees.add(x.ref);
          tout.checked = d.every((y) => !decochees.has(y.ref));
          tout.indeterminate = !tout.checked && d.some((y) => !decochees.has(y.ref));
          majCompteur();
        });
        return h('li', {}, c, h('label', { for: c.id }, `${x.ref} — ${x.population === 'banques' ? x.etablissement.etablissement : x.tiers.libelle}`));
      });
      const tout = h('input', { type: 'checkbox', id: `cour-tout-${p}`, checked: d.length > 0 && d.every((y) => !decochees.has(y.ref)), disabled: d.length === 0 });
      tout.indeterminate = !tout.checked && d.some((y) => !decochees.has(y.ref));
      tout.addEventListener('change', () => {
        for (const y of d) {
          if (tout.checked) decochees.delete(y.ref);
          else decochees.add(y.ref);
        }
        rendreExport();
      });
      return h(
        'div',
        { class: 'groupe-lettres' },
        h('div', { class: 'champ-case' }, tout, h('label', { for: tout.id }, h('strong', {}, `${LIBELLES_POPULATIONS[p]} (${nombreFr(d.length)})`))),
        d.length ? h('details', {}, h('summary', {}, 'Choisir les lettres'), h('ul', { class: 'liste-lettres' }, ...cases)) : null,
      );
    });
    const radio = (valeur: typeof format, libelle: string) => {
      const r = h('input', { type: 'radio', name: 'cour-format', id: `cour-format-${valeur}`, checked: format === valeur });
      r.addEventListener('change', () => (format = valeur));
      return h('span', { class: 'champ-case' }, r, h('label', { for: r.id }, libelle));
    };
    const generer = bouton('Générer les lettres', () => void exporter(generer), { primaire: true });
    majCompteur();
    zoneExport.replaceChildren(
      h('div', { class: 'grille-lettres' }, ...groupes),
      h(
        'div',
        { class: 'champ', role: 'radiogroup', 'aria-label': 'Format' },
        h('span', { class: 'libelle-champ' }, 'Format'),
        radio('zip', 'Archive .zip : un fichier .docx par tiers'),
        radio('unique', 'Document unique .docx pour impression (une lettre par page)'),
      ),
      compteur,
      h('div', { class: 'actions' }, generer),
    );
  }

  async function exporter(b: HTMLButtonElement): Promise<void> {
    if (!modeles || !reglages) return;
    const choisies = retenues();
    if (choisies.length === 0) {
      dire('Aucune lettre à générer.');
      return;
    }
    sauverModeles.vider();
    sauverReglages.vider();
    b.disabled = true;
    dire(`Génération de ${choisies.length} lettre(s)…`);
    try {
      const c = contexte();
      const lettres = choisies.map((d) => composerLettre(d, c));
      const D = await chargerDocx();
      const base = `Courriers_${(fec.siren ?? dossier.nom).replace(/[^\w-]+/g, '_')}_${dateCloture.replaceAll('-', '')}`;
      if (format === 'zip') telecharger(await archiveLettres(D, lettres), `${base}.zip`, TYPE_ZIP);
      else telecharger(await docxLettres(D, lettres, `Demandes de confirmation — ${reglages.societe}`), `${base}.docx`, TYPE_DOCX);
      dire(`${lettres.length} lettre(s) générée(s).`);
    } catch (e) {
      dire(`Génération impossible : ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      b.disabled = false;
    }
  }

  // ---- Assemblage --------------------------------------------------------------------------------
  function rendreTout(): void {
    const onglets = POPULATIONS.map((p) => {
      const b = h('button', { type: 'button', role: 'tab', class: 'onglet', 'aria-selected': String(vue === p), id: `cour-onglet-${p}` }, LIBELLES_POPULATIONS[p]);
      b.addEventListener('click', () => {
        vue = p;
        refApercu = null;
        rendreTout();
        document.getElementById(`cour-onglet-${p}`)?.focus();
      });
      return b;
    });
    zone.replaceChildren(
      h(
        'section',
        { class: 'carte', 'aria-labelledby': 'titre-courriers' },
        h('h2', { id: 'titre-courriers' }, 'Courriers de circularisation'),
        h(
          'p',
          { class: 'texte-secondaire' },
          'Lettres sur papier à en-tête du client, signées par son dirigeant, avec réponse adressée directement au cabinet. Les références sont celles du tableau de suivi ; l’adresse du destinataire est à compléter dans Word.',
        ),
        zoneAvertissement,
        h('div', { class: 'grille-populations' }, blocCabinet(), blocDossier()),
        h('h3', {}, 'Modèles de lettres'),
        h('div', { class: 'onglets', role: 'tablist', 'aria-label': 'Modèle par population' }, ...onglets),
        h('div', { role: 'tabpanel', 'aria-labelledby': `cour-onglet-${vue}`, class: 'grille-modele' }, h('div', {}, zoneModele), h('div', { class: 'colonne-apercu' }, zoneApercu)),
        h('h3', {}, 'Générer les lettres'),
        zoneExport,
      ),
    );
    majAvertissement();
    rendreModele();
    majApercu();
    rendreExport();
  }

  function majAvertissement(): void {
    zoneAvertissement.replaceChildren(
      arretee ? '' : h('p', { class: 'bandeau bandeau-alerte' }, 'La sélection n’est pas arrêtée : les références des lettres (CL-001…) peuvent encore changer. Arrêtez la sélection et exportez le tableau de suivi avant d’envoyer les lettres.'),
    );
  }

  zone.replaceChildren(h('p', { class: 'texte-secondaire' }, 'Chargement des modèles de lettres…'));
  void Promise.all([lireModeles(), lireReglagesCourriers(dossier.id)]).then(
    ([m, r]) => {
      if (detruit) return;
      modeles = m;
      reglages = r ?? reglagesDossierParDefaut(dossier.nom, fec.siren);
      rendreTout();
    },
    (e: unknown) => zone.replaceChildren(h('p', { class: 'message-erreur' }, `Modèles indisponibles : ${e instanceof Error ? e.message : String(e)}`)),
  );

  return {
    maj(s, cloture, estArretee) {
      selection = s;
      dateCloture = cloture;
      const avant = arretee;
      arretee = estArretee;
      liste = demandes(selection);
      if (!modeles) return;
      if (avant !== arretee) majAvertissement();
      majApercu();
      rendreExport();
    },
    vider() {
      sauverModeles.vider();
      sauverReglages.vider();
    },
    detruire() {
      detruit = true;
      sauverModeles.vider();
      sauverReglages.vider();
    },
  };
}

