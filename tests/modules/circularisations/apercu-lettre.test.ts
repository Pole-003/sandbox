// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { apercuLettre } from '../../../src/modules/circularisations/courriers/ecran-courriers.ts';
import type { Lettre } from '../../../src/modules/circularisations/courriers/lettres.ts';

const lettre: Lettre = {
  ref: 'CL-001',
  population: 'clients',
  destinataire: 'Client <b>fictif</b>',
  codeTiers: 'C0001',
  nomFichier: 'CL-001 - Client fictif.docx',
  societe: 'Société fictive',
  enTete: ['1 rue Imaginaire', '69000 Lyon'],
  lieuDate: 'Lyon, le 10/07/2026',
  objet: 'Demande de confirmation de solde au 30/06/2026',
  corps: [
    { type: 'paragraphe', texte: 'Madame, Monsieur,' },
    { type: 'puce', texte: 'a ;' },
    { type: 'puce', texte: 'b.' },
    { type: 'paragraphe', texte: 'Fin.' },
  ],
  signature: ['La Présidente', 'Camille Exemple'],
  coupon: { titre: 'Coupon-réponse', consigne: 'À retourner au cabinet.', blocs: [{ type: 'case', texte: 'Accord' }, { type: 'saisie', texte: 'Date :' }] },
};

describe('aperçu HTML d’une lettre', () => {
  it('reprend la structure de la lettre, puces regroupées, sans interpréter le balisage', () => {
    const a = apercuLettre(lettre);
    expect(a.getAttribute('aria-label')).toBe('Aperçu de la lettre CL-001');
    expect(a.querySelectorAll('ul')).toHaveLength(1);
    expect(a.querySelectorAll('ul li')).toHaveLength(2);
    expect(a.querySelector('b')).toBeNull();
    expect(a.textContent).toContain('Client <b>fictif</b>');
    expect(a.textContent).toContain('Réf. : CL-001 (code tiers C0001)');
    expect(a.querySelector('.lettre-coupon h4')?.textContent).toBe('COUPON-RÉPONSE');
    expect(a.querySelector('.lettre-case')?.textContent).toBe('☐ Accord');
    expect(a.querySelector('.lettre-saisie .lettre-ligne')).not.toBeNull();
  });

  it('sans coupon', () => {
    expect(apercuLettre({ ...lettre, coupon: null }).querySelector('.lettre-coupon')).toBeNull();
  });
});
