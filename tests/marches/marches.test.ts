import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  calculerFraicheur,
  calculerVariations,
  enHeureDeParis,
  estJourTarget,
  extrapolerDette,
  instantParis,
  nouvelleValeurAttendue,
  prochainePublication,
  type IndicateurMarche,
  type MarchesJson,
  type ReglePublication,
} from '../../src/modules/veille/marches.ts';
import { collecterMarches, messageCommit, noterJournal, urlAvecJetons, type ConfigMarches } from '../../scripts/marches/collecte.ts';
import { dateDePeriode, lireCsv, lireProchainePublicationInsee, lireSerieCsv, lireSerieInsee } from '../../scripts/marches/lecture.ts';
import { ClientHttp } from '../../scripts/veille/http.ts';

const fixture = (nom: string) => readFileSync(resolve('tests/fixtures/marches', nom), 'utf8');

describe('lecture des sources (réponses enregistrées)', () => {
  it('CSV avec champs entre guillemets', () => {
    expect(lireCsv('a,b,c\n1,"x, y","dit ""bonjour"""\r\n')).toEqual([['a', 'b', 'c'], ['1', 'x, y', 'dit "bonjour"']]);
  });

  it('BCE : EUR/USD quotidien', () => {
    const l = lireSerieCsv(fixture('bce-eur-usd.csv'), { date: 'TIME_PERIOD', valeur: 'OBS_VALUE' });
    expect(l.historique.at(-1)).toEqual(['2026-10-08', 1.1186]);
    expect(l.historique.at(-2)).toEqual(['2026-10-07', 1.1177]);
    expect(l.historique.every(([d]) => estJourTarget(d))).toBe(true);
  });

  it('BCE : dette trimestrielle en millions convertie en Md€, fin de trimestre', () => {
    const l = lireSerieCsv(fixture('bce-gfs-dette.csv'), { date: 'TIME_PERIOD', valeur: 'OBS_VALUE', multiplicateur: 0.001 });
    expect(l.historique.at(-1)).toEqual(['2026-03-31', 3536.06774]);
  });

  it('BCE : taux long terme mensuel daté de la fin du mois', () => {
    expect(lireSerieCsv(fixture('bce-taux-long-fr.csv'), { date: 'TIME_PERIOD', valeur: 'OBS_VALUE' }).historique.at(-1)).toEqual(['2026-08-31', 4]);
  });

  it('FRED : Brent (valeurs manquantes « . » ignorées)', () => {
    const l = lireSerieCsv(`${fixture('fred-brent.csv')}2026-10-07,.\n`, { date: 'observation_date', valeur: 'DCOILBRENTEU' });
    expect(l.historique.at(-1)).toEqual(['2026-10-06', 125.44]);
  });

  it('Webstat : séparateur « ; », virgule décimale, première colonne de date disponible', () => {
    const l = lireSerieCsv(fixture('webstat-tec10-reconstitue.csv'), { date: ['time_period_end', 'time_period'], valeur: ['obs_value'] }, ';');
    expect(l.historique).toEqual([['2026-10-06', 3.97], ['2026-10-07', 3.99], ['2026-10-08', 4.01]]);
  });

  it('colonne absente : erreur explicite', () => {
    expect(() => lireSerieCsv('date;autre\n2026-10-08;1\n', { date: 'date', valeur: 'obs_value' }, ';')).toThrow(/colonnes introuvables/);
    expect(() => lireSerieCsv('<html>Maintenance</html>', { date: 'TIME_PERIOD', valeur: 'OBS_VALUE' })).toThrow(/colonnes introuvables/);
  });

  it('INSEE : dette de Maastricht et % du PIB dans la même réponse', () => {
    const l = lireSerieInsee(fixture('insee-dette.xml'), { valeur: '010777616', complements: { pib: '010777608' } });
    expect(l.historique.at(-1)).toEqual(['2026-06-30', 3595.5]);
    expect(l.historique).toHaveLength(12);
    expect(l.complements.pib?.at(-1)).toEqual(['2026-06-30', 119]);
    expect(l.miseAJour).toBe('2026-09-29');
  });

  it('INSEE : dette négociable de l’État en M€ convertie en Md€', () => {
    expect(lireSerieInsee(fixture('insee-dette-negociable.xml'), { valeur: '001711531', multiplicateur: 0.001 }).historique.at(-1)).toEqual(['2026-08-31', 2923.761]);
  });

  it('INSEE : prochaine publication lue sur la page « Informations rapides »', () => {
    expect(lireProchainePublicationInsee(fixture('insee-ir-dette.html'))).toEqual({ date: '2026-12-18', heure: '08:45' });
    expect(lireProchainePublicationInsee('<p>Prochaine publication&nbsp;: le 1er avril 2027 à 12h00.</p>')).toEqual({ date: '2027-04-01', heure: '12:00' });
    expect(lireProchainePublicationInsee('<p>Pas de date</p>')).toBeNull();
  });

  it('dates de période', () => {
    expect(dateDePeriode('2026-Q4')).toBe('2026-12-31');
    expect(dateDePeriode('2026-10-08T00:00:00+02:00')).toBe('2026-10-08');
    expect(dateDePeriode('octobre')).toBeNull();
  });
});

