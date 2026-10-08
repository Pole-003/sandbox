/**
 * Suivi automatique du PLF et du PLFSS à partir des dossiers législatifs de l'Assemblée nationale (0 €).
 *
 * La page « dyn/17/dossiers/PLF_<année> » (et PLFSS_<année>) présente un bloc « Étapes de lecture »
 * (structure observée le 08/10/2026 par npm run veille:explorer-suivi) :
 *   <div class="... etape-slider"> … <span class="_bold _colored-primary">Dépôt à l'Assemblée nationale</span>
 *   … <span class="_colored-grey _small">Jeudi 1er octobre 2026</span> …
 * Ce dossier retrace toute la navette (Sénat, CMP, Conseil constitutionnel, promulgation).
 *
 * Délais constitutionnels (indicatifs, comptés en jours calendaires depuis le dépôt) :
 *  - PLF (art. 47 C) : 40 jours pour la 1re lecture à l'Assemblée, 70 jours pour le Parlement ;
 *  - PLFSS (art. 47-1 C) : 20 jours pour la 1re lecture à l'Assemblée, 50 jours pour le Parlement.
 */
import { createHash } from 'node:crypto';
import type { EcheanceSuivi, EtatSource, StatutEtape, SuiviTexte, Theme } from '../../src/modules/veille/modele.ts';
import { themeConnu, type SourceCatalogue } from './config.ts';
import type { ArticleFlux } from './couche-a.ts';
import { dateIsoParis, extraireDateDuTexte } from './dates.ts';
import { decoderOctets, lireEncodageDeclare } from './encodage.ts';
import { decoderEntites } from './flux.ts';
import type { ClientHttp } from './http.ts';
import type { MotsCles } from './classement.ts';
import { construireMesures, lireArticles, texteDepuisDossier } from './projet-loi.ts';

export interface EtapeLue {
  libelle: string;
  date: string | null;
}

