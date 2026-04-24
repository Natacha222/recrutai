import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import {
  DateFilter,
  FiltersReset,
  SelectFilter,
  SortHeader,
  TextFilter,
} from '@/components/TableFilters'
import StatusBadge from '@/components/StatusBadge'
import ResendEmailAction from '@/components/ResendEmailAction'
import JustificationIA from '@/components/JustificationIA'
import { scoreColor } from '@/lib/format'
import CandidatureActions from '../offres/[id]/CandidatureActions'

/**
 * Liste globale des candidatures, filtrable par statut, référent et offre.
 * Accessible depuis le camembert du dashboard (clic sur une part = même
 * page avec ?statut=xxx pré-rempli).
 *
 * Pour chaque « en attente », on affiche la raison (scoring IA échoué,
 * sous le seuil, à trancher) + les points forts/faibles (dépliables via
 * JustificationIA) + les boutons Qualifier / Rejeter directement dans la
 * colonne Action. La qualification déclenche automatiquement l'envoi de
 * l'email au client avec le CV en pièce jointe (même flow que depuis la
 * fiche offre, via `qualifyCandidature`).
 */

export const dynamic = 'force-dynamic'

// Statuts de la colonne `candidatures.statut`. Le select filtre affiche
// une option par entrée — ordre choisi pour que « En attente » (le plus
// actionnable) remonte en premier.
const STATUTS = ['en attente', 'qualifié', 'rejeté'] as const

// Tous les paramètres URL (filtres + tri) que le bouton « Réinitialiser »
// doit purger pour remettre la table à son état par défaut.
const FILTER_FIELDS = [
  'statut',
  'ref',
  'offre_id',
  'candidat',
  'date',
  'ref_offre',
  'sort',
  'dir',
]

type SortField =
  | 'candidat'
  | 'date'
  | 'ref_offre'
  | 'ref'
  | 'offre'
  | 'statut'
  | 'score'

const SORT_FIELDS: Record<SortField, true> = {
  candidat: true,
  date: true,
  ref_offre: true,
  ref: true,
  offre: true,
  statut: true,
  score: true,
}

function normalizeSort(raw: string | undefined): SortField | '' {
  if (!raw) return ''
  return raw in SORT_FIELDS ? (raw as SortField) : ''
}

function normalizeDir(raw: string | undefined): 'asc' | 'desc' {
  return raw === 'desc' ? 'desc' : 'asc'
}

type CandidatureRow = {
  id: string
  nom: string | null
  email: string | null
  score_ia: number | null
  statut: string | null
  created_at: string | null
  cv_url: string | null
  justification_ia: string | null
  /** Décomposition structurée de la justification (3-5 items max par
   *  liste). NULL sur les candidatures scorées avant ce refactor — l'UI
   *  retombe alors sur `justification_ia` brut. */
  points_forts: string[] | null
  points_faibles: string[] | null
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
  /** Filtre libre sur le nom du candidat (contient, insensible à la casse). */
  candidat?: string
  /** Filtre date exacte de réception (created_at, YYYY-MM-DD). */
  date?: string
  /** Filtre libre sur la référence de l'offre (contient, insensible à la casse). */
  ref_offre?: string
  /** Tri : nom du champ trié (`candidat`, `date`, `ref_offre`, `ref`,
   *  `offre`, `statut`). Vide = tri serveur par défaut (created_at desc). */
  sort?: string
  /** Direction du tri : `asc` | `desc`. Ignoré sans `sort`. */
  dir?: string
}>