describe('heure de Paris et jours TARGET', () => {
  it('heure d’été et heure d’hiver', () => {
    expect(instantParis('2026-10-09', '16:15').toISOString()).toBe('2026-10-09T14:15:00.000Z');
    expect(instantParis('2026-12-18', '08:45').toISOString()).toBe('2026-12-18T07:45:00.000Z');
    expect(enHeureDeParis(new Date('2026-03-29T01:30:00Z'))).toEqual({ date: '2026-03-29', heure: '03:30' });
  });

  it('fermetures TARGET : Vendredi saint, lundi de Pâques, 1er mai, Noël et 26 décembre', () => {
    expect(['2027-03-26', '2027-03-29', '2027-05-01', '2026-12-25', '2026-12-26'].map(estJourTarget)).toEqual([false, false, false, false, false]);
    expect(estJourTarget('2026-11-11')).toBe(true); // férié en France, ouvert pour TARGET
  });
});

describe('variations', () => {
  const h: [string, number][] = [['2025-10-08', 100], ['2025-12-31', 110], ['2026-09-08', 118], ['2026-10-07', 119], ['2026-10-08', 120]];
  it('veille, 1 mois, depuis le 1er janvier, 1 an', () => {
    const v = calculerVariations(h, 'niveau');
    expect(v.precedente).toEqual({ depuis: '2026-10-07', absolue: 1, relative: 0.8403 });
    expect(v.un_mois).toEqual({ depuis: '2026-09-08', absolue: 2, relative: 1.6949 });
    expect(v.debut_annee).toEqual({ depuis: '2025-12-31', absolue: 10, relative: 9.0909 });
    expect(v.un_an).toEqual({ depuis: '2025-10-08', absolue: 20, relative: 20 });
  });

  it('taux : variation en points, sans pourcentage ; historique trop court : null', () => {
    expect(calculerVariations([['2026-10-07', 3.5], ['2026-10-08', 3.62]], 'taux').precedente).toEqual({ depuis: '2026-10-07', absolue: 0.12, relative: null });
    expect(calculerVariations([['2026-10-08', 1]], 'niveau')).toEqual({ precedente: null, un_mois: null, debut_annee: null, un_an: null });
  });
});

const QUOTIDIEN: ReglePublication = { frequence: 'quotidienne', heure: '16:15', tolerance_jours_ouvres: 1 };
const HEBDO: ReglePublication = { frequence: 'hebdomadaire', jour_semaine: 3, heure: '19:00', tolerance_jours_ouvres: 2 };
const TRIM: ReglePublication = { frequence: 'trimestrielle', decalage_jours: 85, heure: '08:45', tolerance_jours_ouvres: 5 };
const MENS: ReglePublication = { frequence: 'mensuelle', decalage_jours: 12, heure: null, tolerance_jours_ouvres: 10 };
const ici = (iso: string) => new Date(iso);

describe('prochaine publication attendue', () => {
  it('quotidienne : jour TARGET suivant la dernière valeur, à l’heure habituelle', () => {
    expect(prochainePublication(QUOTIDIEN, '2026-10-08', ici('2026-10-09T08:00:00Z'))).toEqual({ date: '2026-10-09', heure: '16:15', estimee: true });
    expect(prochainePublication(QUOTIDIEN, '2026-10-09', ici('2026-10-09T15:00:00Z'))?.date).toBe('2026-10-12'); // vendredi → lundi
    expect(prochainePublication(QUOTIDIEN, '2027-03-25', ici('2027-03-25T15:00:00Z'))?.date).toBe('2027-03-30'); // Pâques
  });

  it('hebdomadaire : mercredi suivant', () => {
    expect(prochainePublication(HEBDO, '2026-10-06', ici('2026-10-09T08:00:00Z'))?.date).toBe('2026-10-14');
  });

  it('trimestrielle : calendrier officiel, sinon estimation', () => {
    expect(prochainePublication(TRIM, '2026-06-30', ici('2026-10-09T08:00:00Z'), [{ date: '2026-12-18', heure: '08:45' }])).toEqual({ date: '2026-12-18', heure: '08:45', estimee: false });
    // Calendrier dépassé : estimation à partir de la fin du trimestre suivant (30/09 + 85 jours = 24/12, jour TARGET).
    expect(prochainePublication(TRIM, '2026-06-30', ici('2026-12-19T08:00:00Z'), [{ date: '2026-12-18', heure: '08:45' }])).toEqual({ date: '2026-12-24', heure: '08:45', estimee: true });
  });

  it('mensuelle : environ 12 jours après la fin du mois suivant', () => {
    expect(prochainePublication(MENS, '2026-08-31', ici('2026-10-09T08:00:00Z'))?.date).toBe('2026-10-12');
  });
});

