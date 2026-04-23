import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { referentFromUser, todayIso } from '@/lib/format'
import { getAvailableReferents } from '@/lib/referents'
import EditOffreForm from '../EditOffreForm'

type Params = Promise<{ id: string }>
type SearchParams = Promise<{ error?: string }>

export default async function ModifierOffrePage({
  params,
  searchParams,
}: {
  params: Params
  searchParams: SearchParams
}) {
  const { id } = await params
  const { error } = await searchParams
  const supabase = await createClient()

  const { data: offre } = await supabase
    .from('offres')
    .select(
      'id, reference, titre, description, lieu, contrat, seuil, date_validite, client_id, am_referent'
    )
    .eq('id', id)
    .single()

  if (!offre) notFound()

  // Mêmes dépendances que sur la fiche d'origine : liste des clients pour le
  // select, utilisateur connecté pour le fallback référent, liste des
  // référents existants (union clients + offres + user + valeur actuelle).
  const [{ data: clients }, userRes, availableReferents] = await Promise.all([
    supabase.from('clients').select('id, nom').order('nom'),
    supabase.auth.getUser(),
    getAvailableReferents(supabase, [offre.am_referent]),
  ])
  const defaultReferent = userRes.data.user
    ? referentFromUser(userRes.data.user)
    : null
  const today = todayIso()

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link
          href={`/offres/${offre.id}`}
          className="text-sm text-muted hover:underline"
        >
          ← Retour à l&apos;offre
        </Link>
        <h1 className="text-2xl font-bold mt-2">Modifier l&apos;offre</h1>
        <p className="text-sm text-muted mt-1">
          {offre.reference && (
            <>
              <span className="font-mono font-semibold text-brand-purple">
                Réf. {offre.reference}
              </span>
              {offre.titre ? ' · ' : ''}
            </>
          )}
          {offre.titre}
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="px-3 py-2 rounded-md bg-status-red-bg text-status-red text-sm"
        >
          {error}
        </div>
      )}

      <div className="bg-surface-alt rounded-xl border border-border-soft">
        <EditOffreForm
          offre={{
            id: offre.id,
            reference: offre.reference,
            titre: offre.titre,
            description: offre.description,
            lieu: offre.lieu,
            contrat: offre.contrat,
            seuil: offre.seuil,
            date_validite: offre.date_validite,
            client_id: offre.client_id,
            am_referent: offre.am_referent,
          }}
          clients={clients ?? []}
          today={today}
          defaultReferent={defaultReferent}
          availableReferents={availableReferents}
        />
      </div>
    </div>
  )
}
