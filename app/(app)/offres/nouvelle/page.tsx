import { createClient } from '@/lib/supabase/server'
import { referentFromEmail, todayIso } from '@/lib/format'
import { getAvailableReferents } from '@/lib/referents'
import OffreForm from './OffreForm'

type SearchParams = Promise<{ error?: string; client_id?: string }>

export default async function NouvelleOffrePage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const { error, client_id } = await searchParams
  const supabase = await createClient()

  // Chargements parallèles : liste de clients + utilisateur connecté.
  // La liste de référents (clients + offres + user connecté) est construite
  // ensuite via le helper dédié.
  const [clientsRes, userRes] = await Promise.all([
    supabase.from('clients').select('id, nom').order('nom'),
    supabase.auth.getUser(),
  ])

  const clients = clientsRes.data ?? []
  const currentUserEmail = userRes.data.user?.email ?? null
  const defaultReferent = referentFromEmail(currentUserEmail)

  // Union clients.am_referent + offres.am_referent + utilisateur connecté,
  // pour que l'user courant apparaisse dans le select même s'il n'a encore
  // jamais été référent sur aucune entité.
  const availableReferents = await getAvailableReferents(supabase, [
    defaultReferent,
  ])

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">Offre d&apos;emploi</h1>

      {error && (
        <div className="mb-4 px-3 py-2 rounded-md bg-status-red-bg text-status-red text-sm">
          {error}
        </div>
      )}

      <OffreForm
        clients={clients}
        initialClientId={client_id ?? ''}
        today={todayIso()}
        defaultReferent={defaultReferent}
        availableReferents={availableReferents}
      />
    </div>
  )
}
