'use client'

import { useRouter } from 'next/navigation'
import type { ReactNode, MouseEvent } from 'react'

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
