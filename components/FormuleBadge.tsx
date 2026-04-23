type Formule = 'Abonnement' | 'À la mission' | 'Volume entreprise'

// Couleurs alignées sur la palette `--color-status-*` de globals.css pour
// garantir un contraste AA (≥ 4.5:1) sur chaque couple fond/texte. Avant
// V35, « À la mission » utilisait #CC8C00 (≈ 2.5:1 sur #FEF3C7) — sous AA.
const styles: Record<Formule, { bg: string; color: string }> = {
  Abonnement: { bg: '#EDE9FE', color: '#7C3AED' },
  'À la mission': { bg: '#FEF3C7', color: '#8B6100' },
  'Volume entreprise': { bg: '#E0F2FE', color: '#0369A1' },
}

export default function FormuleBadge({ formule }: { formule: string | null }) {
  if (!formule) return <span className="text-muted text-xs">—</span>
  const style =
    styles[formule as Formule] ?? { bg: '#F8FAFC', color: '#6B7280' }
  return (
    <span
      className="inline-block px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap"
      style={{ backgroundColor: style.bg, color: style.color }}
    >
      {formule}
    </span>
  )
}
