/**
 * Connecteurs des API de la couche B validés par du code exécuté dans GitHub Actions
 * (npm run veille:explorer-marches, 09/10/2026) :
 *  - insee-bdm : séries de veille/indicateurs.json (API BDM ouverte, sans clé) ;
 *  - bodacc-35 : annonces commerciales d'Ille-et-Vilaine sur 7 jours, comptées par famille
 *    (open data DILA ; aucun nom de personne ou d'entreprise n'est publié).
 */
import type { Indicateur } from '../../src/modules/veille/modele.ts';
import type { ConnecteurApi } from './couche-b.ts';
import { dateIsoParis } from './dates.ts';
import { ErreurCollecte } from './http.ts';
import { lireSeriesInsee, periodeEnClair, urlSeriesInsee } from './insee.ts';

export function formaterValeur(valeur: number, decimales: number, unite: string): string {
  const nombre = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: decimales, maximumFractionDigits: decimales }).format(valeur);
  if (!unite) return nombre;
  return unite === '%' ? `${nombre} %` : `${nombre} ${unite}`;
}

export const connecteurInsee: ConnecteurApi = {
  async collecter({ source, client, maintenant, indicateurs = [] }) {
    const suivis = indicateurs.filter((i) => i.source_id === source.id);
    if (suivis.length === 0) throw new ErreurCollecte('aucune série dans veille/indicateurs.json');
    const r = await client.recuperer(urlSeriesInsee(suivis.map((i) => i.serie), 1), { robots: source.robots ?? 'api_documentee' });
    if (r.statut !== 200) throw new ErreurCollecte(`HTTP ${r.statut}`);
    const series = lireSeriesInsee(new TextDecoder().decode(r.octets));
    const aujourdhui = dateIsoParis(maintenant);
    const resultat: Indicateur[] = [];
    const absentes: string[] = [];
    for (const i of suivis) {
      const derniere = series.get(i.serie)?.observations.at(-1);
      if (!derniere) {
        absentes.push(i.serie);
        continue;
      }
      resultat.push({
        source_id: source.id,
        libelle: i.libelle,
        valeur: formaterValeur(derniere.valeur, i.decimales, i.unite),
        periode: periodeEnClair(derniere.periode),
        source: 'INSEE',
        url: i.url,
        date_publication: series.get(i.serie)?.derniereMaj ?? aujourdhui,
        collecte_le: aujourdhui,
      });
    }
    if (resultat.length === 0) throw new ErreurCollecte(`aucune série lue (${absentes.join(', ')})`);
    return { articles: [], indicateurs: resultat };
  },
};

/** Familles d'annonces publiées en compteurs, dans l'ordre d'affichage. */
export const FAMILLES_BODACC = [
  { famille: 'Créations', libelle: 'Créations d’entreprises' },
  { famille: 'Procédures collectives', libelle: 'Procédures collectives' },
  { famille: 'Ventes et cessions', libelle: 'Ventes et cessions de fonds' },
  { famille: 'Radiations', libelle: 'Radiations' },
] as const;

export function urlBodacc(departement: string, du: string, au: string): string {
  const url = new URL('https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records');
  url.searchParams.set('select', 'familleavis_lib, count(*) as nb');
  url.searchParams.set('where', `numerodepartement="${departement}" and dateparution>=date'${du}' and dateparution<=date'${au}'`);
  url.searchParams.set('group_by', 'familleavis_lib');
  url.searchParams.set('limit', '50');
  return url.href;
}

/** Comptes par famille d'une réponse de l'API (regroupement par familleavis_lib). */
export function lireComptesBodacc(json: unknown): Map<string, number> {
  const comptes = new Map<string, number>();
  const resultats = (json as { results?: { familleavis_lib?: unknown; nb?: unknown }[] })?.results;
  if (!Array.isArray(resultats)) throw new ErreurCollecte('réponse BODACC inattendue (champ « results » absent)');
  for (const r of resultats) if (typeof r.familleavis_lib === 'string' && typeof r.nb === 'number') comptes.set(r.familleavis_lib, r.nb);
  return comptes;
}

export const connecteurBodacc: ConnecteurApi = {
  async collecter({ source, client, maintenant }) {
    // Les 7 jours qui précèdent la collecte (le BODACC du jour peut être incomplet le matin).
    const au = dateIsoParis(new Date(maintenant.getTime() - 86_400_000));
    const du = dateIsoParis(new Date(maintenant.getTime() - 7 * 86_400_000));
    const r = await client.recuperer(urlBodacc('35', du, au), { robots: source.robots ?? 'ignorer' });
    if (r.statut !== 200) throw new ErreurCollecte(`HTTP ${r.statut}`);
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder().decode(r.octets));
    } catch {
      throw new ErreurCollecte('réponse BODACC illisible (JSON attendu)');
    }
    const comptes = lireComptesBodacc(json);
    const aujourdhui = dateIsoParis(maintenant);
    const periode = `du ${du.split('-').reverse().join('/')} au ${au.split('-').reverse().join('/')}`;
    return {
      articles: [],
      indicateurs: FAMILLES_BODACC.map((f) => ({
        source_id: source.id,
        libelle: `${f.libelle} en Ille-et-Vilaine`,
        valeur: formaterValeur(comptes.get(f.famille) ?? 0, 0, 'annonces'),
        periode,
        source: 'BODACC (DILA)',
        url: 'https://www.bodacc.fr/',
        date_publication: au,
        collecte_le: aujourdhui,
      })),
    };
  },
};
