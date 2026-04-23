import Link from 'next/link'
import { requestPasswordReset } from './actions'

type SearchParams = Promise<{ error?: string }>

export default async function MotDePasseOubliePage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const { error } = await searchParams

  return (
    <div className="min-h-screen flex">
      {/* Panneau gauche décoratif (identique au login pour garder le même
          univers visuel entre les deux écrans d'authentification) */}
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

      {/* Formulaire */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-bold text-brand-indigo-text mb-2">
            Mot de passe oublié
          </h2>
          <p className="text-sm text-muted mb-8">
            Saisis ton adresse email, nous t&apos;enverrons un lien pour
            définir un nouveau mot de passe.
          </p>

          {error && (
            <div
              role="alert"
              className="mb-4 px-3 py-2 rounded-md bg-status-red-bg text-status-red text-sm"
            >
              {error}
            </div>
          )}

          <form action={requestPasswordReset} className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-brand-indigo-text mb-1"
              >
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                className="w-full px-3 py-2 border border-border-soft rounded-md focus:outline-none focus:ring-2 focus:ring-brand-purple"
              />
            </div>

            <button
              type="submit"
              className="w-full py-2.5 bg-brand-purple text-white font-semibold rounded-md hover:opacity-90 transition"
            >
              Envoyer le lien
            </button>
          </form>

          <div className="mt-6 text-center">
            <Link
              href="/login"
              className="text-sm text-muted hover:text-brand-purple hover:underline"
            >
              ← Retour à la connexion
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
