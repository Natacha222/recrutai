import Sidebar from '@/components/Sidebar'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      {/* min-w-0 : sans ça, flexbox laisse <main> grandir pour accommoder
          un contenu large (ex : tableau des offres à 10 colonnes), ce qui
          pousse le bouton « + Nouvelle offre » hors écran et rend le
          `overflow-x-auto` des wrappers internes inopérant. */}
      <main id="main-content" tabIndex={-1} className="flex-1 min-w-0 p-8">
        {children}
      </main>
    </div>
  )
}
