'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

// Icônes SVG distinctes (Heroicons outline) plutôt que 3 losanges Unicode
// quasi-identiques ◆◈◉ : un nouveau collaborateur confond les entrées au
// premier regard sinon. `currentColor` suit la couleur du texte pour
// conserver le contraste sur l'état actif/inactif.
const iconProps = {
  className: 'w-5 h-5 shrink-0',
  fill: 'none',
  viewBox: '0 0 24 24',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  'aria-hidden': true as const,
}

const DashboardIcon = (
  <svg {...iconProps}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6Zm0 9.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6Zm0 9.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z"
    />
  </svg>
)

const ClientsIcon = (
  <svg {...iconProps}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21"
    />
  </svg>
)

const OffresIcon = (
  <svg {...iconProps}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 0 0 .75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 0 0-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0 1 12 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 0 1-.673-.38m0 0A2.18 2.18 0 0 1 3 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 0 1 3.413-.387m7.5 0V5.25A2.25 2.25 0 0 0 13.5 3h-3a2.25 2.25 0 0 0-2.25 2.25v.894m7.5 0a48.667 48.667 0 0 0-7.5 0"
    />
  </svg>
)

const CandidaturesIcon = (
  <svg {...iconProps}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z"
    />
  </svg>
)

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: DashboardIcon },
  { href: '/clients', label: 'Clients', icon: ClientsIcon },
  { href: '/offres', label: 'Offres d\u2019emploi', icon: OffresIcon },
  { href: '/candidatures', label: 'Candidatures', icon: CandidaturesIcon },
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
          src="/logo.webp"
          alt="RecrutAI"
          width={400}
          height={420}
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
              {item.icon}
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
