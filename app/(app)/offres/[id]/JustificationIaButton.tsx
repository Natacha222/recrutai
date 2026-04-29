'use client'

import { useState } from 'react'
import CandidatureDetailModal from '../../candidatures/CandidatureDetailModal'
import type { Enriched } from '../../candidatures/CandidaturesTable'

/**
 * Bouton « Voir détails » + modal de fiche candidat (V52).
 *
 * Réutilise CandidatureDetailModal de la liste globale des candidatures
 * pour offrir une UX cohérente sur la fiche offre. Chaque ligne de
 * candidature de l'offre a son propre bouton + état d'ouverture (le
 * modal n'est monté que quand `open` est vrai, donc pas de coût pour
 * les lignes non cliquées).
 *
 * On reçoit `candidature` déjà enrichi avec `_offre` (le parent — la
 * page offre — connaît l'offre et la passe à la place de re-faire un
 * fetch). Cohérent avec le contrat du modal qui a besoin de `_offre`
 * pour afficher le seuil et le titre dans son en-tête.
 */
export default function JustificationIaButton({
  candidature,
}: {
  candidature: Enriched
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-brand-purple text-brand-purple text-xs font-semibold hover:bg-brand-purple hover:text-white transition-colors whitespace-nowrap"
        aria-label={`Voir les détails IA pour ${candidature.nom?.trim() || 'ce candidat'}`}
      >
        <span aria-hidden="true">ℹ️</span> Voir détails
      </button>
      {open && (
        <CandidatureDetailModal
          candidature={candidature}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
