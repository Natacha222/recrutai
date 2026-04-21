import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import StatusBadge from '@/components/StatusBadge'
import {
  formatValidite,
  effectiveStatut,
  isExpired,
  todayIso,
} from '@/lib/format'
import CVUploader from './CVUploader'
import CandidatureActions from './CandidatureActions'
import DeleteAllCandidaturesButton from './DeleteAllCandidaturesButton'
import EditOffreForm from './EditOffreForm'

type CandidatureFilter = 'qualifié' | 'en attente' | 'rejeté'
const FILTERS: CandidatureFilter[] = ['qualifié', 'en attente', 'rejeté']

type Params = Promise<{ id: string }>
type SearchParams = Promise<{
  error?: string
  saved?: string
  filter?: string
}>

export default async function OffreDetailPage({
  params,
  searchParams,
}: {
  params: Params
  searchParams: SearchParams
}) {
  const { id } = await params
  const { error, saved, filter } = await searchParams
  const activeFilter: CandidatureFilter | null = FILTERS.includes(
    filter as CandidatureFilter
  )
    ? (filter as CandidatureFilter)
    : null
  const supabase = await createClient()

  const { data: offre } = await supabase
    .from('offres')
    .select(
      'id, titre, description, lieu, statut, contrat, seuil, date_validite, client_id, clients(nom, secteur)'
    )
    .eq('id', id)
    .single()

  if (!offre) notFound()

  const { data: clients } = await supabase
    .from('clients')
    .select('id, nom')
    .order('nom')

  const { data: candidatures } = await supabase
    .from('candidatures')
    .select(
      'id, nom, email, score_ia, justification_ia, statut, cv_url, created_at'
    )
    .eq('offre_id', id)
    .order('score_ia', { ascending: false, nullsFirst: false })

  const total = candidatures?.length ?? 0
  const qualifies =
    candidatures?.filter((c) => c.statut === 'qualifié').length ?? 0
  const rejetes =
    candidatures?.filter((c) => c.statut === 'rejeté').length ?? 0
  const enAttente =
    candidatures?.filter((c) => c.statut === 'en attente').length ?? 0

  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0)

  // Filtre appliqué au tableau si l'utilisateur a cliqué sur un KPI
  const filteredCandidatures = activeFilter
    ? (candidatures ?? []).filter((c) => c.statut === activeFilter)
    : (candidatures ?? [])

  const clientInfo = Array.isArray(offre.clients)
    ? offre.clients[0]
    : (offre.clients as { nom: string; secteur: string } | null)

  // Statut effectif : une offre dont la date de validité est dépassée passe
  // automatiquement en « clos », même si la DB la liste comme « actif ».
  const effectiveOffreStatut = effectiveStatut(offre.statut, offre.date_validite)
  const autoClosed =
    offre.statut !== 'clos' && isExpired(offre.date_validite)
  const today = todayIso()

  return (
    <div className="space-y-6">
      <div>
        <Link href="/offres" className="text-sm text-muted hover:underline">
          ← Retour aux offres
        </Link>
        <div className="text-sm text-muted mt-2">
          {clientInfo?.nom}
          {offre.lieu ? ` · ${offre.lieu}` : ''}
          {offre.date_validite
            ? ` · Valide jusqu'au ${formatValidite(offre.date_validite)}`
            : ''}
        </div>
        <div className="flex items-center gap-3 flex-wrap mt-1">
          <h1 className="text-2xl font-bold">{offre.titre}</h1>
          <StatusBadge status={effectiveOffreStatut} />
        </div>
      </div>

      {error && (
        <div className="px-3 py-2 rounded-md bg-status-red-bg text-status-red text-sm">
          {error}
        </div>
      )}
      {saved && (
        <div className="px-3 py-2 rounded-md bg-status-green-bg text-status-green text-sm">
          Modifications enregistrées.
        </div>
      )}
      {effectiveOffreStatut === 'clos' && (
        <div className="px-3 py-2 rounded-md bg-status-amber-bg text-status-amber text-sm">
          {autoClosed
            ? 'Offre clôturée automatiquement : la date de validité est dépassée. Modifie-la ci-dessous pour la réactiver.'
            : "Offre clôturée. Pour la réactiver, mets une date de validité dans le futur ci-dessous."}
        </div>
      )}

      {/* KPIs — cliquables pour filtrer le tableau des candidatures */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Kpi
          label="CV reçus"
          value={total}
          href={`/offres/${offre.id}`}
          active={activeFilter === null}
        />
        <Kpi
          label="CV qualifiés"
          value={qualifies}
          sub={`${pct(qualifies)}% du total`}
          color="text-status-green"
          href={`/offres/${offre.id}?filter=qualifi%C3%A9`}
          active={activeFilter === 'qualifié'}
        />
        <Kpi
          label="En attente"
          value={enAttente}
          sub={`${pct(enAttente)}% du total`}
          color="text-status-amber"
          href={`/offres/${offre.id}?filter=en+attente`}
          active={activeFilter === 'en attente'}
        />
        <Kpi
          label="CV rejetés"
          value={rejetes}
          sub={`${pct(rejetes)}% du total`}
          color="text-status-red"
          href={`/offres/${offre.id}?filter=rejet%C3%A9`}
          active={activeFilter === 'rejeté'}
        />
        <Kpi
          label="Seuil de qualification"
          value={offre.seuil ?? 60}
          color="text-brand-purple"
        />
      </div>

      {/* Uploader CV — désactivé quand l'offre est clôturée (manuel ou auto) */}
      <CVUploader
        offreId={offre.id}
        disabled={effectiveOffreStatut === 'clos'}
      />

      {/* Candidatures — filtrables via les KPIs */}
      <div className="bg-surface-alt rounded-xl border border-border-soft overflow-hidden">
        <div className="px-6 py-4 border-b border-border-soft flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-semibold">
            {activeFilter
              ? `Candidatures « ${activeFilter} » (${filteredCandidatures.length})`
              : `Candidatures reçues (${total})`}
          </h2>
          <div className="flex items-center gap-3 flex-wrap">
            {activeFilter && (
              <Link
                href={`/offres/${offre.id}`}
                className="text-xs text-brand-purple hover:underline"
              >
                ← Voir toutes les candidatures
              </Link>
            )}
            {!activeFilter && (
              <DeleteAllCandidaturesButton offreId={offre.id} total={total} />
            )}
          </div>
        </div>
        <table className="w-full">
          <thead className="bg-surface">
            <tr className="text-left text-xs font-semibold text-muted uppercase">
              <th className="px-6 py-3">Candidat / Email</th>
              <th className="px-6 py-3">Score IA</th>
              <th className="px-6 py-3 w-1/3">Justification IA</th>
              <th className="px-6 py-3">Statut</th>
              <th className="px-6 py-3">Reçu le</th>
              <th className="px-6 py-3">CV / Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-soft">
            {filteredCandidatures.map((c) => (
              <tr key={c.id} className="text-sm align-top">
                <td className="px-6 py-4">
                  <div className="font-medium">{c.nom}</div>
                  <div className="text-muted text-xs">{c.email}</div>
                </td>
                <td className="px-6 py-4">
                  <span
                    className={`font-bold text-lg ${
                      (c.score_ia ?? 0) >= 70
                        ? 'text-status-green'
                        : (c.score_ia ?? 0) >= 50
                          ? 'text-status-amber'
                          : 'text-status-red'
                    }`}
                  >
                    {c.score_ia ?? '—'}
                  </span>
                </td>
                <td className="px-6 py-4 text-muted text-xs max-w-md">
                  {c.justification_ia}
                </td>
                <td className="px-6 py-4">
                  <StatusBadge status={c.statut ?? 'en attente'} />
                </td>
                <td className="px-6 py-4 text-muted">
                  {new Date(c.created_at).toLocaleDateString('fr-FR')}
                </td>
                <td className="px-6 py-4">
                  <div className="flex flex-col gap-2">
                    {c.cv_url ? (
                      <a
                        href={c.cv_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-brand-purple text-brand-purple text-xs font-semibold hover:bg-brand-purple hover:text-white transition-colors w-fit"
                      >
                        📄 Voir le CV
                      </a>
                    ) : (
                      <span className="text-muted text-xs">—</span>
                    )}
                    {c.statut === 'en attente' && (
                      <CandidatureActions candidatureId={c.id} />
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filteredCandidatures.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-muted">
                  {activeFilter
                    ? `Aucune candidature « ${activeFilter} ».`
                    : 'Aucune candidature reçue pour le moment.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Formulaire d'édition */}
      <div className="bg-surface-alt rounded-xl border border-border-soft">
        <div className="px-6 py-4 border-b border-border-soft">
          <h2 className="font-semibold">Modifier l&apos;offre</h2>
        </div>
        <EditOffreForm
          offre={{
            id: offre.id,
            titre: offre.titre,
            description: offre.description,
            lieu: offre.lieu,
            contrat: offre.contrat,
            seuil: offre.seuil,
            date_validite: offre.date_validite,
            client_id: offre.client_id,
          }}
          clients={clients ?? []}
          today={today}
        />
      </div>
    </div>
  )
}

function Kpi({
  label,
  value,
  sub,
  color,
  href,
  active,
}: {
  label: string
  value: number
  sub?: string
  color?: string
  href?: string
  active?: boolean
}) {
  const base = `rounded-xl p-5 border transition-colors ${
    active
      ? 'bg-surface-alt border-brand-purple ring-2 ring-brand-purple/30'
      : 'bg-surface-alt border-border-soft'
  }`
  const inner = (
    <>
      <div className="text-sm text-muted font-medium">{label}</div>
      <div
        className={`text-3xl font-bold mt-1 ${color ?? 'text-brand-indigo-text'}`}
      >
        {value}
      </div>
      {sub && <div className="text-xs text-muted mt-1">{sub}</div>}
    </>
  )
  if (href) {
    return (
      <Link
        href={href}
        className={`${base} block hover:border-brand-purple hover:shadow-sm`}
      >
        {inner}
      </Link>
    )
  }
  return <div className={base}>{inner}</div>
}
