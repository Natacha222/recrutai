'use client'

import Link from 'next/link'

/**
 * Bannière affichée quand on tente de créer/renommer un client avec un nom
 * qui existe déjà en base. Présente explicitement les deux choix possibles à
 * l'utilisateur :
 *   1. Abandonner  → suit le lien `cancelHref` (retour à la liste)
 *   2. Modifier le nom → focus + sélection du champ nom pour ressaisie
 *
 * Le marqueur qui permet de détecter qu'une erreur est bien un doublon de
 * client est le préfixe du message : « Un client nommé ». Voir les actions
 * serveur `createClientAction`, `updateClient` et `createClientInlineAction`.
 */
export default function DuplicateClientErrorBanner({
  message,
  cancelHref,
  onCancel,
  nameInputId = 'nom',
}: {
  message: string
  /** Lien de repli si l'utilisateur veut abandonner (page non modale). */
  cancelHref?: string
  /** Callback si l'utilisateur veut abandonner (version modale). */
  onCancel?: () => void
  /** Id du champ nom à focaliser. Défaut : 'nom'. */
  nameInputId?: string
}) {
  function focusNameInput() {
    const el = document.getElementById(nameInputId) as HTMLInputElement | null
    if (!el) return
    el.focus()
    el.select()
  }

  return (
    <div className="mb-4 px-4 py-3 rounded-md border border-status-amber bg-status-amber-bg">
      <p className="text-sm text-brand-indigo-text font-medium">{message}</p>
      <p className="text-sm text-brand-indigo-text mt-2">
        Deux possibilités :
      </p>
      <ul className="list-disc list-inside text-sm text-brand-indigo-text mt-1 space-y-0.5">
        <li>
          <strong>Abandonner</strong> la création, ou
        </li>
        <li>
          <strong>Modifier le nom</strong> pour le différencier (ex : ajoute la
          ville, la filiale ou le département).
        </li>
      </ul>
      <div className="flex gap-3 mt-3">
        {cancelHref ? (
          <Link
            href={cancelHref}
            className="px-3 py-1.5 border border-border-soft rounded-md text-sm hover:bg-surface"
          >
            Abandonner
          </Link>
        ) : (
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 border border-border-soft rounded-md text-sm hover:bg-surface"
          >
            Abandonner
          </button>
        )}
        <button
          type="button"
          onClick={focusNameInput}
          className="px-3 py-1.5 bg-brand-purple text-white rounded-md text-sm font-semibold hover:opacity-90"
        >
          Modifier le nom
        </button>
      </div>
    </div>
  )
}
