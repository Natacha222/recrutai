import { createClient } from '@/lib/supabase/server'
import CandidaturesTable, { type Enriched } from './CandidaturesTable'

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

// Note V47 : les constantes STATUTS et FILTER_FIELDS, ainsi que le
// rendu de la table (thead + filtres + tbody + compteur), ont été
// déplacées dans CandidaturesTable.tsx (Client Component) pour la
// pagination par scroll infini. Cette page reste un Server Component
// qui fait le filtre + tri en JS comme avant.

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
      .replace(/\p{Mn}/gu, '')
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

      <CandidaturesTable
        items={sorted}
        totalAll={totalAll}
        totalFiltered={totalFiltered}
        hasFilter={hasFilter}
        offresOptions={offresOptions}
        amReferents={amReferents}
      />
    </div>
  )
}
