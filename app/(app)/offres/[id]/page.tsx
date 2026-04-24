import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import StatusBadge from '@/components/StatusBadge'
import ResendEmailAction from '@/components/ResendEmailAction'
import JustificationIA from '@/components/JustificationIA'
import {
  formatValidite,
  effectiveStatut,
  isExpired,
  scoreColor,
} from '@/lib/format'
import {
  DateFilter,
  FiltersReset,
  SelectFilter,
  SortHeader,
  TextFilter,
} from '@/components/TableFilters'
import CVUploader from './CVUploader'
import CandidatureActions from './CandidatureActions'
import BackfillPointsButton from './BackfillPointsButton'

type CandidatureFilter = 'qualifié' | 'en attente' | 'rejeté'
const FILTERS: CandidatureFilter[] = ['qualifié', 'en attente', 'rejeté']

const CAND_FILTER_FIELDS = [
  'filter',
  'cand_q',
  'just_q',
  'recu_from',
  'sort',
  'dir',
]
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Champs triables du tableau des candidatures. Le tri par défaut (score_ia
// desc) est appliqué quand aucun `sort` n'est défini — on n'ajoute pas
// 'score' au record pour ne pas polluer l'URL avec un paramètre redondant
// qui redescend tout de suite en désactivé au prochain clic sur la même
// entête.
type CandSortField = 'candidat' | 'score' | 'statut' | 'date'

const CAND_SORT_FIELDS: Record<CandSortField, true> = {
  candidat: true,
  score: true,
  statut: true,
  date: true,
}

function normalizeCandSort(raw: string | undefined): CandSortField | '' {
  if (!raw) return ''
  return raw in CAND_SORT_FIELDS ? (raw as CandSortField) : ''
}

function normalizeCandDir(raw: string | undefined): 'asc' | 'desc' {
  return raw === 'desc' ? 'desc' : 'asc'
}

type Params = Promise<{ id: string }>
type SearchParams = Promise<{
  error?: string
  saved?: string
  /** Statut de candidature : qualifié | en attente | rejeté. */
  filter?: string
  /** Recherche texte sur nom + email du candidat. */
  cand_q?: string
  /** Recherche texte sur la justification IA. */
  just_q?: string
  /** YYYY-MM-DD — garde les candidatures reçues à cette date ou après. */
  recu_from?: string
  /** Tri : nom du champ trié (`candidat`, `score`, `statut`, `date`).
   *  Vide = tri par défaut (score IA desc, nulls en bas). */
  sort?: string
  /** Direction du tri : `asc` | `desc`. Ignoré sans `sort`. */
  dir?: string
}>

export default async function OffreDetailPage({
  params,
  searchParams,
}: {
  params: Params
  searchParams: SearchParams
}) {
  const { id } = await params
  const {
    error,
    saved,
    filter,
    cand_q = '',
    just_q = '',
    recu_from = '',
    sort,
    dir,
  } = await searchParams
  const activeFilter: CandidatureFilter | null = FILTERS.includes(
    filter as CandidatureFilter
  )
    ? (filter as CandidatureFilter)
    : null
  const candSortField = normalizeCandSort(sort)
  const candSortDir = normalizeCandDir(dir)
  // Ignore silencieusement une date mal formée (param URL corrompu) pour
  // ne pas casser la page — l'input type=date garantit le format ISO.
  const recuFromEffective = ISO_DATE_RE.test(recu_from) ? recu_from : ''
  const candQLower = cand_q.trim().toLowerCase()
  const justQLower = just_q.trim().toLowerCase()
  const supabase = await createClient()

  const { data: offre } = await supabase
    .from('offres')
    .select(
      'id, reference, titre, lieu, statut, seuil, date_validite, am_referent, pdf_path, clients(nom, secteur)'
    )
    .eq('id', id)
    .single()

  if (!offre) notFound()

  // Si l'offre a été créée depuis un import PDF, on génère une URL signée
  // courte durée (1h) pour afficher le bouton « Voir le PDF de l'offre ».
  // L'URL signée n'est valable que le temps d'un rendu de page, c'est
  // largement suffisant pour un clic ; le rafraîchissement de la page
  // en génère une nouvelle.
  let offrePdfUrl: string | null = null
  if (offre.pdf_path) {
    const { data: signed } = await supabase.storage
      .from('offres-pdf')
      .createSignedUrl(offre.pdf_path, 60 * 60)
    offrePdfUrl = signed?.signedUrl ?? null
  }

  // Pas de `.order()` côté SQL : le tri effectif est calculé en JS plus bas
  // pour supporter les colonnes non-triables par PostgREST (aucune ici mais
  // on garde la symétrie avec /candidatures) et appliquer un défaut
  // (score_ia desc, nulls en bas) quand aucun `sort` n'est dans l'URL.
  const { data: candidatures } = await supabase
    .from('candidatures')
    .select(
      'id, nom, email, score_ia, justification_ia, points_forts, points_faibles, statut, cv_url, created_at, email_sent_at, email_error'
    )
    .eq('offre_id', id)

  const total = candidatures?.length ?? 0
  const qualifies =
    candidatures?.filter((c) => c.statut === 'qualifié').length ?? 0
  const rejetes =
    candidatures?.filter((c) => c.statut === 'rejeté').length ?? 0
  const enAttente =
    candidatures?.filter((c) => c.statut === 'en attente').length ?? 0

  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0)

  // Filtres appliqués au tableau : combinaison du KPI (statut) + filtres de
  // colonne (recherche texte + date de réception). Toutes les conditions
  // sont cumulatives.
  const filteredCandidatures = (candidatures ?? []).filter((c) => {
    if (activeFilter && c.statut !== activeFilter) return false
    if (
      candQLower &&
      !`${c.nom ?? ''} ${c.email ?? ''}`.toLowerCase().includes(candQLower)
    ) {
      return false
    }
    if (
      justQLower &&
      !(c.justification_ia ?? '').toLowerCase().includes(justQLower)
    ) {
      return false
    }
    if (recuFromEffective) {
      // created_at est un timestamp ISO, les 10 premiers caractères donnent
      // la date YYYY-MM-DD qu'on compare lexicographiquement.
      const createdDate = (c.created_at ?? '').slice(0, 10)
      if (!createdDate || createdDate < recuFromEffective) return false
    }
    return true
  })

  // Tri : si l'utilisateur a cliqué sur une entête, on applique son choix.
  // Sinon on retombe sur le tri naturel « meilleur score en haut, nulls
  // relégués en bas » — c'était l'ancien `.order('score_ia', desc)` côté
  // SQL, on le reproduit ici pour que les listings non triés restent
  // actionnables (les candidats les plus pertinents d'abord).
  const frCmpCand = new Intl.Collator('fr', { sensitivity: 'base' }).compare
  const cmpScoreDesc = (
    a: { score_ia: number | null },
    b: { score_ia: number | null }
  ): number => {
    const aS = a.score_ia
    const bS = b.score_ia
    if (aS === null && bS === null) return 0
    if (aS === null) return 1
    if (bS === null) return -1
    return bS - aS
  }
  const sortedCandidatures = candSortField
    ? [...filteredCandidatures].sort((a, b) => {
        const mult = candSortDir === 'asc' ? 1 : -1
        switch (candSortField) {
          case 'candidat':
            return mult * frCmpCand(a.nom ?? '', b.nom ?? '')
          case 'statut':
            return mult * frCmpCand(a.statut ?? '', b.statut ?? '')
          case 'date': {
            const aD = a.created_at ?? ''
            const bD = b.created_at ?? ''
            return mult * (aD < bD ? -1 : aD > bD ? 1 : 0)
          }
          case 'score': {
            // Nulls poussés en fin de liste indépendamment du sens pour
            // ne pas cacher les candidats scorés derrière un paquet de
            // « — » en haut quand on tri desc.
            const aS = a.score_ia
            const bS = b.score_ia
            if (aS === null && bS === null) return 0
            if (aS === null) return 1
            if (bS === null) return -1
            return mult * (aS - bS)
          }
          default:
            return 0
        }
      })
    : [...filteredCandidatures].sort(cmpScoreDesc)
  const hasCandFilter = !!(
    activeFilter ||
    candQLower ||
    justQLower ||
    recuFromEffective
  )

  // Candidatures scorées avant l'arrivée des arrays `points_forts` /
  // `points_faibles` : elles ont un `justification_ia` mais des bullets
  // à NULL, donc l'UI retombe sur le bouton « Voir la justification IA »
  // au lieu d'afficher les points forts / faibles. On expose un bouton
  // one-shot pour backfiller ces lignes. On ignore les justifications
  // « Scoring IA indisponible » : celles-là nécessitent un vrai rescore,
  // le backfill ne ferait rien d'utile dessus.
  const missingPointsCount = (candidatures ?? []).filter(
    (c) =>
      c.points_forts === null &&
      typeof c.justification_ia === 'string' &&
      c.justification_ia.trim().length > 0 &&
      !c.justification_ia.startsWith('Scoring IA indisponible')
  ).length

  const clientInfo = Array.isArray(offre.clients)
    ? offre.clients[0]
    : (offre.clients as { nom: string; secteur: string } | null)

  // Statut effectif : une offre dont la date de validité est dépassée passe
  // automatiquement en « clos », même si la DB la liste comme « actif ».
  const effectiveOffreStatut = effectiveStatut(offre.statut, offre.date_validite)
  const autoClosed =
    offre.statut !== 'clos' && isExpired(offre.date_validite)

  // Construit un href KPI qui conserve les autres filtres de candidature
  // (texte, date) — seul le paramètre `filter` (statut) est remplacé.
  // On capture offre.id dans un const local car TypeScript ne propage pas
  // le narrowing de `notFound()` à travers la closure.
  const offreId = offre.id
  function kpiHref(statut: CandidatureFilter | null): string {
    const sp = new URLSearchParams()
    if (cand_q) sp.set('cand_q', cand_q)
    if (just_q) sp.set('just_q', just_q)
    if (recuFromEffective) sp.set('recu_from', recuFromEffective)
    if (statut) sp.set('filter', statut)
    // Préserve le tri actif : sans ça, cliquer sur un KPI « resetait » le
    // tri à son défaut (score IA desc), ce qui cassait le flow quand on
    // cherche par exemple les qualifiés triés par date.
    if (candSortField) {
      sp.set('sort', candSortField)
      sp.set('dir', candSortDir)
    }
    const qs = sp.toString()
    return qs ? `/offres/${offreId}?${qs}` : `/offres/${offreId}`
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/offres" className="text-sm text-muted hover:underline">
          ← Retour aux offres
        </Link>
        <div className="text-sm text-muted mt-2">
          {offre.reference && (
            <>
              <span className="font-mono font-semibold text-brand-purple">
                Réf. {offre.reference}
              </span>
              {' · '}
            </>
          )}
          {clientInfo?.nom}
          {offre.lieu ? ` · ${offre.lieu}` : ''}
          {offre.date_validite
            ? ` · Valide jusqu'au ${formatValidite(offre.date_validite)}`
            : ''}
          {offre.am_referent ? ` · Référent ${offre.am_referent}` : ''}
        </div>
        <div className="flex items-center gap-3 flex-wrap mt-1">
          <h1 className="text-2xl font-bold">{offre.titre}</h1>
          <StatusBadge status={effectiveOffreStatut} />
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            {offrePdfUrl && (
              <a
                href={offrePdfUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 border-2 border-brand-purple text-brand-purple rounded-md text-sm font-semibold hover:bg-brand-purple hover:text-white transition-colors"
              >
                <span aria-hidden="true">📄</span> Voir le PDF de l&apos;offre
              </a>
            )}
            <Link
              href={`/offres/${offre.id}/modifier`}
              className="px-3 py-2 bg-brand-purple text-white rounded-md text-sm font-semibold hover:opacity-90"
            >
              Voir / modifier l&apos;offre
            </Link>
          </div>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="px-3 py-2 rounded-md bg-status-red-bg text-status-red text-sm"
        >
          {error}
        </div>
      )}
      {saved && (
        <div
          role="status"
          className="px-3 py-2 rounded-md bg-status-green-bg text-status-green text-sm"
        >
          Modifications enregistrées.
        </div>
      )}
      {effectiveOffreStatut === 'clos' && (
        <div className="px-3 py-2 rounded-md bg-status-amber-bg text-status-amber text-sm">
          {autoClosed
            ? "Offre clôturée automatiquement : la date de validité est dépassée. Clique sur « Voir / modifier l'offre » pour la réactiver."
            : "Offre clôturée. Pour la réactiver, clique sur « Voir / modifier l'offre » et mets une date de validité dans le futur."}
        </div>
      )}

      {/* KPIs — cliquables pour filtrer le tableau des candidatures */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Kpi
          label="CV reçus"
          value={total}
          href={kpiHref(null)}
          active={activeFilter === null}
        />
        <Kpi
          label="CV qualifiés"
          value={qualifies}
          sub={`${pct(qualifies)}% du total`}
          color="text-status-green"
          href={kpiHref('qualifié')}
          active={activeFilter === 'qualifié'}
        />
        <Kpi
          label="En attente"
          value={enAttente}
          sub={`${pct(enAttente)}% du total`}
          color="text-status-amber"
          href={kpiHref('en attente')}
          active={activeFilter === 'en attente'}
        />
        <Kpi
          label="CV rejetés"
          value={rejetes}
          sub={`${pct(rejetes)}% du total`}
          color="text-status-red"
          href={kpiHref('rejeté')}
          active={activeFilter === 'rejeté'}
        />
        <Kpi
          label="Seuil de qualification"
          value={offre.seuil ?? 60}
          color="text-brand-purple"
        />
      </div>

      {/* Uploader CV — désactivé quand l'offre est clôturée (manuel ou auto) */}
      <CVUploader
        offreId={offre.id}
        disabled={effectiveOffreStatut === 'clos'}
      />

      {/* Candidatures — filtrables via les KPIs ou les colonnes.
          min-w-[960px] sur la table : en dessous de cette largeur le
          parent `overflow-x-auto` prend le relais et on scrolle
          horizontalement plutôt que de squeezer la Justification IA sur
          les autres colonnes (bug observé sur viewport < 1100 px). */}
      <div className="bg-surface-alt rounded-xl border border-border-soft overflow-x-auto">
        <div className="px-6 py-4 border-b border-border-soft flex items-start justify-between gap-3 flex-wrap">
          <h2 className="font-semibold pt-1">
            {hasCandFilter
              ? `${sortedCandidatures.length} résultat${
                  sortedCandidatures.length > 1 ? 's' : ''
                } sur ${total}`
              : `Candidatures reçues (${total})`}
          </h2>
          <div className="flex items-start gap-3 flex-wrap">
            {missingPointsCount > 0 && (
              <BackfillPointsButton
                offreId={offre.id}
                missingCount={missingPointsCount}
              />
            )}
            <FiltersReset fields={CAND_FILTER_FIELDS} />
          </div>
        </div>
        <table className="w-full min-w-[960px]">
          <thead className="bg-surface">
            <tr className="text-left text-xs font-semibold text-muted uppercase">
              <th scope="col" className="px-6 pt-3 pb-2">
                <SortHeader field="candidat" label="Candidat / Email" />
              </th>
              <th scope="col" className="px-6 pt-3 pb-2">
                <SortHeader field="score" label="Score IA" defaultDir="desc" />
              </th>
              <th scope="col" className="px-6 pt-3 pb-2 w-1/3">Justification IA</th>
              <th scope="col" className="px-6 pt-3 pb-2">
                <SortHeader field="statut" label="Statut" defaultDir="asc" />
              </th>
              <th scope="col" className="px-6 pt-3 pb-2">
                <SortHeader field="date" label="Reçu le" defaultDir="desc" />
              </th>
              <th scope="col" className="px-6 pt-3 pb-2">CV / Action</th>
            </tr>
            <tr className="align-top">
              <th className="px-6 pt-0 pb-3 font-normal normal-case">
                <TextFilter field="cand_q" placeholder="Nom ou email…" />
              </th>
              <th className="px-6 pt-0 pb-3"></th>
              <th className="px-6 pt-0 pb-3 font-normal normal-case">
                <TextFilter field="just_q" placeholder="Mot-clé…" />
              </th>
              <th className="px-6 pt-0 pb-3 font-normal normal-case">
                <SelectFilter
                  field="filter"
                  options={FILTERS}
                  placeholder="Tous"
                />
              </th>
              <th className="px-6 pt-0 pb-3 font-normal normal-case">
                <DateFilter field="recu_from" />
              </th>
              <th className="px-6 pt-0 pb-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-soft">
            {sortedCandidatures.map((c) => (
              <tr key={c.id} className="text-sm align-top">
                <td className="px-6 py-4">
                  <div className="font-medium">{c.nom}</div>
                  <div className="text-muted text-sm">{c.email}</div>
                </td>
                <td className="px-6 py-4">
                  <span
                    className={`font-bold text-lg ${scoreColor(c.score_ia, offre.seuil)}`}
                  >
                    {c.score_ia ?? '—'}
                  </span>
                  {offre.seuil != null && c.score_ia != null && (
                    <span className="text-xs text-muted">
                      {' '}
                      / {offre.seuil}
                    </span>
                  )}
                </td>
                <td className="px-6 py-4 text-sm max-w-md break-words">
                  <JustificationIA
                    pointsForts={c.points_forts}
                    pointsFaibles={c.points_faibles}
                    justification={c.justification_ia}
                  />
                </td>
                <td className="px-6 py-4">
                  <StatusBadge status={c.statut ?? 'en attente'} />
                  {/* Alerte + relance : dernier envoi email a échoué
                      (Resend, contact manquant…). Le filtre se base sur
                      `email_error` seul : cette colonne n'est posée QUE
                      quand on a tenté un envoi, elle identifie donc à la
                      fois les candidatures qualifiées (retry) et celles
                      rétrogradées en « en attente » par persistEmailResult
                      après échec (voir lib/email.ts). Inline sous le badge
                      statut pour que l'AM voie les deux d'un coup d'œil. */}
                  {c.email_error && (
                    <ResendEmailAction
                      candidatureId={c.id}
                      emailError={c.email_error}
                      size="md"
                    />
                  )}
                </td>
                <td className="px-6 py-4 text-muted">
                  {new Date(c.created_at).toLocaleDateString('fr-FR')}
                </td>
                <td className="px-6 py-4">
                  <div className="flex flex-col gap-2">
                    {c.cv_url ? (
                      <a
                        href={c.cv_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-brand-purple text-brand-purple text-sm font-semibold hover:bg-brand-purple hover:text-white transition-colors w-fit"
                      >
                        <span aria-hidden="true">📄</span> Voir le CV
                      </a>
                    ) : (
                      <span className="text-muted text-sm">—</span>
                    )}
                    {c.statut === 'en attente' && (
                      <CandidatureActions candidatureId={c.id} />
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {sortedCandidatures.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-muted">
                  {hasCandFilter
                    ? 'Aucune candidature ne correspond à ces filtres.'
                    : 'Aucune candidature reçue pour le moment.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Kpi({
  label,
  value,
  sub,
  color,
  href,
  active,
}: {
  label: string
  value: number
  sub?: string
  color?: string
  href?: string
  active?: boolean
}) {
  const base = `rounded-xl p-5 border transition-colors ${
    active
      ? 'bg-surface-alt border-brand-purple ring-2 ring-brand-purple/30'
      : 'bg-surface-alt border-border-soft'
  }`
  const inner = (
    <>
      <div className="text-sm text-muted font-medium">{label}</div>
      <div
        className={`text-3xl font-bold mt-1 ${color ?? 'text-brand-indigo-text'}`}
      >
        {value}
      </div>
      {sub && <div className="text-xs text-muted mt-1">{sub}</div>}
    </>
  )
  if (href) {
    return (
      <Link
        href={href}
        className={`${base} block hover:border-brand-purple hover:shadow-sm`}
      >
        {inner}
      </Link>
    )
  }
  return <div className={base}>{inner}</div>
}
