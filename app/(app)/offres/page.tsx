import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import StatusBadge from '@/components/StatusBadge'
import { effectiveStatut, formatValidite } from '@/lib/format'
import {
  DateFilter,
  FiltersReset,
  SelectFilter,
  TextFilter,
} from '@/components/TableFilters'

type SortKey =
  | 'reference'
  | 'titre'
  | 'client'
  | 'referent'
  | 'contrat'
  | 'statut'
  | 'date_validite'
  | 'candidatures'
  | 'seuil'
type SortDir = 'asc' | 'desc'

const SORT_KEYS: SortKey[] = [
  'reference',
  'titre',
  'client',
  'referent',
  'contrat',
  'statut',
  'date_validite',
  'candidatures',
  'seuil',
]

const CONTRATS = ['CDI', 'CDD', 'Alternance', 'Stage']

const STATUTS: { value: string; label: string }[] = [
  { value: 'actif', label: 'Active' },
  { value: 'clos', label: 'Clôturée' },
]

const FILTER_FIELDS = [
  'ref_q',
  'q',
  'client',
  'referent',
  'contrat',
  'statut',
  'validite',
]
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

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
  return (
    <th className={`px-6 pt-3 pb-2 ${className}`}>
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
  /** Recherche texte sur la référence d'offre (ex : "tech-2026"). */
  ref_q?: string
  q?: string
  client?: string
  referent?: string
  contrat?: string
  statut?: string
  /** YYYY-MM-DD — filtre date_validite >= validite si défini et valide. */
  validite?: string
  sort?: string
  dir?: string
}>

