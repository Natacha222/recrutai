'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

/**
 * Met à jour le mot de passe de l'utilisateur authentifié (typiquement
 * après clic sur le lien de reset reçu par email → callback PKCE qui
 * établit une session active).
 *
 * Refuse l'action si l'utilisateur n'a pas de session : dans ce cas on
 * renvoie vers /mot-de-passe-oublie avec un message clair. Sans ce
 * garde-fou, updateUser échouerait en interne sans message explicite.
 */
export async function updatePassword(formData: FormData) {
  const password = String(formData.get('password') ?? '')
  const confirm = String(formData.get('password_confirm') ?? '')

  if (password.length < 8) {
    return redirect(
      '/auth/reinitialiser?error=Le+mot+de+passe+doit+contenir+au+moins+8+caract%C3%A8res'
    )
  }
  if (password !== confirm) {
    return redirect(
      '/auth/reinitialiser?error=Les+deux+mots+de+passe+ne+correspondent+pas'
    )
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return redirect(
      '/mot-de-passe-oublie?error=Session+expir%C3%A9e%2C+merci+de+redemander+un+email'
    )
  }

  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    return redirect(
      `/auth/reinitialiser?error=${encodeURIComponent(error.message)}`
    )
  }

  // Le mot de passe est à jour et la session reste valide : on envoie
  // l'utilisateur directement dans son espace.
  redirect('/dashboard')
}
