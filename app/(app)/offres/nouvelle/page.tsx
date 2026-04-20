import { createClient } from '@/lib/supabase/server'
import OffreForm from './OffreForm'

type SearchParams = Promise<{ error?: string; client_id?: string }>

export default async function NouvelleOffrePage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const { error, client_id } = await searchParams
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

      <OffreForm
        clients={clients ?? []}
        initialClientId={client_id ?? ''}
      />
    </div>
  )
}
