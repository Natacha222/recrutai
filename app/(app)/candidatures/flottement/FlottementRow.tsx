'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import StatusBadge from '@/components/StatusBadge'
import JustificationIA from '@/components/JustificationIA'
import {
  qualifyCandidature,
  rejectCandidature,
} from '@/app/(app)/offres/[id]/actions'

type Props = {
  id: string
  nom: string
  email: string | null
  scoreIa: number
  seuil: number
  statut: string
  justificationIa: string | null
  pointsForts: string[] | null
  pointsFaibles: string[] | null
  cvUrl: string | null
  offreId: string
  offreTitre: string
  offreReference: string | null
  offreAmReferent: string | null
}

type Feedback =
  | { kind: 'success'; text: string }
  | { kind: 'warning'; text: string }
  | { kind: 'error'; text: string }

export default function FlottementRow({
  id,
  nom,
  email,
  scoreIa,
  seuil,
  statut,
  justificationIa,
  pointsForts,
  pointsFaibles,
  cvUrl,
  offreId,
  offreTitre,
  offreReference,
  offreAmReferent,
}: Props) {
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleQualify() {
    setFeedback(null)
    startTransition(async () => {
      const res = await qualifyCandidature(id)
      if (!res.ok) {
        setFeedback({ kind: 'error', text: res.error })
        return
      }
      if (res.emailSent) {
        setFeedback({
          kind: 'success',
          text: 'Qualifié ✅ — email envoyé au client ✉️',
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
    // Confirmation explicite : voir CandidatureActions.handleReject pour le
    // rationale. En flottement on tranche souvent vite, donc un garde-fou
    // est encore plus utile ici.
    if (
      typeof window !== 'undefined' &&
      !window.confirm('Rejeter cette candidature ?')
    ) {
      return
    }
    setFeedback(null)
    startTransition(async () => {
      const res = await rejectCandidature(id)
      if (!res.ok) {
        setFeedback({ kind: 'error', text: res.error })
        return
      }
      setFeedback({ kind: 'success', text: 'Rejeté.' })
    })
  }

  // Score coloré vs seuil : dans la bande [seuil-5, seuil+5], au-dessus du
  // seuil on affiche vert (juste qualifié), en dessous on affiche ambre
  // (juste en dessous du seuil). On ne devrait jamais voir de rouge ici.
  const scoreColor =
    scoreIa >= seuil
      ? 'text-status-green'
      : scoreIa >= seuil - 5
        ? 'text-status-amber'
        : 'text-status-red'

  const hasRealEmail = !!email?.trim() && !email.endsWith('@example.com')

  const feedbackClass =
    feedback?.kind === 'error'
      ? 'bg-status-red-bg text-status-red'
      : feedback?.kind === 'warning'
        ? 'bg-status-amber-bg text-status-amber'
        : 'bg-status-green-bg text-status-green'

  return (
    <tr className="text-sm align-top">
      <td className="px-4 py-4">
        {cvUrl ? (
          <a
            href={cvUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-brand-purple text-brand-purple text-sm font-semibold hover:bg-brand-purple hover:text-white transition-colors w-fit whitespace-nowrap"
          >
            <span aria-hidden="true">📄</span> Voir le CV
          </a>
        ) : (
          <span className="text-muted" aria-label="CV non disponible">
            —
          </span>
        )}
      </td>
      <td className="px-4 py-4 min-w-0">
        <Link
          href={`/offres/${offreId}`}
          className="text-brand-purple hover:underline font-medium"
        >
          {offreTitre}
        </Link>
        {offreReference && (
          <div className="text-xs text-muted font-mono mt-0.5">
            Réf. {offreReference}
          </div>
        )}
      </td>
      <td className="px-4 py-4 text-muted whitespace-nowrap">
        {offreAmReferent ?? '—'}
      </td>
      <td className="px-4 py-4 min-w-0">
        <div className="font-medium">{nom}</div>
        {hasRealEmail ? (
          <a
            href={`mailto:${email}`}
            className="text-xs text-brand-purple hover:underline"
          >
            {email}
          </a>
        ) : (
          <div className="text-xs text-muted italic">
            email non extrait
          </div>
        )}
      </td>
      <td className="px-4 py-4 whitespace-nowrap">
        <div className={`font-bold text-lg ${scoreColor}`}>
          {scoreIa}{' '}
          <span className="text-xs font-normal text-muted">/ {seuil}</span>
        </div>
        <StatusBadge status={statut} />
      </td>
      <td className="px-4 py-4 text-sm max-w-md break-words">
        <JustificationIA
          pointsForts={pointsForts}
          pointsFaibles={pointsFaibles}
          justification={justificationIa}
        />
      </td>
      <td className="px-4 py-4">
        <div className="flex flex-col gap-2 min-w-[11rem]">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleQualify}
              disabled={isPending}
              aria-label="Qualifier le candidat"
              className="px-3 py-2 rounded-md bg-status-green text-white text-sm font-semibold hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <span aria-hidden="true">✓</span> Qualifier
            </button>
            <button
              type="button"
              onClick={handleReject}
              disabled={isPending}
              aria-label="Rejeter le candidat"
              className="px-3 py-2 rounded-md bg-status-red text-white text-sm font-semibold hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <span aria-hidden="true">✗</span> Rejeter
            </button>
          </div>
          {isPending && (
            <div className="text-xs text-muted">Enregistrement…</div>
          )}
          {!isPending && feedback && (
            <div className={`text-xs px-2 py-1 rounded ${feedbackClass}`}>
              {feedback.text}
            </div>
          )}
        </div>
      </td>
    </tr>
  )
}
