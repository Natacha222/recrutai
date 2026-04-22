import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { FiltersReset, SelectFilter } from '@/components/TableFilters'
import FlottementRow from './FlottementRow'

// Rendu dynamique forcé : dès qu'on qualifie / rejette une candidature, la
// revalidation la retire de la liste. On ne veut pas de version cachée qui
// la ferait réapparaître.
export const dynamic = 'force-dynamic'

// Largeur de la bande de flottement autour du seuil de l'offre. Doit rester
// alignée avec le calcul du KPI `tauxFlottement` côté dashboard — sinon on
// aurait un écart entre le pourcentage affiché et la taille de la liste.
const FLOTTEMENT_WIDTH = 5

type CandidatureRow = {
  id: string
  nom: string
  email: string | null
  score_ia: number | null
  statut: string | null
  justification_ia: string | null
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

export default async function FlottementPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const { ref = '' } = await searchParams
  const supabase = await createClient()

  // Comme sur /candidatures/incompletes, on fetch toutes les candidatures
  // scorées et on applique le même filtre côté JS que le KPI du dashboard
  // pour garder une cohérence parfaite entre le chiffre (5 %) et la liste.
  const { data: rows } = await supabase
    .from('candidatures')
    .select(
      'id, nom, email, score_ia, statut, justification_ia, cv_url, created_at, offres(id, titre, reference, seuil, am_referent)'
    )
    .not('score_ia', 'is', null)
    .order('created_at', { ascending: false })

  type Enriched = CandidatureRow & {
    _score: number
    _offre: {
      id: string
      titre: string
      reference: string | null
      seuil: number
      am_referent: string | null
    } | null
  }

  const allFlottement: Enriched[] = ((rows ?? []) as CandidatureRow[])
    .map((c) => {
      const offre = Array.isArray(c.offres)
        ? (c.offres[0] ?? null)
        : (c.offres ?? null)
      // Seuil par défaut côté code = 60 (cohérent avec le dashboard et la
      // création d'offre).
      const seuil = offre?.seuil ?? 60
      return {
        ...c,
        _score: c.score_ia as number, // non-null garanti par le filtre SQL
        _offre: offre
          ? {
              id: offre.id,
              titre: offre.titre,
              reference: offre.reference,
              seuil,
              am_referent: offre.am_referent,
            }
          : null,
      }
    })
    .filter((c) => c._offre !== null)
    .filter((c) => Math.abs(c._score - c._offre!.seuil) <= FLOTTEMENT_WIDTH)
    // On ne montre que les candidatures qui attendent encore une décision :
    // les « qualifié » et « rejeté » (automatiquement ou manuellement) ont
    // déjà été tranchés et ne doivent plus polluer la liste. Garde la
    // cohérence avec le KPI du dashboard qui utilise la même logique.
    .filter((c) => c.statut !== 'qualifié' && c.statut !== 'rejeté')

  // Liste des référents distincts dans la sélection (avant filtre).
  const amReferents = Array.from(
    new Set(
      allFlottement
        .map((c) => c._offre?.am_referent)
        .filter((r): r is string => !!r && r.trim() !== '')
    )
  ).sort((a, b) => a.localeCompare(b, 'fr'))

  const flottement = ref
    ? allFlottement.filter((c) => c._offre?.am_referent === ref)
    : allFlottement

  // Tri par score décroissant dans la bande : on voit d'abord les presque-
  // qualifiés (seuil+5), puis les en attente (seuil-5). Plus pratique
  // pour le recruteur qui scanne de haut en bas.
  const sorted = [...flottement].sort((a, b) => b._score - a._score)

  const totalAll = allFlottement.length
  const totalFiltered = sorted.length
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
          Candidatures en flottement
        </h1>
        <p className="text-sm text-muted mt-1">
          Candidats dont le score IA est à ±{FLOTTEMENT_WIDTH}&nbsp;pts du
          seuil de qualification de leur offre. Cas limites : un coup
          d&apos;œil au CV + à la justification, puis tu qualifies
          (email client envoyé) ou tu rejettes.
        </p>
      </div>

      {totalAll === 0 ? (
        <div className="bg-surface-alt rounded-xl p-8 border border-border-soft text-center">
          <p className="text-status-green font-semibold">
            Aucune candidature en flottement 🎉
          </p>
          <p className="text-sm text-muted mt-1">
            Tous les candidats scorés sont clairement au-dessus ou en
            dessous du seuil de leur offre.
          </p>
        </div>
      ) : (
        <div className="bg-surface-alt rounded-xl border border-border-soft overflow-x-auto">
          <div className="px-6 py-4 border-b border-border-soft flex items-center justify-between gap-3 flex-wrap">
            <h2 className="font-semibold">
              {hasFilter
                ? `${totalFiltered} résultat${totalFiltered > 1 ? 's' : ''} sur ${totalAll}`
                : `${totalAll} candidature${totalAll > 1 ? 's' : ''} à trancher`}
            </h2>
            <FiltersReset fields={FILTER_FIELDS} />
          </div>
          <table className="w-full">
            <thead className="bg-surface">
              <tr className="text-left text-xs font-semibold text-muted uppercase">
                <th className="px-4 pt-3 pb-2">CV</th>
                <th className="px-4 pt-3 pb-2">Offre</th>
                <th className="px-4 pt-3 pb-2">Référent</th>
                <th className="px-4 pt-3 pb-2">Candidat</th>
                <th className="px-4 pt-3 pb-2">Score / Seuil</th>
                <th className="px-4 pt-3 pb-2 w-1/3">Justification IA</th>
                <th className="px-4 pt-3 pb-2">Action</th>
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
                <th className="px-4 pt-0 pb-3"></th>
                <th className="px-4 pt-0 pb-3"></th>
                <th className="px-4 pt-0 pb-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-soft">
              {sorted.map((c) => {
                const offre = c._offre!
                return (
                  <FlottementRow
                    key={c.id}
                    id={c.id}
                    nom={c.nom ?? ''}
                    email={c.email}
                    scoreIa={c._score}
                    seuil={offre.seuil}
                    statut={c.statut ?? 'en attente'}
                    justificationIa={c.justification_ia}
                    cvUrl={c.cv_url}
                    offreId={offre.id}
                    offreTitre={offre.titre}
                    offreReference={offre.reference}
                    offreAmReferent={offre.am_referent}
                  />
                )
              })}
              {sorted.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-8 text-center text-muted text-sm"
                  >
                    Aucune candidature en flottement ne correspond à ce
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