const texte = (html: string) => decoderEntites(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** Étapes du bloc « Étapes de lecture » d'un dossier législatif de l'Assemblée nationale. */
export function lireEtapesAN(html: string): EtapeLue[] {
  const debut = html.search(/class=["'][^"']*etape-slider/);
  if (debut < 0) return [];
  const finRelative = html.slice(debut).search(/class=["'][^"']*horizontal-fade-slider/);
  const bloc = html.slice(debut, finRelative > 0 ? debut + finRelative : debut + 50_000);
  const etapes: EtapeLue[] = [];
  for (const diapo of bloc.split(/class=["'][^"']*swiper-slide/).slice(1)) {
    const libelle = /_colored-primary[^>]*>([\s\S]*?)<\/span>/.exec(diapo)?.[1];
    if (!libelle) continue;
    const dateBrute = /_colored-grey[^>]*>([\s\S]*?)<\/span>/.exec(diapo)?.[1];
    const date = dateBrute ? extraireDateDuTexte(texte(dateBrute)) : null;
    etapes.push({ libelle: texte(libelle), date: date ? dateIsoParis(date) : null });
  }
  return etapes;
}

/** Ordre canonique de la procédure budgétaire (pour placer les étapes restantes). */
const PROCEDURE: { motif: RegExp; libelle: string; aVenir: boolean }[] = [
  { motif: /d[ée]p[ôo]t/i, libelle: 'Dépôt à l’Assemblée nationale', aVenir: false },
  { motif: /premi[eè]re lecture.*assembl/i, libelle: 'Première lecture à l’Assemblée nationale', aVenir: false },
  { motif: /premi[eè]re lecture.*s[ée]nat/i, libelle: 'Première lecture au Sénat', aVenir: true },
  { motif: /commission mixte/i, libelle: 'Commission mixte paritaire', aVenir: true },
  { motif: /nouvelle lecture/i, libelle: 'Nouvelle lecture', aVenir: false },
  { motif: /lecture d[ée]finitive/i, libelle: 'Lecture définitive', aVenir: false },
  { motif: /conseil constitutionnel/i, libelle: 'Conseil constitutionnel', aVenir: true },
  { motif: /promulg/i, libelle: 'Promulgation', aVenir: true },
];
const rang = (libelle: string) => PROCEDURE.findIndex((p) => p.motif.test(libelle));

const DELAIS: Record<'plf' | 'plfss', { assemblee: number; parlement: number; article: string }> = {
  plf: { assemblee: 40, parlement: 70, article: 'art. 47 de la Constitution' },
  plfss: { assemblee: 20, parlement: 50, article: 'art. 47-1 de la Constitution' },
};

function plusJours(iso: string, jours: number): string {
  return new Date(Date.parse(`${iso}T12:00:00Z`) + jours * 86_400_000).toISOString().slice(0, 10);
}

export function construireSuivi(
  type: 'plf' | 'plfss',
  intitule: string,
  etapesLues: readonly EtapeLue[],
  aujourdhui: string,
  url: string | null,
): SuiviTexte {
  const dernier = etapesLues.length - 1;
  const terminal = dernier >= 0 && /promulg/i.test(etapesLues[dernier]!.libelle);
  const etapes: SuiviTexte['etapes'] = etapesLues.map((e, i) => ({
    libelle: e.libelle,
    date: e.date,
    statut: (i < dernier || terminal ? 'fait' : 'en_cours') as StatutEtape,
  }));
  const atteint = Math.max(-1, ...etapesLues.map((e) => rang(e.libelle)));
  for (const [i, p] of PROCEDURE.entries()) {
    if (p.aVenir && i > atteint && !etapesLues.some((e) => p.motif.test(e.libelle))) {
      etapes.push({ libelle: p.libelle, date: null, statut: 'a_venir' });
    }
  }

  const depot = etapesLues.find((e) => /d[ée]p[ôo]t/i.test(e.libelle))?.date ?? null;
  const d = DELAIS[type];
  const delais: EcheanceSuivi[] = depot
    ? [
        { libelle: `Fin du délai de 1re lecture à l’Assemblée (${d.assemblee} jours, ${d.article})`, date: plusJours(depot, d.assemblee), indicative: true },
        { libelle: `Fin du délai d’examen par le Parlement (${d.parlement} jours, ${d.article})`, date: plusJours(depot, d.parlement), indicative: true },
      ]
    : [];

  // Prochaine échéance : le premier délai constitutionnel encore à venir et pertinent, sinon la prochaine étape.
  const premiereLectureANFinie = atteint >= 2;
  const parlementFini = atteint >= rang('Conseil constitutionnel');
  const candidats = [
    !premiereLectureANFinie ? delais[0] : undefined,
    !parlementFini ? delais[1] : undefined,
  ].filter((e): e is EcheanceSuivi => Boolean(e?.date && e.date >= aujourdhui));
  const etapeSuivante = etapes.find((e) => e.statut === 'a_venir');
  const prochaine = candidats[0] ?? (etapeSuivante ? { libelle: etapeSuivante.libelle, date: null } : null);

  return {
    texte: intitule,
    etape_actuelle: etapesLues[dernier]?.libelle ?? 'Dossier ouvert, aucune étape publiée',
    etapes,
    prochaine_echeance: prochaine,
    delais,
    source: 'Assemblée nationale — dossier législatif',
    url,
    mis_a_jour_le: aujourdhui,
  };
}

/** Années à essayer : l'année suivante (PLF déposé à l'automne), puis l'année en cours. */
export function anneesCandidates(maintenant: Date): number[] {
  const annee = Number(dateIsoParis(maintenant).slice(0, 4));
  return [annee + 1, annee];
}

export function empreinteEtapes(etapes: readonly EtapeLue[]): string {
  return createHash('sha256').update(JSON.stringify(etapes)).digest('hex').slice(0, 16);
}

export interface ResultatDossiers {
  suivi: { plf: SuiviTexte | null; plfss: SuiviTexte | null };
  articles: ArticleFlux[];
  etats: EtatSource[];
}

const SIGLES = { plf: 'PLF', plfss: 'PLFSS' } as const;
const THEMES_SUIVI: Record<'plf' | 'plfss', Theme> = { plf: 'Loi de finances', plfss: 'Sécurité sociale' };

export async function collecterDossiers(
  sources: readonly SourceCatalogue[],
  options: { client: ClientHttp; maintenant: Date; etatPrecedent: EtatSource[]; motsCles: MotsCles },
): Promise<ResultatDossiers> {
  const resultat: ResultatDossiers = { suivi: { plf: null, plfss: null }, articles: [], etats: [] };
  const aujourdhui = dateIsoParis(options.maintenant);
  const precedents = new Map(options.etatPrecedent.map((e) => [e.id, e]));

  for (const source of sources.filter((s) => s.type === 'dossier')) {
    const precedent = precedents.get(source.id);
    const etat: EtatSource = {
      id: source.id, nom: source.nom, type: 'dossier', theme: source.theme, statut_catalogue: source.statut, etat: 'inactive',
      derniere_tentative: options.maintenant.toISOString(), derniere_reussite: precedent?.derniere_reussite ?? null,
      erreur: null, nb_articles: 0, nb_elements: null, duree_ms: null, empreinte: precedent?.empreinte ?? null,
    };
    const type = source.suivi;
    if (source.statut !== 'verifie' || !source.url || !type) {
      resultat.etats.push({ ...etat, derniere_tentative: precedent?.derniere_tentative ?? null, erreur: 'dossier non suivi (catalogue)' });
      continue;
    }
    try {
      let trouve: { url: string; annee: number; etapes: EtapeLue[]; html: string } | null = null;
      let derniereErreur = 'dossier introuvable';
      // Une page trouvée mais illisible est plus grave qu'une année absente : ce message est prioritaire.
      let erreurStructure: string | null = null;
      for (const annee of anneesCandidates(options.maintenant)) {
        const url = source.url.replace('{annee}', String(annee));
        const r = await options.client.recuperer(url);
        if (r.statut !== 200) {
          derniereErreur = `HTTP ${r.statut} pour ${SIGLES[type]} ${annee}`;
          continue;
        }
        const html = decoderOctets(r.octets, lireEncodageDeclare(r.octets, r.contentType)).texte;
        const etapes = lireEtapesAN(html);
        if (etapes.length === 0) {
          erreurStructure ??= `${SIGLES[type]} ${annee} : bloc « Étapes de lecture » introuvable (structure de la page modifiée ?)`;
          continue;
        }
        trouve = { url, annee, etapes, html };
        etat.duree_ms = r.dureeMs;
        break;
      }
      if (!trouve) throw new Error(erreurStructure ?? derniereErreur);

      const intitule = `${SIGLES[type]} ${trouve.annee}`;
      const suivi = construireSuivi(type, intitule, trouve.etapes, aujourdhui, trouve.url);

      // Articles du projet de loi déposé (texte open data) : une panne ici n'empêche pas le suivi des étapes.
      const texteProjet = texteDepuisDossier(trouve.html);
      let remarque: string | null = texteProjet ? null : 'lien vers le projet de loi introuvable dans le dossier';
      if (texteProjet) {
        try {
          const r = await options.client.recuperer(texteProjet.opendata);
          if (r.statut !== 200) throw new Error(`HTTP ${r.statut}`);
          const articles = lireArticles(decoderOctets(r.octets, lireEncodageDeclare(r.octets, r.contentType)).texte);
          if (articles.length === 0) throw new Error('aucun article reconnu (présentation du texte modifiée ?)');
          suivi.mesures = construireMesures(
            articles, options.motsCles, THEMES_SUIVI[type],
            `Projet de loi n° ${texteProjet.numero} (texte déposé par le Gouvernement)`, texteProjet.page, texteProjet.opendata,
          );
        } catch (e) {
          remarque = `articles du projet de loi non lus : ${e instanceof Error ? e.message : String(e)}`;
        }
      }
      resultat.suivi[type] = suivi;
      const empreinte = empreinteEtapes(trouve.etapes);
      // Nouvelle étape : seulement par rapport à un relevé précédent du même type (pas l'ancienne empreinte de page).
      if (precedent?.type === 'dossier' && precedent.empreinte && precedent.empreinte !== empreinte) {
        const derniere = trouve.etapes[trouve.etapes.length - 1]!;
        resultat.articles.push({
          titre: `${intitule} : nouvelle étape — ${derniere.libelle}`,
          url: trouve.url,
          date: derniere.date ?? aujourdhui,
          theme: themeConnu(THEMES_SUIVI[type]),
          source: source.nom,
          source_id: source.id,
          resume: `Étape « ${derniere.libelle} »${derniere.date ? ` (${derniere.date.split('-').reverse().join('/')})` : ''}, d’après le dossier législatif de l’Assemblée nationale.`,
          type: 'texte_officiel',
        });
      }
      Object.assign(etat, {
        etat: 'ok', derniere_reussite: options.maintenant.toISOString(), empreinte, nb_elements: trouve.etapes.length,
        nb_articles: resultat.articles.filter((a) => a.source_id === source.id).length,
        erreur: remarque,
      });
    } catch (e) {
      Object.assign(etat, { etat: 'erreur', erreur: e instanceof Error ? e.message : String(e) });
    }
    resultat.etats.push(etat);
  }
  return resultat;
}
