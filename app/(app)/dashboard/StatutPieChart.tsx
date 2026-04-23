import Link from 'next/link'

/**
 * Camembert SVG pur (server RSC) pour la répartition des statuts de
 * candidature. On dessine chaque part comme un path SVG (M → L → A → Z)
 * à partir des fractions cumulées. Colors via les variables CSS du
 * thème (cf. app/globals.css) pour rester cohérent avec les badges
 * StatusBadge.
 *
 * Interactivité : si un slice a un `href`, on wrap son path dans un
 * <a xlink:href> (SVG standard, pas de JS) et l'item de légende devient
 * un Link Next.js pour tirer parti du prefetch.
 */

export type PieSlice = {
  key: string
  label: string
  count: number
  /** Couleur CSS (variable ou hex) passée directement en fill SVG. */
  color: string
  /** Si défini, la part et l'item de légende deviennent cliquables. */
  href?: string
}

type Props = {
  slices: PieSlice[]
}

export default function StatutPieChart({ slices }: Props) {
  const nonEmpty = slices.filter((s) => s.count > 0)
  const total = nonEmpty.reduce((s, x) => s + x.count, 0)

  if (total === 0) {
    return (
      <p className="text-sm text-muted py-8 text-center">
        Aucune donnée pour le moment.
      </p>
    )
  }

  const cx = 100
  const cy = 100
  const r = 90

  // Cas dégénéré : une seule part représente 100 %. Le path « M L A Z »
  // classique ne fonctionne pas pour un cercle complet (angles égaux),
  // on dessine un cercle plein à la place.
  if (nonEmpty.length === 1) {
    const s = nonEmpty[0]
    const circleEl = (
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill={s.color}
        aria-label={`${s.label} : 100 %`}
        className={s.href ? 'cursor-pointer hover:opacity-90 transition-opacity' : undefined}
      />
    )
    return (
      <PieLayout
        svg={s.href ? <a href={s.href}>{circleEl}</a> : circleEl}
        legend={[{ ...s, pct: 100 }]}
        total={total}
      />
    )
  }

  // Fractions cumulées précalculées (sans mutation dans map, cf. règle
  // react-hooks/immutability de React 19).
  const fractions = nonEmpty.map((s) => s.count / total)
  const cumuls = fractions.reduce<number[]>((acc, f) => {
    acc.push((acc[acc.length - 1] ?? 0) + f)
    return acc
  }, [])

  const paths = nonEmpty.map((s, i) => {
    const frac = fractions[i]
    const cumulBefore = i === 0 ? 0 : cumuls[i - 1]
    const startAngle = cumulBefore * 2 * Math.PI - Math.PI / 2
    const endAngle = cumuls[i] * 2 * Math.PI - Math.PI / 2

    const x1 = cx + r * Math.cos(startAngle)
    const y1 = cy + r * Math.sin(startAngle)
    const x2 = cx + r * Math.cos(endAngle)
    const y2 = cy + r * Math.sin(endAngle)
    const largeArc = frac > 0.5 ? 1 : 0

    return {
      ...s,
      d: `M ${cx} ${cy} L ${x1.toFixed(3)} ${y1.toFixed(3)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(3)} ${y2.toFixed(3)} Z`,
      pct: frac * 100,
    }
  })

  return (
    <PieLayout
      svg={paths.map((p) => {
        const pathEl = (
          <path
            d={p.d}
            fill={p.color}
            className={p.href ? 'cursor-pointer hover:opacity-80 transition-opacity' : undefined}
          >
            <title>{`${p.label} : ${p.count} (${Math.round(p.pct)} %)${p.href ? ' — cliquer pour voir la liste' : ''}`}</title>
          </path>
        )
        return p.href ? (
          <a key={p.key} href={p.href} aria-label={`${p.label} : ${p.count}`}>
            {pathEl}
          </a>
        ) : (
          <g key={p.key}>{pathEl}</g>
        )
      })}
      legend={paths}
      total={total}
    />
  )
}

function PieLayout({
  svg,
  legend,
  total,
}: {
  svg: React.ReactNode
  legend: Array<{
    key: string
    label: string
    count: number
    color: string
    pct: number
    href?: string
  }>
  total: number
}) {
  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      <svg
        viewBox="0 0 200 200"
        className="w-64 h-64 md:w-72 md:h-72 lg:w-80 lg:h-80 shrink-0"
        role="img"
        aria-label={`Répartition de ${total} candidature${total > 1 ? 's' : ''} par statut`}
      >
        {svg}
      </svg>
      <ul className="flex-1 w-full space-y-2 min-w-0">
        {legend.map((s) => {
          // Anti-troncature : on autorise le label à passer à la ligne
          // plutôt que d'être coupé en « Qu… / En att… / R… » sur les
          // viewports étroits — labels courts (« Qualifiées / En
          // attente / Rejetées ») tiennent en général sur une ligne mais
          // c'est le garde-fou pour l'autre cas.
          const inner = (
            <>
              <span className="flex items-center gap-2 min-w-0 flex-1">
                <span
                  className="inline-block w-3 h-3 rounded-sm shrink-0"
                  style={{ backgroundColor: s.color }}
                  aria-hidden
                />
                <span className="break-words">{s.label}</span>
              </span>
              <span className="text-muted tabular-nums shrink-0">
                {s.count} ({Math.round(s.pct)}&nbsp;%)
              </span>
            </>
          )
          return (
            <li key={s.key}>
              {s.href ? (
                <Link
                  href={s.href}
                  className="flex items-center justify-between text-sm gap-3 px-2 py-1 -mx-2 rounded-md hover:bg-surface transition-colors"
                >
                  {inner}
                </Link>
              ) : (
                <div className="flex items-center justify-between text-sm gap-3 px-2 py-1 -mx-2">
                  {inner}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
