'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { deleteClient } from './actions'

type Props = {
  clientId: string
  clientNom: string
  offresCount: number
  candidaturesCount: number
}

/**
 * Bouton « Supprimer le client » + modal de confirmation.
 *
 * Action destructive en cascade : client → offres → candidatures + CVs +
 * PDFs Storage. La modal annonce explicitement le compte d'offres et de
 * candidatures qui seront supprimées en même temps, pour que l'AM voie
 * exactement ce qu'il s'apprête à perdre.
 *
 * Pattern de modal aligné sur DeleteOffreButton (role=dialog, aria-modal,
 * focus trap, Escape, click outside) — voir V35 pour le rationale a11y.
 */
export default function DeleteClientButton({
  clientId,
  clientNom,
  offresCount,
  candidaturesCount,
}: Props) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null)

  // A11y — focus initial sur Annuler (action sûre par défaut).
  useEffect(() => {
    if (open) cancelButtonRef.current?.focus()
  }, [open])

  // A11y — focus trap + Escape.
  useEffect(() => {
    if (!open) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (!isPending) setOpen(false)
        return
      }
      if (e.key !== 'Tab') return
      const dialog = dialogRef.current
      if (!dialog) return
      const focusables = dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      )
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, isPending])

  function handleConfirm() {
    setError('')
    startTransition(async () => {
      const res = await deleteClient(clientId)
      if (!res.ok) {
        setError(res.error)
        return
      }
      router.push('/clients')
      router.refresh()
    })
  }

  // Phrases ciblées selon les comptes : on évite les formulations gênantes
  // (« 0 offre », « 1 offres ») et on accorde le pluriel.
  const offresPhrase =
    offresCount === 0
      ? null
      : offresCount === 1
        ? '1 offre associée'
        : `${offresCount} offres associées`

  const candidaturesPhrase =
    candidaturesCount === 0
      ? null
      : candidaturesCount === 1
        ? '1 candidature et son CV'
        : `${candidaturesCount} candidatures et leurs CVs`

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-3 py-2 border-2 border-status-red text-status-red rounded-md text-sm font-semibold hover:bg-status-red hover:text-white transition-colors whitespace-nowrap"
        aria-label={`Supprimer le client ${clientNom}`}
      >
        <span aria-hidden="true">🗑️</span> Supprimer le client
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => {
            if (!isPending) setOpen(false)
          }}
        >
          <div
            ref={dialogRef}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-xl p-6 max-w-md w-full space-y-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-client-title"
            aria-describedby="delete-client-desc"
          >
            <h2
              id="delete-client-title"
              className="font-bold text-lg text-status-red"
            >
              <span aria-hidden="true">⚠️</span> Supprimer ce client ?
            </h2>

            <div id="delete-client-desc" className="text-sm space-y-2">
              <p>
                Tu es sur le point de supprimer définitivement le client{' '}
                <strong>«&nbsp;{clientNom}&nbsp;»</strong>.
              </p>

              {(offresPhrase || candidaturesPhrase) && (
                <>
                  <p>Cette action supprimera également&nbsp;:</p>
                  <ul className="list-disc list-inside space-y-0.5 pl-2">
                    {offresPhrase && (
                      <li>
                        <strong>{offresPhrase}</strong>
                      </li>
                    )}
                    {candidaturesPhrase && (
                      <li>
                        <strong>{candidaturesPhrase}</strong>
                      </li>
                    )}
                  </ul>
                </>
              )}

              <p className="text-status-red font-semibold">
                Action irréversible.
              </p>
            </div>

            {error && (
              <div
                role="alert"
                className="px-3 py-2 rounded-md bg-status-red-bg text-status-red text-sm"
              >
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                ref={cancelButtonRef}
                onClick={() => setOpen(false)}
                disabled={isPending}
                className="px-4 py-2 rounded-md border border-border-soft text-brand-indigo-text font-semibold hover:bg-surface disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={isPending}
                className="px-4 py-2 rounded-md bg-status-red text-white font-semibold hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isPending ? 'Suppression…' : 'Supprimer définitivement'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
