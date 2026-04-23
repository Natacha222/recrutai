import { createClient } from '@/lib/supabase/server'

/**
 * Récupère le client Supabase authentifié et l'utilisateur courant depuis
 * la session cookie. À appeler au début de chaque server action pour
 * ajouter une défense en profondeur par-dessus proxy.ts :
 *   - proxy.ts redirige les GET non-auth sur /(app) vers /login, mais un
 *     POST direct sur l'URL d'une server action ne passe pas toujours le
 *     même flux (le proxy ne renvoie pas 401, il répond NextResponse.next
 *     puis la server action s'exécute avec user=null).
 *   - La RLS bloquerait ensuite la mutation, mais on préfère un message
 *     clair à l'utilisateur (« session expirée ») plutôt qu'une erreur
 *     DB opaque, et on évite un round-trip DB inutile.
 *   - Si un jour on déplace des routes hors de /(app), le guard reste
 *     valable par défaut.
 *
 * Retourne `{ supabase, user }`. Les actions renvoyant un redirect font
 * `redirect('/login')` si `user` est null ; celles qui renvoient un Result
 * renvoient `{ ok: false, error: 'Session expirée, reconnecte-toi.' }`.
 */
export async function getAuthedClient() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return { supabase, user }
}
