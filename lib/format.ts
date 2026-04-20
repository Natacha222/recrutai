/**
 * Formate une date Postgres (ISO YYYY-MM-DD) en français (JJ/MM/AAAA).
 * Retourne '—' si la valeur est nulle ou malformée.
 *
 * On parse à la main plutôt que new Date() pour éviter les bascules UTC
 * sur les dates « pures » (sans heure).
 */
export function formatValidite(d: string | null | undefined): string {
  if (!d) return '—'
  const parts = d.split('-')
  if (parts.length !== 3) return d
  return `${parts[2]}/${parts[1]}/${parts[0]}`
}
