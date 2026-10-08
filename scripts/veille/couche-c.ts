/**
 * Couche C : recherche IA quotidienne, un appel à l'API Claude par thème, avec l'outil
 * de recherche web côté serveur (docs/VEILLE.md). Le texte traité est public.
 */
import type { Theme } from '../../src/modules/veille/modele.ts';
import { fenetreJours, type ConfigVeille, type ConsigneTheme } from './config.ts';
import { coutReponse, type Budget } from './couts.ts';
import { dateIsoParis } from './dates.ts';
import {
  BETA_REPLI,
  accepteRepliServeur,
  extraireJson,
  texteFinal,
  urlsCitees,
  type ClientIA,
  type Message,
  type Parametres,
  type VersionRecherche,
} from './ia.ts';
import {
  controlerArticle,
  controlerIndicateur,
  controlerSuivi,
  schemaReponse,
  verifierStructure,
  type ArticleIA,
  type IndicateurIA,
  type Rejet,
  type SuiviIA,
} from './validation.ts';

export interface ResultatTheme {
  theme: Theme;
  statut: 'ok' | 'abandonne';
  articles: ArticleIA[];
  indicateurs: IndicateurIA[];
  suivi: SuiviIA | null;
  rejetes: Rejet[];
  recherches: number;
  coutNano: number;
  erreur: string | null;
}

export interface OptionsCoucheC {
  client: ClientIA;
  config: ConfigVeille;
  promptSysteme: string;
  outil: VersionRecherche;
  budget: Budget;
  maintenant: Date;
  journal?: (message: string) => void;
}

/** Reprises après `pause_turn` (boucle d'outils serveur interrompue) avant d'abandonner l'essai. */
const REPRISES_MAX = 4;
/** Essais par thème : le premier, puis un seul nouvel essai si le JSON est invalide. */
const ESSAIS_MAX = 2;

export function fenetreTheme(config: ConfigVeille, theme: string, maintenant: Date): { debut: string; fin: string; jours: number } {
  const jours = fenetreJours(config, theme);
  const fin = dateIsoParis(maintenant);
  const debut = dateIsoParis(new Date(maintenant.getTime() - jours * 86_400_000));
  return { debut, fin, jours };
}

const versFr = (iso: string) => iso.split('-').reverse().join('/');

export function messageTheme(consigne: ConsigneTheme, fenetre: { debut: string; fin: string; jours: number }): string {
  const champsSpecifiques =
    consigne.theme === 'Économie et statistiques'
      ? 'Remplis « indicateurs ». Mets « suivi_texte » à null.'
      : consigne.theme === 'Loi de finances' || consigne.theme === 'Sécurité sociale'
        ? 'Renseigne « suivi_texte ». Mets « indicateurs » à [].'
        : 'Mets « indicateurs » à [] et « suivi_texte » à null.';
  return [
    `Date du jour : ${versFr(fenetre.fin)} (${fenetre.fin}).`,
    `Fenêtre : ne retiens que des publications datées du ${fenetre.debut} au ${fenetre.fin} inclus (${fenetre.jours} derniers jours).`,
    '',
    `Thème : ${consigne.theme}`,
    `Consigne : ${consigne.consigne}`,
    '',
    `Pour chaque article, « url » doit être l'adresse exacte d'un résultat de tes recherches. ${champsSpecifiques}`,
    'Si rien de déterminant n’a été publié dans la fenêtre, renvoie « articles » vide.',
    '',
    `Réponds uniquement par un objet JSON de cette forme, avec « theme » égal à « ${consigne.theme} » :`,
    schemaReponse(consigne.theme),
  ].join('\n');
}

function parametres(options: OptionsCoucheC, messages: Parametres['messages']): Parametres {
  const modele = options.config.modele_recherche;
  return {
    model: modele,
    max_tokens: 16_000,
    system: options.promptSysteme,
    messages,
    tools: [
      {
        type: options.outil,
        name: 'web_search',
        max_uses: options.config.recherches_max_par_theme,
        user_location: options.config.localisation,
      },
    ],
    // Repli automatique côté serveur si le modèle décline la requête (mêmes tarifs pour Claude Sonnet 5).
    ...(accepteRepliServeur(modele) ? { betas: [BETA_REPLI], fallbacks: 'default' as const } : {}),
  };
}

interface Echange {
  final: Message;
  urls: Set<string>;
  coutNano: number;
  recherches: number;
}

