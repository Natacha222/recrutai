import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { FiltersReset } from '@/components/TableFilters'
import ClientsTable, { type ClientItem } from './ClientsTable'

const FILTER_FIELDS = ['q', 'formule', 'secteur', 'am', 'offres']

type SortKey =
  | 'nom'
  | 'formule'
  | 'secteur'
  | 'offres_actives'
  | 'am_referent'
type SortDir = 'asc' | 'desc'

const SORT_KEYS: SortKey[] = [
  'nom',
  'formule',
  'secteur',
  'offres_actives',
  'am_referent',
]

type SearchParams = Promise<{
  saved?: string
  error?: string
  q?: string
  formule?: string
  secteur?: string
  am?: string
  offres?: string
  sort?: string
  dir?: string
}>

// Filtres par plage (et non plus seuil min) — V46. Le filtre « Au moins N »
// laissait la liste majoritairement remplie de clients déjà bien servis ;
// les plages permettent de cibler un segment précis (les nouveaux entrants
// 1-4, le cœur de portefeuille 5-9, les gros comptes 10+).
const OFFRES_FILTERS: {
  value: string
  matches: (n: number) => boolean
}[] = [
  { value: '0', matches: (n) => n === 0 },
  { value: '1', matches: (n) => n >= 1 && n <= 4 },
  { value: '5', matches: (n) => n >= 5 && n <= 9 },
  { value: '10', matches: (n) => n >= 10 },
]

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const params = await searchParams
  const {
    saved,
    error,
    q = '',
    formule = '',
    secteur = '',
    am = '',
    offres = '',
  } = params
  const sort: SortKey = SORT_KEYS.includes(params.sort as SortKey)
    ? (params.sort as SortKey)
    : 'nom'
  const dir: SortDir = params.dir === 'desc' ? 'desc' : 'asc'

  const supabase = await createClient()
  const { data: clients } = await supabase
    .from('clients')
    .select(
      'id, nom, secteur, contact_email, formule, am_referent, created_at, offres(id, statut)'
    )

  const allClients = clients ?? []

  // Distinct lists for dropdowns
  const secteurs = Array.from(
    new Set(
      allClients
        .map((c) => c.secteur)
        .filter((s): s is string => !!s && s.trim() !== '')
    )
  ).sort((a, b) => a.localeCompare(b, 'fr'))
  const amReferents = Array.from(
    new Set(
      allClients
        .map((c) => c.am_referent)
        .filter((a): a is string => !!a && a.trim() !== '')
    )
  ).sort((a, b) => a.localeCompare(b, 'fr'))

  // Enrich with computed offres_actives. On ne spread pas `c` directement
  // pour éviter de transférer `offres` (la relation jointe) et `created_at`
  // au Client Component qui n'en a pas besoin — économise la sérialisation
  // RSC pour rien.
  const enriched: ClientItem[] = allClients.map((c) => ({
    id: c.id,
    nom: c.nom,
    secteur: c.secteur,
    contact_email: c.contact_email,
    formule: c.formule,
    am_referent: c.am_referent,
    offres_actives: (Array.isArray(c.offres) ? c.offres : []).filter(
      (o) => o.statut === 'actif'
    ).length,
  }))

  // Filter
  const qLower = q.trim().toLowerCase()
  const offresBucket = OFFRES_FILTERS.find((o) => o.value === offres) ?? null
  const filtered = enriched.filter((c) => {
    if (qLower && !(c.nom ?? '').toLowerCase().includes(qLower)) return false
    if (formule && c.formule !== formule) return false
    if (secteur && c.secteur !== secteur) return false
    if (am && c.am_referent !== am) return false
    if (offresBucket && !offresBucket.matches(c.offres_actives)) return false
    return true
  })

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    let av: string | number
    let bv: string | number
    switch (sort) {
      case 'formule':
        av = a.formule ?? ''
        bv = b.formule ?? ''
        break
      case 'secteur':
        av = (a.secteur ?? '').toLowerCase()
        bv = (b.secteur ?? '').toLowerCase()
        break
      case 'offres_actives':
        av = a.offres_actives
        bv = b.offres_actives
        break
      case 'am_referent':
        av = (a.am_referent ?? '').toLowerCase()
        bv = (b.am_referent ?? '').toLowerCase()
        break
      case 'nom':
      default:
        av = (a.nom ?? '').toLowerCase()
        bv = (b.nom ?? '').toLowerCase()
    }
    if (typeof av === 'string' && typeof bv === 'string') {
      const cmp = av.localeCompare(bv, 'fr')
      return dir === 'asc' ? cmp : -cmp
    }
    const na = av as number
    const nb = bv as number
    return dir === 'asc' ? na - nb : nb - na
  })

  const total = sorted.length
  const totalAll = allClients.length
  const hasFilter = !!(q || formule || secteur || am || offres)
  const subtitle = hasFilter
    ? `${total} résultat${total > 1 ? 's' : ''} sur ${totalAll}`
    : total > 1
      ? `${total} entreprises gérées par l'équipe`
      : `${total} entreprise gérée par l'équipe`

  // Pré-calcul des hrefs de tri pour chaque colonne — on ne peut pas
  // passer la fonction `sortHref` au Client Component (non sérialisable),
  // donc on calcule un Record<SortKey, string> ici et on le passe en prop.
  function sortHref(key: SortKey) {
    const newDir: SortDir = sort === key && dir === 'asc' ? 'desc' : 'asc'
    const sp = new URLSearchParams()
    if (q) sp.set('q', q)
    if (formule) sp.set('formule', formule)
    if (secteur) sp.set('secteur', secteur)
    if (am) sp.set('am', am)
    if (offres) sp.set('offres', offres)
    if (key !== 'nom') sp.set('sort', key)
    if (newDir !== 'asc') sp.set('dir', newDir)
    const qs = sp.toString()
    return qs ? `/clients?${qs}` : '/clients'
  }
  const sortHrefs = SORT_KEYS.reduce(
    (acc, key) => {
      acc[key] = sortHref(key)
      return acc
    },
    {} as Record<SortKey, string>
  )

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Clients</h1>
          <div className="text-sm text-muted mt-1 flex items-center gap-3">
            <span>{subtitle}</span>
            <FiltersReset fields={FILTER_FIELDS} />
          </div>
        </div>
        <Link
          href="/clients/nouveau"
          className="px-4 py-2 bg-brand-purple text-white rounded-md text-sm font-semibold hover:opacity-90"
        >
          + Nouveau client
        </Link>
      </div>

      {saved && (
        <div
          role="status"
          className="mb-4 px-3 py-2 rounded-md bg-status-green-bg text-status-green text-sm"
        >
          Client «&nbsp;{saved}&nbsp;» mis à jour.
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mb-4 px-3 py-2 rounded-md bg-status-red-bg text-status-red text-sm"
        >
          {error}
        </div>
      )}

      <ClientsTable
        items={sorted}
        hasFilter={hasFilter}
        secteurs={secteurs}
        amReferents={amReferents}
        sort={sort}
        dir={dir}
        sortHrefs={sortHrefs}
      />
    </div>
  )
}