const indic = (champs: Partial<IndicateurMarche>): Pick<IndicateurMarche, 'prochaine_publication' | 'regle' | 'derniere_erreur' | 'valeur'> => ({
  prochaine_publication: { date: '2026-10-09', heure: '16:15', estimee: true }, regle: QUOTIDIEN, derniere_erreur: null, valeur: 1.1186, ...champs,
});

describe('fraîcheur', () => {
  it('à jour, décalage normal, en retard', () => {
    expect(calculerFraicheur(indic({}), ici('2026-10-09T10:00:00Z'))).toBe('a_jour');
    expect(calculerFraicheur(indic({}), ici('2026-10-09T15:00:00Z'))).toBe('decalage_normal'); // 17 h à Paris, publication de 16 h 15 pas encore relevée
    expect(calculerFraicheur(indic({}), ici('2026-10-12T14:00:00Z'))).toBe('decalage_normal'); // tolérance : 1 jour ouvré
    expect(calculerFraicheur(indic({}), ici('2026-10-12T15:00:00Z'))).toBe('en_retard');
  });

  it('source en panne : dernière tentative en échec ou aucune valeur', () => {
    expect(calculerFraicheur(indic({ derniere_erreur: 'bce-eur-usd : HTTP 503' }), ici('2026-10-09T10:00:00Z'))).toBe('en_panne');
    expect(calculerFraicheur(indic({ valeur: null }), ici('2026-10-09T10:00:00Z'))).toBe('en_panne');
  });

  it('nouvelle valeur attendue ?', () => {
    expect(nouvelleValeurAttendue(indic({}), ici('2026-10-09T10:00:00Z'))).toBe(false);
    expect(nouvelleValeurAttendue(indic({}), ici('2026-10-09T14:20:00Z'))).toBe(true);
    expect(nouvelleValeurAttendue(indic({ derniere_erreur: 'x' }), ici('2026-10-09T10:00:00Z'))).toBe(true);
  });
});

describe('dette : estimation en temps réel', () => {
  const h: [string, number][] = [['2025-06-30', 3384.2], ['2025-09-30', 3416.8], ['2025-12-31', 3460.5], ['2026-03-31', 3535.9], ['2026-06-30', 3595.5]];
  it('part du dernier chiffre officiel et progresse de la variation moyenne des 4 derniers trimestres', () => {
    const base = instantParis('2026-07-01', '00:00');
    const e = extrapolerDette(h, base)!;
    expect(e.valeur).toBeCloseTo(3595.5e9, -3);
    expect(e.trimestres).toBe(4);
    expect(e.parSeconde).toBeCloseTo(((3595.5 - 3384.2) * 1e9) / (365 * 86_400), 3);
    const unJourPlusTard = extrapolerDette(h, new Date(base.getTime() + 86_400_000))!;
    expect(unJourPlusTard.valeur - e.valeur).toBeCloseTo(e.parSeconde * 86_400, 0);
  });

  it('pas d’estimation avant la fin du trimestre ni avec un seul point', () => {
    expect(extrapolerDette(h, instantParis('2026-06-15', '12:00'))!.valeur).toBeCloseTo(3595.5e9, -3);
    expect(extrapolerDette([['2026-06-30', 3595.5]], new Date())).toBeNull();
  });
});

