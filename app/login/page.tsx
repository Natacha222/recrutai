import { login } from './actions'

type SearchParams = Promise<{ error?: string }>

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const { error } = await searchParams

  return (
    <div className="min-h-screen flex">
      {/* Panneau gauche décoratif */}
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
          <p className="mt-6 text-sm opacity-90">
            Identifiez en quelques secondes les candidats les plus qualifiés
            pour chaque offre d&apos;emploi.
          </p>
        </div>
      </div>

      {/* Formulaire */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-bold text-brand-indigo-text mb-2">
            Connexion
          </h2>
          <p className="text-sm text-muted mb-8">
            Accédez à votre espace RecrutAI
          </p>

          {error && (
            <div className="mb-4 px-3 py-2 rounded-md bg-status-red-bg text-status-red text-sm">
              {error}
            </div>
          )}

          <form action={login} className="space-y-4">
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

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-brand-indigo-text mb-1"
              >
                Mot de passe
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                className="w-full px-3 py-2 border border-border-soft rounded-md focus:outline-none focus:ring-2 focus:ring-brand-purple"
              />
            </div>

            <button
              type="submit"
              className="w-full py-2.5 bg-brand-purple text-white font-semibold rounded-md hover:opacity-90 transition"
            >
              Se connecter
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