export default async function OffresPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const params = await searchParams
  const {
    ref_q = '',
    q = '',
    client = '',
    referent = '',
    contrat = '',
    statut = '',
    validite = '',
  } = params
  const sort: SortKey = SORT_KEYS.includes(params.sort as SortKey)
    ? (params.sort as SortKey)
    : 'titre'
  const dir: SortDir = params.dir === 'desc' ? 'desc' : 'asc'

  // On ignore silencieusement une date mal formée pour éviter de casser
  // la requête sur un paramètre corrompu — l'input type=date du navigateur
  // garantit déjà le format ISO en usage normal.
  const validiteEffective = ISO_DATE_RE.test(validite) ? validite : ''

  const supabase = await createClient()
  const { data: offres } = await supabase
    .from('offres')
    .select(
      'id, reference, titre, lieu, statut, contrat, seuil, created_at, date_validite, am_referent, clients(nom), candidatures(id, statut)'
    )

  const allOffres = (offres ?? []).map((o) => {
    const clientNom = Array.isArray(o.clients)
      ? (o.clients[0]?.nom ?? null)
      : ((o.clients as { nom: string } | null)?.nom ?? null)
    const effective = effectiveStatut(o.statut, o.date_validite)
    const total = (o.candidatures ?? []).length
    const qualifies = (o.candidatures ?? []).filter(
      (c) => c.statut === 'qualifié'
    ).length
    return {
      ...o,
      clientNom,
      effective,
      total,
      qualifies,
    }
  })

  // Distinct client names for the filter dropdown
  const clientsList = Array.from(
    new Set(
      allOffres
        .map((o) => o.clientNom)
        .filter((n): n is string => !!n && n.trim() !== '')
    )
  ).sort((a, b) => a.localeCompare(b, 'fr'))

  // Distinct référents pour le filtre (offres uniquement — si on a besoin
  // d'autres référents, les filtres ne les matcheront pas de toute façon).
  const referentsList = Array.from(
    new Set(
      allOffres
        .map((o) => o.am_referent)
        .filter((r): r is string => !!r && r.trim() !== '')
    )
  ).sort((a, b) => a.localeCompare(b, 'fr'))

  // Filter
  const qLower = q.trim().toLowerCase()
  const refQLower = ref_q.trim().toLowerCase()
  const filtered = allOffres.filter((o) => {
    if (
      refQLower &&
      !(o.reference ?? '').toLowerCase().includes(refQLower)
    ) {
      return false
    }
    if (qLower && !(o.titre ?? '').toLowerCase().includes(qLower)) return false
    if (client && o.clientNom !== client) return false
    if (referent && o.am_referent !== referent) return false
    if (contrat && o.contrat !== contrat) return false
    if (statut && o.effective !== statut) return false
    // Comparaison lexicographique sur ISO YYYY-MM-DD = chronologique.
    // Sémantique « encore valide à cette date » : on garde les offres dont
    // la date de validité est >= la date choisie. Les offres sans date sont
    // exclues dès que le filtre est défini.
    if (validiteEffective) {
      if (!o.date_validite || o.date_validite < validiteEffective) return false
    }
    return true
  })

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    let av: string | number
    let bv: string | number
    switch (sort) {
      case 'reference':
        av = (a.reference ?? '').toLowerCase()
        bv = (b.reference ?? '').toLowerCase()
        break
      case 'client':
        av = (a.clientNom ?? '').toLowerCase()
        bv = (b.clientNom ?? '').toLowerCase()
        break
      case 'referent':
        av = (a.am_referent ?? '').toLowerCase()
        bv = (b.am_referent ?? '').toLowerCase()
        break
      case 'contrat':
        av = (a.contrat ?? '').toLowerCase()
        bv = (b.contrat ?? '').toLowerCase()
        break
      case 'statut':
        av = a.effective
        bv = b.effective
        break
      case 'date_validite':
        av = a.date_validite ?? ''
        bv = b.date_validite ?? ''
        break
      case 'candidatures':
        av = a.total
        bv = b.total
        break
      case 'seuil':
        av = a.seuil ?? 0
        bv = b.seuil ?? 0
        break
      case 'titre':
      default:
        av = (a.titre ?? '').toLowerCase()
        bv = (b.titre ?? '').toLowerCase()
    }
    if (typeof av === 'string' && typeof bv === 'string') {
      const cmp = av.localeCompare(bv, 'fr')
      return dir === 'asc' ? cmp : -cmp
    }
    const na = av as number
    const nb = bv as number
    return dir === 'asc' ? na - nb : nb - na
  })

  const totalAll = allOffres.length
  const offresActives = allOffres.filter((o) => o.effective === 'actif').length
  const offresClos = allOffres.filter((o) => o.effective === 'clos').length
  const hasFilter = !!(
    refQLower ||
    q ||
    client ||
    referent ||
    contrat ||
    statut ||
    validiteEffective
  )
  const totalShown = sorted.length
  const subtitle = hasFilter
    ? `${totalShown} résultat${totalShown > 1 ? 's' : ''} sur ${totalAll}`
    : `${offresActives} offre${offresActives > 1 ? 's' : ''} active${
        offresActives > 1 ? 's' : ''
      } · ${offresClos} offre${offresClos > 1 ? 's' : ''} clôturée${
        offresClos > 1 ? 's' : ''
      }`

  function sortHref(key: SortKey) {
    const newDir: SortDir = sort === key && dir === 'asc' ? 'desc' : 'asc'
    const sp = new URLSearchParams()
    if (ref_q) sp.set('ref_q', ref_q)
    if (q) sp.set('q', q)
    if (client) sp.set('client', client)
    if (referent) sp.set('referent', referent)
    if (contrat) sp.set('contrat', contrat)
    if (statut) sp.set('statut', statut)
    if (validiteEffective) sp.set('validite', validiteEffective)
    if (key !== 'titre') sp.set('sort', key)
    if (newDir !== 'asc') sp.set('dir', newDir)
    const qs = sp.toString()
    return qs ? `/offres?${qs}` : '/offres'
  }

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Offres d&apos;emploi</h1>
          <div className="text-sm text-muted mt-1 flex items-center gap-3">
            <span>{subtitle}</span>
            <FiltersReset fields={FILTER_FIELDS} />
          </div>
        </div>
        <Link
          href="/offres/nouvelle"
          className="px-4 py-2 bg-brand-purple text-white rounded-md text-sm font-semibold hover:opacity-90"
        >
          + Nouvelle offre
        </Link>
      </div>

      <div className="bg-surface-alt rounded-xl border border-border-soft overflow-x-auto">
        <table className="w-full">
          <thead className="bg-surface">
            <tr className="text-left text-xs font-semibold text-muted uppercase">
              <SortableHeader
                label="Référence"
                sortKey="reference"
                sort={sort}
                dir={dir}
                href={sortHref('reference')}
              />
              <SortableHeader
                label="Intitulé"
                sortKey="titre"
                sort={sort}
                dir={dir}
                href={sortHref('titre')}
              />
              <SortableHeader
                label="Client"
                sortKey="client"
                sort={sort}
                dir={dir}
                href={sortHref('client')}
              />
              <SortableHeader
                label="Référent"
                sortKey="referent"
                sort={sort}
                dir={dir}
                href={sortHref('referent')}
              />
              <SortableHeader
                label="Contrat"
                sortKey="contrat"
                sort={sort}
                dir={dir}
                href={sortHref('contrat')}
              />
              <SortableHeader
                label="Statut"
                sortKey="statut"
                sort={sort}
                dir={dir}
                href={sortHref('statut')}
              />
              <SortableHeader
                label="Valide jusqu'au"
                sortKey="date_validite"
                sort={sort}
                dir={dir}
                href={sortHref('date_validite')}
              />
              <SortableHeader
                label="CV reçus / Qualifiés"
                sortKey="candidatures"
                sort={sort}
                dir={dir}
                href={sortHref('candidatures')}
              />
              <SortableHeader
                label="Seuil"
                sortKey="seuil"
                sort={sort}
                dir={dir}
                href={sortHref('seuil')}
              />
            </tr>
            <tr className="align-top">
              <th className="px-6 pt-0 pb-3 font-normal normal-case">
                <TextFilter field="ref_q" placeholder="Référence…" />
              </th>
              <th className="px-6 pt-0 pb-3 font-normal normal-case">
                <TextFilter field="q" placeholder="Intitulé…" />
              </th>
              <th className="px-6 pt-0 pb-3 font-normal normal-case">
                <SelectFilter
                  field="client"
                  options={clientsList}
                  placeholder="Tous"
                />
              </th>
              <th className="px-6 pt-0 pb-3 font-normal normal-case">
                <SelectFilter
                  field="referent"
                  options={referentsList}
                  placeholder="Tous"
                />
              </th>
              <th className="px-6 pt-0 pb-3 font-normal normal-case">
                <SelectFilter
                  field="contrat"
                  options={CONTRATS}
                  placeholder="Tous"
                />
              </th>
              <th className="px-6 pt-0 pb-3 font-normal normal-case">
                <SelectFilter
                  field="statut"
                  options={STATUTS.map((s) => s.value)}
                  labels={Object.fromEntries(
                    STATUTS.map((s) => [s.value, s.label])
                  )}
                  placeholder="Tous"
                />
              </th>
              <th className="px-6 pt-0 pb-3 font-normal normal-case">
                <DateFilter field="validite" />
              </th>
              <th className="px-6 pt-0 pb-3"></th>
              <th className="px-6 pt-0 pb-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-soft">
            {sorted.map((o) => (
              <tr
                key={o.id}
                className="text-sm hover:bg-surface transition align-top"
              >
                <td className="px-6 py-5 font-mono font-semibold text-brand-purple tabular-nums whitespace-nowrap">
                  {o.reference ?? <span className="text-muted">—</span>}
                </td>
                <td className="px-6 py-5">
                  <Link
                    href={`/offres/${o.id}`}
                    className="font-semibold text-brand-indigo-text hover:text-brand-purple"
                  >
                    {o.titre}
                  </Link>
                  {o.lieu && (
                    <div className="text-xs text-muted mt-1 flex items-center gap-1">
                      <span>📍</span>
                      <span>{o.lieu}</span>
                    </div>
                  )}
                </td>
                <td className="px-6 py-5 text-muted">{o.clientNom ?? '—'}</td>
                <td className="px-6 py-5 text-muted">
                  {o.am_referent ?? '—'}
                </td>
                <td className="px-6 py-5 text-muted">{o.contrat ?? '—'}</td>
                <td className="px-6 py-5">
                  <StatusBadge status={o.effective} />
                </td>
                <td className="px-6 py-5 text-muted tabular-nums">
                  {formatValidite(o.date_validite)}
                </td>
                <td className="px-6 py-5 font-semibold tabular-nums">
                  {o.total} · {o.qualifies}
                </td>
                <td className="px-6 py-5">
                  <span className="font-bold text-brand-purple">
                    {o.seuil}
                  </span>
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={9}
                  className="px-6 py-8 text-center text-muted text-sm"
                >
                  {hasFilter
                    ? 'Aucune offre ne correspond à ces filtres.'
                    : 'Aucune offre pour le moment.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
