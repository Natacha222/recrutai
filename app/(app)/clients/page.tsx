import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import FormuleBadge from '@/components/FormuleBadge'
import ClickableRow from '@/components/ClickableRow'
import {
  FiltersReset,
  SelectFilter,
  TextFilter,
} from '@/components/TableFilters'

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

const FORMULES = ['Abonnement', 'À la mission', 'Volume entreprise']

function SortableHeader({
  label,
  sortKey,
  sort,
  dir,
  href,
  className = '',
}: {
  label: string
  sortKey: SortKey
  sort: SortKey
  dir: SortDir
  href: string
  className?: string
}) {
  const active = sort === sortKey
  const arrow = !active ? '↕' : dir === 'asc' ? '↑' : '↓'
  // aria-sort : indique au lecteur d'écran la direction de tri active.
  // 'none' par défaut (donc non-actif = triable mais pas trié).
  const ariaSort: 'ascending' | 'descending' | 'none' = active
    ? dir === 'asc'
      ? 'ascending'
      : 'descending'
    : 'none'
  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={`px-6 pt-3 pb-2 ${className}`}
    >
      <Link
        href={href}
        className={`inline-flex items-center gap-1 hover:text-brand-purple ${
          active ? 'text-brand-purple' : ''
        }`}
      >
        <span>{label}</span>
        <span
          className={`text-[10px] ${active ? 'opacity-100' : 'opacity-40'}`}
          aria-hidden
        >
          {arrow}
        </span>
      </Link>
    </th>
  )
}

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

const OFFRES_FILTERS: { value: string; label: string }[] = [
  { value: '0', label: 'Aucune' },
  { value: '1', label: 'Au moins 1' },
  { value: '5', label: 'Au moins 5' },
  { value: '10', label: 'Au moins 10' },
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

  // Enrich with computed offres_actives
  const enriched = allClients.map((c) => ({
    ...c,
    offres_actives: (Array.isArray(c.offres) ? c.offres : []).filter(
      (o) => o.statut === 'actif'
    ).length,
  }))

  // Filter
  const qLower = q.trim().toLowerCase()
  const offresMin = OFFRES_FILTERS.some((o) => o.value === offres)
    ? Number(offres)
    : null
  const filtered = enriched.filter((c) => {
    if (qLower && !(c.nom ?? '').toLowerCase().includes(qLower)) return false
    if (formule && c.formule !== formule) return false
    if (secteur && c.secteur !== secteur) return false
    if (am && c.am_referent !== am) return false
    if (offresMin !== null) {
      if (offresMin === 0) {
        if (c.offres_actives !== 0) return false
      } else if (c.offres_actives < offresMin) {
        return false
      }
    }
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
        <div className="mb-4 px-3 py-2 rounded-md bg-status-green-bg text-status-green text-sm">
          Client «&nbsp;{saved}&nbsp;» mis à jour.
        </div>
      )}

      {error && (
        <div className="mb-4 px-3 py-2 rounded-md bg-status-red-bg text-status-red text-sm">
          {error}
        </div>
      )}

      <div className="bg-surface-alt rounded-xl border border-border-soft overflow-x-auto">
        <table className="w-full">
          <thead className="bg-surface">
            <tr className="text-left text-xs font-semibold text-muted uppercase">
              <SortableHeader
                label="Entreprise"
                sortKey="nom"
                sort={sort}
                dir={dir}
                href={sortHref('nom')}
              />
              <SortableHeader
                label="Formule"
                sortKey="formule"
                sort={sort}
                dir={dir}
                href={sortHref('formule')}
              />
              <SortableHeader
                label="Secteur"
                sortKey="secteur"
                sort={sort}
                dir={dir}
                href={sortHref('secteur')}
              />
              <SortableHeader
                label="Offres actives"
                sortKey="offres_actives"
                sort={sort}
                dir={dir}
                href={sortHref('offres_actives')}
              />
              <SortableHeader
                label="Référent"
                sortKey="am_referent"
                sort={sort}
                dir={dir}
                href={sortHref('am_referent')}
              />
            </tr>
            <tr className="align-top">
              <th className="px-6 pt-0 pb-3 font-normal normal-case">
                <TextFilter field="q" placeholder="Nom d'entreprise…" />
              </th>
              <th className="px-6 pt-0 pb-3 font-normal normal-case">
                <SelectFilter
                  field="formule"
                  options={FORMULES}
                  placeholder="Toutes"
                />
              </th>
              <th className="px-6 pt-0 pb-3 font-normal normal-case">
                <SelectFilter
                  field="secteur"
                  options={secteurs}
                  placeholder="Tous"
                />
              </th>
              <th className="px-6 pt-0 pb-3 font-normal normal-case">
                <SelectFilter
                  field="offres"
                  options={OFFRES_FILTERS.map((o) => o.value)}
                  labels={Object.fromEntries(
                    OFFRES_FILTERS.map((o) => [o.value, o.label])
                  )}
                  placeholder="Toutes"
                />
              </th>
              <th className="px-6 pt-0 pb-3 font-normal normal-case">
                <SelectFilter
                  field="am"
                  options={amReferents}
                  placeholder="Tous"
                />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-soft">
            {sorted.map((c) => (
              <ClickableRow
                key={c.id}
                href={`/clients/${c.id}`}
                className="text-sm hover:bg-surface transition align-top"
              >
                <td className="px-6 py-5">
                  <Link
                    href={`/clients/${c.id}`}
                    className="font-semibold text-brand-indigo-text hover:text-brand-purple"
                  >
                    {c.nom}
                  </Link>
                  {c.contact_email && (
                    <div className="text-xs text-brand-purple mt-1">
                      {c.contact_email}
                    </div>
                  )}
                </td>
                <td className="px-6 py-5">
                  <FormuleBadge formule={c.formule} />
                </td>
                <td className="px-6 py-5 text-muted">{c.secteur ?? '—'}</td>
                <td className="px-6 py-5">
                  <span className="font-bold text-brand-purple text-base">
                    {c.offres_actives}
                  </span>
                </td>
                <td className="px-6 py-5 text-muted">
                  {c.am_referent ?? '—'}
                </td>
              </ClickableRow>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-6 py-8 text-center text-muted text-sm"
                >
                  {hasFilter
                    ? 'Aucun client ne correspond à ces filtres.'
                    : 'Aucun client pour le moment.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
