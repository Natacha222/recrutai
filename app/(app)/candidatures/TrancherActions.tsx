'use client'

import { useState, useTransition } from 'react'
import {
  qualifyCandidature,
  rejectCandidature,
} from '@/app/(app)/offres/[id]/actions'
import { rescoreCandidature } from './actions'

/**
 * Cellule d'actions inline pour la liste /candidatures. Rend jusqu'à 3
 * boutons selon le cas :
 *   - Qualifier / Rejeter : toujours présents quand statut === 'en attente'
 *   - Relancer scoring    : seulement si `scoringFailed` (scoring IA a planté)
 *
 * Le parent décide de rendre ce composant ou non : on ne rend des boutons
 * d'action que pour les candidatures « en attente ». Les qualifiées et
 * rejetées sont considérées comme tranchées.
 */

type Props = {
  candidatureId: string
  /** true si justification_ia commence par « Scoring IA indisponible ». */
  scoringFailed: boolean
}

type Feedback =
  | { kind: 'success'; text: string }
  | { kind: 'warning'; text: string }
  | { kind: 'error'; text: string }

export default function TrancherActions({
  candidatureId,
  scoringFailed,
}: Props) {
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleQualify() {
    setFeedback(null)
    startTransition(async () => {
      const res = await qualifyCandidature(candidatureId)
      if (!res.ok) {
        setFeedback({ kind: 'error', text: res.error })
        return
      }
      if (res.emailSent) {
        setFeedback({
          kind: 'success',
          text: 'Qualifié — email envoyé ✉️',
        })
      } else {
        setFeedback({
          kind: 'warning',
          text: `Qualifié. Email non envoyé : ${res.skippedReason ?? 'raison inconnue'}`,
        })
      }
    })
  }

  function handleReject() {
    setFeedback(null)
    startTransition(async () => {
      const res = await rejectCandidature(candidatureId)
      if (!res.ok) {
        setFeedback({ kind: 'error', text: res.error })
        return
      }
      setFeedback({ kind: 'success', text: 'Rejeté.' })
    })
  }

  function handleRescore() {
    setFeedback(null)
    startTransition(async () => {
      const res = await rescoreCandidature(candidatureId)
      if (!res.ok) {
        setFeedback({ kind: 'error', text: res.error })
        return
      }
      setFeedback({ kind: res.severity, text: res.message })
    })
  }

  const feedbackClass =
    feedback?.kind === 'error'
      ? 'bg-status-red-bg text-status-red'
      : feedback?.kind === 'warning'
        ? 'bg-status-amber-bg text-status-amber'
        : 'bg-status-green-bg text-status-green'

  return (
    <div className="flex flex-col gap-1.5 min-w-[9rem]">
      <div className="flex gap-1.5 flex-wrap">
        <button
          type="button"
          onClick={handleQualify}
          disabled={isPending}
          aria-label="Qualifier le candidat"
          className="px-2.5 py-1.5 rounded-md bg-status-green text-white text-xs font-semibold hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <span aria-hidden="true">✓</span> Qualifier
        </button>
        <button
          type="button"
          onClick={handleReject}
          disabled={isPending}
          aria-label="Rejeter le candidat"
          className="px-2.5 py-1.5 rounded-md bg-status-red text-white text-xs font-semibold hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <span aria-hidden="true">✗</span> Rejeter
        </button>
      </div>
      {scoringFailed && (
        <button
          type="button"
          onClick={handleRescore}
          disabled={isPending}
          aria-label="Relancer le scoring IA"
          title="Le scoring initial a échoué. Relancer pour obtenir un vrai score."
          className="px-2.5 py-1.5 rounded-md bg-brand-purple text-white text-xs font-semibold hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <span aria-hidden="true">↻</span> Relancer le scoring
        </button>
      )}
      {/* Live region persistante : les utilisateurs de lecteur d'écran
          reçoivent les feedbacks (« Enregistrement… », message succès /
          erreur) dès qu'ils apparaissent. role="status" + aria-live=polite
          = annonce sans interrompre la lecture en cours. */}
      <div role="status" aria-live="polite" aria-atomic="true">
        {isPending && (
          <div className="text-xs text-muted">Enregistrement…</div>
        )}
        {!isPending && feedback && (
          <div className={`text-xs px-2 py-1 rounded ${feedbackClass}`}>
            {feedback.text}
          </div>
        )}
      </div>
    </div>
  )
}
