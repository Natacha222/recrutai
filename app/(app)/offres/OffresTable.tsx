'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import StatusBadge from '@/components/StatusBadge'
import {
  DateFilter,
  SelectFilter,
  TextFilter,
} from '@/components/TableFilters'
import { formatValidite } from '@/lib/format'

/**
 * Table des offres avec pagination par scroll infini (V48).
 * Même structure que CandidaturesTable / ClientsTable.
 */

export type OffreItem = {
  id: string
  reference: string | null
  titre: string
  lieu: string | null
  statut: string
  contrat: string | null
  seuil: number | null
  date_validite: string | null
  am_referent: string | null
  client_id: string | null
  clientNom: string | null
  effective: string
  total: number
  qualifies: number
}

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

const PAGE_SIZE = 10

const CONTRATS = ['CDI', 'CDD', 'Alternance', 'Stage']
const STATUTS: { value: string; label: string }[] = [
  { value: 'actif', label: 'Active' },
  { value: 'clos', label: 'Clôturée' },
]

function SortableHeader({
  label,
  sortKey,
  sort,
  dir,
  href,
}: {
  label: string
  sortKey: SortKey
  sort: SortKey
  dir: SortDir
  href: string
}) {
  const active = sort === sortKey
  const arrow = !active ? '↕' : dir === 'asc' ? '↑' : '↓'
  const ariaSort: 'ascending' | 'descending' | 'none' = active
    ? dir === 'asc'
      ? 'ascending'
      : 'descending'
    : 'none'
  return (
    <th scope="col" aria-sort={ariaSort} className="px-6 pt-3 pb-2">
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

export default function OffresTable({
  items,
  hasFilter,
  clientsList,
  referentsList,
  sort,
  dir,
  sortHrefs,
}: {
  items: OffreItem[]
  hasFilter: boolean
  clientsList: string[]
  referentsList: string[]
  sort: SortKey
  dir: SortDir
  sortHrefs: Record<SortKey, string>
}) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [items])

  useEffect(() => {
    if (visibleCount >= items.length) return
    const node = sentinelRef.current
    if (!node) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((c) => Math.min(c + PAGE_SIZE, items.length))
        }
      },
      { rootMargin: '0px' }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [items.length, visibleCount])

  const visible = items.slice(0, visibleCount)
  const hasMore = visibleCount < items.length

  return (
    <div className="bg-surface-alt rounded-xl border border-border-soft overflow-x-auto">
      <table className="w-full">
        <thead className="bg-surface">
          <tr className="text-left text-xs font-semibold text-muted uppercase">
            <SortableHeader
              label="Référence"
              sortKey="reference"
              sort={sort}
              dir={dir}
              href={sortHrefs.reference}
            />
            <SortableHeader
              label="Intitulé"
              sortKey="titre"
              sort={sort}
              dir={dir}
              href={sortHrefs.titre}
            />
            <SortableHeader
              label="Client"
              sortKey="client"
              sort={sort}
              dir={dir}
              href={sortHrefs.client}
            />
            <SortableHeader
              label="Référent"
              sortKey="referent"
              sort={sort}
              dir={dir}
              href={sortHrefs.referent}
            />
            <SortableHeader
              label="Contrat"
              sortKey="contrat"
              sort={sort}
              dir={dir}
              href={sortHrefs.contrat}
            />
            <SortableHeader
              label="Statut"
              sortKey="statut"
              sort={sort}
              dir={dir}
              href={sortHrefs.statut}
            />
            <SortableHeader
              label="Valide jusqu'au"
              sortKey="date_validite"
              sort={sort}
              dir={dir}
              href={sortHrefs.date_validite}
            />
            <SortableHeader
              label="CV reçus / Qualifiés"
              sortKey="candidatures"
              sort={sort}
              dir={dir}
              href={sortHrefs.candidatures}
            />
            <SortableHeader
              label="Seuil"
              sortKey="seuil"
              sort={sort}
              dir={dir}
              href={sortHrefs.seuil}
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
          {visible.map((o) => (
            <tr
              key={o.id}
              className="text-sm hover:bg-surface transition align-top"
            >
              <td className="px-6 py-5 font-mono font-semibold tabular-nums whitespace-nowrap">
                {o.reference ? (
                  <Link
                    href={`/offres/${o.id}`}
                    className="text-brand-purple hover:underline"
                  >
                    {o.reference}
                  </Link>
                ) : (
                  <span className="text-muted" aria-label="Non renseigné">—</span>
                )}
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
                    <span aria-hidden="true">📍</span>
                    <span>
                      <span className="sr-only">Lieu : </span>
                      {o.lieu}
                    </span>
                  </div>
                )}
              </td>
              <td className="px-6 py-5">
                {/* Lien vers la fiche client (V44) — discret pour ne pas
                    voler la vedette au titre, l'action principale. */}
                {o.client_id && o.clientNom ? (
                  <Link
                    href={`/clients/${o.client_id}`}
                    className="text-muted hover:text-brand-purple hover:underline transition-colors"
                  >
                    {o.clientNom}
                  </Link>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </td>
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
          {items.length === 0 && (
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

      {items.length > 0 && (
        <div className="px-6 py-3 text-xs text-center border-t border-border-soft tabular-nums">
          {hasMore ? (
            <span className="text-brand-purple">
              Affichage de <strong>{visible.length}</strong> sur{' '}
              <strong>{items.length}</strong> · ↓ scrollez pour voir la suite
            </span>
          ) : (
            <span className="text-muted">
              Affichage de <strong>{items.length}</strong> sur{' '}
              <strong>{items.length}</strong> offre
              {items.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}
      {hasMore && (
        <div ref={sentinelRef} aria-hidden="true" className="h-1" />
      )}
    </div>
  )
}
