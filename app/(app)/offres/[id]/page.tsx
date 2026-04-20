import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import StatusBadge from '@/components/StatusBadge'

type Params = Promise<{ id: string }>

export default async function OffreDetailPage({ params }: { params: Params }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: offre } = await supabase
    .from('offres')
    .select(
      'id, titre, description, lieu, statut, created_at, clients(nom, secteur)'
    )
    .eq('id', id)
    .single()

  if (!offre) notFound()

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
  const rejetes = candidatures?.filter((c) => c.statut === 'rejeté').length ?? 0

  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0)

  const clientInfo = Array.isArray(offre.clients)
    ? offre.clients[0]
    : (offre.clients as { nom: string; secteur: string } | null)

  return (
    <div className="space-y-6">
      <div>
        <div className="text-sm text-muted mb-1">
          {clientInfo?.nom} · {offre.lieu}
        </div>
        <h1 className="text-2xl font-bold">{offre.titre}</h1>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Kpi label="CV reçus" value={total} />
        <Kpi
          label="CV qualifiés"
          value={qualifies}
          sub={`${pct(qualifies)}% du total`}
          color="text-status-green"
        />
        <Kpi
          label="CV rejetés"
          value={rejetes}
          sub={`${pct(rejetes)}% du total`}
          color="text-status-red"
        />
      </div>

      {/* Description */}
      <div className="bg-surface-alt rounded-xl p-6 border border-border-soft">
        <h2 className="font-semibold mb-3">Description du poste</h2>
        <p className="text-sm text-muted whitespace-pre-line">
          {offre.description ?? 'Aucune description.'}
        </p>
      </div>

      {/* Candidatures */}
      <div className="bg-surface-alt rounded-xl border border-border-soft overflow-hidden">
        <div className="px-6 py-4 border-b border-border-soft">
          <h2 className="font-semibold">
            Candidatures reçues ({total})
          </h2>
        </div>
        <table className="w-full">
          <thead className="bg-surface">
            <tr className="text-left text-xs font-semibold text-muted uppercase">
              <th className="px-6 py-3">Candidat / Email</th>
              <th className="px-6 py-3">Score IA</th>
              <th className="px-6 py-3 w-1/3">Justification IA</th>
              <th className="px-6 py-3">Statut</th>
              <th className="px-6 py-3">Reçu le</th>
              <th className="px-6 py-3">CV</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-soft">
            {candidatures?.map((c) => (
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
                  {c.cv_url ? (
                    <a
                      href={c.cv_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand-purple font-medium"
                    >
                      📄 CV
                    </a>
                  ) : (
                    <span className="text-muted text-xs">—</span>
                  )}
                </td>
              </tr>
            ))}
            {(!candidatures || candidatures.length === 0) && (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-muted">
                  Aucune candidature reçue pour le moment.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Kpi({
  label,
  value,
  sub,
  color,
}: {
  label: string
  value: number
  sub?: string
  color?: string
}) {
  return (
    <div className="bg-surface-alt rounded-xl p-5 border border-border-soft">
      <div className="text-sm text-muted font-medium">{label}</div>
      <div className={`text-3xl font-bold mt-1 ${color ?? 'text-brand-indigo-text'}`}>
        {value}
      </div>
      {sub && <div className="text-xs text-muted mt-1">{sub}</div>}
    </div>
  )
}
