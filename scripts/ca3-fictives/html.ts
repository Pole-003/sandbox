/**
 * Page HTML imitant l'affichage d'une CA3 dans l'espace professionnel, imprimée ensuite en PDF par un vrai
 * navigateur (Chromium « Imprimer en PDF », avec en-têtes et pieds de page du navigateur : date, titre,
 * adresse, numéros de page) et par LibreOffice. On éprouve ainsi la lecture sur des PDF produits par des
 * moteurs de rendu réels : polices embarquées, découpage du texte propre à chaque producteur, libellés
 * coupés par le navigateur, cellules centrées verticalement.
 *
 * Deux dispositions : « tableau » (tableaux HTML, cellules centrées verticalement, en-têtes de colonnes
 * répétés à chaque page) et « blocs » (lignes en flexbox, montants alignés en haut, section A avec une
 * colonne « Montant »).
 */
import { CASES_CA3, type CaseCa3 } from '../../src/modules/tva/ca3-cases.ts';
import { fr, type Ca3Fictive } from './donnees.ts';

export type Disposition = 'tableau' | 'blocs';

const echapper = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const milliers = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

function lignes(d: Ca3Fictive, filtre: (c: CaseCa3) => boolean, deux: boolean, disposition: Disposition): string {
  return CASES_CA3.filter(filtre)
    .map((c) => {
      const v = d.cases[c.code];
      const base = v?.base !== undefined ? milliers(v.base) : '';
      const taxe = c.colonnes === 2 ? (v?.taxe !== undefined ? milliers(v.taxe) : '') : v?.montant !== undefined ? milliers(v.montant) : '';
      const dont = d.dontSous?.code === c.code ? `<tr class="dont"><td></td><td>${echapper(d.dontSous.texte)}</td>${deux ? '<td></td>' : ''}<td class="m" nowrap align="right">${milliers(d.dontSous.montant)}</td></tr>` : '';
      if (disposition === 'blocs') {
        const dontBloc = d.dontSous?.code === c.code ? `<div class="ligne"><span class="code"></span><span class="lib">${echapper(d.dontSous.texte)}</span>${deux ? '<span class="m"></span>' : ''}<span class="m">${milliers(d.dontSous.montant)}</span></div>` : '';
        return `<div class="ligne"><span class="code">${c.code}</span><span class="lib">${echapper(c.libelle)}</span>${deux ? `<span class="m">${base}</span>` : ''}<span class="m">${taxe}</span></div>${dontBloc}`;
      }
      return `<tr><td class="code" nowrap>${c.code}</td><td>${echapper(c.libelle)}</td>${deux ? `<td class="m" nowrap align="right">${base}</td>` : ''}<td class="m" nowrap align="right">${taxe}</td></tr>${dont}`;
    })
    .join('\n');
}

function section(d: Ca3Fictive, titre: string, filtre: (c: CaseCa3) => boolean, deux: boolean, disposition: Disposition, enTeteUnique = ''): string {
  if (disposition === 'blocs') {
    const entete = deux ? '<div class="ligne entete"><span class="code"></span><span class="lib"></span><span class="m">Base hors taxe</span><span class="m">Taxe due</span></div>' : enTeteUnique ? `<div class="ligne entete"><span class="code"></span><span class="lib"></span><span class="m">${enTeteUnique}</span></div>` : '';
    return `<h3>${echapper(titre)}</h3>${entete}${lignes(d, filtre, deux, disposition)}`;
  }
  const thead = deux ? '<thead><tr><th></th><th></th><th class="m" align="right">Base hors taxe</th><th class="m" align="right">Taxe due</th></tr></thead>' : '';
  // Largeurs aussi en attributs : l'import HTML de LibreOffice ignore les largeurs CSS.
  const colonnes = deux ? '<colgroup><col width="40"><col width="380"><col width="110"><col width="110"></colgroup>' : '<colgroup><col width="40"><col width="520"><col width="120"></colgroup>';
  return `<h3>${echapper(titre)}</h3><table class="${deux ? 'deux' : 'une'}" width="100%" cellpadding="2">${colonnes}${thead}<tbody>${lignes(d, filtre, deux, disposition)}</tbody></table>`;
}

