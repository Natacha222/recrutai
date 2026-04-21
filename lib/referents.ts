import type { createClient } from '@/lib/supabase/server'

type Supabase = Awaited<ReturnType<typeof createClient>>

/**
 * Retourne la liste triée (en français) des référents distincts connus de
 * l'app — union de `clients.am_referent` et `offres.am_referent`. Le caller
 * peut ajouter des référents supplémentaires (par ex. l'utilisateur connecté)
 * via `extraReferents`, pour garantir qu'ils apparaissent dans le select
 * même s'ils ne sont référents d'aucune entité existante.
 *
 * Format attendu des référents en base : « F. NOM » (voir `formatReferent`).
 */
export async function getAvailableReferents(
  supabase: Supabase,
  extraReferents: (string | null | undefined)[] = []
): Promise<string[]> {
  const [clientsRes, offresRes] = await Promise.all([
    supabase.from('clients').select('am_referent'),
    supabase.from('offres').select('am_referent'),
  ])

  const set = new Set<string>()
  const add = (r: unknown) => {
    if (typeof r === 'string' && r.trim() !== '') set.add(r)
  }

  for (const row of clientsRes.data ?? []) add(row.am_referent)
  for (const row of offresRes.data ?? []) add(row.am_referent)
  for (const r of extraReferents) add(r)

  return Array.from(set).sort((a, b) => a.localeCompare(b, 'fr'))
}
