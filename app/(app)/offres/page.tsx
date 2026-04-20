import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export default async function OffresPage() {
  const supabase = await createClient()

  const { data: offres } = await supabase
    .from('offres')
    .select(
      'id, titre, lieu, statut, contrat, seuil, created_at, clients(nom), candidatures(id, statut)'
    )
    .order('created_at', { ascending: false })

  const offresActives = offres?.filter((o) => o.statut === 'actif') ?? []
  const offresClos = offres?.filter((o) => o.statut === 'clos') ?? []

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Offres d&apos;emploi</h1>
          <p className="text-sm text-muted mt-1">
            {offresActives.length} offre
            {offresActives.length > 1 ? 's' : ''} active
            {offresActives.length > 1 ? 's' : ''} · {offresClos.length} offre
            {offresClos.length > 1 ? 's' : ''} clôturée
            {offresClos.length > 1 ? 's' : ''}
          </p>
        </div>
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
              <th className="px-6 py-3">Intitulé</th>
              <th className="px-6 py-3">Client</th>
              <th className="px-6 py-3">Contrat</th>
              <th className="px-6 py-3">CV reçus / Qualifiés</th>
              <th className="px-6 py-3">Seuil</th>
              <th className="px-6 py-3">Action</th>
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
                <tr key={o.id} className="text-sm hover:bg-surface transition align-top">
                  <td className="px-6 py-5">
                    <Link
                      href={`/offres/${o.id}`}
                      className="font-semibold text-brand-indigo-text hover:text-brand-purple"
                    >
                      {o.titre}
                    </Link>
                    {o.lieu && (
                      <div className="text-xs text-muted mt-1 flex items-center gap-1">
                        <span>📍</span>
                        <span>{o.lieu}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-5 text-muted">{clientNom ?? '—'}</td>
                  <td className="px-6 py-5 text-muted">{o.contrat ?? '—'}</td>
                  <td className="px-6 py-5 font-semibold">
                    {total} · {qualifies}
                  </td>
                  <td className="px-6 py-5">
                    <span className="font-bold text-brand-purple">
                      {o.seuil}
                    </span>
                  </td>
                  <td className="px-6 py-5">
                    <Link
                      href={`/offres/${o.id}`}
                      className="text-brand-purple text-sm font-medium hover:underline"
                    >
                      Voir →
                    </Link>
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