/** Un essai : appel, puis reprises tant que l'API renvoie `pause_turn`. Chaque réponse est imputée au budget. */
async function echanger(options: OptionsCoucheC, texte: string): Promise<Echange> {
  const messages: Parametres['messages'] = [{ role: 'user', content: texte }];
  const urls = new Set<string>();
  let coutNano = 0;
  let recherches = 0;
  for (let reprise = 0; ; reprise++) {
    const reponse = await options.client.beta.messages.create(parametres(options, messages));
    const cout = coutReponse(reponse.usage, reponse.model);
    options.budget.imputer(cout.nano);
    coutNano += cout.nano;
    recherches += cout.recherches;
    if (!cout.tarifConnu) options.journal?.(`  tarif inconnu pour ${reponse.model} : coût estimé au tarif le plus élevé`);
    for (const url of urlsCitees(reponse.content)) urls.add(url);
    if (reponse.stop_reason !== 'pause_turn' || reprise >= REPRISES_MAX) return { final: reponse, urls, coutNano, recherches };
    // Reprise : on renvoie la réponse partielle telle quelle, le serveur poursuit la boucle de recherche.
    messages.push({ role: 'assistant', content: reponse.content as Parametres['messages'][number]['content'] });
  }
}

export async function rechercherTheme(options: OptionsCoucheC, consigne: ConsigneTheme): Promise<ResultatTheme> {
  const fenetre = fenetreTheme(options.config, consigne.theme, options.maintenant);
  const resultat: ResultatTheme = {
    theme: consigne.theme, statut: 'abandonne', articles: [], indicateurs: [], suivi: null,
    rejetes: [], recherches: 0, coutNano: 0, erreur: null,
  };
  const texte = messageTheme(consigne, fenetre);

  for (let essai = 1; essai <= ESSAIS_MAX; essai++) {
    if (options.budget.depasse()) {
      resultat.erreur = 'budget mensuel atteint';
      return resultat;
    }
    let echange: Echange;
    try {
      echange = await echanger(options, texte);
    } catch (e) {
      // Erreur d'API (réseau, quota, 5xx après les nouvelles tentatives du SDK) : abandon du thème pour la journée.
      resultat.erreur = `erreur d'API : ${e instanceof Error ? e.message : String(e)}`;
      return resultat;
    }
    resultat.coutNano += echange.coutNano;
    resultat.recherches += echange.recherches;

    const { final } = echange;
    if (final.stop_reason === 'refusal') {
      resultat.erreur = `requête déclinée par le modèle${final.stop_details?.category ? ` (${final.stop_details.category})` : ''}`;
      return resultat;
    }
    let structure: ReturnType<typeof verifierStructure>;
    try {
      structure = final.stop_reason === 'pause_turn'
        ? { ok: false, raison: 'recherche interrompue (pause_turn répété)' }
        : verifierStructure(extraireJson(texteFinal(final.content)), consigne.theme);
    } catch (e) {
      structure = { ok: false, raison: `JSON invalide${final.stop_reason === 'max_tokens' ? ' (réponse tronquée)' : ''} : ${e instanceof Error ? e.message : String(e)}` };
    }
    if (!structure.ok) {
      resultat.erreur = structure.raison;
      options.journal?.(`  ${consigne.theme} · essai ${essai} : ${structure.raison}`);
      continue;
    }

    const ctx = { urlsCitees: echange.urls, debut: fenetre.debut, fin: fenetre.fin };
    for (const brut of structure.articles) {
      const v = controlerArticle(brut, ctx);
      if (v.ok) resultat.articles.push(v.valeur);
      else resultat.rejetes.push(v.rejet);
    }
    for (const brut of structure.indicateurs) {
      const v = controlerIndicateur(brut, ctx);
      if (v.ok) resultat.indicateurs.push(v.valeur);
      else resultat.rejetes.push(v.rejet);
    }
    if (structure.suivi !== null) {
      const v = controlerSuivi(structure.suivi);
      if (v.ok) resultat.suivi = v.valeur;
      else resultat.rejetes.push({ titre: 'suivi_texte', url: null, raison: v.raison });
    }
    return { ...resultat, statut: 'ok', erreur: null };
  }
  return resultat;
}

/** Exécute les thèmes l'un après l'autre (le budget est contrôlé avant chaque appel). */
export async function executerCoucheC(options: OptionsCoucheC, consignes: readonly ConsigneTheme[]): Promise<ResultatTheme[]> {
  const resultats: ResultatTheme[] = [];
  for (const consigne of consignes) {
    options.journal?.(`Couche C · ${consigne.theme}…`);
    resultats.push(await rechercherTheme(options, consigne));
  }
  return resultats;
}
