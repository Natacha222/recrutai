'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: '◆' },
  { href: '/clients', label: 'Clients', icon: '◈' },
  { href: '/offres', label: 'Offres d\u2019emploi', icon: '◉' },
]

export default function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-60 shrink-0 bg-brand-indigo text-brand-indigo-light min-h-screen flex flex-col">
      <div className="px-6 py-6 text-white font-bold text-lg tracking-wide">
        RecrutAI
      </div>
      <nav className="flex-1 px-3 space-y-1">
        {navItems.map((item) => {
          const active = pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
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
      <form action="/auth/logout" method="post" className="p-4">
        <button
          type="submit"
          className="w-full text-left text-xs text-brand-indigo-light/70 hover:text-white"
        >
          Se déconnecter
        </button>
      </form>
    </aside>
  )
}