export default async function CandidaturesPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const sp = await searchParams
  const statut = sp.statut ?? ''
  const ref = sp.ref ?? ''
  const offre_id = sp.offre_id ?? ''
  const candidatQ = (sp.candidat ?? '').trim()
  const dateFilter = sp.date ?? ''
  const refOffreQ = (sp.ref_offre ?? '').trim()
  const sortField = normalizeSort(sp.sort)
  const sortDir = normalizeDir(sp.dir)
  const supabase = await createClient()

  const { data: rows } = await supabase
    .from('candidatures')
    .select(
      'id, nom, email, score_ia, statut, created_at, cv_url, justification_ia, points_forts, points_faibles, email_sent_at, email_error, offres(id, titre, reference, seuil, am_referent)'
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

  // Normalisation (minuscules, sans accents) pour les filtres « contient »
  // sur candidat et référence d'offre — cohérent avec normalizeClientName.
  const stripAccents = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
  const candidatQN = stripAccents(candidatQ)
  const refOffreQN = stripAccents(refOffreQ)

  // Filtrage combiné — chaque filtre est ANDé.
  const filtered = all.filter((c) => {
    if (statut && c.statut !== statut) return false
    if (ref && c._offre?.am_referent !== ref) return false
    if (offre_id && c._offre?.id !== offre_id) return false
    if (candidatQN) {
      const nomN = stripAccents(c.nom ?? '')
      if (!nomN.includes(candidatQN)) return false
    }
    if (dateFilter) {
      // created_at est un timestamp ISO — on compare sur les 10 premiers
      // caractères (YYYY-MM-DD) à la date du filtre pour un match exact.
      const candDate = (c.created_at ?? '').slice(0, 10)
      if (candDate !== dateFilter) return false
    }
    if (refOffreQN) {
      const refN = stripAccents(c._offre?.reference ?? '')
      if (!refN.includes(refOffreQN)) return false
    }
    return true
  })

  // Tri côté serveur sur le tableau filtré. On ne touche pas à la requête
  // Supabase parce que les champs triables vivent sur la relation `offres`
  // (titre, reference, am_referent) — PostgREST ne sait pas ordonner sur
  // une relation jointe sans sous-requête. À notre volume, un sort JS est
  // parfaitement acceptable (quelques milliers de rows max).
  const frCmp = new Intl.Collator('fr', { sensitivity: 'base' }).compare
  const sorted = sortField
    ? [...filtered].sort((a, b) => {
        const mult = sortDir === 'asc' ? 1 : -1
        switch (sortField) {
          case 'candidat':
            return mult * frCmp(a.nom ?? '', b.nom ?? '')
          case 'date': {
            const aD = a.created_at ?? ''
            const bD = b.created_at ?? ''
            // Les timestamps ISO se comparent lexicographiquement.
            return mult * (aD < bD ? -1 : aD > bD ? 1 : 0)
          }
          case 'ref_offre':
            return mult * frCmp(a._offre?.reference ?? '', b._offre?.reference ?? '')
          case 'ref':
            return mult * frCmp(a._offre?.am_referent ?? '', b._offre?.am_referent ?? '')
          case 'offre':
            return mult * frCmp(a._offre?.titre ?? '', b._offre?.titre ?? '')
          case 'statut':
            return mult * frCmp(a.statut ?? '', b.statut ?? '')
          case 'score': {
            // Nulls poussés en fin de liste indépendamment du sens, sinon
            // on aurait un gros tas de « — » qui remonte sur un tri desc
            // et qui cache les candidatures effectivement scorées.
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
    : filtered

  const totalAll = all.length
  const totalFiltered = sorted.length
  const hasFilter =
    !!statut ||
    !!ref ||
    !!offre_id ||
    !!candidatQ ||
    !!dateFilter ||
    !!refOffreQ

  const fmtDate = (iso: string | null) => {
    if (!iso) return '—'
    const d = new Date(iso)
    const jj = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    return `${jj}/${mm}/${d.getFullYear()}`
  }

  /**
   * Libellé court qui résume POURQUOI une candidature « en attente »
   * n'a pas été tranchée automatiquement. Permet au recruteur de
   * comprendre d'un coup d'œil ce qu'il doit faire sans lire toute la
   * justification IA. Les infos candidat (nom/email) ne sont plus un
   * motif : on peut désormais qualifier et envoyer le CV au client
   * même si elles manquent, donc ça ne doit plus bloquer ni être
   * signalé comme un motif d'attente.
   */
  const raisonEnAttente = (
    c: Enriched,
    seuil: number | null
  ): { label: string; tone: 'red' | 'amber' | 'muted' } => {
    if (c.justification_ia?.startsWith('Scoring IA indisponible')) {
      return { label: 'Scoring IA échoué', tone: 'red' }
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
        <h1 className="text-2xl font-bold">{pageTitle}</h1>
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
        {/* min-w-[1180px] : 10 colonnes (Action incluse). Padding des
            cellules resserré (px-3) et colonne Candidat bornée pour tenir
            sur un écran standard sans scroll horizontal. overflow-x-auto
            parent prend le relais sous cette largeur. */}
        <table className="w-full min-w-[1180px]">
          <thead className="bg-surface">
            <tr className="text-left text-xs font-semibold text-muted uppercase">
              <th scope="col" className="px-3 pt-3 pb-2">CV</th>
              <th scope="col" className="px-3 pt-3 pb-2">
                <SortHeader field="candidat" label="Candidat" />
              </th>
              <th scope="col" className="px-3 pt-3 pb-2">
                <SortHeader field="score" label="Score" defaultDir="desc" />
              </th>
              <th scope="col" className="px-3 pt-3 pb-2">
                <SortHeader field="statut" label="Statut" defaultDir="asc" />
              </th>
              <th scope="col" className="px-3 pt-3 pb-2">Justification IA</th>
              <th scope="col" className="px-3 pt-3 pb-2">
                <SortHeader field="ref_offre" label="Réf." />
              </th>
              <th scope="col" className="px-3 pt-3 pb-2">
                <SortHeader field="offre" label="Offre" />
              </th>
              <th scope="col" className="px-3 pt-3 pb-2">
                <SortHeader field="ref" label="Référent" />
              </th>
              <th scope="col" className="px-3 pt-3 pb-2">
                <SortHeader field="date" label="Date" defaultDir="desc" />
              </th>
              <th scope="col" className="px-3 pt-3 pb-2">Action</th>
            </tr>
            <tr className="align-top">
              <th className="px-3 pt-0 pb-3"></th>
              <th className="px-3 pt-0 pb-3 font-normal normal-case">
                <TextFilter field="candidat" placeholder="Nom…" />
              </th>
              <th className="px-3 pt-0 pb-3"></th>
              <th className="px-3 pt-0 pb-3 font-normal normal-case">
                <SelectFilter
                  field="statut"
                  options={[...STATUTS]}
                  placeholder="Tous"
                />
              </th>
              <th className="px-3 pt-0 pb-3"></th>
              <th className="px-3 pt-0 pb-3 font-normal normal-case">
                <TextFilter field="ref_offre" placeholder="Réf…" />
              </th>
              <th className="px-3 pt-0 pb-3 font-normal normal-case">
                <SelectFilter
                  field="offre_id"
                  options={offresOptions.map((o) => o.id)}
                  labels={Object.fromEntries(
                    offresOptions.map((o) => [o.id, o.titre])
                  )}
                  placeholder="Toutes"
                />
              </th>
              <th className="px-3 pt-0 pb-3 font-normal normal-case">
                <SelectFilter
                  field="ref"
                  options={amReferents}
                  placeholder="Tous"
                />
              </th>
              <th className="px-3 pt-0 pb-3 font-normal normal-case">
                <DateFilter field="date" />
              </th>
              <th className="px-3 pt-0 pb-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-soft">
            {sorted.map((c) => {
              const offre = c._offre
              const hasRealEmail =
                !!c.email?.trim() && !c.email.endsWith('@example.com')
              const isEnAttente = c.statut === 'en attente'
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
                  <td className="px-3 py-3">
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
                  <td className="px-3 py-3 min-w-0 max-w-[11rem]">
                    <div
                      className="font-medium truncate"
                      title={c.nom?.trim() || undefined}
                    >
                      {c.nom?.trim() || '—'}
                    </div>
                    {hasRealEmail ? (
                      <a
                        href={`mailto:${c.email}`}
                        className="block text-xs text-brand-purple hover:underline truncate"
                        title={c.email ?? undefined}
                      >
                        {c.email}
                      </a>
                    ) : (
                      <div className="text-xs text-muted italic">
                        email non extrait
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
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
                  <td className="px-3 py-3">
                    <StatusBadge status={c.statut ?? 'en attente'} />
                    {raison && (
                      <div
                        className={`text-xs mt-1 font-medium ${raisonClass}`}
                      >
                        {raison.label}
                      </div>
                    )}
                    {/* Alerte + relance : le dernier envoi email a échoué.
                        Le filtre se base uniquement sur `email_error` car
                        cette colonne n'est posée QUE quand on a tenté un
                        envoi — elle identifie donc uniquement les
                        candidatures qualifiées (ou rétrogradées en « en
                        attente » par persistEmailResult après échec).
                        Inline sous le badge statut pour que l'AM voie les
                        deux d'un coup d'œil (le candidat est bien passé
                        mais le client n'a pas encore été notifié). */}
                    {c.email_error && (
                      <ResendEmailAction
                        candidatureId={c.id}
                        emailError={c.email_error}
                        size="sm"
                      />
                    )}
                  </td>
                  <td className="px-3 py-3 max-w-xs min-w-[11rem]">
                    <JustificationIA
                      pointsForts={c.points_forts}
                      pointsFaibles={c.points_faibles}
                      justification={c.justification_ia}
                    />
                  </td>
                  <td className="px-3 py-3 text-xs text-muted font-mono whitespace-nowrap">
                    {offre?.reference ?? '—'}
                  </td>
                  <td className="px-3 py-3 min-w-0">
                    {offre ? (
                      <Link
                        href={`/offres/${offre.id}`}
                        className="text-brand-purple hover:underline font-medium"
                      >
                        {offre.titre}
                      </Link>
                    ) : (
                      <span className="text-muted" aria-label="Non renseigné">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-muted whitespace-nowrap">
                    {offre?.am_referent ?? '—'}
                  </td>
                  <td className="px-3 py-3 text-muted text-xs tabular-nums whitespace-nowrap">
                    {fmtDate(c.created_at)}
                  </td>
                  <td className="px-3 py-3">
                    {isEnAttente ? (
                      <CandidatureActions candidatureId={c.id} compact />
                    ) : (
                      <span className="text-muted" aria-label="Aucune action disponible">
                        —
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={10}
                  className="px-3 py-8 text-center text-muted text-sm"
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
