import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
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
    | { id: string; titre: string; reference: string | null }
    | { id: string; titre: string; reference: string | null }[]
    | null
}

export default async function IncompletesPage() {
  const supabase = await createClient()

  // On fetch toutes les candidatures scorées puis on filtre côté JS avec la
  // MÊME logique que le KPI du dashboard, pour garantir la cohérence du
  // nombre (un écart entre le KPI et la liste serait très déroutant). Le
  // volume reste raisonnable tant qu'on est sur quelques milliers de
  // candidatures — à basculer en SQL agrégé si ça grossit.
  const { data: rows } = await supabase
    .from('candidatures')
    .select(
      'id, nom, email, score_ia, cv_url, created_at, offres(id, titre, reference)'
    )
    .not('score_ia', 'is', null)
    .order('created_at', { ascending: false })

  const incompletes = ((rows ?? []) as CandidatureRow[]).filter((c) => {
    const hasNom = !!c.nom?.trim()
    const hasEmail =
      !!c.email?.trim() && !c.email.endsWith('@example.com')
    return !hasNom || !hasEmail
  })

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

      {incompletes.length === 0 ? (
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
          <div className="px-6 py-4 border-b border-border-soft">
            <h2 className="font-semibold">
              {incompletes.length} candidature
              {incompletes.length > 1 ? 's' : ''} à compléter
            </h2>
          </div>
          <table className="w-full">
            <thead className="bg-surface">
              <tr className="text-left text-xs font-semibold text-muted uppercase">
                <th className="px-4 py-3">CV</th>
                <th className="px-4 py-3">Offre</th>
                <th className="px-4 py-3">Score IA</th>
                <th className="px-4 py-3" colSpan={2}>
                  Nom et email à corriger
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-soft">
              {incompletes.map((c) => {
                const offre = Array.isArray(c.offres) ? c.offres[0] : c.offres
                if (!offre) return null
                const emailIsPlaceholder = !!c.email?.endsWith('@example.com')
                return (
                  <IncompleteRow
                    key={c.id}
                    id={c.id}
                    initialNom={c.nom ?? ''}
                    initialEmail={c.email ?? ''}
                    emailIsPlaceholder={emailIsPlaceholder}
                    scoreIa={c.score_ia}
                    cvUrl={c.cv_url}
                    offreId={offre.id}
                    offreTitre={offre.titre}
                    offreReference={offre.reference}
                  />
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
