'use client'

import { useState, useTransition } from 'react'
import { resendQualifiedEmail } from '@/app/(app)/candidatures/actions'

/**
 * Badge d'alerte ⚠️ + bouton « Renvoyer » affiché à côté du statut d'une
 * candidature QUALIFIÉE dont le dernier envoi d'email a échoué
 * (`candidatures.email_error != NULL`). Monté dans :
 *   - app/(app)/candidatures/page.tsx (liste globale)
 *   - app/(app)/offres/[id]/page.tsx (fiche offre)
 *
 * Sans cette UI, un échec Resend est totalement silencieux pour l'AM :
 * il voit la candidature qualifiée et pense que le client a reçu le CV,
 * alors que rien n'est parti. Le bouton permet de relancer une fois le
 * problème externe résolu (clé API, quota, contact_email client, …).
 *
 * Deux tailles : `sm` pour la liste globale /candidatures (déjà dense),
 * `md` pour la fiche offre qui a plus d'espace.
 */
type Props = {
  candidatureId: string
  /** Message d'erreur du dernier envoi (candidatures.email_error). Affiché
   *  en tooltip pour que l'AM voie le détail technique (Resend error,
   *  clé manquante…) sans saturer la cellule. */
  emailError: string
  size?: 'sm' | 'md'
}

type Feedback =
  | { kind: 'success'; text: string }
  | { kind: 'warning'; text: string }
  | { kind: 'error'; text: string }

export default function ResendEmailAction({
  candidatureId,
  emailError,
  size = 'sm',
}: Props) {
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleResend() {
    setFeedback(null)
    startTransition(async () => {
      const res = await resendQualifiedEmail(candidatureId)
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

  // Dimensions : sm (liste globale compacte) vs md (fiche offre).
  const badgeClass =
    size === 'sm'
      ? 'text-xs font-medium text-status-amber'
      : 'text-sm font-medium text-status-amber'
  const buttonClass =
    size === 'sm'
      ? 'px-2.5 py-1.5 rounded-md bg-status-amber text-white text-xs font-semibold hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed w-fit'
      : 'px-3 py-2 rounded-md bg-status-amber text-white text-sm font-semibold hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed w-fit'

  return (
    <div className="flex flex-col gap-1 mt-1">
      {/* title = emailError : l'AM survole le badge pour lire le message
          technique (ex : "Resend: Invalid API key"). Évite de saturer la
          cellule avec un message parfois long, tout en rendant l'info
          accessible en un hover / focus clavier. */}
      <div className={badgeClass} title={emailError}>
        <span aria-hidden="true">⚠️</span> Email non envoyé
      </div>
      <button
        type="button"
        onClick={handleResend}
        disabled={isPending}
        aria-label="Renvoyer l'email au client"
        className={buttonClass}
      >
        <span aria-hidden="true">↻</span> Renvoyer
      </button>
      {/* Live region polie : le résultat du renvoi est annoncé aux
          lecteurs d'écran sans interrompre la navigation en cours. */}
      <div role="status" aria-live="polite" aria-atomic="true">
        {isPending && <div className="text-xs text-muted">Envoi…</div>}
        {!isPending && feedback && (
          <div className={`text-xs px-2 py-1 rounded ${feedbackClass}`}>
            {feedback.text}
          </div>
        )}
      </div>
    </div>
  )
}
