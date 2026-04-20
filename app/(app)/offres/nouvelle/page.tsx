import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createOffre } from './actions'

type SearchParams = Promise<{ error?: string }>

export default async function NouvelleOffrePage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const { error } = await searchParams
  const supabase = await createClient()
  const { data: clients } = await supabase
    .from('clients')
    .select('id, nom')
    .order('nom')

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">Offre d&apos;emploi</h1>

      {error && (
        <div className="mb-4 px-3 py-2 rounded-md bg-status-red-bg text-status-red text-sm">
          {error}
        </div>
      )}

      <form
        action={createOffre}
        className="bg-surface-alt rounded-xl p-6 border border-border-soft space-y-4"
      >
        <div>
          <label
            htmlFor="titre"
            className="block text-sm font-medium text-brand-indigo-text mb-1"
          >
            Titre du poste <span className="text-status-red">*</span>
          </label>
          <input
            id="titre"
            name="titre"
            type="text"
            required
            className="w-full px-3 py-2 border border-border-soft rounded-md focus:outline-none focus:ring-2 focus:ring-brand-purple"
          />
        </div>

        <div>
          <label
            htmlFor="client_id"
            className="block text-sm font-medium text-brand-indigo-text mb-1"
          >
            Client <span className="text-status-red">*</span>
          </label>
          <select
            id="client_id"
            name="client_id"
            required
            className="w-full px-3 py-2 border border-border-soft rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-brand-purple"
          >
            <option value="">— Sélectionnez un client —</option>
            {clients?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nom}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="lieu"
            className="block text-sm font-medium text-brand-indigo-text mb-1"
          >
            Lieu
          </label>
          <input
            id="lieu"
            name="lieu"
            type="text"
            className="w-full px-3 py-2 border border-border-soft rounded-md focus:outline-none focus:ring-2 focus:ring-brand-purple"
          />
        </div>

        <div>
          <label
            htmlFor="description"
            className="block text-sm font-medium text-brand-indigo-text mb-1"
          >
            Description du poste
          </label>
          <textarea
            id="description"
            name="description"
            rows={8}
            className="w-full px-3 py-2 border border-border-soft rounded-md focus:outline-none focus:ring-2 focus:ring-brand-purple"
          />
        </div>

        <div className="flex justify-between items-center pt-2">
          <button
            type="button"
            className="px-4 py-2 bg-brand-purple-soft text-brand-purple rounded-md text-sm font-semibold hover:opacity-90"
            disabled
          >
            📎 Joindre des CVs
          </button>
          <div className="flex gap-3">
            <Link
              href="/offres"
              className="px-4 py-2 border border-border-soft rounded-md text-sm hover:bg-surface"
            >
              Annuler
            </Link>
            <button
              type="submit"
              className="px-4 py-2 bg-brand-purple text-white rounded-md text-sm font-semibold hover:opacity-90"
            >
              Enregistrer l&apos;offre d&apos;emploi
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
