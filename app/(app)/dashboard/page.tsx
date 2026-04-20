import { createClient } from '@/lib/supabase/server'

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

  const kpis = [
    { label: 'Clients', value: nbClients ?? 0 },
    { label: 'Offres actives', value: nbOffres ?? 0 },
    { label: 'Candidatures reçues', value: nbCandidatures ?? 0 },
    { label: 'Candidats qualifiés', value: nbQualifies ?? 0 },
  ]

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>

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
    </div>
  )
}
