'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export type UpdateCandidatureInfoResult =
  | { ok: true }
  | { ok: false; error: string }

// Format email minimaliste : on ne cherche pas à être RFC-compliant, juste à
// bloquer les saisies manifestement fausses (ex : espace, absence de @, pas
// de TLD). Les cas limites (quotes, caractères unicode…) passent sans drame.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Met à jour le nom et l'email d'une candidature depuis la page
 * /candidatures/incompletes. Utilisée quand l'IA n'a pas réussi à extraire
 * ces champs du PDF et que le recruteur les complète à la main.
 *
 * Ne touche pas au score ni à la justification : seule l'identité est
 * corrigée, le reste du scoring IA reste en l'état.
 */
export async function updateCandidatureInfo({
  id,
  nom,
  email,
}: {
  id: string
  nom: string
  email: string
}): Promise<UpdateCandidatureInfoResult> {
  if (!id) return { ok: false, error: 'Candidature introuvable.' }

  const cleanNom = nom.trim()
  const cleanEmail = email.trim()

  if (!cleanNom) return { ok: false, error: 'Le nom est obligatoire.' }
  if (!cleanEmail) return { ok: false, error: "L'email est obligatoire." }
  if (!EMAIL_RE.test(cleanEmail)) {
    return { ok: false, error: "Format d'email invalide." }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('candidatures')
    .update({ nom: cleanNom, email: cleanEmail })
    .eq('id', id)

  if (error) return { ok: false, error: error.message }

  revalidatePath('/candidatures/incompletes')
  revalidatePath('/dashboard')
  // On rafraîchit aussi la fiche offre d'où provient la candidature, mais
  // on ne connaît pas l'offre_id ici. Un `revalidatePath('/offres', 'layout')`
  // nukerait tout le layout offres, ce qui est overkill pour une édition
  // ponctuelle — le `Ctrl+F5` côté offre suffit si l'utilisateur veut voir
  // les changements tout de suite là-bas.
  return { ok: true }
}
