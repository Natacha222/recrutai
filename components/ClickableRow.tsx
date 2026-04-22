'use client'

import { useRouter } from 'next/navigation'
import type { ReactNode, MouseEvent } from 'react'

/**
 * Ligne de tableau cliquable en entier — confort souris uniquement.
 *
 * Accessibilité :
 * Chaque consumer (ex. /clients) place un `<Link>` à l'intérieur de la
 * 1re cellule qui pointe vers la même URL. Ce Link est focusable au
 * clavier et annoncé par les lecteurs d'écran — la navigation clavier
 * fonctionne donc déjà sans rien ajouter à la `<tr>`.
 *
 * On n'ajoute volontairement PAS `role="button"` + `tabIndex={0}` ici :
 *   - ce serait un double stop clavier par ligne (Link + row)
 *   - sur une liste de 50+ lignes, ça alourdit inutilement la nav
 *   - le screen reader annoncerait la ligne comme « bouton » ET comme
 *     « ligne de tableau », ce qui est déroutant
 * Le click-row reste donc un bonus souris, pas une feature clavier.
 */
export default function ClickableRow({
  href,
  children,
  className = '',
}: {
  href: string
  children: ReactNode
  className?: string
}) {
  const router = useRouter()

  const handleClick = (e: MouseEvent<HTMLTableRowElement>) => {
    // Si l'utilisateur clique sur un lien ou un bouton à l'intérieur, ne pas intercepter
    const target = e.target as HTMLElement
    if (target.closest('a, button, input, select, textarea')) return
    router.push(href)
  }

  return (
    <tr
      onClick={handleClick}
      className={`cursor-pointer ${className}`}
    >
      {children}
    </tr>
  )
}
