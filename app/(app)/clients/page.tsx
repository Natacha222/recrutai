import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import FormuleBadge from '@/components/FormuleBadge'
import ClickableRow from '@/components/ClickableRow'

type SearchParams = Promise<{ saved?: string; error?: string }>

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const { saved, error } = await searchParams
  const supabase = await createClient()
  const { data: clients } = await supabase
    .from('clients')
    .select(
      'id, nom, secteur, contact_email, formule, am_referent, created_at, offres(id, statut)'
    )
    .order('nom', { ascending: true })

  const total = clients?.length ?? 0
  const subtitle =
    total > 1
      ? `${total} entreprises gérées par l'équipe`
      : `${total} entreprise gérée par l'équipe`

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Clients</h1>
          <p className="text-sm text-muted mt-1">{subtitle}</p>
        </div>
        <Link
          href="/clients/nouveau"
          className="px-4 py-2 bg-brand-purple text-white rounded-md text-sm font-semibold hover:opacity-90"
        >
          + Nouveau client
        </Link>
      </div>

      {saved && (
        <div className="mb-4 px-3 py-2 rounded-md bg-status-green-bg text-status-green text-sm">
          Client «&nbsp;{saved}&nbsp;» mis à jour.
        </div>
      )}

      {error && (
        <div className="mb-4 px-3 py-2 rounded-md bg-status-red-bg text-status-red text-sm">
          {error}
        </div>
      )}

      <div className="bg-surface-alt rounded-xl border border-border-soft overflow-hidden">
        <table className="w-full">
          <thead className="bg-surface">
            <tr className="text-left text-xs font-semibold text-muted uppercase">
              <th className="px-6 py-3">Entreprise</th>
              <th className="px-6 py-3">Formule</th>
              <th className="px-6 py-3">Secteur</th>
              <th className="px-6 py-3">Offres actives</th>
              <th className="px-6 py-3">AM référent</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-soft">
            {clients?.map((c) => {
              const offresList = Array.isArray(c.offres) ? c.offres : []
              const offresActives = offresList.filter(
                (o) => o.statut === 'actif'
              ).length
              return (
                <ClickableRow
                  key={c.id}
                  href={`/clients/${c.id}`}
                  className="text-sm hover:bg-surface transition align-top"
                >
                  <td className="px-6 py-5">
                    <Link
                      href={`/clients/${c.id}`}
                      className="font-semibold text-brand-indigo-text hover:text-brand-purple"
                    >
                      {c.nom}
                    </Link>
                    {c.contact_email && (
                      <div className="text-xs text-brand-purple mt-1">
                        {c.contact_email}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-5">
                    <FormuleBadge formule={c.formule} />
                  </td>
                  <td className="px-6 py-5 text-muted">
                    {c.secteur ?? '—'}
                  </td>
                  <td className="px-6 py-5">
                    <span className="font-bold text-brand-purple text-base">
                      {offresActives}
                    </span>
                  </td>
                  <td className="px-6 py-5 text-muted">
                    {c.am_referent ?? '—'}
                  </td>
                </ClickableRow>
              )
            })}
            {(!clients || clients.length === 0) && (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-muted">
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
