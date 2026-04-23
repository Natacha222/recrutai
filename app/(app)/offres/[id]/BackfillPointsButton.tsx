'use client'

import { useState, useTransition } from 'react'
import { backfillPointsForOffre } from './actions'

/**
 * Bouton one-shot pour backfiller les points forts / points faibles des
 * candidatures scorées avant que scoreCandidate() ne renvoie les arrays
 * structurés. Visible seulement quand il reste au moins une candidature
 * sans bullets sur l'offre (le parent décide).
 *
 * Comportement :
 *   - Clic → appelle backfillPointsForOffre(offreId).
 *   - Pendant le traitement, bouton désactivé + texte « Analyse en cours… ».
 *   - À la fin, affiche un feedback inline (succès ou échec) et le parent
 *     se re-rend via revalidatePath côté serveur, faisant disparaître le
 *     bouton une fois le count = 0.
 */
type Props = {
  offreId: string
  /** Nombre de candidatures manquant les bullets — piloté côté serveur. */
  missingCount: number
}

type Feedback =
  | { kind: 'success'; text: string }
  | { kind: 'error'; text: string }

export default function BackfillPointsButton({
  offreId,
  missingCount,
}: Props) {
  const [isPending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  function run() {
    setFeedback(null)
    startTransition(async () => {
      const res = await backfillPointsForOffre(offreId)
      if (!res.ok) {
        setFeedback({ kind: 'error', text: res.error })
        return
      }
      const parts: string[] = []
      if (res.processed > 0) parts.push(`${res.processed} traitée(s)`)
      if (res.failed > 0) parts.push(`${res.failed} en échec`)
      if (res.skipped > 0) parts.push(`${res.skipped} ignorée(s)`)
      const label =
        parts.length > 0 ? parts.join(', ') : 'rien à traiter'
      setFeedback({
        kind: res.failed > 0 ? 'error' : 'success',
        text: `Analyse terminée : ${label}.`,
      })
    })
  }

  // Tant que le backfill n'a pas été lancé, on affiche le compteur serveur
  // tel quel. Pendant/après exécution, on laisse le parent re-render : le
  // bouton disparaîtra automatiquement si plus rien n'est à traiter.
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={run}
        disabled={isPending}
        className="self-start px-3 py-1.5 text-xs font-semibold rounded-md border border-brand-purple text-brand-purple hover:bg-brand-purple hover:text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        title="Analyse les justifications IA existantes pour en extraire des points forts / points faibles structurés."
      >
        {isPending
          ? 'Analyse en cours…'
          : `Extraire les points forts / faibles (${missingCount})`}
      </button>
      {feedback && (
        <div
          role="status"
          aria-live="polite"
          className={`text-xs ${
            feedback.kind === 'success'
              ? 'text-status-green'
              : 'text-status-red'
          }`}
        >
          {feedback.text}
        </div>
      )}
    </div>
  )
}
