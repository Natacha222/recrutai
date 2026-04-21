'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

/**
 * Calcule l'origine absolue (protocole + host) à partir des headers de la
 * requête. Supabase exige une URL absolue pour le `redirectTo` de l'email
 * de reset — on ne peut pas se contenter d'un chemin relatif.
 */
async function getOrigin(): Promise<string> {
  const h = await headers()
  const host = h.get('host') ?? 'localhost:3000'
  const proto =
    h.get('x-forwarded-proto') ??
    (host.startsWith('localhost') || host.startsWith('127.0.0.1')
      ? 'http'
      : 'https')
  return `${proto}://${host}`
}

/**
 * Envoie un email avec un lien de réinitialisation du mot de passe.
 * Le lien pointe vers /auth/callback qui échange le code PKCE contre une
 * session, puis redirige vers /auth/reinitialiser où l'utilisateur
 * saisit son nouveau mot de passe.
 *
 * Par sécurité on ne distingue pas les cas « email inconnu » / « email
 * trouvé » côté UI : on redirige dans les deux cas vers /login?reset_sent=1
 * avec un message neutre pour éviter de leaker l'existence d'un compte.
 */
export async function requestPasswordReset(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim()

  if (!email) {
    return redirect(
      '/mot-de-passe-oublie?error=L%27email+est+obligatoire'
    )
  }

  const supabase = await createClient()
  const origin = await getOrigin()
  const redirectTo = `${origin}/auth/callback?next=/auth/reinitialiser`

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo,
  })

  // En cas d'erreur technique (SMTP down, clé API invalide, etc.) on
  // préfère redirigier sur la page avec un message — mais on reste vague
  // pour ne pas révéler la nature de l'erreur à un attaquant.
  if (error) {
    console.error(`[requestPasswordReset] ${error.message}`)
    return redirect(
      '/mot-de-passe-oublie?error=Impossible+d%27envoyer+l%27email+pour+le+moment%2C+merci+de+r%C3%A9essayer+plus+tard'
    )
  }

  redirect('/login?reset_sent=1')
}
