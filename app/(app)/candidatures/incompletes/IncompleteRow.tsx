'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { scoreColor } from '@/lib/format'
import { updateCandidatureInfo, type UpdateCandidatureInfoResult } from './actions'

type Props = {
  id: string
  initialNom: string
  initialEmail: string
  /** Email actuel est un placeholder @example.com → on vide l'input pour
   *  forcer l'utilisateur à taper le vrai email plutôt que de le laisser
   *  « valider » le placeholder par inadvertance. */
  emailIsPlaceholder: boolean
  scoreIa: number | null
  /** Seuil de qualification de l'offre, pour colorer le score vs seuil (±15). */
  seuil: number | null
  cvUrl: string | null
  offreId: string
  offreTitre: string
  offreReference: string | null
  offreAmReferent: string | null
}

type Feedback =
  | { kind: 'error'; text: string }
  | { kind: 'success'; text: string }
  | { kind: 'warning'; text: string }

function feedbackFromResult(res: UpdateCandidatureInfoResult): Feedback {
  if (!res.ok) return { kind: 'error', text: res.error }
  return { kind: res.severity, text: res.message }
}

export default function IncompleteRow({
  id,
  initialNom,
  initialEmail,
  emailIsPlaceholder,
  scoreIa,
  seuil,
  cvUrl,
  offreId,
  offreTitre,
  offreReference,
  offreAmReferent,
}: Props) {
  const [nom, setNom] = useState(initialNom)
  const [email, setEmail] = useState(emailIsPlaceholder ? '' : initialEmail)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFeedback(null)
    startTransition(async () => {
      const res = await updateCandidatureInfo({ id, nom, email })
      setFeedback(feedbackFromResult(res))
    })
  }

  const scoreClass = scoreColor(scoreIa, seuil)

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
      <td className="px-4 py-4">
        <span className={`font-bold text-lg ${scoreClass}`}>
          {scoreIa ?? '—'}
        </span>
      </td>
      <td className="px-4 py-4" colSpan={2}>
        <form
          onSubmit={handleSubmit}
          className="flex flex-col sm:flex-row gap-2 items-stretch"
        >
          <label className="flex-1 min-w-[10rem]">
            <span className="block text-xs text-muted mb-1">Nom</span>
            <input
              type="text"
              value={nom}
              onChange={(e) => setNom(e.target.value)}
              disabled={isPending}
              placeholder="Nom Prénom"
              className="w-full px-3 py-2 border border-border-soft rounded-md text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-brand-purple disabled:opacity-60"
              required
            />
          </label>
          <label className="flex-1 min-w-[14rem]">
            <span className="block text-xs text-muted mb-1">
              Email{' '}
              {emailIsPlaceholder && (
                <span className="text-status-amber">(placeholder IA)</span>
              )}
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isPending}
              placeholder="prenom.nom@domaine.fr"
              className="w-full px-3 py-2 border border-border-soft rounded-md text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-brand-purple disabled:opacity-60"
              required
            />
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={isPending}
              className="px-4 py-2 bg-brand-purple text-white rounded-md text-sm font-semibold hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {isPending ? 'Enregistrement + re-scoring…' : 'Enregistrer'}
            </button>
          </div>
        </form>
        {isPending && (
          <p className="mt-2 text-xs text-muted">
            Re-scoring du CV par l&apos;IA en cours (~15&nbsp;s). Si le nouveau
            score atteint le seuil de l&apos;offre, un email est
            automatiquement envoyé au client.
          </p>
        )}
        {!isPending && feedback && (
          <p
            className={`mt-2 px-3 py-2 rounded-md text-xs ${feedbackClass}`}
          >
            {feedback.text}
          </p>
        )}
      </td>
    </tr>
  )
}
