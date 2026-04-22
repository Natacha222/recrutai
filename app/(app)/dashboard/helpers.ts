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
  forecast: ForecastKey
}

export type PresetKey = '7d' | '30d' | '12m' | 'custom'

/**
 * Prolongation prévisionnelle du graphique. Projection déterministe :
 * pour chaque bucket futur, on compte les offres existantes qui seront
 * encore actives à cette date (created_at <= date, statut !== 'clos', et
 * date_validite null OU >= date). Les clients actifs en découlent.
 *
 * Ce n'est PAS une extrapolation statistique — on ne prédit pas les
 * futures créations d'offres, on montre seulement la décroissance
 * mécanique du portefeuille actuel selon les date_validite déjà saisies.
 *
 *   - '1m'  : +30 buckets si granularity=day, +1 bucket si month
 *   - '1y'  : désactivé si granularity=day (trop de points), +12 si month
 *   - 'none': aucune prévision
 */
export type ForecastKey = 'none' | '1m' | '1y'

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
  forecast?: string
}): Period {
  const today = parseIsoDate(todayIso())
  const forecast: ForecastKey =
    params.forecast === '1m' || params.forecast === '1y'
      ? (params.forecast as ForecastKey)
      : 'none'

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
        forecast,
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
      forecast,
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
      forecast,
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
    forecast,
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
  /** true si le point est extrapolé (prévision), false si mesuré. */
  forecasted: boolean
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
  const pastBuckets = buildBuckets(period)
  const futureBuckets = buildForecastBuckets(period)

  return [
    ...pastBuckets.map((b) => computePoint(b, offres, candidatures, false)),
    ...futureBuckets.map((b) => computePoint(b, offres, [], true)),
  ]
}

/**
 * Calcule un point du graphique pour un bucket donné (passé ou futur). Le
 * calcul d'« offre active à la fin du bucket » est identique dans les deux
 * cas : on se base sur les offres existantes aujourd'hui avec leur
 * created_at, leur date_validite et leur statut. Pour les buckets futurs,
 * sans création d'offres nouvelles, le nombre ne peut que décroître ou
 * rester stable (les offres expirent à leur date_validite).
 *
 * Pour les buckets futurs, `candidaturesRecues` est forcée à 0 : on ne
 * peut pas projeter le flux de candidatures sans modèle probabiliste, et
 * le graphique ne l'affiche pas de toute façon.
 */
function computePoint(
  b: Bucket,
  offres: OffreForSeries[],
  candidatures: CandForSeries[],
  forecasted: boolean
): TimeseriesPoint {
  const activeAtEnd = offres.filter((o) => {
    if (o.statut === 'clos') return false
    const created = new Date(o.created_at)
    if (created >= b.end) return false
    if (o.date_validite) {
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
    forecasted,
  }
}

/**
 * Construit les buckets futurs (post-période.to), selon la même
 * granularité que les buckets passés. Sert à projeter qui sera encore
 * actif parmi les offres existantes — c'est une projection déterministe,
 * pas une extrapolation statistique.
 *
 * Horizon :
 *   - '1m' en granularity=day   → 30 buckets (jours)
 *   - '1m' en granularity=month → 1 bucket
 *   - '1y' en granularity=month → 12 buckets
 *   - '1y' en granularity=day   → désactivé côté UI (trop de points)
 */
function buildForecastBuckets(period: Period): Bucket[] {
  if (period.forecast === 'none') return []
  const nbExtra = countForecastBuckets(period.forecast, period.granularity)
  if (nbExtra === 0) return []

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
    // On démarre au lendemain de period.to. `start` inclusif, `end` exclusif
    // — même convention que buildBuckets pour que la jonction soit propre.
    const cursor = new Date(
      period.to.getFullYear(),
      period.to.getMonth(),
      period.to.getDate() + 1
    )
    return Array.from({ length: nbExtra }, () => {
      const start = new Date(cursor)
      const end = new Date(cursor)
      end.setDate(end.getDate() + 1)
      const jj = String(start.getDate()).padStart(2, '0')
      const mm = String(start.getMonth() + 1).padStart(2, '0')
      const bucket: Bucket = { start, end, label: `${jj}/${mm}` }
      cursor.setDate(cursor.getDate() + 1)
      return bucket
    })
  }

  // Mensuel : on démarre au 1er du mois suivant period.to.
  const cursor = new Date(period.to.getFullYear(), period.to.getMonth() + 1, 1)
  return Array.from({ length: nbExtra }, () => {
    const start = new Date(cursor)
    const end = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
    const label = `${monthShort[start.getMonth()]} ${String(start.getFullYear()).slice(-2)}`
    const bucket: Bucket = { start, end, label }
    cursor.setMonth(cursor.getMonth() + 1)
    return bucket
  })
}

/**
 * Convertit un ForecastKey en nombre de buckets à projeter, en fonction
 * de la granularité. '1y' en granularity=day reste désactivé : 365 points
 * rendraient l'axe X illisible (et les offres sans date_validite seraient
 * actives à l'infini, aplatissant la courbe).
 */
function countForecastBuckets(
  forecast: ForecastKey,
  granularity: 'day' | 'month'
): number {
  if (forecast === 'none') return 0
  if (granularity === 'day') {
    return forecast === '1m' ? 30 : 0
  }
  return forecast === '1m' ? 1 : 12
}
