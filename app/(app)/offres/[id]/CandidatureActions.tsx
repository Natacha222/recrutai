'use client'

import { useState, useTransition } from 'react'
import { qualifyCandidature, rejectCandidature } from './actions'

type Status = 'idle' | 'success' | 'error'

export default function CandidatureActions({
  candidatureId,
}: {
  candidatureId: string
}) {
  const [isPending, startTransition] = useTransition()
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState<string>('')

  function handleQualify() {
    setStatus('idle')
    setMessage('')
    startTransition(async () => {
      const res = await qualifyCandidature(candidatureId)
      if (!res.ok) {
        setStatus('error')
        setMessage(res.error)
        return
      }
      setStatus('success')
      setMessage(
        res.emailSent
          ? 'Qualifié et email envoyé au client.'
          : res.skippedReason
            ? `Qualifié. Email non envoyé : ${res.skippedReason}`
            : 'Qualifié.'
      )
    })
  }

  function handleReject() {
    setStatus('idle')
    setMessage('')
    startTransition(async () => {
      const res = await rejectCandidature(candidatureId)
      if (!res.ok) {
        setStatus('error')
        setMessage(res.error)
        return
      }
      setStatus('success')
      setMessage('Rejeté.')
    })
  }

  return (
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
      {/* Live region : les feedbacks asynchrones (en cours, succès, erreur)
          sont annoncés par les lecteurs d'écran sans interrompre. */}
      <div role="status" aria-live="polite" aria-atomic="true">
        {isPending && (
          <div className="text-xs text-muted">Enregistrement…</div>
        )}
        {!isPending && status === 'success' && (
          <div className="text-xs text-status-green">{message}</div>
        )}
        {!isPending && status === 'error' && (
          <div className="text-xs text-status-red">{message}</div>
        )}
      </div>
    </div>
  )
}
