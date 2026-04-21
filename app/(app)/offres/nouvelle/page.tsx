import { createClient } from '@/lib/supabase/server'
import { referentFromEmail, todayIso } from '@/lib/format'
import OffreForm from './OffreForm'

type SearchParams = Promise<{ error?: string; client_id?: string }>

export default async function NouvelleOffrePage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const { error, client_id } = await searchParams
  const supabase = await createClient()

  // Chargements parallèles : liste de clients + utilisateur connecté +
  // liste des référents existants (pour la modale de création de client).
  const [clientsRes, userRes, referentsRes] = await Promise.all([
    supabase.from('clients').select('id, nom').order('nom'),
    supabase.auth.getUser(),
    supabase.from('clients').select('am_referent'),
  ])

  const clients = clientsRes.data ?? []
  const currentUserEmail = userRes.data.user?.email ?? null
  const defaultReferent = referentFromEmail(currentUserEmail)

  // Ensemble des référents déjà normalisés en DB, trié en français.
  // On s'assure que le référent courant figure dans la liste même s'il
  // n'a encore géré aucun client.
  const referentsSet = new Set<string>(
    (referentsRes.data ?? [])
      .map((r) => r.am_referent)
      .filter((r): r is string => !!r && r.trim() !== '')
  )
  if (defaultReferent) referentsSet.add(defaultReferent)
  const availableReferents = Array.from(referentsSet).sort((a, b) =>
    a.localeCompare(b, 'fr')
  )

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
