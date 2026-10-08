/** Petits composants partagés par les écrans du module FEC. */
import { h } from '../../../app/dom.ts';
import { formaterDate } from '../../../core/format.ts';
import { compterParGravite, type Constat } from '../conformite/constats.ts';
import { LIBELLES_GRAVITE, type Gravite } from '../conformite/regles.ts';

export function bouton(libelle: string, action: () => void, options: { primaire?: boolean; danger?: boolean; titre?: string } = {}): HTMLButtonElement {
  const b = h(
    'button',
    {
      type: 'button',
      class: `bouton${options.primaire ? ' bouton-primaire' : ''}${options.danger ? ' bouton-danger' : ''}`,
      title: options.titre,
    },
    libelle,
  );
  b.addEventListener('click', action);
  return b;
}

export function dateFr(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return formaterDate(iso);
  } catch {
    return iso;
  }
}

export function nombreFr(n: number): string {
  return n.toLocaleString('fr-FR');
}

export function octetsFr(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 ** 2) return `${(n / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} Ko`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`;
  return `${(n / 1024 ** 3).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} Go`;
}

export function badgeGravite(g: Gravite, contenu: string = LIBELLES_GRAVITE[g]): HTMLElement {
  return h('span', { class: `badge badge-gravite-${g}` }, contenu);
}

/** Indicateur de conformité : nombre d'anomalies par gravité. */
export function indicateurConformite(constats: Constat[]): HTMLElement {
  const n = compterParGravite(constats);
  const ordre: Gravite[] = ['non-conforme', 'anomalie', 'information'];
  return h(
    'p',
    { class: 'indicateur-conformite', 'aria-label': 'Résultat du contrôle de conformité' },
    ...ordre.map((g) => badgeGravite(g, `${LIBELLES_GRAVITE[g]} : ${nombreFr(n[g])}`)),
  );
}

/** Proposer un fichier au téléchargement (URL blob locale, aucune requête réseau). */
export function telecharger(octets: Uint8Array, nom: string, type: string): void {
  const url = URL.createObjectURL(new Blob([octets as BlobPart], { type }));
  const a = h('a', { href: url, download: nom, class: 'visuellement-masque' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const TYPE_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
