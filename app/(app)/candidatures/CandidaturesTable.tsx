'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  DateFilter,
  FiltersReset,
  SelectFilter,
  SortHeader,
  TextFilter,
} from '@/components/TableFilters'
import StatusBadge from '@/components/StatusBadge'
import ResendEmailAction from '@/components/ResendEmailAction'
import { scoreColor } from '@/lib/format'
import CandidatureActions from '../offres/[id]/CandidatureActions'
import CandidatureDetailModal from './CandidatureDetailModal'

/**
 * Table des candidatures avec pagination d'affichage par scroll infini.
 *
 * Stratégie (V47) : le serveur fournit TOUTE la liste filtrée+triée, mais
 * le navigateur ne rend que `visibleCount` lignes (10 au départ). Un
 * IntersectionObserver sur une div sentinelle en bas révèle les 10
 * suivantes quand on scrolle. Le bottleneck c'est le rendu React, pas le
 * fetch SQL — cette stratégie suffit jusqu'à ~5000 candidatures. Au-delà,
 * il faudra passer à une vraie pagination serveur (range + offset SQL).
 *
 * Comportement :
 *  - À l'arrivée sur la page : 10 lignes
 *  - Scroll vers le bas → +10 lignes (rootMargin 300px → préchargement)
 *  - Filtre / tri (URL change) → reset à 10 lignes
 *  - Compteur en bas : « Affichage de X sur Y »
 */

type Offre = {
  id: string
  titre: string
  reference: string | null
  seuil: number | null
  am_referent: string | null
}

export type Enriched = {
  id: string
  nom: string | null
  email: string | null
  score_ia: number | null
  statut: string | null
  created_at: string | null
  cv_url: string | null
  justification_ia: string | null
  points_forts: string[] | null
  points_faibles: string[] | null
  email_sent_at: string | null
  email_error: string | null
  _offre: Offre | null
}

const STATUTS = ['en attente', 'qualifié', 'rejeté'] as const

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

// Taille d'une « page » d'affichage. Volontairement petite pour que la
// liste apparaisse instantanément à l'arrivée, même sur réseau lent.
const PAGE_SIZE = 10

const fmtDate = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  const jj = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${jj}/${mm}/${d.getFullYear()}`
}

/**
 * Voir page.tsx (ancienne version, V45) pour le rationale détaillé. Le
 * cas « score < seuil » a été retiré pour éviter le doublon avec la
 * colonne Score (déjà colorée via scoreColor).
 */
const raisonEnAttente = (
  c: Enriched
): { label: string; tone: 'red' | 'muted' } => {
  if (c.justification_ia?.startsWith('Scoring IA indisponible')) {
    return { label: 'Scoring IA échoué', tone: 'red' }
  }
  return { label: 'À trancher manuellement', tone: 'muted' }
}

export default function CandidaturesTable({
  items,
  totalAll,
  totalFiltered,
  hasFilter,
  offresOptions,
  amReferents,
}: {
  items: Enriched[]
  totalAll: number
  totalFiltered: number
  hasFilter: boolean
  offresOptions: { id: string; titre: string }[]
  amReferents: string[]
}) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  // Candidature ouverte dans la modal de détail. On stocke l'objet
  // complet plutôt que l'ID — ainsi la modal reste cohérente même si
  // `items` change pendant qu'elle est ouverte (filtre/tri).
  const [openCandidature, setOpenCandidature] = useState<Enriched | null>(
    null
  )

  // Reset à 10 lignes quand la liste change (filtre / tri / nouveau fetch
  // RSC). On dépend de `items` directement : Next.js ne re-render le RSC
  // que sur changement d'URL, donc le reference change uniquement quand
  // les filtres bougent — pas de reset parasite à chaque render.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [items])

  // IntersectionObserver — déclenche +10 lignes quand la sentinelle entre
  // dans le viewport. rootMargin volontairement à 0 pour que le déclic
  // visuel ne se produise qu'au moment où l'utilisateur a réellement
  // scrollé jusqu'au bas (sinon, sur des petits volumes de données, le
  // pré-chargement à 300px chargeait toutes les lignes immédiatement et
  // l'effet pagination n'était pas perceptible).
  useEffect(() => {
    if (visibleCount >= items.length) return // tout est déjà affiché
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
            {/* Pas de filtre sur le score (valeur continue, peu utile à
                filtrer), donc on profite de cette case pour expliquer le
                format « 88 / 60 » qui s'affichait dans la cellule sans
                que les AM en comprennent immédiatement les 2 nombres. */}
            <th className="px-3 pt-0 pb-3 text-[11px] text-muted normal-case font-normal text-center">
              score / seuil
            </th>
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
          {visible.map((c) => {
            const offre = c._offre
            const hasRealEmail =
              !!c.email?.trim() && !c.email.endsWith('@example.com')
            const isEnAttente = c.statut === 'en attente'
            const raison = isEnAttente ? raisonEnAttente(c) : null
            const raisonClass =
              raison?.tone === 'red' ? 'text-status-red' : 'text-muted'
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
                <td className="px-3 py-3">
                  {/* V48 : la justification IA, les points forts/faibles
                      et la synthèse texte sont sortis dans une modal
                      « Voir détails » pour densifier la liste (chaque
                      candidat tient sur 1-2 lignes au lieu de 4-6). */}
                  <button
                    type="button"
                    onClick={() => setOpenCandidature(c)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-brand-purple text-brand-purple text-xs font-semibold hover:bg-brand-purple hover:text-white transition-colors whitespace-nowrap"
                    aria-label={`Voir les détails IA pour ${c.nom?.trim() || 'ce candidat'}`}
                  >
                    <span aria-hidden="true">ℹ️</span> Voir détails
                  </button>
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
          {items.length === 0 && (
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

      {/* Compteur + sentinelle de scroll infini. Le compteur affiche
          un texte différent selon qu'il reste des lignes à charger ou
          non — l'utilisateur sait ainsi quand scroller est utile. La
          sentinelle est une div invisible (h-1) surveillée par
          l'IntersectionObserver — son entrée dans le viewport déclenche
          le chargement des 10 suivantes. */}
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
              <strong>{items.length}</strong> candidature
              {items.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}
      {hasMore && (
        <div ref={sentinelRef} aria-hidden="true" className="h-1" />
      )}

      {/* Modal de détail — montée seulement quand une candidature est
          sélectionnée. Le mount/unmount sert de cycle de vie : on ne
          paie pas le coût du modal tant qu'il n'est pas ouvert, et le
          focus initial est ré-appliqué à chaque ouverture. */}
      {openCandidature && (
        <CandidatureDetailModal
          candidature={openCandidature}
          onClose={() => setOpenCandidature(null)}
        />
      )}
    </div>
  )
}
