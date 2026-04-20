type Formule = 'Abonnement' | 'À la mission' | 'Volume entreprise'

const styles: Record<Formule, { bg: string; color: string }> = {
  Abonnement: { bg: '#EDE9FE', color: '#7C3AED' },
  'À la mission': { bg: '#FEF3C7', color: '#CC8C00' },
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
