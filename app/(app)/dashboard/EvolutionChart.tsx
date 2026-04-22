import type { TimeseriesPoint } from './helpers'

/**
 * Graphique SVG pur (server RSC) avec 2 courbes :
 *   - Offres actives (stock à la fin de chaque bucket)
 *   - Clients avec ≥ 1 offre active (stock à la fin de chaque bucket)
 *
 * Le flux (candidatures reçues) est affiché à part sous forme de KPI
 * dans page.tsx — mélanger stock et flux sur le même axe Y serait
 * trompeur dès que les volumes divergent.
 *
 * Pas de librairie graphique : coordonnées calculées à la main pour
 * rester léger, rendre côté serveur, et contrôler précisément le style.
 */

type Props = {
  points: TimeseriesPoint[]
  /** Sous-titre sous le titre (ex. « 30 derniers jours »). */
  periodLabel: string
}

const W = 780 // viewBox width — ratio large pour lisibilité des labels X
const H = 260
const PAD_LEFT = 42 // place pour les chiffres de l'axe Y
const PAD_RIGHT = 16
const PAD_TOP = 20
const PAD_BOTTOM = 40 // place pour les labels X

const COLOR_OFFRES = 'var(--color-brand-purple)'
const COLOR_CLIENTS = 'var(--color-status-green)'

