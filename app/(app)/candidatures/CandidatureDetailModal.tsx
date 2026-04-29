'use client'

import { useEffect, useRef } from 'react'
import StatusBadge from '@/components/StatusBadge'
import ResendEmailAction from '@/components/ResendEmailAction'
import CandidatureActions from '../offres/[id]/CandidatureActions'
import { scoreColor } from '@/lib/format'
import type { Enriched } from './CandidaturesTable'

/**
 * Modal de détail d'une candidature (V48). Reprend tous les éléments
 * d'analyse IA (score + points forts/faibles + justification texte) qui
 * étaient affichés inline dans la liste des candidatures, plus le statut
 * email + le CV, dans un format plus lisible « fiche candidat ».
 *
 * Pourquoi : la liste des candidatures était devenue dense (la colonne
 * Justification IA pouvait prendre 4-5 lignes par candidat). En sortant
 * tout le détail dans une modal, chaque candidat tient sur 1-2 lignes
 * dans la liste, ce qui rend la pagination par scroll bien plus visible.
 *
 * Layout : 2 colonnes sur desktop (analyse à gauche, CV à droite),
 * empilées en single-column sur mobile. Pattern d'accessibilité aligné
 * sur DeleteOffreButton / DeleteClientButton (focus trap, Escape, click
 * outside).
 */

type Props = {
  candidature: Enriched
  onClose: () => void
}

function initials(name: string | null) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0][0]?.toUpperCase() || '?'
  return (
    (parts[0][0] || '') + (parts[parts.length - 1][0] || '')
  ).toUpperCase()
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('fr-FR')
}