export function htmlCa3(d: Ca3Fictive, disposition: Disposition): string {
  const ident = [
    ['Dénomination :', d.denomination],
    ['SIREN :', d.siren],
    ['Impôt :', 'TVA'],
    ['Période déclarée :', `${fr(d.debut)} au ${fr(d.fin)}`],
    ['Date limite de dépôt :', fr(d.dateLimite)],
    ['Date de dépôt :', fr(d.dateDepot)],
    ['Date de création du document :', fr(d.dateDepot)],
  ];
  const supplementaires = (d.casesSupplementaires ?? []).map((s) => `<tr><td class="code">${s.code}</td><td>${echapper(s.libelle)}</td><td class="m" nowrap align="right">${milliers(s.montant)}</td></tr>`).join('');
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Déclaration de TVA - ${echapper(d.denomination)}</title>
<style>
  body { font-family: 'DejaVu Sans', 'Liberation Sans', Arial, sans-serif; font-size: 10pt; margin: 0 1cm; }
  h2 { font-size: 13pt; } h3 { font-size: 11pt; margin: 14pt 0 6pt; }
  table { width: 100%; border-collapse: collapse; }
  table.deux thead { display: table-header-group; }
  td, th { padding: 2pt 4pt; border-bottom: 0.5pt solid #ccc; vertical-align: middle; }
  td.code { width: 3em; font-weight: bold; }
  table.une td:nth-child(2) { width: 75%; }
  table.deux td:nth-child(2) { width: 55%; }
  .m { text-align: right; white-space: nowrap; width: 8em; }
  tr { page-break-inside: avoid; }
  .ident td { border: none; } .ident td:first-child { width: 14em; }
  .saut { page-break-before: always; }
  .ligne { display: flex; align-items: flex-start; border-bottom: 0.5pt solid #ccc; padding: 2pt 0; page-break-inside: avoid; }
  .ligne .code { width: 3em; font-weight: bold; flex: none; } .ligne .lib { flex: 1; padding-right: 1em; }
  .ligne .m { flex: none; width: 9em; } .ligne.entete { font-weight: bold; border-bottom: 1pt solid #000; }
</style></head><body>
<h2>Identification</h2>
<table class="ident">${ident.map(([k, v]) => `<tr><td>${k}</td><td>${echapper(v!)}</td></tr>`).join('')}</table>
<p><strong>Formulaire 3310-CA3 (applicable à compter du 01/01/${d.millesime})</strong></p>
<p>Déclaration de taxe sur la valeur ajoutée et taxes assimilées – régime réel normal.</p>
<div class="saut"></div>
<h2>A - Montant des opérations réalisées</h2>
${section(d, 'Opérations taxées (HT)', (c) => c.section === 'operations' && /^[AB]/.test(c.code), false, disposition, 'Montant')}
${section(d, 'Opérations non taxées', (c) => c.section === 'operations' && /^[EF]/.test(c.code), false, disposition, 'Montant')}
${supplementaires ? `<table class="une" width="100%"><colgroup><col width="40"><col width="520"><col width="120"></colgroup><tbody>${supplementaires}</tbody></table>` : ''}
<div class="saut"></div>
<h2>B - Décompte de la TVA à payer</h2>
${section(d, 'TVA brute', (c) => c.section === 'tva-brute', true, disposition)}
${section(d, 'TVA déductible', (c) => c.section === 'tva-deductible', true, disposition)}
${section(d, 'TVA due ou crédit de TVA', (c) => c.section === 'solde', true, disposition)}
${section(d, 'Régularisation d’accise sur les énergies', (c) => c.section === 'accise', true, disposition)}
${section(d, 'Détermination du montant à payer et/ou des crédits', (c) => c.section === 'determination', true, disposition)}
<p>Le crédit de la ligne 27 est à reporter ligne 22 de la prochaine déclaration (3310-CA3G pour les groupes, art 1693 ter du CGI).</p>
</body></html>`;
}
