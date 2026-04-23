import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { FiltersReset, SelectFilter } from '@/components/TableFilters'
import IncompleteRow from './IncompleteRow'

// Rendu dynamique forcé : même raison que le dashboard — dès qu'une
// candidature est corrigée via updateCandidatureInfo, la revalidation
// retire sa ligne. On ne veut pas que Next.js serve une version en cache
// qui la ferait réapparaître.
export const dynamic = 'force-dynamic'

type CandidatureRow = {
  id: string
  nom: string
  email: string | null
  score_ia: number | null
  cv_url: string | null
  created_at: string | null
  offres:
    | {
        id: string
        titre: string
        reference: string | null
        seuil: number | null
        am_referent: string | null
      }
    | {
        id: string
        titre: string
        reference: string | null
        seuil: number | null
        am_referent: string | null
      }[]
    | null
}

const FILTER_FIELDS = ['ref']

type SearchParams = Promise<{
  /** Nom du référent de l'offre (am_referent, format « F. NOM »). */
  ref?: string
}>

export default async function IncompletesPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const { ref = '' } = await searchParams
  const supabase = await createClient()

  // On fetch toutes les candidatures scorées puis on filtre côté JS avec la
  // MÊME logique que le KPI du dashboard, pour garantir la cohérence du
  // nombre (un écart entre le KPI et la liste serait très déroutant). Le
  // volume reste raisonnable tant qu'on est sur quelques milliers de
  // candidatures — à basculer en SQL agrégé si ça grossit.
  const { data: rows } = await supabase
    .from('candidatures')
    .select(
      'id, nom, email, score_ia, cv_url, created_at, offres(id, titre, reference, seuil, am_referent)'
    )
    .not('score_ia', 'is', null)
    .order('created_at', { ascending: false })

  type Enriched = CandidatureRow & {
    _offre: {
      id: string
      titre: string
      reference: string | null
      seuil: number | null
      am_referent: string | null
    } | null
  }

  const allIncompletes: Enriched[] = ((rows ?? []) as CandidatureRow[])
    .filter((c) => {
      const hasNom = !!c.nom?.trim()
      const hasEmail =
        !!c.email?.trim() && !c.email.endsWith('@example.com')
      return !hasNom || !hasEmail
    })
    .map((c) => ({
      ...c,
      _offre: Array.isArray(c.offres) ? (c.offres[0] ?? null) : c.offres,
    }))
    .filter((c) => c._offre !== null) // on ignore les orphelines (offre supprimée)

  // Liste des référents distincts présents dans la sélection (avant filtre),
  // pour peupler le <select>. Si un seul référent apparaît, le select n'a
  // pas vraiment d'intérêt mais on le garde pour la cohérence visuelle.
  const amReferents = Array.from(
    new Set(
      allIncompletes
        .map((c) => c._offre?.am_referent)
        .filter((r): r is string => !!r && r.trim() !== '')
    )
  ).sort((a, b) => a.localeCompare(b, 'fr'))

  // Applique le filtre référent côté serveur.
  const incompletes = ref
    ? allIncompletes.filter((c) => c._offre?.am_referent === ref)
    : allIncompletes

  const totalAll = allIncompletes.length
  const totalFiltered = incompletes.length
  const hasFilter = !!ref

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard"
          className="text-sm text-muted hover:underline"
        >
          ← Retour au dashboard
        </Link>
        <h1 className="text-2xl font-bold mt-2">
          Candidatures incomplètes
        </h1>
        <p className="text-sm text-muted mt-1">
          CV scorés pour lesquels l&apos;IA n&apos;a pas pu extraire un nom ou
          un email réel. Ouvre le PDF, relève les infos à la main, puis
          enregistre : si l&apos;offre est toujours active, le CV est
          re-scoré automatiquement et un email est envoyé au client si le
          nouveau score atteint le seuil.
        </p>
      </div>

      {totalAll === 0 ? (
        <div className="bg-surface-alt rounded-xl p-8 border border-border-soft text-center">
          <p className="text-status-green font-semibold">
            Aucune candidature incomplète 🎉
          </p>
          <p className="text-sm text-muted mt-1">
            L&apos;IA a bien extrait le nom et l&apos;email de tous les CVs
            scorés.
          </p>
        </div>
      ) : (
        <div className="bg-surface-alt rounded-xl border border-border-soft overflow-x-auto">
          <div className="px-6 py-4 border-b border-border-soft flex items-center justify-between gap-3 flex-wrap">
            <h2 className="font-semibold">
              {hasFilter
                ? `${totalFiltered} résultat${totalFiltered > 1 ? 's' : ''} sur ${totalAll}`
                : `${totalAll} candidature${totalAll > 1 ? 's' : ''} à compléter`}
            </h2>
            <FiltersReset fields={FILTER_FIELDS} />
          </div>
          <table className="w-full">
            <thead className="bg-surface">
              <tr className="text-left text-xs font-semibold text-muted uppercase">
                <th scope="col" className="px-4 pt-3 pb-2">CV</th>
                <th scope="col" className="px-4 pt-3 pb-2">Offre</th>
                <th scope="col" className="px-4 pt-3 pb-2">Référent</th>
                <th scope="col" className="px-4 pt-3 pb-2">Score IA</th>
                <th scope="col" className="px-4 pt-3 pb-2" colSpan={2}>
                  Nom et email à corriger
                </th>
              </tr>
              <tr className="align-top">
                <th className="px-4 pt-0 pb-3"></th>
                <th className="px-4 pt-0 pb-3"></th>
                <th className="px-4 pt-0 pb-3 font-normal normal-case">
                  <SelectFilter
                    field="ref"
                    options={amReferents}
                    placeholder="Tous"
                  />
                </th>
                <th className="px-4 pt-0 pb-3"></th>
                <th className="px-4 pt-0 pb-3" colSpan={2}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-soft">
              {incompletes.map((c) => {
                const offre = c._offre!
                const emailIsPlaceholder = !!c.email?.endsWith('@example.com')
                return (
                  <IncompleteRow
                    key={c.id}
                    id={c.id}
                    initialNom={c.nom ?? ''}
                    initialEmail={c.email ?? ''}
                    emailIsPlaceholder={emailIsPlaceholder}
                    scoreIa={c.score_ia}
                    seuil={offre.seuil}
                    cvUrl={c.cv_url}
                    offreId={offre.id}
                    offreTitre={offre.titre}
                    offreReference={offre.reference}
                    offreAmReferent={offre.am_referent}
                  />
                )
              })}
              {incompletes.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-muted text-sm"
                  >
                    Aucune candidature incomplète ne correspond à ce
                    référent.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