export default function CandidatureDetailModal({ candidature, onClose }: Props) {
  const c = candidature
  const offre = c._offre
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const hasRealEmail =
    !!c.email?.trim() && !c.email.endsWith('@example.com')
  const isEnAttente = c.statut === 'en attente'

  const forts = c.points_forts ?? []
  const faibles = c.points_faibles ?? []
  const fullText = (c.justification_ia ?? '').trim()
  const hasJustification =
    forts.length > 0 || faibles.length > 0 || fullText.length > 0

  // A11y — focus initial sur le bouton fermer.
  useEffect(() => {
    closeButtonRef.current?.focus()
  }, [])

  // A11y — focus trap + Escape (cohérent avec les autres modals du projet).
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const dialog = dialogRef.current
      if (!dialog) return
      const focusables = dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      )
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Pattern « min-h-full + flex centré dans un parent scrollable » :
  // évite le bug classique où `flex items-center` + `overflow-y-auto` font
  // sortir le haut du modal hors du viewport quand le contenu dépasse en
  // hauteur (impossible alors de scroller jusqu'au début).
  //
  // Outer (fixed + overflow-y-auto) : crée le contexte de scroll.
  // Middle (min-h-full + flex items-center) : centre si possible, grandit
  // sinon — le scroll du parent permet de remonter au début.
  // Inner : le contenu du modal lui-même.
  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 overflow-y-auto"
      onClick={onClose}
    >
      <div className="min-h-full flex items-center justify-center p-4">
        <div
          ref={dialogRef}
          onClick={(e) => e.stopPropagation()}
          className="bg-white rounded-xl shadow-xl max-w-3xl w-full my-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="candidature-modal-title"
        >
        {/* En-tête : avatar + identité + statut + bouton fermer */}
        <div className="flex items-start gap-4 p-6 border-b border-border-soft">
          <div
            className="w-12 h-12 rounded-full bg-brand-purple-soft text-brand-purple flex items-center justify-center font-bold text-lg shrink-0"
            aria-hidden="true"
          >
            {initials(c.nom)}
          </div>
          <div className="flex-1 min-w-0">
            <h2
              id="candidature-modal-title"
              className="font-bold text-lg break-words"
            >
              {c.nom?.trim() || 'Candidat sans nom'}
            </h2>
            <div className="flex items-center gap-2 flex-wrap mt-1 text-sm">
              {hasRealEmail ? (
                <a
                  href={`mailto:${c.email}`}
                  className="text-brand-purple hover:underline truncate"
                >
                  {c.email}
                </a>
              ) : (
                <span className="text-muted italic">
                  email non extrait
                </span>
              )}
              {offre && (
                <>
                  <span className="text-muted" aria-hidden="true">·</span>
                  <span className="text-muted">
                    Offre : <strong>{offre.titre}</strong>
                    {offre.reference ? ` (${offre.reference})` : ''}
                  </span>
                </>
              )}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <StatusBadge status={c.statut ?? 'en attente'} />
              <span className="text-xs text-muted">
                Reçu le {formatDate(c.created_at)}
              </span>
            </div>
          </div>
          <button
            type="button"
            ref={closeButtonRef}
            onClick={onClose}
            className="text-muted hover:text-brand-indigo-text text-2xl leading-none px-2 -mt-1 -mr-2"
            aria-label="Fermer la fiche candidat"
          >
            ×
          </button>
        </div>

        {/* Corps : 2 colonnes sur desktop, empilées sur mobile */}
        <div className="grid md:grid-cols-[1fr,auto] gap-6 p-6">
          {/* Colonne gauche : analyse IA */}
          <div className="space-y-5 min-w-0">
            {/* Score IA */}
            <div>
              <div className="text-xs uppercase font-semibold text-muted tracking-wide">
                Score IA
              </div>
              <div className="flex items-center gap-3 mt-1.5">
                <span
                  className={`text-3xl font-bold tabular-nums ${scoreColor(c.score_ia, offre?.seuil ?? null)}`}
                >
                  {c.score_ia ?? '—'}
                </span>
                {offre?.seuil != null && c.score_ia != null && (
                  <span className="text-sm text-muted">
                    / {offre.seuil} (seuil)
                  </span>
                )}
              </div>
              {c.score_ia != null && (
                <div
                  className="h-2 bg-surface rounded-full overflow-hidden mt-2"
                  role="presentation"
                >
                  <div
                    className="h-full bg-brand-purple transition-all"
                    style={{ width: `${Math.min(100, Math.max(0, c.score_ia))}%` }}
                  />
                </div>
              )}
            </div>

            {/* Points forts / faibles — cartes côte à côte (image fournie) */}
            {(forts.length > 0 || faibles.length > 0) && (
              <div className="grid sm:grid-cols-2 gap-3">
                {forts.length > 0 && (
                  <div className="rounded-lg border border-status-green/30 bg-status-green-bg/40 p-3">
                    <div className="text-xs uppercase font-semibold text-status-green mb-1.5">
                      Points forts
                    </div>
                    <ul className="space-y-1.5">
                      {forts.map((p, i) => (
                        <li
                          key={i}
                          className="flex gap-2 text-sm text-brand-indigo-text"
                        >
                          <span
                            className="inline-block w-1.5 h-1.5 rounded-full bg-status-green mt-1.5 shrink-0"
                            aria-hidden="true"
                          />
                          <span>{p}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {faibles.length > 0 && (
                  <div className="rounded-lg border border-status-red/30 bg-status-red-bg/40 p-3">
                    <div className="text-xs uppercase font-semibold text-status-red mb-1.5">
                      Points faibles
                    </div>
                    <ul className="space-y-1.5">
                      {faibles.map((p, i) => (
                        <li
                          key={i}
                          className="flex gap-2 text-sm text-brand-indigo-text"
                        >
                          <span
                            className="inline-block w-1.5 h-1.5 rounded-full bg-status-red mt-1.5 shrink-0"
                            aria-hidden="true"
                          />
                          <span>{p}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Synthèse texte — fallback ou complément aux bullets */}
            {fullText && (
              <div>
                <div className="text-xs uppercase font-semibold text-muted tracking-wide">
                  Synthèse IA
                </div>
                <p className="text-sm text-brand-indigo-text leading-relaxed whitespace-pre-wrap mt-1.5">
                  {fullText}
                </p>
              </div>
            )}

            {!hasJustification && (
              <div className="text-sm text-muted italic">
                Aucune justification IA disponible pour cette candidature.
              </div>
            )}

            {/* Notification client — affichée uniquement si problème ou état
                qualifié. Permet de relancer en un clic depuis la fiche. */}
            {(c.email_error || c.email_sent_at) && (
              <div className="border-t border-border-soft pt-4">
                <div className="text-xs uppercase font-semibold text-muted tracking-wide mb-1.5">
                  Notification client
                </div>
                {c.email_error ? (
                  <div className="rounded-lg border border-status-amber/40 bg-status-amber-bg/40 p-3">
                    <div className="text-sm font-semibold text-status-amber mb-1">
                      ⚠ Notification non envoyée
                    </div>
                    <div className="text-xs text-muted mb-2">
                      {c.email_error}
                    </div>
                    <ResendEmailAction
                      candidatureId={c.id}
                      emailError={c.email_error}
                      size="md"
                    />
                  </div>
                ) : (
                  <div className="text-sm text-status-green">
                    ✓ Email envoyé le {formatDate(c.email_sent_at)}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Colonne droite : CV */}
          <div className="md:w-56 space-y-3">
            <div className="text-xs uppercase font-semibold text-muted tracking-wide">
              CV du candidat
            </div>
            {c.cv_url ? (
              <a
                href={c.cv_url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 border-brand-purple text-brand-purple text-sm font-semibold hover:bg-brand-purple hover:text-white transition-colors w-full"
              >
                <span aria-hidden="true">📄</span> Ouvrir le CV (PDF)
              </a>
            ) : (
              <div className="text-sm text-muted italic">
                Aucun CV en pièce jointe.
              </div>
            )}
          </div>
        </div>

        {/* Pied : actions Qualifier/Rejeter pour les en-attente */}
        {isEnAttente && (
          <div className="border-t border-border-soft px-6 py-4 flex items-center justify-end gap-3">
            <span className="text-sm text-muted mr-auto">
              Action sur cette candidature :
            </span>
            <CandidatureActions candidatureId={c.id} />
          </div>
        )}
        </div>
      </div>
    </div>
  )
}
