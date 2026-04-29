'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import FormuleBadge from '@/components/FormuleBadge'
import ClickableRow from '@/components/ClickableRow'
import { SelectFilter, TextFilter } from '@/components/TableFilters'

/**
 * Table des clients avec pagination par scroll infini (V48).
 *
 * Même stratégie que CandidaturesTable : la liste filtrée+triée arrive
 * complète, mais on ne rend que `visibleCount` lignes (10 au départ).
 * Sentinelle en bas + IntersectionObserver révèlent les 10 suivantes.
 *
 * thead + filter controls renderés ici plutôt que dans la page parente
 * pour garder l'a11y de la table cohérente (un seul `<table>` avec ses
 * en-têtes), et pour pouvoir hot-reload le compteur au même endroit.
 */

export type ClientItem = {
  id: string
  nom: string
  secteur: string | null
  contact_email: string | null
  formule: string | null
  am_referent: string | null
  offres_actives: number
}

type SortKey =
  | 'nom'
  | 'formule'
  | 'secteur'
  | 'offres_actives'
  | 'am_referent'
type SortDir = 'asc' | 'desc'

const PAGE_SIZE = 10

const FORMULES = ['Abonnement', 'À la mission', 'Volume entreprise']

// Repris depuis V46 — filtres « Offres actives » par plages.
const OFFRES_FILTERS: { value: string; label: string }[] = [
  { value: '0', label: 'Aucune' },
  { value: '1', label: 'Entre 1 et 4' },
  { value: '5', label: 'Entre 5 et 9' },
  { value: '10', label: 'Plus de 10' },
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

export default function ClientsTable({
  items,
  hasFilter,
  secteurs,
  amReferents,
  sort,
  dir,
  sortHrefs,
}: {
  items: ClientItem[]
  hasFilter: boolean
  secteurs: string[]
  amReferents: string[]
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
              label="Entreprise"
              sortKey="nom"
              sort={sort}
              dir={dir}
              href={sortHrefs.nom}
            />
            <SortableHeader
              label="Formule"
              sortKey="formule"
              sort={sort}
              dir={dir}
              href={sortHrefs.formule}
            />
            <SortableHeader
              label="Secteur"
              sortKey="secteur"
              sort={sort}
              dir={dir}
              href={sortHrefs.secteur}
            />
            <SortableHeader
              label="Offres actives"
              sortKey="offres_actives"
              sort={sort}
              dir={dir}
              href={sortHrefs.offres_actives}
            />
            <SortableHeader
              label="Référent"
              sortKey="am_referent"
              sort={sort}
              dir={dir}
              href={sortHrefs.am_referent}
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
          {visible.map((c) => (
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
          {items.length === 0 && (
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

      {/* Compteur + sentinelle. Texte en violet « scrollez » quand il
          reste à charger, en gris discret quand tout est affiché. */}
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
              <strong>{items.length}</strong> client
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
