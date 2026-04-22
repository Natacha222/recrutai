import Sidebar from '@/components/Sidebar'
import { createClient } from '@/lib/supabase/server'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Le middleware (lib/supabase/proxy.ts) garantit qu'on a un user sur
  // toutes les routes de /(app). On fetch quand même ici pour passer
  // identité à la Sidebar (bloc utilisateur).
  //
  // On préfère lire prenom/nom depuis user_metadata (renseigné via le
  // dashboard Supabase), et on tombe sur une dérivation depuis l'email
  // côté Sidebar si la metadata est absente.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const email = user?.email ?? ''
  const meta = user?.user_metadata ?? {}
  const prenom = typeof meta.prenom === 'string' ? meta.prenom : null
  const nom = typeof meta.nom === 'string' ? meta.nom : null

  return (
    <div className="flex min-h-screen">
      <Sidebar email={email} prenom={prenom} nom={nom} />
      {/* min-w-0 : sans ça, flexbox laisse <main> grandir pour accommoder
          un contenu large (ex : tableau des offres à 10 colonnes), ce qui
          pousse le bouton « + Nouvelle offre » hors écran et rend le
          `overflow-x-auto` des wrappers internes inopérant. */}
      <main id="main-content" tabIndex={-1} className="flex-1 min-w-0 p-6">
        {children}
      </main>
    </div>
  )
}
