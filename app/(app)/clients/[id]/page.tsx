import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { updateClient } from './actions'
import StatusBadge from '@/components/StatusBadge'
import { effectiveStatut, formatValidite } from '@/lib/format'

type Params = Promise<{ id: string }>
type SearchParams = Promise<{ error?: string }>

const FORMULES = ['Abonnement', 'À la mission', 'Volume entreprise']

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Params
  searchParams: SearchParams
}) {
  const { id } = await params
  const { error } = await searchParams
  const supabase = await createClient()

  const { data: client } = await supabase
    .from('clients')
    .select(
      'id, nom, secteur, contact_email, formule, am_referent, created_at'
    )
    .eq('id', id)
    .single()

  if (!client) notFound()

  const { data: offres } = await supabase
    .from('offres')
    .select('id, titre, lieu, statut, date_validite, created_at')
    .eq('client_id', id)
    .order('created_at', { ascending: false })

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href="/clients" className="text-sm text-muted hover:underline">
          ← Retour aux clients
        </Link>
        <h1 className="text-2xl font-bold mt-2">Fiche client</h1>
        <p className="text-sm text-muted mt-1">
          Ajouté le{' '}
          {new Date(client.created_at).toLocaleDateString('fr-FR')}
        </p>
      </div>

      {error && (
        <div className="px-3 py-2 rounded-md bg-status-red-bg text-status-red text-sm">
          {error}
        </div>
      )}

      <form
        action={updateClient}
        className="bg-surface-alt rounded-xl p-6 border border-border-soft space-y-4"
      >
        <input type="hidden" name="id" value={client.id} />

        <Field
          label="Nom de l'entreprise"
          name="nom"
          defaultValue={client.nom}
          required
        />
        <Field
          label="Secteur"
          name="secteur"
          defaultValue={client.secteur ?? ''}
        />
        <Field
          label="Email de notification"
          name="contact_email"
          type="email"
          defaultValue={client.contact_email ?? ''}
        />

        <div>
          <label
            htmlFor="formule"
            className="block text-sm font-medium text-brand-indigo-text mb-1"
          >
            Formule
          </label>
          <select
            id="formule"
            name="formule"
            defaultValue={client.formule ?? 'Abonnement'}
            className="w-full px-3 py-2 border border-border-soft rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-brand-purple"
          >
            {FORMULES.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>

        <Field
          label="AM référent"
          name="am_referent"
          defaultValue={client.am_referent ?? ''}
        />

        <div className="flex justify-end gap-3 pt-2">
          <Link
            href="/clients"
            className="px-4 py-2 border border-border-soft rounded-md text-sm hover:bg-surface"
          >
            Annuler
          </Link>
          <button
            type="submit"
            className="px-4 py-2 bg-brand-purple text-white rounded-md text-sm font-semibold hover:opacity-90"
          >
            Enregistrer les modifications
          </button>
        </div>
      </form>

      {/* Offres associées */}
      <div className="bg-surface-alt rounded-xl border border-border-soft overflow-hidden">
        <div className="px-6 py-4 border-b border-border-soft flex items-center justify-between gap-4">
          <h2 className="font-semibold">
            Offres associées ({offres?.length ?? 0})
          </h2>
          <Link
            href={`/offres/nouvelle?client_id=${client.id}`}
            className="px-3 py-1.5 bg-brand-purple text-white rounded-md text-xs font-semibold hover:opacity-90 whitespace-nowrap"
          >
            + Créer une offre d&apos;emploi
          </Link>
        </div>
        <ul className="divide-y divide-border-soft">
          {offres?.map((o) => (
            <li
              key={o.id}
              className="px-6 py-3 text-sm flex items-center justify-between gap-4"
            >
              <Link
                href={`/offres/${o.id}`}
                className="font-medium text-brand-indigo-text hover:text-brand-purple"
              >
                {o.titre}
              </Link>
              <div className="flex items-center gap-3 text-muted text-xs">
                <span>{o.lieu ?? '—'}</span>
                <span>
                  {o.date_validite
                    ? `Valide jusqu'au ${formatValidite(o.date_validite)}`
                    : '—'}
                </span>
                <StatusBadge
                  status={effectiveStatut(o.statut, o.date_validite)}
                />
              </div>
            </li>
          ))}
          {(!offres || offres.length === 0) && (
            <li className="px-6 py-6 text-center text-muted text-sm">
              Aucune offre pour ce client.
            </li>
          )}
        </ul>
      </div>
    </div>
  )
}

function Field({
  label,
  name,
  type = 'text',
  defaultValue = '',
  required = false,
}: {
  label: string
  name: string
  type?: string
  defaultValue?: string
  required?: boolean
}) {
  return (
    <div>
      <label
        htmlFor={name}
        className="block text-sm font-medium text-brand-indigo-text mb-1"
      >
        {label} {required && <span className="text-status-red">*</span>}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        className="w-full px-3 py-2 border border-border-soft rounded-md focus:outline-none focus:ring-2 focus:ring-brand-purple"
      />
    </div>
  )
}
