import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import StatusBadge from '@/components/StatusBadge'

export default async function OffresPage() {
  const supabase = await createClient()

  const { data: offres } = await supabase
    .from('offres')
    .select(
      'id, titre, lieu, statut, created_at, clients(nom), candidatures(id, statut)'
    )
    .order('created_at', { ascending: false })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Offres d&apos;emploi</h1>
        <Link
          href="/offres/nouvelle"
          className="px-4 py-2 bg-brand-purple text-white rounded-md text-sm font-semibold hover:opacity-90"
        >
          + Nouvelle offre
        </Link>
      </div>

      <div className="bg-surface-alt rounded-xl border border-border-soft overflow-hidden">
        <table className="w-full">
          <thead className="bg-surface">
            <tr className="text-left text-xs font-semibold text-muted uppercase">
              <th className="px-6 py-3">Titre</th>
              <th className="px-6 py-3">Client</th>
              <th className="px-6 py-3">Lieu</th>
              <th className="px-6 py-3">CV reçus / Qualifiés</th>
              <th className="px-6 py-3">Statut</th>
              <th className="px-6 py-3">Créée le</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-soft">
            {offres?.map((o) => {
              const total = o.candidatures?.length ?? 0
              const qualifies =
                o.candidatures?.filter((c) => c.statut === 'qualifié').length ??
                0
              const clientNom = Array.isArray(o.clients)
                ? o.clients[0]?.nom
                : (o.clients as { nom: string } | null)?.nom
              return (
                <tr key={o.id} className="text-sm">
                  <td className="px-6 py-4 font-medium">
                    <Link
                      href={`/offres/${o.id}`}
                      className="hover:text-brand-purple"
                    >
                      {o.titre}
                    </Link>
                  </td>
                  <td className="px-6 py-4 text-muted">{clientNom ?? '—'}</td>
                  <td className="px-6 py-4 text-muted">{o.lieu ?? '—'}</td>
                  <td className="px-6 py-4 font-semibold">
                    {total} · <span className="text-status-green">{qualifies}</span>
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={o.statut ?? 'actif'} />
                  </td>
                  <td className="px-6 py-4 text-muted">
                    {new Date(o.created_at).toLocaleDateString('fr-FR')}
                  </td>
                </tr>
              )
            })}
            {(!offres || offres.length === 0) && (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-muted">
                  Aucune offre pour le moment.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
