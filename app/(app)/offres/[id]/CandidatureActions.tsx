'use client'

import { useState, useTransition } from 'react'
import { qualifyCandidature, rejectCandidature } from './actions'

type Status = 'idle' | 'success' | 'error'

/**
 * `compact` : variante resserrée pour les tableaux denses (ex :
 * /candidatures liste globale). Boutons plus petits, moins de min-width,
 * feedback inline plus discret. Par défaut on garde la version « md »
 * utilisée sur /offres/[id] où il y a plus de place.
 */
export default function CandidatureActions({
  candidatureId,
  compact = false,
}: {
  candidatureId: string
  compact?: boolean
}) {
  const [isPending, startTransition] = useTransition()
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState<string>('')

  function handleQualify() {
    // Confirmation explicite : ce bouton n'apparaît que pour les candidatures
    // « en attente » (voir pages parentes /offres/[id] et /candidatures), or
    // qualifier déclenche automatiquement l'envoi du CV au client par email.
    // Un AM qui clique par réflexe ou se trompe de ligne ne doit pas pouvoir
    // envoyer un candidat au client sans s'en rendre compte — d'où le
    // confirm() natif, cohérent avec celui de handleReject.
    if (
      typeof window !== 'undefined' &&
      !window.confirm('Qualifier et envoyer le CV au client par email ?')
    ) {
      return
    }
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
      // Sur échec d'envoi, `persistEmailResult` (lib/email.ts) rétrograde
      // la candidature en « en attente ». On ne dit donc plus « Qualifié. »
      // quand le mail n'est pas parti — ce serait faux en base. Le
      // skippedReason seul suffit (l'AM verra le badge ⚠️ + Renvoyer
      // après refresh). Cas edge « déjà tranchée » : la candidature n'a
      // pas bougé du tout, on reste sur son skippedReason propre.
      setMessage(
        res.emailSent
          ? 'Qualifié et email envoyé au client.'
          : res.skippedReason
            ? `Email non envoyé : ${res.skippedReason}`
            : 'Qualifié.'
      )
    })
  }

  function handleReject() {
    // Confirmation explicite : le rejet ne ferme rien de définitif côté DB
    // (la candidature reste, juste marquée `rejeté` — réversible via la
    // page /candidatures) mais c'est loud au quotidien : un AM qui se
    // trompe de ligne ne devrait pas pouvoir annuler d'un clic sans s'en
    // rendre compte. confirm() natif suffit pour la v1.
    if (
      typeof window !== 'undefined' &&
      !window.confirm('Rejeter cette candidature ?')
    ) {
      return
    }
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

  const rootClass = compact
    ? 'flex flex-col gap-1 min-w-[8.5rem]'
    : 'flex flex-col gap-2 min-w-[11rem]'
  const btnQualifyClass = compact
    ? 'px-2 py-1 rounded bg-status-green text-white text-xs font-semibold hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed'
    : 'px-3 py-2 rounded-md bg-status-green text-white text-sm font-semibold hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed'
  const btnRejectClass = compact
    ? 'px-2 py-1 rounded bg-status-red text-white text-xs font-semibold hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed'
    : 'px-3 py-2 rounded-md bg-status-red text-white text-sm font-semibold hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed'

  return (
    <div className={rootClass}>
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={handleQualify}
          disabled={isPending}
          aria-label="Qualifier le candidat"
          className={btnQualifyClass}
        >
          <span aria-hidden="true">✓</span> Qualifier
        </button>
        <button
          type="button"
          onClick={handleReject}
          disabled={isPending}
          aria-label="Rejeter le candidat"
          className={btnRejectClass}
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
