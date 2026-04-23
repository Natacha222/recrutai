'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'

const CELL_INPUT_CLASS =
  'w-full px-2 py-1.5 border border-border-soft rounded-md text-xs bg-white focus:outline-none focus:ring-1 focus:ring-brand-purple normal-case font-normal text-brand-indigo-text'

function useUrlFilter(field: string) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const urlValue = searchParams.get(field) ?? ''
  const [, startTransition] = useTransition()

  function update(newValue: string) {
    const sp = new URLSearchParams(searchParams.toString())
    if (newValue) sp.set(field, newValue)
    else sp.delete(field)
    const qs = sp.toString()
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname)
    })
  }

  return { urlValue, update }
}

export function TextFilter({
  field,
  placeholder,
}: {
  field: string
  placeholder: string
}) {
  const { urlValue, update } = useUrlFilter(field)
  const [value, setValue] = useState(urlValue)
  const [prevUrlValue, setPrevUrlValue] = useState(urlValue)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync with URL changes (reset button, back/forward navigation)
  if (urlValue !== prevUrlValue) {
    setPrevUrlValue(urlValue)
    setValue(urlValue)
  }

  function handleChange(newValue: string) {
    setValue(newValue)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => update(newValue), 300)
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return (
    <input
      type="search"
      // name = field : autofill, labellisation par les outils d'accessibilité
      // et tests e2e peuvent cibler l'input par son nom sémantique.
      name={field}
      placeholder={placeholder}
      value={value}
      onChange={(e) => handleChange(e.target.value)}
      className={CELL_INPUT_CLASS}
    />
  )
}

/**
 * Champ de filtre date (type=date). Comme SelectFilter, pas de debouncing :
 * l'utilisateur ouvre le picker et choisit, un clic = un update URL.
 */
export function DateFilter({
  field,
  placeholder,
}: {
  field: string
  /** Placeholder affiché quand aucun champ date natif n'est disponible. */
  placeholder?: string
}) {
  const { urlValue, update } = useUrlFilter(field)
  return (
    <input
      type="date"
      name={field}
      value={urlValue}
      onChange={(e) => update(e.target.value)}
      placeholder={placeholder}
      className={CELL_INPUT_CLASS}
    />
  )
}

export function SelectFilter({
  field,
  placeholder,
  options,
  labels,
}: {
  field: string
  placeholder: string
  options: string[]
  /** Optional mapping from option value to display label. */
  labels?: Record<string, string>
}) {
  const { urlValue, update } = useUrlFilter(field)
  return (
    <select
      name={field}
      value={urlValue}
      onChange={(e) => update(e.target.value)}
      disabled={options.length === 0}
      className={CELL_INPUT_CLASS}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {labels?.[o] ?? o}
        </option>
      ))}
    </select>
  )
}

export function FiltersReset({ fields }: { fields: string[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  const hasFilter = fields.some((f) => {
    const v = searchParams.get(f)
    return !!v && v !== ''
  })
  if (!hasFilter) return null

  return (
    <button
      type="button"
      onClick={() => {
        const sp = new URLSearchParams(searchParams.toString())
        for (const f of fields) sp.delete(f)
        const qs = sp.toString()
        startTransition(() => {
          router.replace(qs ? `${pathname}?${qs}` : pathname)
        })
      }}
      className="text-xs text-brand-purple hover:underline"
    >
      Réinitialiser les filtres
    </button>
  )
}

/**
 * En-tête de colonne cliquable qui pilote un tri URL `?sort=<field>&dir=…`.
 *
 * Cycle 3 états au clic pour permettre un retour à l'ordre par défaut
 * sans passer par le bouton de reset :
 *   inactif → défaut (asc ou desc selon `defaultDir`) → direction inverse
 *   → inactif (tri retiré de l'URL).
 *
 * Seule UNE colonne peut être triée à la fois : cliquer un autre en-tête
 * écrase `sort` + `dir` (comportement standard type Notion/Airtable).
 */
export function SortHeader({
  field,
  label,
  defaultDir = 'asc',
}: {
  field: string
  label: string
  /** Direction du 1er clic. `desc` pour dates et scores (récent/haut
   *  d'abord), `asc` pour alpha. */
  defaultDir?: 'asc' | 'desc'
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  const currentSort = searchParams.get('sort') ?? ''
  const currentDir = (searchParams.get('dir') ?? '') as 'asc' | 'desc' | ''
  const isActive = currentSort === field
  const dir = isActive ? currentDir : ''

  function handleClick() {
    const sp = new URLSearchParams(searchParams.toString())
    if (!isActive) {
      sp.set('sort', field)
      sp.set('dir', defaultDir)
    } else if (dir === defaultDir) {
      sp.set('sort', field)
      sp.set('dir', defaultDir === 'asc' ? 'desc' : 'asc')
    } else {
      // 3e clic : on retire le tri → retour à l'ordre serveur par défaut.
      sp.delete('sort')
      sp.delete('dir')
    }
    const qs = sp.toString()
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname)
    })
  }

  // Flèche ↑/↓ quand actif, double-flèche neutre sinon (signale la
  // possibilité de trier sans attirer l'œil avant le clic).
  const arrow = dir === 'asc' ? '↑' : dir === 'desc' ? '↓' : '⇅'
  const arrowClass = isActive ? 'text-brand-purple' : 'text-muted/50'

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center gap-1 uppercase font-semibold hover:text-brand-purple transition-colors"
      aria-label={
        isActive
          ? `Trier par ${label} (${dir === 'asc' ? 'ascendant' : 'descendant'})`
          : `Trier par ${label}`
      }
    >
      <span>{label}</span>
      <span className={arrowClass} aria-hidden>
        {arrow}
      </span>
    </button>
  )
}
