/**
 * Essai de la couche C sur un seul thème :
 *   npm run veille:essai -- --theme "Rennes et Bretagne"
 *
 * Affiche les articles retenus, les articles rejetés avec la raison, et le coût.
 * Ne publie rien ; le coût réel est ajouté à veille/couts.json (il compte dans le budget du mois).
 * Nécessite la variable d'environnement ANTHROPIC_API_KEY.
 */
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chargerReglages } from './config.ts';
import { rechercherTheme, type ResultatTheme } from './couche-c.ts';
import { Budget, depuisDollars, ecrireCouts, enDollars, lireCouts } from './couts.ts';
import { dateIsoParis } from './dates.ts';
import { creerClientIA, verifierModeleRecherche } from './ia.ts';

export function rapportEssai(r: ResultatTheme, moisUsd: number, budgetUsd: number): string {
  const lignes = [`Thème : ${r.theme} — ${r.statut === 'ok' ? 'réponse exploitable' : `abandonné (${r.erreur})`}`, ''];
  lignes.push(`Articles retenus (${r.articles.length}) :`);
  for (const a of r.articles) {
    lignes.push(`  [${a.importance}] ${a.date_publication} · ${a.source} · ${a.titre}`, `      ${a.url}`, `      ${a.resume}`);
  }
  if (r.indicateurs.length) {
    lignes.push('', `Indicateurs retenus (${r.indicateurs.length}) :`);
    for (const i of r.indicateurs) lignes.push(`  ${i.libelle} : ${i.valeur} (${i.periode}, ${i.source}, publié le ${i.date_publication})`);
  }
  if (r.suivi) lignes.push('', `Suivi : ${r.suivi.texte} — ${r.suivi.etape_actuelle}`);
  lignes.push('', `Rejetés (${r.rejetes.length}) :`);
  for (const x of r.rejetes) lignes.push(`  ✗ ${x.titre}${x.url ? ` <${x.url}>` : ''}`, `      raison : ${x.raison}`);
  lignes.push(
    '',
    `Recherches web : ${r.recherches}`,
    `Coût de l'essai : ${enDollars(r.coutNano).toFixed(4)} $ (cumul du mois : ${moisUsd.toFixed(4)} $ / ${budgetUsd} $)`,
  );
  return lignes.join('\n');
}

async function principal(): Promise<void> {
  const { values } = parseArgs({ options: { theme: { type: 'string' } } });
  const reglages = chargerReglages();
  const consigne = reglages.themes.find((t) => t.theme === values.theme);
  if (!consigne) {
    console.error(`Thème inconnu. Utilisation : npm run veille:essai -- --theme "<thème>"\nThèmes : ${reglages.themes.map((t) => t.theme).join(', ')}`);
    process.exit(2);
  }
  const client = creerClientIA();
  if (!client) {
    console.error('ANTHROPIC_API_KEY absente : définissez la variable d’environnement pour lancer un essai.');
    process.exit(2);
  }
  const cheminCouts = new URL('../../veille/couts.json', import.meta.url);
  const maintenant = new Date();
  const budget = new Budget(lireCouts(cheminCouts), dateIsoParis(maintenant), depuisDollars(reglages.config.budget_mensuel_usd));
  if (budget.depasse()) {
    console.error(`Budget mensuel atteint (${enDollars(budget.moisNano).toFixed(2)} $ / ${reglages.config.budget_mensuel_usd} $) : essai annulé.`);
    process.exit(3);
  }
  const outil = await verifierModeleRecherche(client, reglages.config.modele_recherche);
  console.log(`Modèle ${reglages.config.modele_recherche}, outil ${outil}. Recherche en cours…\n`);
  const resultat = await rechercherTheme(
    { client, config: reglages.config, promptSysteme: reglages.promptSysteme, outil, budget, maintenant, journal: (m) => console.log(m) },
    consigne,
  );
  if (budget.executionNano > 0) ecrireCouts(cheminCouts, budget.etat);
  console.log(rapportEssai(resultat, enDollars(budget.moisNano), reglages.config.budget_mensuel_usd));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  principal().catch((e: unknown) => {
    console.error('L’essai a échoué :', e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
