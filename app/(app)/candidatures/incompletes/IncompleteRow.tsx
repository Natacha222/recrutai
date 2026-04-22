'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { updateCandidatureInfo } from './actions'

type Props = {
  id: string
  initialNom: string
  initialEmail: string
  /** Email actuel est un placeholder @example.com → on vide l'input pour
   *  forcer l'utilisateur à taper le vrai email plutôt que de le laisser
   *  « valider » le placeholder par inadvertance. */
  emailIsPlaceholder: boolean
  scoreIa: number | null
  cvUrl: string | null
  offreId: string
  offreTitre: string
  offreReference: string | null
}

export default function IncompleteRow({
  id,
  initialNom,
  initialEmail,
  emailIsPlaceholder,
  scoreIa,
  cvUrl,
  offreId,
  offreTitre,
  offreReference,
}: Props) {
  const [nom, setNom] = useState(initialNom)
  const [email, setEmail] = useState(emailIsPlaceholder ? '' : initialEmail)
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    startTransition(async () => {
      const res = await updateCandidatureInfo({ id, nom, email })
      if (!res.ok) {
        setError(res.error)
      }
      // Succès : on ne fait rien côté UI — la revalidation du path côté
      // serveur va retirer cette ligne de la liste au prochain render.
    })
  }

  const scoreColor =
    scoreIa === null
      ? 'text-muted'
      : scoreIa >= 70
        ? 'text-status-green'
        : scoreIa >= 50
          ? 'text-status-amber'
          : 'text-status-red'

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
          <span className="text-muted">—</span>
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
      <td className="px-4 py-4">
        <span className={`font-bold text-lg ${scoreColor}`}>
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
              {isPending ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </form>
        {error && (
          <p className="mt-2 text-xs text-status-red">{error}</p>
        )}
      </td>
    </tr>
  )
}
