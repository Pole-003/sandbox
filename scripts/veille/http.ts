/**
 * Client HTTP de la collecte (exécuté dans GitHub Actions, jamais dans le navigateur).
 *
 *  - User-Agent explicite (veille/config.json) ;
 *  - au plus 1 requête par seconde et par domaine (robots.txt compris) ;
 *  - robots.txt respecté à chaque étape d'une redirection ;
 *  - délai maximal par requête, lecture du corps comprise.
 */
import { analyserRobots, estAutorise, type Robots } from './robots.ts';

export interface OptionsClient {
  userAgent: string;
  delaiMaxMs?: number;
  intervalleParDomaineMs?: number;
  redirectionsMax?: number;
  /** Injectables pour les tests. */
  fetch?: typeof fetch;
  maintenant?: () => number;
  attendre?: (ms: number) => Promise<void>;
}

export interface Reponse {
  url: string;
  urlFinale: string;
  statut: number;
  contentType: string | null;
  octets: Uint8Array;
  dureeMs: number;
}

/** Erreur dont le message est destiné au rapport (en français, sans donnée sensible). */
export class ErreurCollecte extends Error {
  override name = 'ErreurCollecte';
}

type EtatRobots = { robots: Robots | null; detail: string; toutInterdit: boolean };

export class ClientHttp {
  readonly userAgent: string;
  private readonly delaiMaxMs: number;
  private readonly intervalle: number;
  private readonly redirectionsMax: number;
  private readonly fetch: typeof fetch;
  private readonly maintenant: () => number;
  private readonly attendre: (ms: number) => Promise<void>;
  private readonly prochainCreneau = new Map<string, number>();
  private readonly robots = new Map<string, Promise<EtatRobots>>();

  constructor(options: OptionsClient) {
    this.userAgent = options.userAgent;
    this.delaiMaxMs = options.delaiMaxMs ?? 20_000;
    this.intervalle = options.intervalleParDomaineMs ?? 1_000;
    this.redirectionsMax = options.redirectionsMax ?? 5;
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.maintenant = options.maintenant ?? Date.now;
    this.attendre = options.attendre ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Réserve un créneau pour le domaine, puis attend son heure (sûr en cas d'appels concurrents). */
  private async patienter(hote: string): Promise<void> {
    const maintenant = this.maintenant();
    const creneau = Math.max(maintenant, this.prochainCreneau.get(hote) ?? 0);
    this.prochainCreneau.set(hote, creneau + this.intervalle);
    if (creneau > maintenant) await this.attendre(creneau - maintenant);
  }

  /** Envoie une requête à son créneau ; `debut` est l'instant d'envoi (hors attente du créneau). */
  private async requete(url: URL): Promise<{ reponse: Response; debut: number }> {
    await this.patienter(url.host);
    const debut = this.maintenant();
    try {
      const reponse = await this.fetch(url, {
        headers: { 'User-Agent': this.userAgent, Accept: '*/*' },
        redirect: 'manual',
        signal: AbortSignal.timeout(this.delaiMaxMs),
      });
      return { reponse, debut };
    } catch (e) {
      throw new ErreurCollecte(decrireErreurReseau(e, this.delaiMaxMs));
    }
  }

  private etatRobots(url: URL): Promise<EtatRobots> {
    let etat = this.robots.get(url.origin);
    if (!etat) {
      etat = this.lireRobots(new URL('/robots.txt', url.origin));
      this.robots.set(url.origin, etat);
    }
    return etat;
  }

  private async lireRobots(url: URL): Promise<EtatRobots> {
    try {
      const { reponse } = await this.requete(url);
      if (reponse.status >= 200 && reponse.status < 300) {
        const texte = await lireCorps(reponse);
        return { robots: analyserRobots(new TextDecoder().decode(texte)), detail: 'robots.txt lu', toutInterdit: false };
      }
      await reponse.body?.cancel();
      // RFC 9309 : 4xx (absent) = tout est permis ; 5xx = injoignable, tout est interdit par prudence.
      if (reponse.status >= 400 && reponse.status < 500) {
        return { robots: null, detail: `pas de robots.txt (${reponse.status})`, toutInterdit: false };
      }
      if (reponse.status >= 300 && reponse.status < 400) {
        return { robots: null, detail: `robots.txt redirigé (${reponse.status}), considéré absent`, toutInterdit: false };
      }
      return { robots: null, detail: `robots.txt injoignable (${reponse.status})`, toutInterdit: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { robots: null, detail: `robots.txt injoignable : ${message}`, toutInterdit: true };
    }
  }

  /** Indique si robots.txt autorise la lecture de l'URL. */
  async autorise(url: URL): Promise<{ autorise: boolean; detail: string }> {
    const etat = await this.etatRobots(url);
    if (etat.toutInterdit) return { autorise: false, detail: etat.detail };
    if (!etat.robots) return { autorise: true, detail: etat.detail };
    const ok = estAutorise(etat.robots, this.userAgent, url.pathname + url.search);
    return { autorise: ok, detail: ok ? etat.detail : 'interdit par robots.txt' };
  }

  /** Télécharge une ressource en suivant les redirections, robots.txt vérifié à chaque étape. */
  async recuperer(adresse: string): Promise<Reponse> {
    let url = new URL(adresse);
    for (let saut = 0; ; saut++) {
      const droit = await this.autorise(url);
      if (!droit.autorise) throw new ErreurCollecte(`${droit.detail} (${url.host})`);

      const { reponse, debut } = await this.requete(url);
      const destination = reponse.headers.get('location');
      if (reponse.status >= 300 && reponse.status < 400 && destination) {
        await reponse.body?.cancel();
        if (saut >= this.redirectionsMax) throw new ErreurCollecte('trop de redirections');
        url = new URL(destination, url);
        continue;
      }
      let octets: Uint8Array;
      try {
        octets = await lireCorps(reponse);
      } catch (e) {
        throw new ErreurCollecte(decrireErreurReseau(e, this.delaiMaxMs));
      }
      return {
        url: adresse,
        urlFinale: url.href,
        statut: reponse.status,
        contentType: reponse.headers.get('content-type'),
        octets,
        dureeMs: this.maintenant() - debut,
      };
    }
  }
}

/** Le signal de délai passé à fetch() couvre aussi la lecture du corps. */
async function lireCorps(reponse: Response): Promise<Uint8Array> {
  return new Uint8Array(await reponse.arrayBuffer());
}

function decrireErreurReseau(e: unknown, delaiMaxMs: number): string {
  if (e instanceof ErreurCollecte) return e.message;
  if (e instanceof Error) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') return `délai dépassé (${delaiMaxMs / 1000} s)`;
    const cause = (e as Error & { cause?: { code?: string; message?: string } }).cause;
    if (cause?.code) return `erreur réseau : ${cause.code}`;
    return `erreur réseau : ${cause?.message ?? e.message}`;
  }
  return 'erreur réseau inconnue';
}
