'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: '◆' },
  { href: '/clients', label: 'Clients', icon: '◈' },
  { href: '/offres', label: 'Offres d\u2019emploi', icon: '◉' },
]

/**
 * Dérive nom affiché et initiales depuis l'email de l'utilisateur,
 * uniquement en fallback quand prenom/nom ne sont pas renseignés dans
 * user_metadata côté Supabase.
 *
 * Format de sortie : "initiale du prénom + . + nom en majuscules",
 * cohérent avec l'affichage du référent dans les tableaux.
 *   - "n.magne@agoriade.fr" → { displayName: "N. MAGNE", initials: "NM" }
 *   - "natacha.magne@…"     → { displayName: "N. MAGNE", initials: "NM" }
 *   - "contact@…"           → { displayName: "CONTACT",  initials: "CO" }
 */
function deriveUserFromEmail(email: string): {
  displayName: string
  initials: string
} {
  const local = email.split('@')[0] ?? ''
  const parts = local.split('.').filter(Boolean)

  if (parts.length >= 2) {
    const first = parts[0]
    const last = parts[parts.length - 1]
    return {
      displayName: `${first.charAt(0).toUpperCase()}. ${last.toUpperCase()}`,
      initials: (first.charAt(0) + last.charAt(0)).toUpperCase(),
    }
  }

  return {
    displayName: (local || 'utilisateur').toUpperCase(),
    initials: (local.slice(0, 2) || '??').toUpperCase(),
  }
}

export default function Sidebar({
  email,
  prenom,
  nom,
}: {
  email: string
  prenom: string | null
  nom: string | null
}) {
  const pathname = usePathname()

  // Priorité à user_metadata quand il est renseigné ; sinon heuristique
  // sur l'email (utile pour les users créés sans metadata).
  // Format unifié : "N. MAGNE" (initiale prénom + nom en majuscules),
  // identique au format du référent affiché dans les tableaux.
  const { displayName, initials } =
    prenom && nom
      ? {
          displayName: `${prenom.charAt(0).toUpperCase()}. ${nom.toUpperCase()}`,
          initials: `${prenom.charAt(0)}${nom.charAt(0)}`.toUpperCase(),
        }
      : deriveUserFromEmail(email)

  return (
    <aside className="w-44 shrink-0 bg-brand-indigo text-brand-indigo-light sticky top-0 h-screen flex flex-col">
      {/* Logo — remplace l'ancien texte "RecrutAI" */}
      <div className="px-2 py-4">
        <Image
          src="/logo.png"
          alt="RecrutAI"
          width={200}
          height={200}
          priority
          className="h-20 w-auto"
        />
      </div>

      <nav className="flex-1 px-2 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const active = pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2 px-2.5 py-2 rounded-md text-sm font-medium transition-colors ${
                active
                  ? 'bg-white/10 text-white'
                  : 'hover:bg-white/5 hover:text-white'
              }`}
            >
              <span className="text-base">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>

      {/* Bloc utilisateur + déconnexion. Le nom est rendu accessible via
          le texte lui-même ; l'avatar est décoratif (initiales lues par
          le texte à côté), d'où aria-hidden. */}
      <div className="p-3 shrink-0 border-t border-white/10 space-y-3">
        <div className="flex items-center gap-2">
          <div
            aria-hidden="true"
            className="w-8 h-8 rounded-full bg-brand-purple text-white font-semibold text-xs flex items-center justify-center shrink-0"
          >
            {initials}
          </div>
          <div
            className="text-sm text-white font-medium truncate"
            title={displayName}
          >
            {displayName}
          </div>
        </div>
        <form action="/auth/logout" method="post">
          <button
            type="submit"
            className="w-full text-left text-xs text-brand-indigo-light hover:text-white"
          >
            Se déconnecter
          </button>
        </form>
      </div>
    </aside>
  )
}
