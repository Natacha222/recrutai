'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { formatReferent, normalizeClientName } from '@/lib/format'

const FORMULES = ['Abonnement', 'À la mission', 'Volume entreprise']

export async function createClientAction(formData: FormData) {
  const supabase = await createClient()

  const nom = String(formData.get('nom') ?? '').trim()
  const secteur = String(formData.get('secteur') ?? '').trim() || null
  const contact_email =
    String(formData.get('contact_email') ?? '').trim() || null
  const formuleRaw = String(formData.get('formule') ?? '').trim()
  const formule = FORMULES.includes(formuleRaw) ? formuleRaw : 'Abonnement'
  const am_referent = formatReferent(
    String(formData.get('am_referent') ?? '')
  )

  if (!nom) {
    return redirect('/clients/nouveau?error=Le+nom+est+obligatoire')
  }

  // Détection de doublon : compare le nom normalisé (casse/accents/espaces)
  // avec les noms existants. On bloque la création pour forcer l'utilisateur
  // à préciser ce qui différencie le nouveau client (filiale, ville, etc.).
  const { data: existing } = await supabase.from('clients').select('nom')
  const targetNorm = normalizeClientName(nom)
  const duplicate = (existing ?? []).find(
    (c) => normalizeClientName(c.nom ?? '') === targetNorm
  )
  if (duplicate) {
    // Le préfixe « Un client nommé » est reconnu par la page pour afficher
    // la bannière à 2 choix (abandonner / modifier le nom). Les options
    // détaillées sont fournies par la bannière, pas par ce message.
    const msg = `Un client nommé « ${duplicate.nom} » existe déjà.`
    return redirect(`/clients/nouveau?error=${encodeURIComponent(msg)}`)
  }

  const { data, error } = await supabase
    .from('clients')
    .insert({ nom, secteur, contact_email, formule, am_referent })
    .select('id')
    .single()

  if (error || !data) {
    const message = error?.message ?? 'Erreur+inconnue'
    return redirect(`/clients/nouveau?error=${encodeURIComponent(message)}`)
  }

  revalidatePath('/clients')
  redirect(`/clients/${data.id}`)
}
