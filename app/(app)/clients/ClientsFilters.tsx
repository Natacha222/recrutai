'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'

const FILTER_FIELDS = ['q', 'formule', 'secteur', 'am']

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
      placeholder={placeholder}
      value={value}
      onChange={(e) => handleChange(e.target.value)}
      className={CELL_INPUT_CLASS}
    />
  )
}

export function SelectFilter({
  field,
  placeholder,
  options,
}: {
  field: string
  placeholder: string
  options: string[]
}) {
  const { urlValue, update } = useUrlFilter(field)
  return (
    <select
      value={urlValue}
      onChange={(e) => update(e.target.value)}
      disabled={options.length === 0}
      className={CELL_INPUT_CLASS}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  )
}

export function FiltersReset() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  const hasFilter = FILTER_FIELDS.some((f) => {
    const v = searchParams.get(f)
    return !!v && v !== ''
  })
  if (!hasFilter) return null

  return (
    <button
      type="button"
      onClick={() => {
        const sp = new URLSearchParams(searchParams.toString())
        for (const f of FILTER_FIELDS) sp.delete(f)
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
