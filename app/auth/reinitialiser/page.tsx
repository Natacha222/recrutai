import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { updatePassword } from './actions'

type SearchParams = Promise<{ error?: string }>

export default async function ReinitialiserPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const { error } = await searchParams

  // Vérifie qu'il y a bien une session active (l'utilisateur vient du
  // callback PKCE). Sans session, impossible de mettre à jour le mot
  // de passe : on affiche un message + un lien pour redemander l'email.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <div className="min-h-screen flex">
      <div
        className="hidden lg:flex lg:w-1/2 bg-brand-indigo items-end p-12 relative overflow-hidden"
        style={{
          backgroundImage:
            "linear-gradient(to bottom, rgba(30, 27, 75, 0.45), rgba(30, 27, 75, 0.85)), url('/login-hero.png')",
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <div className="max-w-md text-brand-indigo-light relative z-10">
          <h1 className="text-4xl font-bold text-white mb-4">RecrutAI</h1>
          <p className="text-lg">
            L&apos;intelligence artificielle au service de vos recrutements.
          </p>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-bold text-brand-indigo-text mb-2">
            Nouveau mot de passe
          </h2>

          {!user ? (
            <>
              <p className="text-sm text-muted mb-6">
                Le lien est invalide ou a expiré. Redemande un email de
                réinitialisation pour définir un nouveau mot de passe.
              </p>
              <Link
                href="/mot-de-passe-oublie"
                className="inline-block w-full py-2.5 bg-brand-purple text-white font-semibold rounded-md hover:opacity-90 transition text-center"
              >
                Demander un nouveau lien
              </Link>
            </>
          ) : (
            <>
              <p className="text-sm text-muted mb-8">
                Choisis un nouveau mot de passe pour{' '}
                <span className="font-medium text-brand-indigo-text">
                  {user.email}
                </span>
                .
              </p>

              {error && (
                <div
                  role="alert"
                  className="mb-4 px-3 py-2 rounded-md bg-status-red-bg text-status-red text-sm"
                >
                  {error}
                </div>
              )}

              <form action={updatePassword} className="space-y-4">
                <div>
                  <label
                    htmlFor="password"
                    className="block text-sm font-medium text-brand-indigo-text mb-1"
                  >
                    Nouveau mot de passe
                  </label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    className="w-full px-3 py-2 border border-border-soft rounded-md focus:outline-none focus:ring-2 focus:ring-brand-purple"
                  />
                  <p className="text-sm text-muted mt-1">
                    8 caractères minimum.
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="password_confirm"
                    className="block text-sm font-medium text-brand-indigo-text mb-1"
                  >
                    Confirmation
                  </label>
                  <input
                    id="password_confirm"
                    name="password_confirm"
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    className="w-full px-3 py-2 border border-border-soft rounded-md focus:outline-none focus:ring-2 focus:ring-brand-purple"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full py-2.5 bg-brand-purple text-white font-semibold rounded-md hover:opacity-90 transition"
                >
                  Enregistrer le nouveau mot de passe
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