describe('collecte des marchés', () => {
  const CONFIG: ConfigMarches = {
    historique_jours: 730,
    indicateurs: [
      {
        id: 'eurusd', nom: 'EUR/USD', unite: '$', decimales: 4, genre: 'niveau', nature: 'quotidien officiel', regle: QUOTIDIEN,
        sources: [{ id: 'bce-eur-usd', organisme: 'BCE', libelle: 'EUR/USD', format: 'csv', url: 'https://data-api.ecb.europa.eu/eurusd?startPeriod={debut}', emplacement: { date: 'TIME_PERIOD', valeur: 'OBS_VALUE' }, lien: 'https://bce', conditions: 'libre' }],
      },
      {
        id: 'oat10', nom: 'OAT 10 ans', unite: '%', decimales: 2, genre: 'taux', nature: 'quotidien officiel', regle: { ...QUOTIDIEN, heure: '19:00' },
        sources: [
          { id: 'webstat', organisme: 'Banque de France', libelle: 'TEC 10', format: 'csv', separateur: ';', secret: 'BDF_API_KEY', url: 'https://webstat.banque-france.fr/tec10', emplacement: { date: ['time_period_end'], valeur: ['obs_value'] }, lien: 'https://bdf', conditions: 'licence ouverte' },
          { id: 'bce-irs', organisme: 'BCE', libelle: 'Taux long', format: 'csv', url: 'https://data-api.ecb.europa.eu/irs', emplacement: { date: 'TIME_PERIOD', valeur: 'OBS_VALUE' }, lien: 'https://bce', conditions: 'libre', nature_secours: 'mensuel', regle_secours: MENS },
        ],
      },
    ],
  };

  function reseau(routes: Record<string, string | number>) {
    const appels: { url: string; entetes: Record<string, string> }[] = [];
    const fetch = (async (u: URL | string, init?: RequestInit) => {
      const url = String(u).split('?')[0]!;
      appels.push({ url, entetes: (init?.headers ?? {}) as Record<string, string> });
      if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
      const r = routes[url];
      return typeof r === 'string' ? new Response(r) : new Response('', { status: r ?? 404 });
    }) as typeof globalThis.fetch;
    return { client: new ClientHttp({ userAgent: 'test', fetch, attendre: async () => {}, maintenant: () => 0 }), appels: () => appels.filter((a) => !a.url.endsWith('/robots.txt')) };
  }
  const ROUTES = { 'https://data-api.ecb.europa.eu/eurusd': fixture('bce-eur-usd.csv'), 'https://data-api.ecb.europa.eu/irs': fixture('bce-taux-long-fr.csv') };

  it('première collecte : toutes les sources, secours sans clé Webstat, fichier à écrire', async () => {
    const { client, appels } = reseau(ROUTES);
    const r = await collecterMarches({ config: CONFIG, evenements: [], precedent: null, client, maintenant: ici('2026-10-09T08:00:00Z'), env: {} });
    expect(r.modifie).toBe(true);
    expect(appels().map((a) => a.url)).toEqual(['https://data-api.ecb.europa.eu/eurusd', 'https://data-api.ecb.europa.eu/irs']);
    const oat = r.marches.indicateurs.find((i) => i.id === 'oat10')!;
    expect(oat).toMatchObject({ valeur: 4, date_valeur: '2026-08-31', source: { id: 'bce-irs', secours: true, nature: 'mensuel' }, regle: MENS, remarque: 'webstat : non configurée (BDF_API_KEY absent)' });
    expect(r.marches.indicateurs[0]).toMatchObject({ valeur: 1.1186, date_valeur: '2026-10-08', journal: [{ date: '2026-10-09', etat: 'ok' }] });
    expect(r.nouveautes).toEqual(['EUR/USD 1,1186 au 08/10', 'OAT 10 ans 4,00 % au 31/08']);
  });

  it('exécution suivante : seules les sources dont une valeur est attendue sont interrogées', async () => {
    const premier = reseau(ROUTES);
    const r1 = await collecterMarches({ config: CONFIG, evenements: [], precedent: null, client: premier.client, maintenant: ici('2026-10-09T08:00:00Z'), env: {} });
    const second = reseau(ROUTES);
    const r2 = await collecterMarches({ config: CONFIG, evenements: [], precedent: r1.marches, client: second.client, maintenant: ici('2026-10-09T09:00:00Z'), env: {} });
    expect(second.appels()).toHaveLength(0);
    expect(r2.modifie).toBe(false);
    // Après 16 h 15 : seul EUR/USD est attendu ; même réponse, donc rien à publier.
    const troisieme = reseau(ROUTES);
    const r3 = await collecterMarches({ config: CONFIG, evenements: [], precedent: r1.marches, client: troisieme.client, maintenant: ici('2026-10-09T14:20:00Z'), env: {} });
    expect(troisieme.appels().map((a) => a.url)).toEqual(['https://data-api.ecb.europa.eu/eurusd']);
    expect(r3.modifie).toBe(false);
  });

  it('clé Webstat présente : source principale réessayée, en-tête d’authentification envoyé', async () => {
    const { client: c1 } = reseau(ROUTES);
    const r1 = await collecterMarches({ config: CONFIG, evenements: [], precedent: null, client: c1, maintenant: ici('2026-10-09T08:00:00Z'), env: {} });
    const { client, appels } = reseau({ ...ROUTES, 'https://webstat.banque-france.fr/tec10': fixture('webstat-tec10-reconstitue.csv') });
    const r = await collecterMarches({ config: CONFIG, evenements: [], precedent: r1.marches, client, maintenant: ici('2026-10-09T09:00:00Z'), env: { BDF_API_KEY: 'cle-fictive' } });
    expect(appels().find((a) => a.url.includes('webstat'))?.entetes.Authorization).toBe('Apikey cle-fictive');
    expect(r.marches.indicateurs.find((i) => i.id === 'oat10')).toMatchObject({ valeur: 4.01, source: { id: 'webstat', secours: false }, regle: { frequence: 'quotidienne' } });
    expect(r.modifie).toBe(true);
    expect(JSON.stringify(r.marches)).not.toContain('cle-fictive');
  });

  it('source en panne : valeur conservée, erreur notée, publication (changement d’état), puis retour à la normale', async () => {
    const { client: c1 } = reseau(ROUTES);
    const r1 = await collecterMarches({ config: CONFIG, evenements: [], precedent: null, client: c1, maintenant: ici('2026-10-09T08:00:00Z'), env: {} });
    const { client } = reseau({ 'https://data-api.ecb.europa.eu/irs': fixture('bce-taux-long-fr.csv'), 'https://data-api.ecb.europa.eu/eurusd': 503 });
    const r2 = await collecterMarches({ config: CONFIG, evenements: [], precedent: r1.marches, client, maintenant: ici('2026-10-09T14:20:00Z'), env: {} });
    const eur = r2.marches.indicateurs[0]!;
    expect(eur).toMatchObject({ valeur: 1.1186, derniere_erreur: 'bce-eur-usd : HTTP 503', journal: [{ date: '2026-10-09', etat: 'erreur' }] });
    expect(calculerFraicheur(eur, ici('2026-10-09T14:20:00Z'))).toBe('en_panne');
    expect(r2.modifie).toBe(true);
    expect(messageCommit(r2.nouveautes, ici('2026-10-09T14:20:00Z'))).toBe('Marchés : état des sources mis à jour (collecte du 09/10/2026 16 h 20)');
    // Le lendemain matin, la source répond : l'erreur disparaît.
    const { client: c3 } = reseau(ROUTES);
    const r3 = await collecterMarches({ config: CONFIG, evenements: [], precedent: r2.marches, client: c3, maintenant: ici('2026-10-10T05:05:00Z'), env: {} });
    expect(r3.marches.indicateurs[0]!.derniere_erreur).toBeNull();
    expect(r3.modifie).toBe(true);
  });

  it('message de commit explicite, jetons d’URL, journal sur 30 jours', () => {
    expect(messageCommit(['EUR/USD 1,1201 au 09/10'], ici('2026-10-09T14:20:00Z'))).toBe('Marchés : EUR/USD 1,1201 au 09/10 (collecte du 09/10/2026 16 h 20)');
    expect(urlAvecJetons('x?d={debut}&m={debut_mois}&t={debut_trimestre}', ici('2026-10-09T08:00:00Z'), 730)).toBe('x?d=2024-10-02&m=2023-10&t=2023-Q4');
    const j = noterJournal(noterJournal([{ date: '2026-09-01', etat: 'ok' }], '2026-10-09', 'ok'), '2026-10-09', 'sans_nouveaute');
    expect(j).toEqual([{ date: '2026-10-09', etat: 'ok' }]);
  });

  it('le marches.json publié a la forme attendue', () => {
    const m = JSON.parse(readFileSync(resolve('public/marches.json'), 'utf8')) as MarchesJson;
    expect(m.indicateurs.map((i) => i.id)).toEqual(['dette', 'oat10', 'eurusd', 'brent']);
    for (const i of m.indicateurs) {
      expect(i.historique.length).toBeGreaterThan(5);
      expect(i.source.lien).toMatch(/^https:\/\//);
    }
    expect(m.evenements.some((e) => e.type === 'bce')).toBe(true);
  });
});
