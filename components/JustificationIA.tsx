'use client'

import { useState } from 'react'

type Props = {
  /** Forces extraites par l'IA (colonne `points_forts`). `null` ou `[]` =
   *  candidatures scorées avant la décomposition → on tombe sur le fallback. */
  pointsForts: string[] | null
  /** Lacunes / points à challenger (colonne `points_faibles`). */
  pointsFaibles: string[] | null
  /** Résumé 2-4 phrases (colonne `justification_ia`). Utilisé en fallback
   *  quand les arrays sont vides ET affiché en version dépliée pour tout
   *  le contexte. */
  justification: string | null
  /** Contexte d'affichage : `table` pour les listings denses (liste globale
   *  des candidatures) — préfixe les titres avec un petit badge couleur et
   *  compacte le vertical. `card` pour les vues détail (fiche offre). */
  variant?: 'table' | 'card'
}

/**
 * Affichage condensé de la justification IA d'une candidature.
 *
 * Par défaut : jusqu'à 3 bullets forts + jusqu'à 3 bullets faibles + bouton
 * « Voir plus » qui déplie les autres bullets (s'il y en a) + le résumé
 * texte complet. On montre TOUT ce qui est dispo jusqu'à la limite — donc
 * 2 items s'il y en a 2, 3 items s'il y en a 3+. Si les arrays sont vides
 * (données pré-refactor), on montre directement le résumé brut pour rester
 * rétrocompatible — pas de bouton inutile.
 *
 * Client Component : nécessaire pour le toggle open/close. Reste léger
 * (un seul useState, pas d'effet, pas de ref) pour éviter l'impact perf
 * dans les listings qui rendent cette boîte pour chaque ligne.
 */
export default function JustificationIA({
  pointsForts,
  pointsFaibles,
  justification,
  variant = 'table',
}: Props) {
  const [open, setOpen] = useState(false)

  const forts = pointsForts ?? []
  const faibles = pointsFaibles ?? []
  const hasStructured = forts.length > 0 || faibles.length > 0
  const fullText = (justification ?? '').trim()

  // Fallback : rien d'utile → petit tiret discret. Cas rare (scoring
  // totalement vide) mais évite un bloc blanc dans le listing.
  if (!hasStructured && !fullText) {
    return <span className="text-muted text-xs">—</span>
  }

  // Données pré-refactor : pas de structure, juste la justification brute.
  // On cache le pavé de texte derrière un bouton pour que le listing
  // reste compact — avant, on affichait le paragraphe en line-clamp-4
  // et ça bouffait toute la largeur de la table. Cohérent avec le mode
  // structuré qui met aussi le texte brut derrière « Voir plus ».
  if (!hasStructured) {
    return (
      <div className="text-xs">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-brand-purple hover:underline font-medium"
          aria-expanded={open}
        >
          {open ? 'Masquer la justification' : 'Voir la justification IA'}
        </button>
        {open && (
          <p className="text-muted leading-relaxed whitespace-pre-wrap mt-1.5 pt-1.5 border-t border-border-soft/60">
            {fullText}
          </p>
        )}
      </div>
    )
  }

  // On montre jusqu'à 3 bullets dans l'état compact (pas forcément 3 — on
  // prend ce qui est dispo). Côté IA le prompt demande 3-5 items donc en
  // général on a 3-5 → slice(0,3) affiche 3 et laisse 0-2 en extras.
  // Si l'IA n'a rendu que 2 items, on affiche 2 et le bouton « Voir plus »
  // reste utile tant qu'il y a une justification texte à exposer.
  const COMPACT_LIMIT = 3
  const fortsShort = forts.slice(0, COMPACT_LIMIT)
  const faiblesShort = faibles.slice(0, COMPACT_LIMIT)
  const fortsExtra = forts.slice(COMPACT_LIMIT)
  const faiblesExtra = faibles.slice(COMPACT_LIMIT)
  const hasExtras =
    fortsExtra.length > 0 || faiblesExtra.length > 0 || fullText.length > 0

  const wrapperClass =
    variant === 'card'
      ? 'space-y-3 text-sm'
      : 'space-y-1.5 text-xs leading-relaxed'

  return (
    <div className={wrapperClass}>
      {fortsShort.length > 0 && (
        <Section
          label="Points forts"
          color="green"
          items={fortsShort}
          variant={variant}
        />
      )}
      {faiblesShort.length > 0 && (
        <Section
          label="Points faibles"
          color="red"
          items={faiblesShort}
          variant={variant}
        />
      )}

      {open && (
        <div className="space-y-2 pt-1 border-t border-border-soft/60 mt-2">
          {fortsExtra.length > 0 && (
            <Section
              label="Autres forces"
              color="green"
              items={fortsExtra}
              variant={variant}
            />
          )}
          {faiblesExtra.length > 0 && (
            <Section
              label="Autres points faibles"
              color="red"
              items={faiblesExtra}
              variant={variant}
            />
          )}
          {fullText && (
            <div>
              <div className="text-[11px] uppercase font-semibold text-muted mb-0.5">
                Synthèse IA
              </div>
              <p className="text-xs text-muted leading-relaxed whitespace-pre-wrap">
                {fullText}
              </p>
            </div>
          )}
        </div>
      )}

      {hasExtras && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-xs text-brand-purple hover:underline font-medium"
          aria-expanded={open}
        >
          {open ? 'Masquer' : 'Voir plus'}
        </button>
      )}
    </div>
  )
}

function Section({
  label,
  color,
  items,
  variant,
}: {
  label: string
  color: 'green' | 'red'
  items: string[]
  variant: 'table' | 'card'
}) {
  const dotClass =
    color === 'green' ? 'bg-status-green' : 'bg-status-red'
  const labelClass =
    color === 'green' ? 'text-status-green' : 'text-status-red'
  const textClass =
    variant === 'card' ? 'text-sm text-brand-indigo-text' : 'text-xs text-muted'

  return (
    <div>
      <div
        className={`text-[11px] uppercase font-semibold flex items-center gap-1 ${labelClass}`}
      >
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full ${dotClass}`}
          aria-hidden
        />
        {label}
      </div>
      <ul className="list-disc pl-5 mt-0.5 space-y-0.5">
        {items.map((it, i) => (
          <li key={i} className={textClass}>
            {it}
          </li>
        ))}
      </ul>
    </div>
  )
}
