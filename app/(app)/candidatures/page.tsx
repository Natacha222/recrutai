import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { FiltersReset, SelectFilter } from '@/components/TableFilters'
import StatusBadge from '@/components/StatusBadge'
import ResendEmailAction from '@/components/ResendEmailAction'
import TrancherActions from './TrancherActions'

/**
 * Liste globale des candidatures, filtrable par statut, référent et offre.
 * Accessible depuis le camembert du dashboard (clic sur une part = même
 * page avec ?statut=xxx pré-rempli).
 *
 * Pour chaque « en attente », on affiche la raison (scoring IA échoué,
 * infos candidat à compléter, sous le seuil, à trancher) + la
 * justification IA complète, pour que le recruteur puisse décider sans
 * ouvrir l'offre. Trois boutons inline via <TrancherActions> :
 *   - Qualifier / Rejeter (toujours)
 *   - Relancer le scoring (si le scoring IA a planté la 1re fois)
 * La qualification déclenche l'email client si l'offre est active
 * — exactement comme le workflow de la page offre.
 */

export const dynamic = 'force-dynamic'

// Statuts de la colonne `candidatures.statut`. Le select filtre affiche
// une option par entrée — ordre choisi pour que « En attente » (le plus
// actionnable) remonte en premier.
const STATUTS = ['en attente', 'qualifié', 'rejeté'] as const

const FILTER_FIELDS = ['statut', 'ref', 'offre_id']

