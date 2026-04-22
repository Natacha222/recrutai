import { todayIso } from '@/lib/format'

/**
 * Plage de temps résolue pour le graphique d'évolution, plus granularité
 * (jour ou mois) dérivée automatiquement. Le label sert de sous-titre au
 * chart et de libellé pour le screen reader.
 */
export type Period = {
  from: Date
  to: Date
  granularity: 'day' | 'month'
  label: string
  presetKey: PresetKey
}

export type PresetKey = '7d' | '30d' | '12m' | 'custom'

/** Parse YYYY-MM-DD en Date locale à minuit, sans bascule UTC. */
function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

function isValidIsoDate(iso: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso)
}

/**
 * Calcule la Period à partir des searchParams :
 *   - evol = '7d' | '30d' | '12m' | 'custom'
 *   - evol_from / evol_to : YYYY-MM-DD (uniquement si evol = 'custom')
 * Défaut = 30 derniers jours (le plus équilibré pour voir une tendance
 * sur une démo sans bucketing trop fin ni trop large).
 */
export function resolvePeriod(params: {
  evol?: string
  evol_from?: string
  evol_to?: string
}): Period {
  const today = parseIsoDate(todayIso())

  if (
    params.evol === 'custom' &&
    params.evol_from &&
    params.evol_to &&
    isValidIsoDate(params.evol_from) &&
    isValidIsoDate(params.evol_to)
  ) {
    const from = parseIsoDate(params.evol_from)
    const to = parseIsoDate(params.evol_to)
    if (from <= to) {
      const days =
        Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1
      return {
        from,
        to,
        // Seuil arbitraire : au-delà de 62 jours, l'axe X devient illisible
        // au quotidien, on bascule sur un bucket mensuel.
        granularity: days <= 62 ? 'day' : 'month',
        label: `Du ${frenchShort(from)} au ${frenchShort(to)}`,
        presetKey: 'custom',
      }
    }
  }

  const key = (params.evol as PresetKey | undefined) ?? '30d'

  if (key === '7d') {
    const from = new Date(today)
    from.setDate(today.getDate() - 6)
    return {
      from,
      to: today,
      granularity: 'day',
      label: '7 derniers jours',
      presetKey: '7d',
    }
  }
  if (key === '12m') {
    const from = new Date(today.getFullYear(), today.getMonth() - 11, 1)
    return {
      from,
      to: today,
      granularity: 'month',
      label: '12 derniers mois',
      presetKey: '12m',
    }
  }
  // Défaut : 30 jours
  const from = new Date(today)
  from.setDate(today.getDate() - 29)
  return {
    from,
    to: today,
    granularity: 'day',
    label: '30 derniers jours',
    presetKey: '30d',
  }
}

function frenchShort(d: Date): string {
  const jj = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${jj}/${mm}/${d.getFullYear()}`
}

export type Bucket = {
  start: Date
  end: Date
  label: string
}

/**
 * Découpe la période en buckets consécutifs (jour ou mois) pour le chart.
 * `end` est exclusif pour éviter les doublons aux frontières : une
 * candidature créée le 15 à 23:59 est dans le bucket du 15, pas du 16.
 * Pour un bucket « jour » sur J, end = J+1 à minuit.
 */
export function buildBuckets(period: Period): Bucket[] {
  const buckets: Bucket[] = []
  const monthShort = [
    'Jan',
    'Fév',
    'Mar',
    'Avr',
    'Mai',
    'Juin',
    'Juil',
    'Août',
    'Sep',
    'Oct',
    'Nov',
    'Déc',
  ]

  if (period.granularity === 'day') {
    const cursor = new Date(period.from)
    while (cursor <= period.to) {
      const start = new Date(cursor)
      const end = new Date(cursor)
      end.setDate(end.getDate() + 1)
      const jj = String(start.getDate()).padStart(2, '0')
      const mm = String(start.getMonth() + 1).padStart(2, '0')
      buckets.push({ start, end, label: `${jj}/${mm}` })
      cursor.setDate(cursor.getDate() + 1)
    }
  } else {
    const cursor = new Date(period.from.getFullYear(), period.from.getMonth(), 1)
    const lastMonthStart = new Date(
      period.to.getFullYear(),
      period.to.getMonth(),
      1
    )
    while (cursor <= lastMonthStart) {
      const start = new Date(cursor)
      const end = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
      const label = `${monthShort[start.getMonth()]} ${String(start.getFullYear()).slice(-2)}`
      buckets.push({ start, end, label })
      cursor.setMonth(cursor.getMonth() + 1)
    }
  }

  return buckets
}

export type OffreForSeries = {
  id: string
  created_at: string
  date_validite: string | null
  statut: string | null
  client_id: string
}

export type CandForSeries = {
  id: string
  created_at: string
  statut: string | null
}

export type TimeseriesPoint = {
  label: string
  /** Nb d'offres « actives » (dans leur fenêtre de validité) à la fin du bucket. */
  offresActives: number
  /** Nb de clients distincts ayant ≥ 1 offre active à la fin du bucket. */
  clientsActifs: number
  /** Nb de candidatures créées dans le bucket (flux). */
  candidaturesRecues: number
}

/**
 * Calcule la time series pour le graphique d'évolution.
 *
 * « Offre active à la date D » : on l'approxime par
 *     created_at <= D  ET  (date_validite null OU date_validite >= D)
 *     ET  statut !== 'clos'
 *
 * Limitation assumée : on ne connaît pas l'historique des changements de
 * statut. Une offre fermée manuellement aujourd'hui disparaît de tous les
 * buckets passés. Acceptable pour un dashboard de tendance — pas pour un
 * audit financier.
 */
export function computeTimeseries(
  period: Period,
  offres: OffreForSeries[],
  candidatures: CandForSeries[]
): TimeseriesPoint[] {
  const buckets = buildBuckets(period)

  return buckets.map((b) => {
    const activeAtEnd = offres.filter((o) => {
      if (o.statut === 'clos') return false
      const created = new Date(o.created_at)
      if (created >= b.end) return false
      if (o.date_validite) {
        // Inclusif : une offre dont date_validite = dernier jour du bucket
        // est encore active en fin de bucket.
        const expiry = parseIsoDate(o.date_validite)
        if (expiry < b.end) return false
      }
      return true
    })
    const clientIds = new Set(activeAtEnd.map((o) => o.client_id))
    const inBucket = candidatures.filter((c) => {
      const d = new Date(c.created_at)
      return d >= b.start && d < b.end
    })
    return {
      label: b.label,
      offresActives: activeAtEnd.length,
      clientsActifs: clientIds.size,
      candidaturesRecues: inBucket.length,
    }
  })
}
