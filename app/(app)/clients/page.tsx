import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export default async function ClientsPage() {
  const supabase = await createClient()
  const { data: clients } = await supabase
    .from('clients')
    .select('id, nom, secteur, contact_email, created_at')
    .order('created_at', { ascending: false })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Clients</h1>
        <Link
          href="/clients/nouveau"
          className="px-4 py-2 bg-brand-purple text-white rounded-md text-sm font-semibold hover:opacity-90"
        >
          + Nouveau client
        </Link>
      </div>

      <div className="bg-surface-alt rounded-xl border border-border-soft overflow-hidden">
        <table className="w-full">
          <thead className="bg-surface">
            <tr className="text-left text-xs font-semibold text-muted uppercase">
              <th className="px-6 py-3">Nom</th>
              <th className="px-6 py-3">Secteur</th>
              <th className="px-6 py-3">Contact</th>
              <th className="px-6 py-3">Ajouté le</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-soft">
            {clients?.map((c) => (
              <tr key={c.id} className="text-sm">
                <td className="px-6 py-4 font-medium">{c.nom}</td>
                <td className="px-6 py-4 text-muted">{c.secteur ?? '—'}</td>
                <td className="px-6 py-4 text-muted">
                  {c.contact_email ?? '—'}
                </td>
                <td className="px-6 py-4 text-muted">
                  {new Date(c.created_at).toLocaleDateString('fr-FR')}
                </td>
              </tr>
            ))}
            {(!clients || clients.length === 0) && (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-muted">
                  Aucun client pour le moment.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
