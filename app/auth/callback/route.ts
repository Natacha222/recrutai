import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Callback OAuth / recovery de Supabase. Point d'atterrissage du lien
 * envoyé par email lors d'une réinitialisation de mot de passe.
 *
 * Flow PKCE :
 *   1. Supabase envoie un email au user avec un lien contenant un code
 *      de récupération → `redirectTo` pointe ici avec `?code=xxx`.
 *   2. On échange ce code contre une session active (cookies posés par
 *      createServerClient) via exchangeCodeForSession.
 *   3. On redirige vers `?next=...` — par défaut /auth/reinitialiser
 *      pour le flow « mot de passe oublié ».
 *
 * En cas d'échec (code invalide, expiré, déjà utilisé) on renvoie vers
 * /login avec un message d'erreur générique.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const next = url.searchParams.get('next') ?? '/auth/reinitialiser'

  // Garde-fou : on n'autorise que des chemins internes pour éviter un
  // open redirect via ?next=https://phishing.example.
  const safeNext = next.startsWith('/') ? next : '/auth/reinitialiser'

  if (!code) {
    return NextResponse.redirect(
      new URL(
        '/login?error=Lien+invalide+ou+expir%C3%A9',
        request.url
      )
    )
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    console.error(`[auth/callback] ${error.message}`)
    return NextResponse.redirect(
      new URL(
        '/login?error=Lien+invalide+ou+expir%C3%A9%2C+merci+de+redemander+un+email',
        request.url
      )
    )
  }

  return NextResponse.redirect(new URL(safeNext, request.url))
}
