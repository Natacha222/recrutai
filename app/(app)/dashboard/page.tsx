import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import StatusBadge from '@/components/StatusBadge'

export default async function DashboardPage() {
  const supabase = await createClient()

  const [{ count: nbClients }, { count: nbOffres }, { count: nbCandidatures }] =
    await Promise.all([
      supabase.from('clients').select('*', { count: 'exact', head: true }),
      supabase.from('offres').select('*', { count: 'exact', head: true }),
      supabase.from('candidatures').select('*', { count: 'exact', head: true }),
    ])

  const { count: nbQualifies } = await supabase
    .from('candidatures')
    .select('*', { count: 'exact', head: true })
    .eq('statut', 'qualifié')

  const { data: recent } = await supabase
    .from('candidatures')
    .select('id, nom, email, score_ia, statut, created_at, offres(id, titre)')
    .order('created_at', { ascending: false })
    .limit(5)

  const kpis = [
    { label: 'Clients', value: nbClients ?? 0 },
    { label: 'Offres actives', value: nbOffres ?? 0 },
    { label: 'Candidatures reçues', value: nbCandidatures ?? 0 },
    { label: 'Candidats qualifiés', value: nbQualifies ?? 0 },
  ]

  const fmtDate = (iso: string) => {
    const d = new Date(iso)
    const jj = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const aaaa = d.getFullYear()
    return `${jj}/${mm}/${aaaa}`
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <div
            key={k.label}
            className="bg-surface-alt rounded-xl p-5 shadow-sm border border-border-soft"
          >
            <div className="text-sm text-muted font-medium">{k.label}</div>
            <div className="text-3xl font-bold text-brand-indigo-text mt-1">
              {k.value}
            </div>
          </div>
        ))}
      </div>

      {/* Activité récente */}
      <div className="bg-surface-alt rounded-xl border border-border-soft overflow-x-auto">
        <div className="px-6 py-4 border-b border-border-soft">
          <h2 className="font-semibold">Activité récente</h2>
          <p className="text-sm text-muted mt-0.5">
            Les 5 derniers CV scorés par l&apos;IA
          </p>
        </div>
        <table className="w-full">
          <thead className="bg-surface">
            <tr className="text-left text-xs font-semibold text-muted uppercase">
              <th className="px-6 py-3">Candidat</th>
              <th className="px-6 py-3">Offre</th>
              <th className="px-6 py-3">Score</th>
              <th className="px-6 py-3">Statut</th>
              <th className="px-6 py-3">Reçu le</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-soft">
            {recent?.map((c) => {
              const offreInfo = Array.isArray(c.offres)
                ? c.offres[0]
                : (c.offres as { id: string; titre: string } | null)
              return (
                <tr key={c.id} className="text-sm">
                  <td className="px-6 py-4">
                    <div className="font-medium">{c.nom}</div>
                    <div className="text-muted text-sm">{c.email}</div>
                  </td>
                  <td className="px-6 py-4">
                    {offreInfo ? (
                      <Link
                        href={`/offres/${offreInfo.id}`}
                        className="text-brand-purple font-medium hover:underline"
                      >
                        {offreInfo.titre}
                      </Link>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`font-bold ${
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
                  <td className="px-6 py-4">
                    <StatusBadge status={c.statut ?? 'en attente'} />
                  </td>
                  <td className="px-6 py-4 text-muted">
                    {fmtDate(c.created_at)}
                  </td>
                </tr>
              )
            })}
            {(!recent || recent.length === 0) && (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-muted">
                  Aucune activité récente.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
