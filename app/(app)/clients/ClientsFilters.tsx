'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'

const FORMULES = ['Abonnement', 'À la mission', 'Volume entreprise']

type Props = {
  q: string
  formule: string
  secteur: string
  am: string
  sort: string
  dir: string
  secteurs: string[]
  amReferents: string[]
}

export default function ClientsFilters(props: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [localQ, setLocalQ] = useState(props.q)
  const [prevPropQ, setPrevPropQ] = useState(props.q)

  // Derived state sync: when props.q changes externally (URL navigation or
  // reset), update the local input value. This is the React-recommended
  // pattern for syncing state with props during render.
  if (props.q !== prevPropQ) {
    setPrevPropQ(props.q)
    setLocalQ(props.q)
  }

  function buildUrl(updates: Partial<Props>, overrideQ?: string) {
    const merged = {
      q: overrideQ !== undefined ? overrideQ : props.q,
      formule:
        updates.formule !== undefined ? updates.formule : props.formule,
      secteur:
        updates.secteur !== undefined ? updates.secteur : props.secteur,
      am: updates.am !== undefined ? updates.am : props.am,
      sort: props.sort,
      dir: props.dir,
    }
    const sp = new URLSearchParams()
    if (merged.q) sp.set('q', merged.q)
    if (merged.formule) sp.set('formule', merged.formule)
    if (merged.secteur) sp.set('secteur', merged.secteur)
    if (merged.am) sp.set('am', merged.am)
    if (merged.sort && merged.sort !== 'nom') sp.set('sort', merged.sort)
    if (merged.dir && merged.dir !== 'asc') sp.set('dir', merged.dir)
    const qs = sp.toString()
    return qs ? `/clients?${qs}` : '/clients'
  }

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleQChange(value: string) {
    setLocalQ(value)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      startTransition(() => {
        router.replace(buildUrl({}, value))
      })
    }, 300)
  }

  // Clear any pending timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  function update(updates: Partial<Props>) {
    startTransition(() => {
      router.replace(buildUrl(updates))
    })
  }

  const hasFilter = !!(props.q || props.formule || props.secteur || props.am)

  const selectClass =
    'px-3 py-2 border border-border-soft rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-purple'

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <input
        type="search"
        placeholder="Rechercher une entreprise…"
        value={localQ}
        onChange={(e) => handleQChange(e.target.value)}
        className="px-3 py-2 border border-border-soft rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-purple min-w-[220px]"
      />

      <select
        value={props.formule}
        onChange={(e) => update({ formule: e.target.value })}
        className={selectClass}
      >
        <option value="">Toutes formules</option>
        {FORMULES.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>

      <select
        value={props.secteur}
        onChange={(e) => update({ secteur: e.target.value })}
        className={selectClass}
        disabled={props.secteurs.length === 0}
      >
        <option value="">Tous secteurs</option>
        {props.secteurs.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      <select
        value={props.am}
        onChange={(e) => update({ am: e.target.value })}
        className={selectClass}
        disabled={props.amReferents.length === 0}
      >
        <option value="">Tous AM</option>
        {props.amReferents.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>

      {hasFilter && (
        <button
          type="button"
          onClick={() => {
            if (timerRef.current) clearTimeout(timerRef.current)
            startTransition(() => router.replace('/clients'))
          }}
          className="text-sm text-brand-purple hover:underline"
        >
          Réinitialiser
        </button>
      )}

      {isPending && <span className="text-xs text-muted">…</span>}
    </div>
  )
}
