import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import StatusBadge from '@/components/StatusBadge'
import { effectiveStatut, scoreColor, todayIso } from '@/lib/format'
import StatutPieChart from './StatutPieChart'
import EvolutionChart from './EvolutionChart'
import PeriodSelector from './PeriodSelector'
import {
  resolvePeriod,
  computeTimeseries,
  type OffreForSeries,
  type CandForSeries,
} from './helpers'

// Force le rendu dynamique : sinon Next.js peut servir une version cachée
// du dashboard quand une candidature vient d'être ajoutée ou un statut de
// changer, et l'utilisateur voit des données périmées.
export const dynamic = 'force-dynamic'

type SearchParams = Promise<{
  /** Preset du graphique d'évolution : '7d' | '30d' | '12m' | 'custom'. */
  evol?: string
  /** Si evol=custom : date de début ISO YYYY-MM-DD. */
  evol_from?: string
  /** Si evol=custom : date de fin ISO YYYY-MM-DD. */
  evol_to?: string
  /** Prévision : 'none' (défaut) | '1m' | '1y'. */
  forecast?: string
}>

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const params = await searchParams
  const period = resolvePeriod(params)

  const supabase = await createClient()

  // On bascule sur du fetch complet (offres + candidatures + clients) car
  // on a besoin des rows brutes côté JS à la fois pour calculer les KPIs
  // avec effectiveStatut (qui prend en compte date_validite) et pour
  // construire la time series du graphique. Volume raisonnable tant qu'on
  // reste sur quelques milliers de lignes ; à migrer en SQL agrégé si on
  // dépasse.
  const [offresRes, candidaturesRes, clientsRes] = await Promise.all([
    supabase
      .from('offres')
      .select('id, titre, created_at, date_validite, statut, client_id, clients(id, nom)')
      .order('created_at', { ascending: false }),
    supabase
      .from('candidatures')
      .select(
        'id, nom, email, score_ia, statut, offre_id, created_at, offres(id, titre, seuil, statut, date_validite)'
      )
      .order('created_at', { ascending: false }),
    supabase
      .from('clients')
      .select('id, nom, created_at')
      .order('created_at', { ascending: false }),
  ])

  type OffreRow = {
    id: string
    titre: string
    created_at: string
    date_validite: string | null
    statut: string | null
    client_id: string
    clients: { id: string; nom: string } | { id: string; nom: string }[] | null
  }

  type CandidatureRow = {
    id: string
    nom: string | null
    email: string | null
    score_ia: number | null
    statut: string | null
    offre_id: string
    created_at: string
    offres:
      | {
          id: string
          titre: string
          seuil: number | null
          statut: string | null
          date_validite: string | null
        }
      | {
          id: string
          titre: string
          seuil: number | null
          statut: string | null
          date_validite: string | null
        }[]
      | null
  }

  type ClientRow = {
    id: string
    nom: string
    created_at: string
  }

  const offres = (offresRes.data ?? []) as OffreRow[]
  const candidatures = (candidaturesRes.data ?? []) as CandidatureRow[]
  const clients = (clientsRes.data ?? []) as ClientRow[]

  // ---- KPIs
  // Définition "active" = effectiveStatut (statut manuel + date_validite).
  // On construit un Set pour tester vite l'appartenance des candidatures.
  const offresActivesIds = new Set(
    offres
      .filter((o) => effectiveStatut(o.statut, o.date_validite) === 'actif')
      .map((o) => o.id)
  )
  const nbOffresActives = offresActivesIds.size

  // Candidatures liées à une offre actuellement active — base commune pour
  // les 2 moyennes "par offre active".
  const candidaturesSurActives = candidatures.filter((c) =>
    offresActivesIds.has(c.offre_id)
  )
  const nbCandidaturesSurActives = candidaturesSurActives.length
  const nbQualifiesSurActives = candidaturesSurActives.filter(
    (c) => c.statut === 'qualifié'
  ).length

  const fmtMoyenne = (num: number, den: number) =>
    den > 0 ? (num / den).toFixed(1).replace('.', ',') : '—'

  const moyenneCandParOffreActive = fmtMoyenne(
    nbCandidaturesSurActives,
    nbOffresActives
  )
  const moyenneQualifiesParOffreActive = fmtMoyenne(
    nbQualifiesSurActives,
    nbOffresActives
  )

  const kpis = [
    { label: 'Offres actives', value: nbOffresActives },
    {
      label: 'Candidatures / offre active',
      value: moyenneCandParOffreActive,
    },
    {
      label: 'Qualifiés / offre active',
      value: moyenneQualifiesParOffreActive,
    },
  ]

  // ---- Qualité IA : score moyen + répartition pie chart.
  // Depuis le refactor « CV en attente » (qui remplace l'ancienne carte
  // Taux de flottement), on n'a plus besoin du seuil côté KPI — seuls
  // score_ia et statut restent.
  const scored = candidatures.filter(
    (c): c is CandidatureRow & { score_ia: number } => c.score_ia !== null
  )
  const totalScored = scored.length

  const scoreMoyen =
    totalScored > 0
      ? Math.round(
          scored.reduce((sum, c) => sum + c.score_ia, 0) / totalScored
        )
      : 0

  // ---- Répartition par statut (pie chart)
  const statutCounts = scored.reduce((acc, c) => {
    const s = c.statut ?? 'en attente'
    acc[s] = (acc[s] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  // Source unique de vérité pour le bouton « CV en attente » ET la part
  // orange du camembert : les deux doivent afficher STRICTEMENT le même
  // chiffre (cf. demande utilisateur), sinon le clic sur la part puis sur
  // le bouton donne deux listes différentes = incohérence visible.
  const cvEnAttenteCount = statutCounts['en attente'] ?? 0

  // URL vers la liste filtrée par statut. encodeURIComponent gère les
  // accents de 'qualifié' / 'rejeté' et l'espace de 'en attente'.
  const hrefFor = (s: string) =>
    `/candidatures?statut=${encodeURIComponent(s)}`

  const statutSlices = [
    {
      key: 'qualifié',
      label: 'Qualifiés',
      count: statutCounts['qualifié'] ?? 0,
      color: 'var(--color-status-green)',
      href: hrefFor('qualifié'),
    },
    {
      key: 'en attente',
      label: 'En attente',
      count: statutCounts['en attente'] ?? 0,
      color: 'var(--color-status-amber)',
      href: hrefFor('en attente'),
    },
    {
      key: 'rejeté',
      label: 'Rejetés',
      count: statutCounts['rejeté'] ?? 0,
      color: 'var(--color-status-red)',
      href: hrefFor('rejeté'),
    },
  ]

  // ---- Time series pour le graphique d'évolution
  const offresForSeries: OffreForSeries[] = offres.map((o) => ({
    id: o.id,
    created_at: o.created_at,
    date_validite: o.date_validite,
    statut: o.statut,
    client_id: o.client_id,
  }))
  const candForSeries: CandForSeries[] = candidatures.map((c) => ({
    id: c.id,
    created_at: c.created_at,
    statut: c.statut,
  }))
  const timeseries = computeTimeseries(period, offresForSeries, candForSeries)

  // Totaux flux sur la période (affichés à côté du chart)
  const candidaturesSurPeriode = candidatures.filter((c) => {
    const d = new Date(c.created_at)
    return d >= period.from && d <= endOfDay(period.to)
  })
  const nbCandSurPeriode = candidaturesSurPeriode.length
  const nbQualifiesSurPeriode = candidaturesSurPeriode.filter(
    (c) => c.statut === 'qualifié'
  ).length

  // ---- Activité récente : 5 derniers événements (candidatures, clients,
  // offres) fusionnés puis triés desc. Sans audit log on ne capture que
  // les créations.
  const recentCandidatures = candidatures.slice(0, 5)
  const recentClients = clients.slice(0, 5)
  const recentOffres = offres.slice(0, 5)

  type OffreRef = { id: string; titre: string } | null
  type ClientRef = { id: string; nom: string } | null
  type Activite =
    | {
        type: 'candidature'
        id: string
        nom: string | null
        email: string | null
        scoreIa: number | null
        /** Seuil de l'offre ciblée, pour colorer le score vs seuil (±15). */
        seuil: number | null
        statut: string | null
        offre: OffreRef
        createdAt: string
      }
    | {
        type: 'client'
        id: string
        nom: string
        createdAt: string
      }
    | {
        type: 'offre'
        id: string
        titre: string
        client: ClientRef
        createdAt: string
      }

  const activites: Activite[] = [
    ...recentCandidatures.map((c): Activite => {
      const offreRaw = Array.isArray(c.offres) ? c.offres[0] : c.offres
      const offreInfo: OffreRef = offreRaw
        ? { id: offreRaw.id, titre: offreRaw.titre }
        : null
      return {
        type: 'candidature',
        id: c.id,
        nom: c.nom,
        email: c.email,
        scoreIa: c.score_ia,
        seuil: offreRaw?.seuil ?? null,
        statut: c.statut,
        offre: offreInfo,
        createdAt: c.created_at,
      }
    }),
    ...recentClients.map(
      (c): Activite => ({
        type: 'client',
        id: c.id,
        nom: c.nom,
        createdAt: c.created_at,
      })
    ),
    ...recentOffres.map((o): Activite => {
      const clientInfo = (Array.isArray(o.clients)
        ? o.clients[0]
        : o.clients) as ClientRef
      return {
        type: 'offre',
        id: o.id,
        titre: o.titre,
        client: clientInfo,
        createdAt: o.created_at,
      }
    }),
  ]
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
    .slice(0, 5)

  const fmtDate = (iso: string) => {
    const d = new Date(iso)
    const jj = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const aaaa = d.getFullYear()
    return `${jj}/${mm}/${aaaa}`
  }

  const todayForInput = todayIso()

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      {/* 5 KPIs compactés sur une seule ligne (2 cols mobile → 3 tablette →
          5 desktop). Les 2 derniers (Qualité IA) ont une bordure gauche
          colorée pour les différencier visuellement sans perdre la ligne
          de heading dédiée. */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {kpis.map((k) => (
          <div
            key={k.label}
            className="bg-surface-alt rounded-lg px-3 py-2.5 shadow-sm border border-border-soft"
          >
            <div className="text-[11px] text-muted font-medium leading-tight">
              {k.label}
            </div>
            <div className="text-2xl font-bold text-brand-indigo-text leading-tight mt-0.5">
              {k.value}
            </div>
          </div>
        ))}
        <div
          className="bg-surface-alt rounded-lg px-3 py-2.5 shadow-sm border border-border-soft border-l-4 border-l-brand-purple"
          title="Indicateur de qualité IA"
        >
          <div className="text-[11px] text-muted font-medium leading-tight">
            Score moyen IA
          </div>
          <div className="flex items-baseline gap-1.5 leading-tight mt-0.5 flex-wrap">
            <span className="text-2xl font-bold text-brand-indigo-text">
              {totalScored > 0 ? scoreMoyen : '—'}
            </span>
            <span className="text-[11px] text-muted">
              sur {totalScored} CV{totalScored > 1 ? 's' : ''}
            </span>
          </div>
        </div>
        {/* CV en attente — même chiffre que la part orange du camembert,
            les deux sources partagent `cvEnAttenteCount`. Clic = filtre
            sur /candidatures?statut=en attente (encoding fait par hrefFor).
            Quand il y a des CV à trancher on vire la carte neutre pour un
            vrai bouton rempli (brand-purple, texte blanc), pour que l'oeil
            voie immédiatement qu'il y a quelque chose à cliquer. À zéro on
            reste sur le look de carte KPI : rien à faire, pas d'urgence. */}
        <Link
          href={hrefFor('en attente')}
          className={`rounded-lg px-3 py-2.5 shadow-sm border block transition-all ${
            cvEnAttenteCount > 0
              ? 'bg-brand-purple text-white border-brand-purple hover:opacity-90 hover:shadow-md cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-purple focus:ring-offset-2'
              : 'bg-surface-alt border-border-soft border-l-4 border-l-brand-purple'
          }`}
          title={
            cvEnAttenteCount > 0
              ? `Voir les ${cvEnAttenteCount} CV en attente`
              : 'Tout est à jour'
          }
          aria-label={
            cvEnAttenteCount > 0
              ? `Voir les ${cvEnAttenteCount} CV en attente`
              : 'CV en attente : tout est à jour'
          }
        >
          <div
            className={`text-[11px] font-medium leading-tight ${
              cvEnAttenteCount > 0 ? 'text-white/90' : 'text-muted'
            }`}
          >
            CV en attente
          </div>
          <div className="flex items-baseline gap-1.5 leading-tight mt-0.5 flex-wrap">
            <span
              className={`text-2xl font-bold ${
                cvEnAttenteCount > 0 ? 'text-white' : 'text-brand-indigo-text'
              }`}
            >
              {cvEnAttenteCount}
            </span>
            {cvEnAttenteCount === 0 && (
              <span className="text-[11px] text-muted">tout est à jour</span>
            )}
          </div>
        </Link>
      </div>

      {/* Évolution + Répartition — côte à côte en 2 colonnes sur grand
          écran, empilés sur mobile. Hauteurs homogènes via items-stretch
          par défaut de grid. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section
          aria-labelledby="evolution-heading"
          className="bg-surface-alt rounded-xl p-5 shadow-sm border border-border-soft space-y-3"
        >
          <div>
            <h2 id="evolution-heading" className="text-lg font-semibold">
              Évolution
            </h2>
            <p className="text-sm text-muted mt-0.5">{period.label}</p>
          </div>
          <PeriodSelector
            currentKey={period.presetKey}
            currentFrom={params.evol_from}
            currentTo={params.evol_to}
            todayIso={todayForInput}
            currentForecast={period.forecast}
          />
          <EvolutionChart points={timeseries} periodLabel={period.label} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-border-soft">
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-bold text-brand-indigo-text tabular-nums">
                {nbCandSurPeriode}
              </span>
              <span className="text-xs text-muted">
                candidature{nbCandSurPeriode > 1 ? 's' : ''} reçue
                {nbCandSurPeriode > 1 ? 's' : ''} sur la période
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-bold text-status-green tabular-nums">
                {nbQualifiesSurPeriode}
              </span>
              <span className="text-xs text-muted">
                qualifié{nbQualifiesSurPeriode > 1 ? 's' : ''} sur la période
              </span>
            </div>
          </div>
        </section>

        <section
          aria-labelledby="repartition-heading"
          className="bg-surface-alt rounded-xl p-5 shadow-sm border border-border-soft flex flex-col"
        >
          <div className="mb-3">
            <h2 id="repartition-heading" className="text-lg font-semibold">
              Répartition des candidatures
            </h2>
            <p className="text-sm text-muted mt-0.5">
              Statuts sur l&apos;ensemble des CV scorés
            </p>
          </div>
          <div className="flex-1 flex items-center">
            <StatutPieChart slices={statutSlices} />
          </div>
        </section>
      </div>

      {/* Activité récente — feed unifié : nouveaux clients, nouvelles
          offres, nouvelles candidatures. Triés par created_at desc,
          limités aux 5 plus récents. Pas d'audit log sur les changements
          de statut — juste les créations. */}
      <div className="bg-surface-alt rounded-xl border border-border-soft">
        <div className="px-6 py-4 border-b border-border-soft">
          <h2 className="font-semibold">Activité récente</h2>
          <p className="text-sm text-muted mt-0.5">
            Les 5 derniers événements sur la plateforme
          </p>
        </div>
        <ul className="divide-y divide-border-soft">
          {activites.map((a) => (
            <li
              key={`${a.type}-${a.id}`}
              className="px-6 py-4 flex items-start justify-between gap-4 text-sm flex-wrap"
            >
              {a.type === 'candidature' && (
                <>
                  <div className="min-w-0 flex-1">
                    <span className="text-brand-purple font-semibold">
                      Nouvelle candidature
                    </span>
                    <span className="text-muted"> • </span>
                    <span className="font-medium">
                      {a.nom?.trim() || 'Candidat'}
                    </span>
                    {a.offre && (
                      <>
                        <span className="text-muted"> → </span>
                        <Link
                          href={`/offres/${a.offre.id}`}
                          className="text-brand-purple hover:underline font-medium"
                        >
                          {a.offre.titre}
                        </Link>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {a.scoreIa !== null && (
                      <span
                        className={`font-bold ${scoreColor(a.scoreIa, a.seuil)}`}
                        aria-label={`Score ${a.scoreIa} sur 100`}
                      >
                        {a.scoreIa}
                      </span>
                    )}
                    <StatusBadge status={a.statut ?? 'en attente'} />
                    <span className="text-muted text-xs tabular-nums">
                      {fmtDate(a.createdAt)}
                    </span>
                  </div>
                </>
              )}
              {a.type === 'client' && (
                <>
                  <div className="min-w-0 flex-1">
                    <span className="text-brand-indigo-text font-semibold">
                      Nouveau client
                    </span>
                    <span className="text-muted"> • </span>
                    <Link
                      href={`/clients/${a.id}`}
                      className="font-medium text-brand-indigo-text hover:text-brand-purple"
                    >
                      {a.nom}
                    </Link>
                  </div>
                  <span className="text-muted text-xs tabular-nums shrink-0">
                    {fmtDate(a.createdAt)}
                  </span>
                </>
              )}
              {a.type === 'offre' && (
                <>
                  <div className="min-w-0 flex-1">
                    <span className="text-status-amber font-semibold">
                      Nouvelle offre
                    </span>
                    <span className="text-muted"> • </span>
                    <Link
                      href={`/offres/${a.id}`}
                      className="font-medium text-brand-indigo-text hover:text-brand-purple"
                    >
                      {a.titre}
                    </Link>
                    {a.client && (
                      <>
                        <span className="text-muted"> chez </span>
                        <Link
                          href={`/clients/${a.client.id}`}
                          className="hover:underline"
                        >
                          {a.client.nom}
                        </Link>
                      </>
                    )}
                  </div>
                  <span className="text-muted text-xs tabular-nums shrink-0">
                    {fmtDate(a.createdAt)}
                  </span>
                </>
              )}
            </li>
          ))}
          {activites.length === 0 && (
            <li className="px-6 py-8 text-center text-muted text-sm">
              Aucune activité récente.
            </li>
          )}
        </ul>
      </div>
    </div>
  )
}

/** Fin de journée locale pour inclure les candidatures du dernier jour. */
function endOfDay(d: Date): Date {
  const out = new Date(d)
  out.setHours(23, 59, 59, 999)
  return out
}
