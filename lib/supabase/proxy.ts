import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const url = request.nextUrl.clone()

  // Pages publiques (accessibles sans être connecté) :
  //   - /login : formulaire de connexion
  //   - /mot-de-passe-oublie : demande de lien de réinitialisation
  //   - /auth/* : callback OAuth/recovery, logout, reset du mot de passe
  //   - /api/cron/* : endpoints de cron Vercel — ces routes ont leur
  //     propre auth via CRON_SECRET (cf. route.ts). Sans cette exception,
  //     le proxy redirigerait vers /login et le cron Vercel recevrait du
  //     HTML au lieu de notre JSON.
  const isPublic =
    url.pathname === '/login' ||
    url.pathname === '/mot-de-passe-oublie' ||
    url.pathname.startsWith('/auth') ||
    url.pathname.startsWith('/api/cron')

  if (!user && !isPublic) {
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Un utilisateur déjà connecté n'a rien à faire sur les écrans
  // d'identification : on le renvoie au dashboard. En revanche on ne
  // redirige PAS depuis /auth/reinitialiser : après le callback PKCE de
  // Supabase, l'utilisateur y accède avec une session active et doit
  // pouvoir y saisir son nouveau mot de passe.
  if (
    user &&
    (url.pathname === '/login' || url.pathname === '/mot-de-passe-oublie')
  ) {
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
