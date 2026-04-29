import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/**
 * Client Supabase avec privilèges admin (service_role).
 *
 * À UTILISER UNIQUEMENT côté serveur, dans des contextes sans utilisateur
 * connecté (cron jobs, webhooks). Ce client BYPASS toutes les RLS policies
 * — il a un accès total en lecture/écriture/suppression sur la DB et le
 * Storage.
 *
 * NE JAMAIS exposer SUPABASE_SERVICE_ROLE_KEY au client (pas de préfixe
 * NEXT_PUBLIC_) ni la committer dans le repo. Si la clé fuit, la régénérer
 * immédiatement via le dashboard Supabase → Settings → API → "Reset
 * service_role secret".
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) {
    throw new Error(
      'createAdminClient : NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant dans l\'env.'
    )
  }
  return createSupabaseClient(url, serviceRoleKey, {
    // Pas de session à persister — c'est un client one-shot pour scripts
    // backend, pas un client utilisateur.
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
