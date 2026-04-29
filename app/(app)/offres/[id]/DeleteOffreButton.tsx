'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { deleteOffre } from './actions'

type Props = {
  offreId: string
  offreTitre: string
  candidaturesCount: number
}

/**
 * Bouton « Supprimer l'offre » + modal de confirmation.
 *
 * Action destructive et irréversible : on impose une confirmation explicite
 * avec le compte exact de CVs qui seront supprimés en même temps. Pattern de
 * modal aligné sur CreateClientInlineModal (role=dialog, aria-modal, focus
 * trap, Escape, click outside) — voir V35 (accessibilité) pour le rationale.
 *
 * Sur succès : redirige vers /offres (l'offre courante n'existe plus, rester
 * sur /offres/[id] donnerait un notFound() au prochain render).
 */
export default function DeleteOffreButton({
  offreId,
  offreTitre,
  candidaturesCount,
}: Props) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null)

  // A11y — à l'ouverture, focus sur « Annuler » (action sûre par défaut).
  // Si l'utilisateur tape Entrée par réflexe, on annule plutôt que de
  // confirmer la suppression — c'est la convention WCAG pour les dialogs
  // destructifs.
  useEffect(() => {
    if (open) cancelButtonRef.current?.focus()
  }, [open])

  // A11y — focus trap + Escape (cf. CreateClientInlineModal pour le rationale
  // détaillé). Tab boucle sur les boutons de la modale, Escape ferme.
  useEffect(() => {
    if (!open) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        // On bloque la fermeture pendant la suppression — sinon l'utilisateur
        // pourrait rouvrir une modale dans un état incohérent.
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
      const res = await deleteOffre(offreId)
      if (!res.ok) {
        setError(res.error)
        return
      }
      // L'offre n'existe plus — on quitte la page courante avant que le
      // prochain render ne tape un notFound(). router.refresh() force la
      // RSC à re-fetcher /offres avec les données à jour (sans la ligne
      // qu'on vient de supprimer).
      router.push('/offres')
      router.refresh()
    })
  }

  // Phrase ciblée selon le nombre de candidatures liées : on évite « 0
  // candidatures liées » qui sonne maladroit, et on accorde le pluriel.
  const candidatesPhrase =
    candidaturesCount === 0
      ? null
      : candidaturesCount === 1
        ? '1 candidature liée et son CV'
        : `${candidaturesCount} candidatures liées et leurs CVs`

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-3 py-2 border-2 border-status-red text-status-red rounded-md text-sm font-semibold hover:bg-status-red hover:text-white transition-colors"
        aria-label={`Supprimer l'offre ${offreTitre}`}
      >
        <span aria-hidden="true">🗑️</span> Supprimer
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
            aria-labelledby="delete-offre-title"
            aria-describedby="delete-offre-desc"
          >
            <h2
              id="delete-offre-title"
              className="font-bold text-lg text-status-red"
            >
              <span aria-hidden="true">⚠️</span> Supprimer cette offre ?
            </h2>

            <div id="delete-offre-desc" className="text-sm space-y-2">
              <p>
                Tu es sur le point de supprimer définitivement l&apos;offre{' '}
                <strong>«&nbsp;{offreTitre}&nbsp;»</strong>.
              </p>
              {candidatesPhrase && (
                <p>
                  Cette action supprimera également{' '}
                  <strong>{candidatesPhrase}</strong>.
                </p>
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
