import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

export const metadata: Metadata = {
  title: 'RecrutAI',
  description: 'Plateforme de recrutement assistée par IA',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="fr" className={inter.variable}>
      <body className="min-h-screen antialiased">
        {/* Skip link a11y : caché par défaut, visible au focus clavier.
            Permet aux utilisateurs au clavier / lecteur d'écran de sauter
            la sidebar et d'aller directement au contenu principal. */}
        <a
          href="#main-content"
          className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-3 focus-visible:left-3 focus-visible:z-50 focus-visible:px-4 focus-visible:py-2 focus-visible:rounded-md focus-visible:bg-brand-purple focus-visible:text-white focus-visible:font-semibold"
        >
          Aller au contenu principal
        </a>
        {children}
      </body>
    </html>
  )
}
