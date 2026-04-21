'use client'

import { useState, useTransition } from 'react'
import { deleteAllCandidaturesForOffre } from './actions'

export default function DeleteAllCandidaturesButton({
  offreId,
  total,
}: {
  offreId: string
  total: number
}) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleConfirm() {
    setError(null)
    startTransition(async () => {
      const res = await deleteAllCandidaturesForOffre(offreId)
      if (!res.ok) {
        setError(res.error)
        return
      }
      setOpen(false)
    })
  }

  if (total === 0) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm px-3 py-2 rounded-md border border-status-red text-status-red hover:bg-status-red hover:text-white transition-colors font-semibold"
      >
        Effacer toutes les candidatures
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-all-title"
          onClick={() => {
            if (!isPending) setOpen(false)
          }}
        >
          <div
            className="bg-white rounded-xl shadow-lg max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              id="delete-all-title"
              className="text-lg font-bold text-brand-indigo-text mb-2"
            >
              Effacer toutes les candidatures ?
            </h3>
            <p className="text-sm text-muted mb-4">
              Cette action va supprimer définitivement{' '}
              <strong className="text-brand-indigo-text">
                {total} candidature{total > 1 ? 's' : ''}
              </strong>{' '}
              et leurs CV associés dans le storage. L&apos;offre et ses
              paramètres restent intacts.
            </p>
            <p className="text-sm text-status-red font-medium mb-6">
              Cette action est irréversible.
            </p>

            {error && (
              <div className="mb-4 px-3 py-2 rounded-md bg-status-red-bg text-status-red text-sm">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={isPending}
                className="px-4 py-2 border border-border-soft rounded-md text-sm hover:bg-surface disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={isPending}
                className="px-4 py-2 rounded-md text-sm font-semibold bg-status-red text-white hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isPending
                  ? 'Suppression…'
                  : `Oui, effacer les ${total} candidature${total > 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