export default function EvolutionChart({ points, periodLabel }: Props) {
  if (points.length === 0) {
    return (
      <p className="text-sm text-muted py-8 text-center">
        Aucune donnée pour cette période.
      </p>
    )
  }

  const maxOffres = Math.max(...points.map((p) => p.offresActives))
  const maxClients = Math.max(...points.map((p) => p.clientsActifs))
  // Axe Y partagé : on prend le max des deux séries. +1 pour éviter un
  // graphique plat qui touche le haut quand toutes les valeurs sont 0.
  const yMaxRaw = Math.max(maxOffres, maxClients, 1)
  const yMax = niceCeil(yMaxRaw)

  const plotW = W - PAD_LEFT - PAD_RIGHT
  const plotH = H - PAD_TOP - PAD_BOTTOM
  // Si un seul point, on le centre (sinon division par 0).
  const xStep = points.length > 1 ? plotW / (points.length - 1) : 0

  function x(i: number): number {
    return PAD_LEFT + (points.length > 1 ? i * xStep : plotW / 2)
  }
  function y(v: number): number {
    return PAD_TOP + plotH - (v / yMax) * plotH
  }

  // Séparation réel / prévision : on construit 4 paths pour pouvoir styler
  // la partie prévisionnelle en pointillé. `firstForecastIdx` vaut -1 s'il
  // n'y a pas de prévision. Le dernier point réel est inclus aussi comme
  // premier point du path "forecast" pour que les 2 traits se rejoignent
  // sans discontinuité visible.
  const firstForecastIdx = points.findIndex((p) => p.forecasted)
  const realLast = firstForecastIdx === -1 ? points.length : firstForecastIdx
  const realPoints = points.slice(0, realLast)
  const forecastPoints =
    firstForecastIdx === -1
      ? []
      : points.slice(firstForecastIdx - 1, points.length) // -1 pour la jonction

  const realOffsetIdx = 0
  const forecastOffsetIdx = firstForecastIdx === -1 ? -1 : firstForecastIdx - 1

  const pathOffresReal = buildLinePath(
    realPoints.map((p, i) => [x(realOffsetIdx + i), y(p.offresActives)])
  )
  const pathClientsReal = buildLinePath(
    realPoints.map((p, i) => [x(realOffsetIdx + i), y(p.clientsActifs)])
  )
  const pathOffresForecast = buildLinePath(
    forecastPoints.map((p, i) => [x(forecastOffsetIdx + i), y(p.offresActives)])
  )
  const pathClientsForecast = buildLinePath(
    forecastPoints.map((p, i) => [x(forecastOffsetIdx + i), y(p.clientsActifs)])
  )

  // Axe Y : 5 graduations (0, Q1, Q2, Q3, max). On affiche des entiers
  // puisque les métriques sont des comptes discrets.
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(yMax * t))
  // Dédoublonnage au cas où yMax est petit (ex. 2 → [0,1,1,2,2])
  const yTicksUniq = Array.from(new Set(yTicks)).sort((a, b) => a - b)

  // Axe X : pour ne pas surcharger (surtout en demi-largeur avec la grille
  // à 2 colonnes), on plafonne à ~8 labels visibles quelle que soit la
  // longueur de la série.
  const xLabelStep = Math.max(1, Math.ceil(points.length / 8))

  const ariaLabel = buildAriaLabel(points, periodLabel)

  return (
    <div className="w-full">
      <div className="flex items-center gap-4 flex-wrap mb-3 text-sm">
        <LegendItem color={COLOR_OFFRES} label="Offres actives" />
        <LegendItem color={COLOR_CLIENTS} label="Clients actifs" />
        {firstForecastIdx > 0 && (
          <span className="flex items-center gap-2 text-muted">
            <span
              className="inline-block rounded-sm"
              style={{
                height: '3px',
                width: '14px',
                backgroundImage:
                  'repeating-linear-gradient(90deg, var(--color-muted, #6b7280) 0 3px, transparent 3px 6px)',
              }}
              aria-hidden
            />
            <span>Prévision (offres existantes)</span>
          </span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        role="img"
        aria-label={ariaLabel}
      >
        {/* Grille horizontale + graduations Y */}
        {yTicksUniq.map((tick) => {
          const yy = y(tick)
          return (
            <g key={`ytick-${tick}`}>
              <line
                x1={PAD_LEFT}
                x2={W - PAD_RIGHT}
                y1={yy}
                y2={yy}
                stroke="var(--color-border-soft, #e5e7eb)"
                strokeDasharray="2 3"
                strokeWidth="1"
              />
              <text
                x={PAD_LEFT - 6}
                y={yy}
                fontSize="13"
                textAnchor="end"
                dominantBaseline="middle"
                fill="var(--color-muted, #6b7280)"
              >
                {tick}
              </text>
            </g>
          )
        })}

        {/* Axe X : labels datés, un sur xLabelStep */}
        {points.map((p, i) => {
          if (i % xLabelStep !== 0 && i !== points.length - 1) return null
          return (
            <text
              key={`xlabel-${i}`}
              x={x(i)}
              y={H - PAD_BOTTOM + 16}
              fontSize="13"
              textAnchor="middle"
              fill="var(--color-muted, #6b7280)"
            >
              {p.label}
            </text>
          )
        })}

        {/* Ligne verticale « aujourd'hui » entre réel et prévision, pour
            que l'œil sépare sans ambiguïté le passé mesuré du futur
            extrapolé. */}
        {firstForecastIdx > 0 && (
          <g>
            <line
              x1={x(firstForecastIdx - 1)}
              x2={x(firstForecastIdx - 1)}
              y1={PAD_TOP}
              y2={H - PAD_BOTTOM}
              stroke="var(--color-border-soft, #e5e7eb)"
              strokeDasharray="4 3"
              strokeWidth="1"
            />
            <text
              x={x(firstForecastIdx - 1) + 4}
              y={PAD_TOP + 10}
              fontSize="11"
              fill="var(--color-muted, #6b7280)"
            >
              Prévision →
            </text>
          </g>
        )}

        {/* Courbes — trait plein pour le réel, pointillé pour la prévision */}
        <path
          d={pathOffresReal}
          fill="none"
          stroke={COLOR_OFFRES}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d={pathClientsReal}
          fill="none"
          stroke={COLOR_CLIENTS}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {pathOffresForecast && (
          <path
            d={pathOffresForecast}
            fill="none"
            stroke={COLOR_OFFRES}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="5 4"
            opacity="0.75"
          />
        )}
        {pathClientsForecast && (
          <path
            d={pathClientsForecast}
            fill="none"
            stroke={COLOR_CLIENTS}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="5 4"
            opacity="0.75"
          />
        )}

        {/* Points avec tooltip natif <title>. Plus discret quand il y a
            beaucoup de buckets (rayon réduit). Les points prévisionnels
            sont dessinés en version allégée (creux + opacité réduite). */}
        {points.map((p, i) => {
          const r = points.length > 40 ? 1.5 : 3
          const suffix = p.forecasted ? ' (prévision)' : ''
          const offresTitle = `${p.label} — Offres actives : ${p.offresActives}${suffix}`
          const clientsTitle = `${p.label} — Clients actifs : ${p.clientsActifs}${suffix}`
          if (p.forecasted) {
            return (
              <g key={`pts-${i}`} opacity="0.75">
                <circle
                  cx={x(i)}
                  cy={y(p.offresActives)}
                  r={r}
                  fill="white"
                  stroke={COLOR_OFFRES}
                  strokeWidth="1.5"
                >
                  <title>{offresTitle}</title>
                </circle>
                <circle
                  cx={x(i)}
                  cy={y(p.clientsActifs)}
                  r={r}
                  fill="white"
                  stroke={COLOR_CLIENTS}
                  strokeWidth="1.5"
                >
                  <title>{clientsTitle}</title>
                </circle>
              </g>
            )
          }
          return (
            <g key={`pts-${i}`}>
              <circle cx={x(i)} cy={y(p.offresActives)} r={r} fill={COLOR_OFFRES}>
                <title>{offresTitle}</title>
              </circle>
              <circle cx={x(i)} cy={y(p.clientsActifs)} r={r} fill={COLOR_CLIENTS}>
                <title>{clientsTitle}</title>
              </circle>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <span
        className="inline-block w-3 h-0.5 rounded-sm"
        style={{ backgroundColor: color, height: '3px', width: '14px' }}
        aria-hidden
      />
      <span>{label}</span>
    </span>
  )
}

function buildLinePath(pts: Array<[number, number]>): string {
  if (pts.length === 0) return ''
  if (pts.length === 1) {
    // Avec un seul point on ne peut pas tracer une ligne : on dessine un
    // micro-segment horizontal centré pour rester visible.
    const [xx, yy] = pts[0]
    return `M ${(xx - 2).toFixed(2)} ${yy.toFixed(2)} L ${(xx + 2).toFixed(2)} ${yy.toFixed(2)}`
  }
  return pts
    .map(([xx, yy], i) => `${i === 0 ? 'M' : 'L'} ${xx.toFixed(2)} ${yy.toFixed(2)}`)
    .join(' ')
}

/**
 * Arrondit un max vers un « joli » nombre au-dessus pour que l'axe Y
 * tombe sur des multiples lisibles (5, 10, 25, 50, 100, 250…) plutôt
 * que 7 ou 13. Évite aussi un yMax = 0 (division par zéro plus loin).
 */
function niceCeil(v: number): number {
  if (v <= 1) return 1
  if (v <= 5) return 5
  if (v <= 10) return 10
  const mag = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / mag
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return nice * mag
}

function buildAriaLabel(points: TimeseriesPoint[], periodLabel: string): string {
  const first = points[0]
  const real = points.filter((p) => !p.forecasted)
  const forecast = points.filter((p) => p.forecasted)
  const lastReal = real[real.length - 1] ?? first
  const base =
    `Évolution sur ${periodLabel} : ` +
    `offres actives de ${first.offresActives} à ${lastReal.offresActives}, ` +
    `clients actifs de ${first.clientsActifs} à ${lastReal.clientsActifs}.`
  if (forecast.length === 0) return base
  const lastForecast = forecast[forecast.length - 1]
  return (
    base +
    ` Prévision à horizon ${forecast.length} bucket${forecast.length > 1 ? 's' : ''} : ` +
    `offres actives ≈ ${lastForecast.offresActives}, ` +
    `clients actifs ≈ ${lastForecast.clientsActifs}.`
  )
}
