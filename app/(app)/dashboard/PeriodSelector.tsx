'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'

/**
 * Sélecteur de période pour le graphique d'évolution. Écrit dans l'URL
 * (searchParams) les clés `evol`, `evol_from`, `evol_to` pour que le
 * dashboard serveur puisse re-render le graphique avec les bonnes
 * données. Même pattern que TableFilters.tsx : router.replace dans un
 * useTransition pour ne pas bloquer l'UI pendant le re-render serveur.
 */

type Preset = { key: '7d' | '30d' | '12m'; label: string }
const PRESETS: Preset[] = [
  { key: '7d', label: '7 derniers jours' },
  { key: '30d', label: '30 derniers jours' },
  { key: '12m', label: '12 derniers mois' },
]

type Props = {
  /** Preset actuel ('7d' | '30d' | '12m' | 'custom') — décidé côté serveur. */
  currentKey: '7d' | '30d' | '12m' | 'custom'
  /** Bornes actuelles si custom, pour pré-remplir les inputs. */
  currentFrom?: string
  currentTo?: string
  /** Date max proposée aux inputs (≈ aujourd'hui au format ISO). */
  todayIso: string
  /** Prévision actuelle : 'none' | '1m' | '1y'. */
  currentForecast: 'none' | '1m' | '1y'
  /** Granularité actuelle : utilisée pour désactiver '1y' en mode jour. */
  granularity: 'day' | 'month'
}

export default function PeriodSelector({
  currentKey,
  currentFrom,
  currentTo,
  todayIso,
  currentForecast,
  granularity,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  const [customOpen, setCustomOpen] = useState(currentKey === 'custom')
  const [from, setFrom] = useState(currentFrom ?? '')
  const [to, setTo] = useState(currentTo ?? '')
  const [err, setErr] = useState<string | null>(null)

  function push(params: Record<string, string | null>) {
    const sp = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(params)) {
      if (v) sp.set(k, v)
      else sp.delete(k)
    }
    const qs = sp.toString()
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname)
    })
  }

  function selectPreset(key: '7d' | '30d' | '12m') {
    setCustomOpen(false)
    setErr(null)
    push({ evol: key, evol_from: null, evol_to: null })
  }

  function selectForecast(key: 'none' | '1m' | '1y') {
    // 'none' → on supprime le param pour garder l'URL propre.
    push({ forecast: key === 'none' ? null : key })
  }

  function applyCustom() {
    if (!from || !to) {
      setErr('Sélectionne une date de début et une date de fin.')
      return
    }
    if (from > to) {
      setErr('La date de début doit être antérieure ou égale à la date de fin.')
      return
    }
    setErr(null)
    push({ evol: 'custom', evol_from: from, evol_to: to })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        {PRESETS.map((p) => {
          const active = currentKey === p.key
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => selectPreset(p.key)}
              className={`px-3 py-1.5 rounded-md text-sm border transition-colors ${
                active
                  ? 'bg-brand-purple text-white border-brand-purple'
                  : 'bg-surface-alt text-brand-indigo-text border-border-soft hover:border-brand-purple'
              }`}
              aria-pressed={active}
            >
              {p.label}
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => setCustomOpen((v) => !v)}
          className={`px-3 py-1.5 rounded-md text-sm border transition-colors ${
            currentKey === 'custom'
              ? 'bg-brand-purple text-white border-brand-purple'
              : 'bg-surface-alt text-brand-indigo-text border-border-soft hover:border-brand-purple'
          }`}
          aria-expanded={customOpen}
        >
          Période personnalisée
        </button>
      </div>

      {/* Prévision — sur sa propre ligne pour ne pas surcharger celle des
          presets. '1 an' est désactivé en granularity=day (trop de points
          futurs pour un modèle linéaire simple). */}
      <div className="flex items-center gap-2 flex-wrap text-sm">
        <span className="text-xs text-muted font-medium mr-1">Prévision :</span>
        {(
          [
            { key: 'none', label: 'Aucune' },
            { key: '1m', label: '+ 1 mois' },
            { key: '1y', label: '+ 1 an' },
          ] as const
        ).map((opt) => {
          const active = currentForecast === opt.key
          const disabled = opt.key === '1y' && granularity === 'day'
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => !disabled && selectForecast(opt.key)}
              disabled={disabled}
              title={
                disabled
                  ? 'Indisponible sur une période en jours — choisis un preset mensuel (12 mois ou période personnalisée longue).'
                  : undefined
              }
              className={`px-3 py-1 rounded-md text-xs border transition-colors ${
                active
                  ? 'bg-brand-purple text-white border-brand-purple'
                  : disabled
                    ? 'bg-surface-alt text-muted border-border-soft opacity-50 cursor-not-allowed'
                    : 'bg-surface-alt text-brand-indigo-text border-border-soft hover:border-brand-purple'
              }`}
              aria-pressed={active}
              aria-disabled={disabled}
            >
              {opt.label}
            </button>
          )
        })}
      </div>

      {customOpen && (
        <div className="flex items-end gap-2 flex-wrap bg-surface-alt border border-border-soft rounded-md p-3">
          <label className="text-sm">
            <span className="block text-xs text-muted mb-1">Du</span>
            <input
              type="date"
              value={from}
              max={todayIso}
              onChange={(e) => setFrom(e.target.value)}
              className="px-2 py-1.5 border border-border-soft rounded-md text-sm bg-white focus:outline-none focus:ring-1 focus:ring-brand-purple"
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-muted mb-1">Au</span>
            <input
              type="date"
              value={to}
              max={todayIso}
              onChange={(e) => setTo(e.target.value)}
              className="px-2 py-1.5 border border-border-soft rounded-md text-sm bg-white focus:outline-none focus:ring-1 focus:ring-brand-purple"
            />
          </label>
          <button
            type="button"
            onClick={applyCustom}
            className="px-3 py-1.5 bg-brand-purple text-white rounded-md text-sm font-semibold hover:opacity-90"
          >
            Appliquer
          </button>
          {err && (
            <span className="text-xs text-status-red basis-full">{err}</span>
          )}
        </div>
      )}
    </div>
  )
}
