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

/**
 * Retourne la date du jour en Europe/Paris au format YYYY-MM-DD.
 * Utilisée à la fois pour la validation des formulaires et le calcul
 * du statut effectif d'une offre. On passe par Intl pour que Vercel
 * (serveur UTC) ne décale pas la date d'un jour aux heures de nuit FR.
 */
export function todayIso(): string {
  const parts = new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const y = parts.find((p) => p.type === 'year')?.value ?? ''
  const m = parts.find((p) => p.type === 'month')?.value ?? ''
  const d = parts.find((p) => p.type === 'day')?.value ?? ''
  return `${y}-${m}-${d}`
}

/** true si la date de validité est strictement antérieure à aujourd'hui. */
export function isExpired(dateValidite: string | null | undefined): boolean {
  if (!dateValidite) return false
  // Les ISO YYYY-MM-DD se comparent lexicographiquement = chronologiquement.
  return dateValidite < todayIso()
}

/**
 * Statut effectif d'une offre, qui combine le statut manuel stocké en base
 * et la date de validité. Une offre dont la date est dépassée bascule
 * automatiquement en « clos », même si l'utilisateur n'a rien touché.
 */
export function effectiveStatut(
  rawStatut: string | null | undefined,
  dateValidite: string | null | undefined
): 'actif' | 'clos' {
  if (rawStatut === 'clos') return 'clos'
  if (isExpired(dateValidite)) return 'clos'
  return 'actif'
}

/**
 * Normalise un référent au format « F. NOM » :
 *   - 1re lettre du prénom en majuscule, suivie d'un point et d'un espace
 *   - Nom en majuscules
 *
 * Exemples :
 *   formatReferent('Natacha Magne')  -> 'N. MAGNE'
 *   formatReferent('N MAGNE')        -> 'N. MAGNE'
 *   formatReferent('N. MAGNE')       -> 'N. MAGNE'
 *   formatReferent('jean-pierre dupont') -> 'J. DUPONT'
 *   formatReferent('  ')             -> null
 *
 * Si l'entrée ne contient qu'un seul mot, renvoie ce mot en majuscules
 * (sans le point) — on ne sait pas si c'est un prénom ou un nom.
 */
export function formatReferent(
  raw: string | null | undefined
): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  const parts = trimmed.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return null
  if (parts.length === 1) return parts[0].toUpperCase()
  const firstLetter = parts[0].charAt(0).toUpperCase()
  const lastName = parts.slice(1).join(' ').toUpperCase()
  return `${firstLetter}. ${lastName}`
}

/**
 * Normalise un nom de client pour détecter les doublons :
 * minuscules, sans accents, espaces compactés. Utilisée uniquement
 * pour la comparaison — le nom affiché reste celui saisi.
 *
 * Exemples :
 *   normalizeClientName('Danone')         -> 'danone'
 *   normalizeClientName('  DANONE  ')     -> 'danone'
 *   normalizeClientName('Crédit Agricole') -> 'credit agricole'
 *   normalizeClientName('L Oréal')        -> 'l oreal'
 */
export function normalizeClientName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
}

/**
 * Déduit un référent au format canonique « F. NOM » depuis un email.
 * Règle : on prend la partie locale de l'email, on transforme les
 * séparateurs (. _ -) en espaces, puis on délègue à formatReferent.
 *
 * Exemples :
 *   referentFromEmail('n.magne@agoriade.fr')     -> 'N. MAGNE'
 *   referentFromEmail('jean.dupont@recrutai.fr') -> 'J. DUPONT'
 *   referentFromEmail('contact@x.fr')            -> 'CONTACT'
 *   referentFromEmail('')                        -> null
 */
export function referentFromEmail(
  email: string | null | undefined
): string | null {
  if (!email) return null
  const local = email.split('@')[0] ?? ''
  if (!local) return null
  const withSpaces = local.replace(/[._-]+/g, ' ')
  return formatReferent(withSpaces)
}