type CandidatureRow = {
  id: string
  nom: string | null
  email: string | null
  score_ia: number | null
  statut: string | null
  created_at: string | null
  cv_url: string | null
  justification_ia: string | null
  /** Dernier envoi d'email réussi. NULL si jamais envoyé ou si le dernier
   *  essai a échoué — dans ce cas `email_error` contient le message. */
  email_sent_at: string | null
  /** Message d'erreur du dernier envoi échoué (Resend down, clé absente,
   *  pas de destinataire…). NULL si le dernier envoi est passé. */
  email_error: string | null
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

type SearchParams = Promise<{
  /** Filtre statut : 'qualifié' | 'en attente' | 'rejeté'. */
  statut?: string
  /** Filtre référent (offres.am_referent, format « F. NOM »). */
  ref?: string
  /** Filtre offre (offres.id en UUID). */
  offre_id?: string
}>

export default async function CandidaturesPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const { statut = '', ref = '', offre_id = '' } = await searchParams
  const supabase = await createClient()

  const { data: rows } = await supabase
    .from('candidatures')
    .select(
      'id, nom, email, score_ia, statut, created_at, cv_url, justification_ia, email_sent_at, email_error, offres(id, titre, reference, seuil, am_referent)'
    )
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

  const all: Enriched[] = ((rows ?? []) as CandidatureRow[]).map((c) => {
    const offre = Array.isArray(c.offres)
      ? (c.offres[0] ?? null)
      : (c.offres ?? null)
    return { ...c, _offre: offre }
  })

  // Options des selects — calculées AVANT le filtrage (pour que les
  // options disponibles ne se restreignent pas au fur et à mesure qu'on
  // filtre, sinon on peut plus revenir en arrière sans le bouton reset).
  const amReferents = Array.from(
    new Set(
      all
        .map((c) => c._offre?.am_referent)
        .filter((r): r is string => !!r && r.trim() !== '')
    )
  ).sort((a, b) => a.localeCompare(b, 'fr'))

  const offresOptions = Array.from(
    new Map(
      all
        .filter((c) => c._offre)
        .map((c) => [c._offre!.id, c._offre!.titre])
    ).entries()
  )
    .map(([id, titre]) => ({ id, titre }))
    .sort((a, b) => a.titre.localeCompare(b.titre, 'fr'))

  // Filtrage combiné — chaque filtre est ANDé.
  const filtered = all.filter((c) => {
    if (statut && c.statut !== statut) return false
    if (ref && c._offre?.am_referent !== ref) return false
    if (offre_id && c._offre?.id !== offre_id) return false
    return true
  })

  const totalAll = all.length
  const totalFiltered = filtered.length
  const hasFilter = !!statut || !!ref || !!offre_id

  const fmtDate = (iso: string | null) => {
    if (!iso) return '—'
    const d = new Date(iso)
    const jj = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    return `${jj}/${mm}/${d.getFullYear()}`
  }

  const scoreColor = (score: number | null, seuil: number | null) => {
    if (score === null) return 'text-muted'
    const s = seuil ?? 60
    if (score >= s) return 'text-status-green'
    if (score >= s - 15) return 'text-status-amber'
    return 'text-status-red'
  }

  /**
   * Libellé court qui résume POURQUOI une candidature « en attente »
   * n'a pas été tranchée automatiquement. Permet au recruteur de
   * comprendre d'un coup d'œil ce qu'il doit faire sans lire toute la
   * justification IA.
   */
  const raisonEnAttente = (
    c: Enriched,
    seuil: number | null
  ): { label: string; tone: 'red' | 'amber' | 'muted' } => {
    if (c.justification_ia?.startsWith('Scoring IA indisponible')) {
      return { label: 'Scoring IA échoué', tone: 'red' }
    }
    const missingName = !c.nom?.trim()
    const missingEmail =
      !c.email?.trim() || c.email.endsWith('@example.com')
    if (missingName || missingEmail) {
      return { label: 'Infos candidat à compléter', tone: 'amber' }
    }
    if (seuil !== null && c.score_ia !== null && c.score_ia < seuil) {
      return {
        label: `Sous le seuil (${c.score_ia}/${seuil})`,
        tone: 'amber',
      }
    }
    return { label: 'À trancher manuellement', tone: 'muted' }
  }

  // Libellé de page adapté au filtre statut actif, pour que le <h1> et le
  // <title> reflètent le sous-ensemble qu'on regarde.
  const pageTitle = statut
    ? statut === 'qualifié'
      ? 'Candidatures qualifiées'
      : statut === 'rejeté'
        ? 'Candidatures rejetées'
        : 'Candidatures en attente'
    : 'Toutes les candidatures'

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard"
          className="text-sm text-muted hover:underline"
        >
          ← Retour au dashboard
        </Link>
        <h1 className="text-2xl font-bold mt-2">{pageTitle}</h1>
        <p className="text-sm text-muted mt-1">
          Filtre par statut, référent ou offre. Clique sur une offre pour
          y retourner et qualifier / rejeter les candidatures.
        </p>
      </div>

      <div className="bg-surface-alt rounded-xl border border-border-soft overflow-x-auto">
        <div className="px-6 py-4 border-b border-border-soft flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-semibold">
            {hasFilter
              ? `${totalFiltered} résultat${totalFiltered > 1 ? 's' : ''} sur ${totalAll}`
              : `${totalAll} candidature${totalAll > 1 ? 's' : ''}`}
          </h2>
          <FiltersReset fields={FILTER_FIELDS} />
        </div>
        <table className="w-full">
          <thead className="bg-surface">
            <tr className="text-left text-xs font-semibold text-muted uppercase">
              <th scope="col" className="px-4 pt-3 pb-2">CV</th>
              <th scope="col" className="px-4 pt-3 pb-2">Candidat</th>
              <th scope="col" className="px-4 pt-3 pb-2">Score</th>
              <th scope="col" className="px-4 pt-3 pb-2">Statut</th>
              <th scope="col" className="px-4 pt-3 pb-2">Justification IA</th>
              <th scope="col" className="px-4 pt-3 pb-2">Offre</th>
              <th scope="col" className="px-4 pt-3 pb-2">Référent</th>
              <th scope="col" className="px-4 pt-3 pb-2">Date</th>
              <th scope="col" className="px-4 pt-3 pb-2">Action</th>
            </tr>
            <tr className="align-top">
              <th className="px-4 pt-0 pb-3"></th>
              <th className="px-4 pt-0 pb-3"></th>
              <th className="px-4 pt-0 pb-3"></th>
              <th className="px-4 pt-0 pb-3 font-normal normal-case">
                <SelectFilter
                  field="statut"
                  options={[...STATUTS]}
                  placeholder="Tous"
                />
              </th>
              <th className="px-4 pt-0 pb-3"></th>
              <th className="px-4 pt-0 pb-3 font-normal normal-case">
                <SelectFilter
                  field="offre_id"
                  options={offresOptions.map((o) => o.id)}
                  labels={Object.fromEntries(
                    offresOptions.map((o) => [o.id, o.titre])
                  )}
                  placeholder="Toutes"
                />
              </th>
              <th className="px-4 pt-0 pb-3 font-normal normal-case">
                <SelectFilter
                  field="ref"
                  options={amReferents}
                  placeholder="Tous"
                />
              </th>
              <th className="px-4 pt-0 pb-3"></th>
              <th className="px-4 pt-0 pb-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-soft">
            {filtered.map((c) => {
              const offre = c._offre
              const hasRealEmail =
                !!c.email?.trim() && !c.email.endsWith('@example.com')
              const isEnAttente = c.statut === 'en attente'
              const scoringFailed =
                c.justification_ia?.startsWith('Scoring IA indisponible') ??
                false
              const raison = isEnAttente
                ? raisonEnAttente(c, offre?.seuil ?? null)
                : null
              const raisonClass =
                raison?.tone === 'red'
                  ? 'text-status-red'
                  : raison?.tone === 'amber'
                    ? 'text-status-amber'
                    : 'text-muted'
              return (
                <tr key={c.id} className="text-sm align-top">
                  <td className="px-4 py-3">
                    {c.cv_url ? (
                      <a
                        href={c.cv_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-brand-purple text-brand-purple text-xs font-semibold hover:bg-brand-purple hover:text-white transition-colors w-fit whitespace-nowrap"
                      >
                        <span aria-hidden="true">📄</span> CV
                      </a>
                    ) : (
                      <span className="text-muted" aria-label="Non renseigné">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 min-w-0">
                    <div className="font-medium">{c.nom?.trim() || '—'}</div>
                    {hasRealEmail ? (
                      <a
                        href={`mailto:${c.email}`}
                        className="text-xs text-brand-purple hover:underline"
                      >
                        {c.email}
                      </a>
                    ) : (
                      <div className="text-xs text-muted italic">
                        email non extrait
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span
                      className={`font-bold text-lg ${scoreColor(c.score_ia, offre?.seuil ?? null)}`}
                    >
                      {c.score_ia ?? '—'}
                    </span>
                    {offre?.seuil != null && c.score_ia != null && (
                      <span className="text-xs text-muted">
                        {' '}
                        / {offre.seuil}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={c.statut ?? 'en attente'} />
                    {raison && (
                      <div
                        className={`text-xs mt-1 font-medium ${raisonClass}`}
                      >
                        {raison.label}
                      </div>
                    )}
                    {/* Alerte + relance : candidature qualifiée mais le
                        dernier envoi email a échoué. Inline sous le badge
                        statut pour que l'AM voie les deux d'un coup d'œil
                        (le candidat est bien passé mais le client n'a
                        pas encore été notifié). */}
                    {c.statut === 'qualifié' && c.email_error && (
                      <ResendEmailAction
                        candidatureId={c.id}
                        emailError={c.email_error}
                        size="sm"
                      />
                    )}
                  </td>
                  <td className="px-4 py-3 max-w-md min-w-[16rem]">
                    {c.justification_ia?.trim() ? (
                      <p
                        className="text-xs text-muted leading-relaxed line-clamp-4"
                        title={c.justification_ia}
                      >
                        {c.justification_ia}
                      </p>
                    ) : (
                      <span className="text-muted text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 min-w-0">
                    {offre ? (
                      <>
                        <Link
                          href={`/offres/${offre.id}`}
                          className="text-brand-purple hover:underline font-medium"
                        >
                          {offre.titre}
                        </Link>
                        {offre.reference && (
                          <div className="text-xs text-muted font-mono mt-0.5">
                            Réf. {offre.reference}
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="text-muted" aria-label="Non renseigné">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted whitespace-nowrap">
                    {offre?.am_referent ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-muted text-xs tabular-nums whitespace-nowrap">
                    {fmtDate(c.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    {isEnAttente ? (
                      <TrancherActions
                        candidatureId={c.id}
                        scoringFailed={scoringFailed}
                      />
                    ) : (
                      <span className="text-muted text-xs">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={9}
                  className="px-4 py-8 text-center text-muted text-sm"
                >
                  {totalAll === 0
                    ? 'Aucune candidature pour le moment.'
                    : 'Aucune candidature ne correspond aux filtres.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
